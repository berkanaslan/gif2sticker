// Encodes sticker frames off the main thread, shrinking the output until it fits a size limit.
//  - gif:  what you copy & paste into WhatsApp mobile (it turns it into an animated sticker)
//  - webp: WhatsApp's native sticker format (for WhatsApp Web/Desktop)
import createWebpModule from '../vendor/webp-wasm.js';
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.js';

const MAX_DECIMATION = 3;
const PALETTE_SAMPLE_FRAMES = 8;

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

async function encodeWebp(frames, size, { quality }) {
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

/** One global palette from evenly spaced frames keeps colors stable and the file small. */
function paletteFor(frames, colors) {
  const step = Math.max(1, Math.floor(frames.length / PALETTE_SAMPLE_FRAMES));
  const picked = frames.filter((_, i) => i % step === 0).slice(0, PALETTE_SAMPLE_FRAMES);
  const sample = new Uint8Array(picked.reduce((n, f) => n + f.data.length, 0));
  picked.reduce((offset, f) => (sample.set(f.data, offset), offset + f.data.length), 0);
  return quantize(sample, colors, { format: 'rgba4444', oneBitAlpha: true });
}

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

const DISPOSE_KEEP = 1; // next frame draws on top of this one
const DISPOSE_CLEAR = 2; // area is cleared to transparent before the next frame

/** Quantized palette that always has a fully transparent entry (needed for delta frames). */
function transparentPalette(frames, colors) {
  const palette = paletteFor(frames, colors - 1);
  let index = palette.findIndex((color) => color[3] === 0);
  if (index < 0) index = palette.push([0, 0, 0, 0]) - 1;
  return { palette, transparent: index };
}

/**
 * Inter-frame optimisation: pixels that didn't change are written as transparent so the
 * previous frame shows through, which compresses far better. If a pixel turns transparent,
 * the previous frame is cleared instead and the frame is written in full.
 */
function deltaFrames(indexed, transparent) {
  return indexed.map((pixels, i) => {
    const previous = indexed[i - 1];
    const next = indexed[i + 1];
    const clearsAfter = next ? next.some((p, k) => p === transparent && pixels[k] !== transparent) : false;
    const clearedBefore = previous ? pixels.some((p, k) => p === transparent && previous[k] !== transparent) : true;
    const data = clearedBefore ? pixels : pixels.map((p, k) => (p === previous[k] ? transparent : p));
    return { data, dispose: clearsAfter ? DISPOSE_CLEAR : DISPOSE_KEEP };
  });
}

// Pasted GIFs are rescaled by WhatsApp, so a smaller GIF beats dropping frames.
function encodeGif(frames, size, { side, colors }) {
  const scaled = frames.map((f) => ({ ...f, data: resize(f.data, size, side) }));
  const { palette, transparent } = transparentPalette(scaled, colors);
  const indexed = scaled.map((f) => applyPalette(f.data, palette, 'rgba4444'));
  const gif = GIFEncoder();
  deltaFrames(indexed, transparent).forEach(({ data, dispose }, i) => {
    gif.writeFrame(data, side, side, {
      palette: i === 0 ? palette : undefined,
      delay: scaled[i].duration,
      transparent: true,
      transparentIndex: transparent,
      dispose,
    });
  });
  gif.finish();
  return gif.bytes();
}

// Each format lists the knob it turns (from best to smallest) before dropping frames.
const FORMATS = {
  webp: { encode: encodeWebp, knobs: [80, 55, 30].map((quality) => ({ quality })) },
  gif: {
    encode: encodeGif,
    knobs: [
      { side: 512, colors: 256 },
      { side: 448, colors: 256 },
      { side: 384, colors: 256 },
      { side: 320, colors: 192 },
    ],
  },
};

async function encodeToFit({ format, frames, size, limit }, report) {
  const { encode, knobs } = FORMATS[format];
  const steps = frames.length > 1 ? MAX_DECIMATION : 1;
  const total = steps * knobs.length;
  let best = null;
  let attempt = 0;
  for (let step = 1; step <= steps; step++) {
    const subset = decimate(frames, step);
    for (const knob of knobs) {
      report(++attempt / total);
      const bytes = await encode(subset, size, knob);
      if (!bytes) throw new Error(`${format.toUpperCase()} encoding failed.`);
      const result = { bytes, frames: subset.length, fits: bytes.length <= limit };
      if (result.fits) return result;
      if (!best || bytes.length < best.bytes.length) best = result;
    }
  }
  return best;
}

self.onmessage = async ({ data: job }) => {
  const report = (progress) => self.postMessage({ id: job.id, progress });
  try {
    const result = await encodeToFit(job, report);
    self.postMessage({ id: job.id, result }, [result.bytes.buffer]);
  } catch (err) {
    self.postMessage({ id: job.id, error: err.message ?? String(err) });
  }
};
