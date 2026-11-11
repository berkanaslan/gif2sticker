import { CORS_PROXY, MAX_SOURCE_BYTES } from './config.js';

const viaProxy = (url) => CORS_PROXY + encodeURIComponent(url);

async function request(url) {
  try {
    return await fetch(url, { credentials: 'omit' });
  } catch (err) {
    // A TypeError here is almost always CORS / network: retry through the proxy if one is set.
    if (!CORS_PROXY) throw new Error(`Could not reach ${new URL(url).host} from the browser (CORS).`);
    return fetch(viaProxy(url), { credentials: 'omit' });
  }
}

async function ok(response) {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response;
}

export const fetchJson = async (url) => (await ok(await request(url))).json();

export async function fetchBlob(url) {
  const blob = await (await ok(await request(url))).blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('File is too large (max 50 MB).');
  return blob;
}
