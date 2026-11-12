const MAX_PAGE_BYTES = 1024 * 1024; // preview tags live in <head>; never read a whole huge page
const VIDEO_TAGS = ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream'];
const IMAGE_TAGS = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'];
const isGif = (url) => /\.gif(?:[?#]|$)/i.test(url);

/**
 * Reads a page's link-preview tags and returns their absolute URLs, best first:
 * videos, then GIFs, then other images. Stops reading at </head>.
 */
export async function previewUrls(response, pageUrl) {
  const found = new Map(); // tag → content
  let headEnded = false;
  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const tag = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase();
        const content = el.getAttribute('content');
        if (content && !found.has(tag)) found.set(tag, content);
      },
    })
    .on('head', {
      element(el) {
        el.onEndTag(() => {
          headEnded = true;
        });
      },
    });

  const reader = rewriter.transform(response).body.getReader();
  for (let bytes = 0; !headEnded && bytes < MAX_PAGE_BYTES; ) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
  }
  await reader.cancel();

  const absolute = (tags) =>
    tags.filter((tag) => found.has(tag)).map((tag) => {
      try {
        return new URL(found.get(tag), pageUrl).href;
      } catch {
        return null;
      }
    });
  const images = absolute(IMAGE_TAGS);
  const ordered = [...absolute(VIDEO_TAGS), ...images.filter(isGif), ...images.filter((url) => url && !isGif(url))];
  return [...new Set(ordered.filter(Boolean))];
}
