import { previewUrls } from './preview.js';

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // same limit as the app
const MAX_CANDIDATES = 3; // preview URLs tried per page, to bound outgoing requests
const MEDIA_TYPES = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);
const PAGE_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const USER_AGENT = 'Mozilla/5.0 (compatible; gif2sticker/1.0; +https://sticker.berkan.io)';

/** A failure the user should see, with the HTTP status to answer with. */
export class MediaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isPrivateHost = (host) =>
  host === 'localhost' || /\.(?:localhost|local|internal)$/i.test(host) || /^[\d.]+$/.test(host) || host.startsWith('[');

/** Only plain public https links: no IP addresses, ports or credentials. */
function parseLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaError(400, 'That doesn’t look like a link.');
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || isPrivateHost(url.hostname)) {
    throw new MediaError(400, 'Only public https links are supported.');
  }
  return url;
}

const contentType = (response) => (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();

async function get(url) {
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT }, cf: { cacheTtl: 3600 } });
  } catch {
    throw new MediaError(502, `Couldn’t reach ${url.hostname}.`);
  }
}

/** The response as media, or null (and its body released) if it isn't a GIF, image or video. */
function asMedia(response) {
  const type = contentType(response);
  if (!response.ok || !MEDIA_TYPES.has(type)) {
    response.body?.cancel();
    return null;
  }
  const length = Number(response.headers.get('Content-Length')) || 0;
  if (length > MAX_MEDIA_BYTES) {
    response.body?.cancel();
    throw new MediaError(413, 'That file is too large (max 50 MB).');
  }
  return { body: response.body, type, length };
}

/**
 * Resolves a link to media: a direct GIF/image/video link is passed through; a web page is read
 * for the preview its owner publishes for link previews (og:video, og:image, twitter:image…).
 */
export async function fetchMedia(raw) {
  const link = parseLink(raw);
  const response = await get(link);
  if (!response.ok) {
    response.body?.cancel();
    throw new MediaError(502, `${link.hostname} refused the request (${response.status}).`);
  }
  if (!PAGE_TYPES.has(contentType(response))) {
    const media = asMedia(response);
    if (media) return media;
    throw new MediaError(415, 'That link isn’t a GIF, video or web page.');
  }

  const candidates = (await previewUrls(response, link)).filter((url) => {
    try {
      parseLink(url);
      return true;
    } catch {
      return false;
    }
  });
  for (const url of candidates.slice(0, MAX_CANDIDATES)) {
    const media = asMedia(await get(new URL(url)).catch(() => new Response(null, { status: 502 })));
    if (media) return media;
  }
  throw new MediaError(404, 'No GIF or video found on that page.');
}
