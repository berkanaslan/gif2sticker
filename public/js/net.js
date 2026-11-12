import { CORS_PROXY, MAX_SOURCE_BYTES } from './config.js';

// Twitter's CDN rejects hot-linked requests that carry a foreign Referer, so never send one.
const OPTIONS = { credentials: 'omit', referrerPolicy: 'no-referrer' };

const host = (url) => new URL(url).host;
const viaProxy = (url) => CORS_PROXY + encodeURIComponent(url);

/** The link couldn't be read from the browser (blocked, unreachable or not a media file). */
export class LinkError extends Error {}

async function get(url) {
  let response;
  try {
    response = await fetch(url, OPTIONS);
  } catch {
    throw new LinkError(`${host(url)} doesn’t let other websites load its files.`);
  }
  if (!response.ok) throw new LinkError(`${host(url)} refused the request (${response.status}).`);
  return response;
}

/** Fetches directly; with `proxy`, retries through the optional CORS proxy when the browser is blocked. */
async function request(url, { proxy = false } = {}) {
  try {
    return await get(url);
  } catch (err) {
    if (!proxy) throw err;
    if (!CORS_PROXY) throw new LinkError(`${err.message} Set up the CORS proxy (see README).`);
    return get(viaProxy(url));
  }
}

export const fetchJson = async (url, options) => (await request(url, options)).json();

export async function fetchBlob(url, options) {
  const blob = await (await request(url, options)).blob();
  if (blob.type.startsWith('text/')) throw new LinkError('That link is a web page, not a GIF or video.');
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('File is too large (max 50 MB).');
  return blob;
}
