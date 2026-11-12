import { MAX_DURATION_S, STICKER_SIZE } from './config.js';
import { createSource } from './sources.js';
import { parseTweetId, resolveTweetMedia } from './twitter.js';
import { readTransfer } from './transfer.js';
import { fetchBlob, LinkError } from './net.js';
import { encodeSticker } from './encoder.js';
import { withStickerMetadata } from './webp-meta.js';
import { PreviewPlayer } from './preview.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  source: $('#source'),
  guide: $('#guide'),
  editor: $('#editor'),
  actions: $('#actions'),
  restart: $('#restart'),
  file: $('#file'),
  link: $('#link'),
  paste: $('#paste'),
  style: $('#style'),
  timing: $('#timing'),
  timingInfo: $('#timing-info'),
  preview: $('#preview'),
  result: $('#result'),
  stage: $('#stage'),
  busy: $('#busy'),
  busyLabel: $('#busy-label'),
  busyBar: $('#busy-bar'),
  status: $('#status'),
  saveGif: $('#save-gif'),
  saveWebp: $('#save-webp'),
  toast: $('#toast'),
};

const SWATCHES = ['#ffffff', '#000000', '#25d366', '#ffd60a', '#ff3b6b', '#3d8bff'];
const STYLE_STORAGE_KEY = 'gif2sticker.style';
const NUMERIC_FIELDS = ['borderWidth', 'captionSize', 'start', 'clip', 'fps'];
const ENCODE_IDLE_MS = 900;
const MIN_TRIMMABLE_S = 1;
const DEFAULT_CLIP_S = 4; // short loops stay under WhatsApp's size limit with good quality
// Preview collapses past COLLAPSE_AT and expands above EXPAND_AT (the gap prevents flicker).
const COLLAPSE_AT_PX = 120;
const EXPAND_AT_PX = 40;
const MINI_PREVIEW_PX = 104;

const player = new PreviewPlayer(ui.preview);
const state = {
  source: null,
  frames: [],
  version: 0, // bumps on every edit; results from older versions are discarded
  outputs: {}, // format → { version, file, url, info }
  jobs: {}, // format → { version, promise, progress }
};

// GIF is what gets copied & pasted into WhatsApp mobile; WebP is WhatsApp's native sticker file.
const FORMATS = {
  gif: { type: 'image/gif', finish: (bytes) => bytes },
  webp: { type: 'image/webp', finish: (bytes, style) => withStickerMetadata(bytes, stickerMetadata(style), STICKER_SIZE) },
};

// ---------- small helpers ----------

function readForm(form) {
  const values = Object.fromEntries(new FormData(form));
  NUMERIC_FIELDS.forEach((key) => key in values && (values[key] = Number(values[key])));
  return values;
}

function writeForm(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements[name];
    if (field instanceof RadioNodeList) field.value = value;
    else if (field) field.value = value;
  }
}

const storage = {
  load: (key) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? {};
    } catch {
      return {};
    }
  },
  save: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / storage disabled: preferences just aren't remembered */
    }
  },
};

let toastTimer;
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidden = true), 3500);
}

const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const graphemes = (text) =>
  typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter().segment(text)].map((s) => s.segment)
    : Array.from(text);

function stickerMetadata(style) {
  return {
    'sticker-pack-id': 'gif2sticker',
    'sticker-pack-name': style.packName.trim() || 'GIF to Sticker',
    'sticker-pack-publisher': style.publisher.trim() || 'gif2sticker',
    emojis: graphemes(style.emojis).filter((g) => g.trim()).slice(0, 3),
  };
}

// ---------- sticker lifecycle ----------

const current = (format) => (state.outputs[format]?.version === state.version ? state.outputs[format] : null);
const running = (format) => (state.jobs[format]?.version === state.version ? state.jobs[format] : null);

