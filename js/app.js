import { MAX_DURATION_S, STICKER_SIZE } from './config.js';
import { createSource } from './sources.js';
import { parseTweetId, resolveTweetMedia } from './twitter.js';
import { fetchBlob } from './net.js';
import { encodeSticker } from './encoder.js';
import { withStickerMetadata } from './webp-meta.js';
import { PreviewPlayer } from './preview.js';
import { bindHold } from './hold.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  source: $('#source'),
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
  status: $('#status'),
  send: $('#send'),
  sendLabel: $('#send .label'),
  save: $('#save'),
  toast: $('#toast'),
};

const SWATCHES = ['#ffffff', '#000000', '#25d366', '#ffd60a', '#ff3b6b', '#3d8bff'];
const STYLE_STORAGE_KEY = 'gif2sticker.style';
const NUMERIC_FIELDS = ['borderWidth', 'captionSize', 'start', 'clip', 'fps'];
const ENCODE_IDLE_MS = 900;
const MIN_TRIMMABLE_S = 1;

const player = new PreviewPlayer(ui.preview);
const state = {
  source: null,
  frames: [],
  version: 0, // bumps on every edit; results from older versions are discarded
  job: null, // { version, promise, progress }
  sticker: null, // { version, file, url, info }
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

function setSendLabel(text) {
  ui.sendLabel.textContent = text;
}

function renderStatus() {
  const { sticker, job } = state;
  const ready = sticker?.version === state.version;
  ui.result.hidden = !ready;
  ui.preview.hidden = ready;
  ui.save.disabled = !ready;
  ui.send.disabled = !state.frames.length;

  if (ready) {
    const { kb, frames, fits } = sticker.info;
    ui.status.textContent = fits
      ? `${kb} KB · ${frames} frame${frames > 1 ? 's' : ''} · ready for WhatsApp ✓`
      : `${kb} KB is over WhatsApp's limit — shorten it or choose “Light”.`;
    ui.status.classList.toggle('warn', !fits);
    setSendLabel(ui.send.classList.contains('armed') ? 'Release to send' : 'Hold, then release to send');
  } else if (job?.version === state.version) {
    ui.status.classList.remove('warn');
    ui.status.textContent = `Making sticker… ${Math.round(job.progress * 100)}%`;
    setSendLabel(ui.send.classList.contains('armed') ? 'Preparing… keep holding' : 'Preparing…');
  } else {
    ui.status.classList.remove('warn');
    ui.status.textContent = 'Live preview';
    setSendLabel('Hold, then release to send');
  }
}

function ensureSticker() {
  const version = state.version;
  if (state.sticker?.version === version) return Promise.resolve(state.sticker);
  if (state.job?.version === version) return state.job.promise;

  const style = readForm(ui.style);
  const job = { version, progress: 0 };
  job.promise = encodeSticker(state.frames, style, (progress) => {
    job.progress = progress;
    renderStatus();
  })
    .then(({ bytes, frames, fits }) => {
      if (version !== state.version) return null;
      const webp = withStickerMetadata(bytes, stickerMetadata(style), STICKER_SIZE);
      const file = new File([webp], `sticker-${Date.now()}.webp`, { type: 'image/webp' });
      if (state.sticker) URL.revokeObjectURL(state.sticker.url);
      state.sticker = { version, file, url: URL.createObjectURL(file), info: { kb: Math.ceil(webp.length / 1024), frames, fits } };
      ui.result.src = state.sticker.url;
      return state.sticker;
    })
    .catch((err) => {
      toast(err.message);
      return null;
    })
    .finally(() => {
      if (state.job === job) state.job = null;
      renderStatus();
    });
  state.job = job;
  renderStatus();
  return job.promise;
}

const scheduleSticker = debounce(() => state.frames.length && ensureSticker(), ENCODE_IDLE_MS);

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

// Must run synchronously inside a user gesture (iOS Safari requirement for navigator.share).
function share(file) {
  const data = { files: [file] };
  if (navigator.canShare?.(data)) {
    navigator.share(data).catch((err) => err.name !== 'AbortError' && download(file));
  } else {
    download(file);
    toast('Saved. Send the .webp file to WhatsApp to use it as a sticker.');
  }
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
  clip.value = clip.max;
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
  ui.editor.hidden = !visible;
  ui.actions.hidden = !visible;
  ui.restart.hidden = !visible;
}

async function load(blobPromise, label = 'Loading…') {
  ui.source.classList.add('busy');
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
    ui.source.classList.remove('busy');
  }
}

async function blobFromLink(text) {
  const url = text.match(/https?:\/\/\S+/)?.[0] ?? text.trim();
  const tweetId = parseTweetId(url);
  return fetchBlob(tweetId ? await resolveTweetMedia(tweetId) : url);
}

const loadLink = (text) => load(blobFromLink(text), parseTweetId(text) ? 'Fetching the post’s GIF…' : 'Downloading…');

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
    if (e.target.closest?.('#style')) return;
    const file = [...(e.clipboardData?.files ?? [])][0];
    const text = e.clipboardData?.getData('text');
    if (file) load(Promise.resolve(file));
    else if (text && /https?:\/\//.test(text) && e.target !== ui.link.elements.url) loadLink(text);
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text');
    if (file) load(Promise.resolve(file));
    else if (text) loadLink(text);
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

function setupSend() {
  bindHold(ui.send, {
    onStart: () => ensureSticker(),
    onArmed: renderStatus,
    onRelease: (armed) => {
      const ready = state.sticker?.version === state.version;
      renderStatus();
      if (!armed) return toast('Hold the button, then release to send.');
      if (!ready) return toast('Almost ready — hold & release again in a moment.');
      share(state.sticker.file);
    },
    onCancel: renderStatus,
  });
  ui.save.addEventListener('click', () => state.sticker && download(state.sticker.file));
}

setupSwatches();
setupInputs();
setupEditor();
setupSend();

const sharedUrl = new URLSearchParams(location.search).get('url') ?? new URLSearchParams(location.search).get('text');
if (sharedUrl) loadLink(sharedUrl);
