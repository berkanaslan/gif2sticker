import { ANIMATED_LIMIT_BYTES, STATIC_LIMIT_BYTES, STICKER_SIZE } from './config.js';
import { renderSticker } from './renderer.js';

let worker;
let nextId = 0;
const jobs = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    if (!job) return;
    if ('progress' in data) return job.onProgress?.(data.progress);
    jobs.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.result);
  };
  return worker;
}

/** Renders every frame with `style` and returns RGBA buffers ready for the encoder. */
function renderFrames(frames, style) {
  const canvas = Object.assign(document.createElement('canvas'), { width: STICKER_SIZE, height: STICKER_SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return frames.map(({ image, duration }) => {
    renderSticker(ctx, image, style);
    return { data: new Uint8Array(ctx.getImageData(0, 0, STICKER_SIZE, STICKER_SIZE).data.buffer), duration };
  });
}

/** Resolves to { bytes: Uint8Array, quality, frames, fits }. */
export function encodeSticker(frames, style, onProgress) {
  const rendered = renderFrames(frames, style);
  const limit = rendered.length > 1 ? ANIMATED_LIMIT_BYTES : STATIC_LIMIT_BYTES;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    getWorker().postMessage(
      { id, size: STICKER_SIZE, frames: rendered, limit },
      rendered.map((f) => f.data.buffer),
    );
  });
}
