// Encodes sticker frames off the main thread, shrinking the output until it fits a size limit.
//  - gif:  what you copy & paste into WhatsApp mobile (it turns it into an animated sticker)
//  - webp: WhatsApp's native sticker format (for WhatsApp Web/Desktop)
import createWebpModule from '../vendor/webp-wasm.js';
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.js';

const MAX_DECIMATION = 3;
const PALETTE_SAMPLE_FRAMES = 12;
const ALPHA_CUTOFF = 128; // GIF transparency is on/off
const DISPOSE_KEEP = 1; // next frame draws on top of this one
const DISPOSE_CLEAR = 2; // area is cleared to transparent before the next frame

let webpModule;
const webp = () => (webpModule ??= createWebpModule());

/** Keep every `step`-th frame, folding the dropped frames' time into it. */
function decimate(frames, step) {
  if (step === 1) return frames;
  const out = [];
  frames.forEach((frame, i) => {
    if (i % step === 0) out.push({ ...frame });
    else out[out.length - 1].duration += frame.duration;
  });
  return out;
}

// ---------- WebP ----------

async function encodeWebp(frames, size, { quality }, onProgress) {
  onProgress(0.5); // a single WASM call: no finer progress available
  const mod = await webp();
  const config = { lossless: 0, quality };
  if (frames.length === 1) return mod.encode(frames[0].data, size, size, true, config)?.slice();

  const vector = new mod.VectorWebPAnimationFrame();
  try {
    frames.forEach(({ data, duration }) => vector.push_back({ data, duration, config, has_config: true }));
    return mod.encodeAnimation(size, size, true, vector)?.slice();
  } finally {
    vector.delete();
  }
}

// ---------- GIF ----------

/** Bilinear RGBA downscale of a square `from`×`from` bitmap to `to`×`to`. */
function resize(src, from, to) {
  if (from === to) return src;
  const out = new Uint8Array(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y++) {
    const sy = Math.max(0, (y + 0.5) * ratio - 0.5);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, from - 1);
    const fy = sy - y0;
    for (let x = 0; x < to; x++) {
      const sx = Math.max(0, (x + 0.5) * ratio - 0.5);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, from - 1);
      const fx = sx - x0;
      const a = (y0 * from + x0) * 4, b = (y0 * from + x1) * 4, c = (y1 * from + x0) * 4, d = (y1 * from + x1) * 4;
      const o = (y * to + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = src[a + k] + (src[b + k] - src[a + k]) * fx;
        const bottom = src[c + k] + (src[d + k] - src[c + k]) * fx;
        out[o + k] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

/** Opaque pixels of evenly spaced frames: transparent ones would skew the palette towards black. */
function paletteSample(frames) {
  const step = Math.max(1, Math.floor(frames.length / PALETTE_SAMPLE_FRAMES));
  const picked = frames.filter((_, i) => i % step === 0).slice(0, PALETTE_SAMPLE_FRAMES);
  const pixels = new Uint8Array(picked.reduce((n, f) => n + f.data.length, 0));
  let length = 0;
  for (const { data } of picked) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < ALPHA_CUTOFF) continue;
      pixels.set(data.subarray(i, i + 3), length);
      pixels[length + 3] = 255;
      length += 4;
    }
  }
  return pixels.subarray(0, length);
}

/** One shared full-color (RGB565) palette, plus a transparent entry at the end. */
function buildPalette(frames, colors) {
  const sample = paletteSample(frames);
  const palette = sample.length ? quantize(sample, colors - 1) : [];
  return { colors: palette, transparent: palette.push([0, 0, 0]) - 1 };
}

function toIndices(rgba, { colors, transparent }) {
  const opaque = colors.slice(0, transparent); // never map a real color to the transparent slot
  const indices = opaque.length ? applyPalette(rgba, opaque) : new Uint8Array(rgba.length / 4);
  for (let p = 0; p < indices.length; p++) if (rgba[p * 4 + 3] < ALPHA_CUTOFF) indices[p] = transparent;
  return indices;
}

/** similar[a * 256 + b] is 1 when palette colors a and b are within `tolerance` of each other. */
function similarityTable({ colors }, tolerance) {
  const table = new Uint8Array(256 * 256);
  const limit = tolerance * tolerance * 3;
  colors.forEach(([r1, g1, b1], a) => {
    colors.forEach(([r2, g2, b2], b) => {
      table[a * 256 + b] = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2 <= limit ? 1 : 0;
    });
  });
  return table;
}

