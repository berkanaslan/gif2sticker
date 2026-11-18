// The site's Worker. Static files are served by Cloudflare's asset layer without running this
// code; only /api/* reaches it (see wrangler.jsonc), plus requests for files that don't exist.
import { fetchMedia, MediaError } from './media.js';

const MEDIA_ROUTE = '/api/media';

const plainText = (status, message) =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * Browsers say where a request comes from. Rejecting other sites keeps them from hot-linking the
 * service through their visitors (scripts can fake these headers; the rate limit covers those).
 */
function isFromOurPages(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  const origin = request.headers.get('Origin');
  return (!site || site === 'same-origin') && (!origin || origin === new URL(request.url).origin);
}

/**
 * The link as it appears in failure logs: origin and path only. The query string and fragment are
 * dropped because they can hold tokens or personal data, and the path is enough to trace the file.
 */
function loggableLink(raw) {
  try {
    const { origin, pathname } = new URL(raw);
    return origin + pathname;
  } catch {
    return '(not a link)';
  }
}

/** Only failures are logged, so the logs show what broke without recording every link people paste. */
const logFailure = (raw, status, reason) =>
  console.warn(JSON.stringify({ event: 'media_failed', link: loggableLink(raw), status, reason }));

async function handleMedia(request, env) {
  if (request.method !== 'GET') return plainText(405, 'Method not allowed.');
  if (!isFromOurPages(request)) return plainText(403, 'This service only works on the GIF to Sticker site.');

  const { success } = await env.LINK_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
  if (!success) return plainText(429, 'Too many links in a minute. Wait a moment and try again.');

  const link = new URL(request.url).searchParams.get('url');
  try {
    const media = await fetchMedia(link);
    const headers = {
      'Content-Type': media.type,
      'Cache-Control': 'private, max-age=3600',
      // Third-party bytes served from our origin: never sniff them, never let them run anything.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    };
    if (media.length) headers['Content-Length'] = media.length;
    return new Response(media.body, { headers });
  } catch (err) {
    if (err instanceof MediaError) {
      logFailure(link, err.status, err.message);
      return plainText(err.status, err.message);
    }
    logFailure(link, 500, String(err));
    throw err;
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === MEDIA_ROUTE) return handleMedia(request, env);
    return env.ASSETS.fetch(request);
  },
};
