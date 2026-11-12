// Browsers hand over a still snapshot when an image is dragged or copied from a web page
// (e.g. from Google Images), even if the page shows an animated GIF. The original's URL
// usually travels along in the drag/clipboard data, so it is used instead when it looks animated.
const ANIMATED_TYPE = /^(?:image\/gif|video\/)/i;
const ANIMATED_URL = /\.(?:gif|mp4|webm)(?:[?#]|$)/i;

const findUrl = (text) => text?.match(/https?:\/\/\S+/)?.[0] ?? null;

/** Google Images result links wrap the original as ?imgurl=…; unwrap them. */
function unwrap(url) {
  try {
    return new URL(url).searchParams.get('imgurl') || url;
  } catch {
    return url;
  }
}

function imageSource(data) {
  const html = data.getData('text/html');
  if (!html) return null;
  return new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src') ?? null;
}

const linkText = (data) => data.getData('text/uri-list') || data.getData('text/plain');

/**
 * Reads a drop or paste (a DataTransfer). Returns `{ file, url }`:
 * - a file alone → load the file;
 * - a url alone → load the link;
 * - both → the file is a still snapshot of an animated original at `url`; prefer the url.
 */
export function readTransfer(data) {
  const file = data.files?.[0] ?? null;
  if (!file) return { file, url: findUrl(linkText(data)) };
  if (ANIMATED_TYPE.test(file.type)) return { file, url: null };
  const candidates = [imageSource(data), linkText(data)].map(findUrl).filter(Boolean).map(unwrap);
  return { file, url: candidates.find((u) => ANIMATED_URL.test(u)) ?? null };
}
