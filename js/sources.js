import { parseGIF, decompressFrames } from '../vendor/gifuct.js';
import { MAX_FRAMES, STICKER_SIZE } from './config.js';

/**
 * A source exposes `width`, `height`, `duration` (seconds, 0 for stills) and
 * `frames({ start, length, fps })` → Promise<[{ image, duration(ms) }]>.
 */

// Keep enough pixels for a "cover" crop to 512, but no more (memory on phones).
function scaledSize(width, height) {
  const scale = Math.min(1, STICKER_SIZE / Math.min(width, height), (STICKER_SIZE * 2) / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function snapshot(drawable, width, height) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, scaledSize(width, height));
  canvas.getContext('2d').drawImage(drawable, 0, 0, canvas.width, canvas.height);
  return createImageBitmap(canvas);
}

/** Sample a [{ image, start, duration }] timeline at `fps`, merging repeated frames. */
function sample(timeline, { start, length, fps }) {
  const step = Math.max(1 / fps, length / MAX_FRAMES);
  const frames = [];
  let i = 0;
  for (let t = start; t < start + length - 1e-6; t += step) {
    while (i < timeline.length - 1 && timeline[i].start + timeline[i].duration <= t) i++;
    const last = frames[frames.length - 1];
    if (last?.image === timeline[i].image) last.duration += step * 1000;
    else frames.push({ image: timeline[i].image, duration: step * 1000 });
  }
  frames.forEach((f) => (f.duration = Math.round(f.duration)));
  return frames;
}

class StillSource {
  constructor(image) {
    this.image = image;
    this.width = image.width;
    this.height = image.height;
    this.duration = 0;
  }
  async frames() {
    return [{ image: this.image, duration: 0 }];
  }
}

class TimelineSource {
  constructor(timeline, width, height) {
    this.timeline = timeline;
    this.width = width;
    this.height = height;
    const last = timeline[timeline.length - 1];
    this.duration = last.start + last.duration;
  }
  async frames(range) {
    return sample(this.timeline, range);
  }
}

class VideoSource {
  constructor(video) {
    this.video = video;
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.duration = video.duration;
    this.queue = Promise.resolve();
  }

  #seek(time) {
    return new Promise((resolve) => {
      this.video.addEventListener('seeked', resolve, { once: true });
      this.video.currentTime = time;
    });
  }

  // Seeks share one <video>, so extraction requests run one after another.
  frames(range) {
    const run = this.queue.then(() => this.#extract(range));
    this.queue = run.catch(() => {});
    return run;
  }

  async #extract(range) {
    const times = [];
    const step = Math.max(1 / range.fps, range.length / MAX_FRAMES);
    const end = Math.min(this.duration, range.start + range.length);
    for (let t = range.start; t < end - 1e-6; t += step) times.push(t);

    const frames = [];
    for (const t of times) {
      await this.#seek(t);
      frames.push({ image: await snapshot(this.video, this.width, this.height), duration: Math.round(step * 1000) });
    }
    return frames;
  }
}

async function loadGif(blob) {
  const gif = parseGIF(await blob.arrayBuffer());
  const { width, height } = gif.lsd;
  const parts = decompressFrames(gif, true);
  if (!parts.length) throw new Error('This GIF has no frames.');

  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const patch = document.createElement('canvas');
  const timeline = [];
  let start = 0;
  let previous = null;
  let restore = null;

  for (const part of parts) {
    if (previous?.disposalType === 2) {
      const { left, top, width: w, height: h } = previous.dims;
      ctx.clearRect(left, top, w, h);
    } else if (previous?.disposalType === 3 && restore) {
      ctx.putImageData(restore, 0, 0);
    }
    if (part.disposalType === 3) restore = ctx.getImageData(0, 0, width, height);

    const { left, top, width: w, height: h } = part.dims;
    Object.assign(patch, { width: w, height: h });
    patch.getContext('2d').putImageData(new ImageData(part.patch, w, h), 0, 0);
    ctx.drawImage(patch, left, top);

    // Browsers play delays under 20 ms as 100 ms; match what people see.
    const duration = (part.delay < 20 ? 100 : part.delay) / 1000;
    timeline.push({ image: await snapshot(canvas, width, height), start, duration });
    start += duration;
    previous = part;
  }

  if (timeline.length === 1) return new StillSource(timeline[0].image);
  const size = scaledSize(width, height);
  return new TimelineSource(timeline, size.width, size.height);
}

async function loadVideo(blob) {
  const video = document.createElement('video');
  Object.assign(video, { muted: true, playsInline: true, preload: 'auto', src: URL.createObjectURL(blob) });
  video.setAttribute('playsinline', '');
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('This video format is not supported by your browser.')), { once: true });
  });
  // iOS Safari only decodes frames for seeking after playback has started once.
  await video.play().catch(() => {});
  video.pause();
  return new VideoSource(video);
}

async function loadStill(blob) {
  const bitmap = await createImageBitmap(blob);
  const image = await snapshot(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return new StillSource(image);
}

async function sniff(blob) {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.slice(4, 8) === 'ftyp' || ascii.startsWith('\x1aE\xdf\xa3')) return 'video';
  if (blob.type.startsWith('video/')) return 'video';
  return 'image';
}

const LOADERS = { gif: loadGif, video: loadVideo, image: loadStill };

export async function createSource(blob) {
  return LOADERS[await sniff(blob)](blob);
}
