import { MEDIA_SERVICE, MAX_SOURCE_BYTES } from './config.js';

// Twitter's CDN rejects hot-linked requests that carry a foreign Referer, so never send one.
const OPTIONS = { credentials: 'omit', referrerPolicy: 'no-referrer' };

const host = (url) => new URL(url).host;
const isText = (response) => (response.headers.get('Content-Type') ?? '').startsWith('text/');

/** The link couldn't be loaded (blocked, unreachable, or no GIF/video found). */
export class LinkError extends Error {}

// Statuses that mean "not from another website" (hotlink protection): the server may still get it.
const BLOCKED_STATUSES = new Set([401, 403]);

/**
 * Tries the link from the browser first, so most links never touch the server. Returns null
 * only when the server can do better: the browser was blocked (CORS — browsers don't say why a
 * request failed, so any failure counts), the site blocks hotlinking, or the link is a web page.
 */
async function fetchInBrowser(url) {
  let response;
  try {
    response = await fetch(url, OPTIONS);
  } catch {
    return null;
  }
  if (response.ok) return isText(response) ? null : response;
  if (BLOCKED_STATUSES.has(response.status)) return null;
  throw new LinkError(`${host(url)} couldn’t load that link (${response.status}).`);
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
  const response = (await fetchInBrowser(url)) ?? (await fetchViaService(url));
  const blob = await response.blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('File is too large (max 50 MB).');
  return blob;
}
