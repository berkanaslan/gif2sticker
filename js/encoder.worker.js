// Runs libwebp (WASM) off the main thread and shrinks output until it fits WhatsApp's limit.
import createModule from '../vendor/webp-wasm.js';

const QUALITIES = [80, 55, 30];
const MAX_DECIMATION = 3;
let modulePromise;
const webp = () => (modulePromise ??= createModule());

/** Keep every `step`-th frame, folding the dropped frames' time into it. */
function decimate(frames, step) {
  const out = [];
  frames.forEach((frame, i) => {
    if (i % step === 0) out.push({ ...frame });
    else out[out.length - 1].duration += frame.duration;
  });
  return out;
}

function encodeOnce(mod, { size, frames }, quality) {
  const config = { lossless: 0, quality };
  if (frames.length === 1) return mod.encode(frames[0].data, size, size, true, config);

  const vector = new mod.VectorWebPAnimationFrame();
  try {
    frames.forEach(({ data, duration }) => vector.push_back({ data, duration, config, has_config: true }));
    return mod.encodeAnimation(size, size, true, vector);
  } finally {
    vector.delete();
  }
}

async function encodeToFit(job, report) {
  const mod = await webp();
  const attempts = MAX_DECIMATION * QUALITIES.length;
  let best = null;
  let n = 0;
  for (let step = 1; step <= MAX_DECIMATION; step++) {
    const frames = step === 1 ? job.frames : decimate(job.frames, step);
    for (const quality of QUALITIES) {
      report(++n / attempts);
      const result = encodeOnce(mod, { size: job.size, frames }, quality);
      if (!result) throw new Error('WebP encoding failed.');
      const bytes = result.slice();
      if (!best || bytes.length < best.bytes.length) best = { bytes, quality, frames: frames.length };
      if (bytes.length <= job.limit) return { bytes, quality, frames: frames.length, fits: true };
    }
    if (frames.length === 1) break;
  }
  return { ...best, fits: false };
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