function renderStatus() {
  const gif = current('gif');
  const job = running('gif') ?? running('webp');
  ui.result.hidden = !gif;
  ui.preview.hidden = !!gif;
  ui.saveGif.disabled = !gif;
  ui.saveWebp.disabled = !state.frames.length;
  ui.status.classList.toggle('warn', !!gif && !gif.info.fits);

  // Progress shows on the (sticky) preview and on the always-visible Save button.
  const percent = job?.progress ? ` ${Math.round(job.progress * 100)}%` : '';
  ui.busy.hidden = !job;
  ui.busyBar.style.width = job ? `${Math.max(8, job.progress * 100)}%` : '0';
  ui.saveGif.textContent = job && !gif ? `Making…${percent}` : 'Save GIF';

  if (job) {
    const label = job.attempt > 0 ? 'Shrinking to fit' : job === running('webp') ? 'Making WebP' : 'Making sticker';
    ui.busyLabel.textContent = `${label}…${percent}`;
    ui.status.textContent = `${label}…`;
  } else if (gif) {
    const { kb, frames, fits } = gif.info;
    ui.status.textContent = fits
      ? `${kb} KB · ${frames} frame${frames > 1 ? 's' : ''} · ready ✓`
      : `${kb} KB is large — WhatsApp may not offer it as a sticker. Shorten it or choose “Light”.`;
  } else {
    ui.status.textContent = 'Live preview';
  }
}

/** Encodes the current frames + style as `format`, reusing the result until something changes. */
function ensureOutput(format) {
  const version = state.version;
  if (current(format)) return Promise.resolve(current(format));
  if (running(format)) return running(format).promise;

  const style = readForm(ui.style);
  const job = { version, progress: 0, attempt: 0 };
  job.promise = encodeSticker(state.frames, style, format, ({ progress, attempt }) => {
    Object.assign(job, { progress, attempt });
    renderStatus();
  })
    .then(({ bytes, frames, fits }) => {
      if (version !== state.version) return null;
      const { type, finish } = FORMATS[format];
      const data = finish(bytes, style);
      const file = new File([data], `sticker-${Date.now()}.${format}`, { type });
      if (state.outputs[format]) URL.revokeObjectURL(state.outputs[format].url);
      const output = { version, file, url: URL.createObjectURL(file), info: { kb: Math.ceil(data.length / 1024), frames, fits } };
      state.outputs[format] = output;
      // The fragment makes Chrome on iOS copy the original (animated) bytes instead of a still frame.
      if (format === 'gif') ui.result.src = `${output.url}#sticker.gif`;
      return output;
    })
    .catch((err) => {
      toast(err.message);
      return null;
    })
    .finally(() => {
      if (state.jobs[format] === job) delete state.jobs[format];
      renderStatus();
    });
  state.jobs[format] = job;
  renderStatus();
  return job.promise;
}

const scheduleSticker = debounce(() => state.frames.length && ensureOutput('gif'), ENCODE_IDLE_MS);

function changed() {
  state.version++;
  player.show(state.frames, readForm(ui.style));
  renderStatus();
  scheduleSticker();
}

function download(file) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}


// ---------- loading ----------

const formatSeconds = (s) => `${s.toFixed(1)}s`;

function syncTimingOutputs() {
  const { start, clip, startOut, clipOut } = ui.timing.elements;
  startOut.value = formatSeconds(Number(start.value));
  clipOut.value = formatSeconds(Number(clip.value));
}

function setupTiming(duration) {
  ui.timing.hidden = duration < MIN_TRIMMABLE_S;
  const { start, clip } = ui.timing.elements;
  start.max = Math.max(0, duration - 0.5).toFixed(1);
  start.value = 0;
  clip.max = Math.min(MAX_DURATION_S, duration).toFixed(1);
  clip.value = Math.min(DEFAULT_CLIP_S, duration).toFixed(1);
  ui.timingInfo.textContent = `(clip is ${formatSeconds(duration)}, max ${MAX_DURATION_S}s)`;
  syncTimingOutputs();
}

let framesRequest = 0;
async function refreshFrames() {
  const { source } = state;
  if (!source) return;
  const request = ++framesRequest;
  const { start, clip, fps } = readForm(ui.timing);
  const range = { start, fps, length: Math.min(clip, source.duration - start) };
  ui.status.textContent = 'Reading frames…';
  const frames = await source.frames(range);
  if (request !== framesRequest || !frames.length) return;
  state.frames = frames;
  changed();
}

function showEditor(visible) {
  ui.source.hidden = visible;
  ui.guide.hidden = visible;
  ui.editor.hidden = !visible;
  ui.actions.hidden = !visible;
  ui.restart.hidden = !visible;
}

async function load(blobPromise, label = 'Loading…') {
  ui.source.classList.add('loading');
  toast(label);
  try {
    const source = await createSource(await blobPromise);
    state.source = source;
    state.frames = [];
    setupTiming(source.duration);
    showEditor(true);
    await refreshFrames();
    ui.toast.hidden = true;
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not open that file.');
  } finally {
    ui.source.classList.remove('loading');
  }
}

const LINK_HELP = 'Drag the GIF onto this page instead, or save it and choose the file.';