/**
 * Inter-frame optimisation: pixels that look unchanged (within `tolerance`) are written as
 * transparent so what's already on screen shows through, which compresses far better. When a
 * pixel must turn transparent, the previous frame is cleared and this frame is written in full.
 */
function deltaFrames(indexed, palette, tolerance) {
  const { transparent } = palette;
  const similar = tolerance > 0 ? similarityTable(palette, tolerance) : null;
  const out = [];
  let shown = null; // palette index currently on screen, per pixel

  for (const pixels of indexed) {
    const mustClear = !shown || pixels.some((p, k) => p === transparent && shown[k] !== transparent);
    if (mustClear) {
      if (out.length) out[out.length - 1].dispose = DISPOSE_CLEAR;
      shown = pixels.slice();
      out.push({ data: pixels, dispose: DISPOSE_KEEP });
      continue;
    }
    const data = new Uint8Array(pixels.length);
    for (let k = 0; k < pixels.length; k++) {
      const p = pixels[k];
      const s = shown[k];
      const unchanged = p === s || (similar && s !== transparent && similar[p * 256 + s]);
      if (unchanged) data[k] = transparent;
      else data[k] = shown[k] = p;
    }
    out.push({ data, dispose: DISPOSE_KEEP });
  }
  return out;
}

// Pasted GIFs are rescaled by WhatsApp, so a smaller GIF beats dropping frames.
function encodeGif(frames, size, { side, tolerance }, onProgress) {
  const scaled = frames.map((f) => ({ ...f, data: resize(f.data, size, side) }));
  const palette = buildPalette(scaled, 256);
  // Progress: first half maps colors, second half writes frames.
  const indexed = scaled.map((f, i) => (onProgress((i + 1) / scaled.length / 2), toIndices(f.data, palette)));
  const gif = GIFEncoder();
  const deltas = deltaFrames(indexed, palette, tolerance);
  deltas.forEach(({ data, dispose }, i) => {
    onProgress(0.5 + (i + 1) / deltas.length / 2);
    gif.writeFrame(data, side, side, {
      palette: i === 0 ? palette.colors : undefined,
      delay: scaled[i].duration,
      transparent: true,
      transparentIndex: palette.transparent,
      dispose,
    });
  });
  gif.finish();
  return gif.bytes();
}

// ---------- fit to size ----------

// Each format lists its settings from best to smallest; frames are dropped only after all fail.
const FORMATS = {
  webp: { encode: encodeWebp, knobs: [80, 55, 30].map((quality) => ({ quality })) },
  gif: {
    encode: encodeGif,
    knobs: [
      { side: 512, tolerance: 0 },
      { side: 512, tolerance: 6 },
      { side: 512, tolerance: 12 },
      { side: 448, tolerance: 12 },
      { side: 384, tolerance: 16 },
      { side: 320, tolerance: 20 },
    ],
  },
};

async function encodeToFit({ format, frames, size, limit }, report) {
  const { encode, knobs } = FORMATS[format];
  const steps = frames.length > 1 ? MAX_DECIMATION : 1;
  let best = null;
  let attempt = 0;
  for (let step = 1; step <= steps; step++) {
    const subset = decimate(frames, step);
    for (const knob of knobs) {
      const current = attempt++;
      report({ progress: 0, attempt: current });
      const bytes = await encode(subset, size, knob, (progress) => report({ progress, attempt: current }));
      if (!bytes) throw new Error(`${format.toUpperCase()} encoding failed.`);
      const result = { bytes, frames: subset.length, fits: bytes.length <= limit };
      if (result.fits) return result;
      if (!best || bytes.length < best.bytes.length) best = result;
    }
  }
  return best;
}

self.onmessage = async ({ data: job }) => {
  const report = ({ progress, attempt }) => self.postMessage({ id: job.id, progress, attempt });
  try {
    const result = await encodeToFit(job, report);
    self.postMessage({ id: job.id, result }, [result.bytes.buffer]);
  } catch (err) {
    self.postMessage({ id: job.id, error: err.message ?? String(err) });
  }
};
