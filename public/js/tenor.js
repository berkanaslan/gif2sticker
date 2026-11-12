// Tenor share links look like tenor.com/view/<slug>-<id> (optionally with a /<lang>/ prefix).
const TENOR_PAGE = /^(?:www\.)?tenor\.com$/i;
const VIEW_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?view\/[^/]+-\d+$/i;

/**
 * Maps a Tenor page link to its GIF, or returns null if `url` is not a Tenor page.
 * Appending `.gif` to a view link makes Tenor redirect to the GIF file itself.
 * tenor.com doesn't allow cross-site requests, so this goes through the CORS proxy.
 */
export function tenorMediaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!TENOR_PAGE.test(parsed.hostname)) return null;
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\.gif$/i, '');
  if (!VIEW_PATH.test(path)) {
    throw new Error('That’s a Tenor page with many GIFs. Open the one you want and paste its link, or drag the GIF in.');
  }
  return `https://tenor.com${path}.gif`;
}