/** X/Twitter posts are resolved to their media; any other link is a file or a page with a GIF/video. */
async function blobFromLink(text) {
  // Anything that isn't a web link stays on the device: no request is made for it.
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new LinkError('Paste a link that starts with https://');
  const tweetId = parseTweetId(url);
  if (tweetId) return fetchBlob(await resolveTweetMedia(tweetId));
  return fetchBlob(url).catch((err) => {
    throw err instanceof LinkError ? new LinkError(`${err.message} ${LINK_HELP}`) : err;
  });
}

const loadLink = (text) => load(blobFromLink(text), parseTweetId(text) ? 'Fetching the post’s GIF…' : 'Downloading…');

/** Loads a drop or paste, fetching the animated original when the browser only handed over a still. */
async function loadTransfer(data) {
  const { file, url } = readTransfer(data);
  if (!url) return file && load(Promise.resolve(file));
  if (!file) return loadLink(url);
  let gotStill = false;
  const original = fetchBlob(url).catch(() => {
    gotStill = true;
    return file;
  });
  await load(original, 'Fetching the animated GIF…');
  if (gotStill) toast('That site only let us take a still image. Save the GIF to your device and choose it instead.');
}

// ---------- wiring ----------

function setupSwatches() {
  document.querySelectorAll('.swatches').forEach((group) => {
    const input = group.querySelector('input[type=color]');
    SWATCHES.forEach((color) => {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'swatch', title: color });
      button.style.background = color;
      button.addEventListener('click', () => {
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      input.before(button);
    });
  });
}

function setupInputs() {
  ui.file.addEventListener('change', () => ui.file.files[0] && load(Promise.resolve(ui.file.files[0])));

  ui.link.addEventListener('submit', (e) => {
    e.preventDefault();
    loadLink(ui.link.elements.url.value);
  });

  ui.paste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      ui.link.elements.url.value = text;
      loadLink(text);
    } catch {
      ui.link.elements.url.focus();
      toast('Long-press the box and choose Paste.');
    }
  });

  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('#style') || !e.clipboardData) return;
    // Typing or pasting into the link box is handled by its own form.
    if (e.target === ui.link.elements.url && !e.clipboardData.files.length) return;
    loadTransfer(e.clipboardData);
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer) loadTransfer(e.dataTransfer);
  });

  ui.restart.addEventListener('click', () => {
    state.source = null;
    state.frames = [];
    ui.file.value = '';
    showEditor(false);
  });
}

function setupEditor() {
  writeForm(ui.style, storage.load(STYLE_STORAGE_KEY));
  ui.style.addEventListener('input', () => {
    const { captionText, ...prefs } = readForm(ui.style);
    storage.save(STYLE_STORAGE_KEY, prefs);
    changed();
  });
  ui.style.addEventListener('submit', (e) => e.preventDefault());

  const refresh = debounce(refreshFrames, 250);
  ui.timing.addEventListener('input', () => {
    syncTimingOutputs();
    refresh();
  });
}

/** The sticky preview shrinks to a corner thumbnail while scrolled down, and grows back at the top. */
function setupStage() {
  const isCollapsed = () => ui.stage.classList.contains('collapsed');
  const sizeMini = () => {
    // offsetWidth / clientWidth ignore transforms, so this is safe to measure while collapsed.
    const width = ui.stage.offsetWidth;
    ui.stage.style.setProperty('--mini-scale', String(MINI_PREVIEW_PX / width));
    ui.stage.style.setProperty('--mini-shift', `${(ui.editor.clientWidth - width) / 2}px`);
  };
  const update = () => {
    if (!isCollapsed() && window.scrollY > COLLAPSE_AT_PX) {
      sizeMini();
      ui.stage.classList.add('collapsed');
    } else if (isCollapsed() && window.scrollY < EXPAND_AT_PX) {
      ui.stage.classList.remove('collapsed');
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', sizeMini);
  ui.stage.addEventListener('click', () => isCollapsed() && window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function setupExport() {
  ui.saveGif.addEventListener('click', () => current('gif') && download(current('gif').file));
  ui.saveWebp.addEventListener('click', async () => {
    const webp = await ensureOutput('webp');
    if (webp) download(webp.file);
  });
}

setupSwatches();
setupInputs();
setupEditor();
setupStage();
setupExport();

const sharedUrl = new URLSearchParams(location.search).get('url') ?? new URLSearchParams(location.search).get('text');
if (sharedUrl) loadLink(sharedUrl);
