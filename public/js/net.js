import { MEDIA_SERVICE, MAX_SOURCE_BYTES } from './config.js';

// Twitter's CDN rejects hot-linked requests that carry a foreign Referer, so never send one.
const OPTIONS = { credentials: 'omit', referrerPolicy: 'no-referrer' };

const host = (url) => new URL(url).host;
const isText = (response) => (response.headers.get('Content-Type') ?? '').startsWith('text/');

/** The link couldn't be loaded (blocked, unreachable, or no GIF/video found). */
export class LinkError extends Error {}

/** Fetches straight from the browser; null if the site blocks that or answers with a web page. */
async function fetchDirect(url) {
  try {
    const response = await fetch(url, OPTIONS);
    return response.ok && !isText(response) ? response : null;
  } catch {
    return null;
  }
}

/** Asks the site's link service, which can read blocked media and find the GIF a page previews. */
async function fetchViaService(url) {
  let response;
  try {
    response = await fetch(MEDIA_SERVICE + encodeURIComponent(url));
  } catch {
    throw new LinkError('Couldn’t reach the link service. Check your connection.');
  }
  if (response.ok) return response;
  const message = response.headers.get('Content-Type')?.startsWith('text/plain') ? await response.text() : '';
  throw new LinkError(message || `Couldn’t load that link (${response.status}).`);
}

export async function fetchJson(url) {
  const response = await fetch(url, OPTIONS).catch(() => null);
  if (!response?.ok) throw new LinkError(`Couldn’t reach ${host(url)}.`);
  return response.json();
}

export async function fetchBlob(url) {
  const response = (await fetchDirect(url)) ?? (await fetchViaService(url));
  const blob = await response.blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('File is too large (max 50 MB).');
  return blob;
}
