import { fetchJson } from './net.js';

const TWEET_URL = /(?:twitter|x|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/(?:[^/?#]+\/)?status(?:es)?\/(\d+)/i;
const PREFERRED_TYPES = ['gif', 'video', 'photo'];

export const parseTweetId = (text) => text.match(TWEET_URL)?.[1] ?? null;

// Public, CORS-enabled tweet embed APIs. Each returns [{ type, url }].
const PROVIDERS = [
  async (id) => {
    const data = await fetchJson(`https://api.fxtwitter.com/status/${id}`, { proxy: true });
    return (data?.tweet?.media?.all ?? []).map(({ type, url }) => ({ type, url }));
  },
  async (id) => {
    const data = await fetchJson(`https://api.vxtwitter.com/status/${id}`, { proxy: true });
    return (data?.media_extended ?? []).map(({ type, url }) => ({ type, url }));
  },
];

const pickBest = (media) =>
  PREFERRED_TYPES.map((type) => media.find((m) => m.type === type)).find(Boolean)?.url ?? null;

/** Resolves a tweet id to the URL of its GIF (an MP4 on Twitter's CDN), video or photo. */
export async function resolveTweetMedia(id) {
  let lastError;
  for (const provider of PROVIDERS) {
    try {
      const url = pickBest(await provider(id));
      if (url) return url;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('No GIF or video found in this post.');
}
