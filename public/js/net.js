import { CORS_PROXY, MAX_SOURCE_BYTES } from './config.js';

// Twitter's CDN rejects hot-linked requests that carry a foreign Referer, so never send one.
const OPTIONS = { credentials: 'omit', referrerPolicy: 'no-referrer' };

const host = (url) => new URL(url).host;
const viaProxy = (url) => CORS_PROXY + encodeURIComponent(url);

async function get(url) {
  let response;
  try {
    response = await fetch(url, OPTIONS);
  } catch {
    throw new Error(`Could not reach ${host(url)} from the browser.`);
  }
  if (!response.ok) throw new Error(`${host(url)} refused the request (${response.status}).`);
  return response;
}

/** Fetches directly; if the browser is blocked (CORS, 403…) retries through the optional proxy. */
async function request(url) {
  try {
    return await get(url);
  } catch (err) {
    if (!CORS_PROXY) throw new Error(`${err.message} Set up the CORS proxy (see README).`);
    return get(viaProxy(url));
  }
}

export const fetchJson = async (url) => (await request(url)).json();

export async function fetchBlob(url) {
  const blob = await (await request(url)).blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('File is too large (max 50 MB).');
  return blob;
}
