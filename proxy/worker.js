// OPTIONAL Cloudflare Worker (free tier) used only if a browser can't fetch X/Twitter
// media directly because of CORS. Deploy with `npx wrangler deploy proxy/worker.js
// --name gif2sticker-proxy`, then set CORS_PROXY in js/config.js to
// 'https://gif2sticker-proxy.<your-subdomain>.workers.dev/?url='.

const ALLOWED_HOSTS = ['api.fxtwitter.com', 'api.vxtwitter.com', 'video.twimg.com', 'pbs.twimg.com'];
const CORS = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get('url');
    let url;
    try {
      url = new URL(target);
    } catch {
      return new Response('Missing ?url=', { status: 400, headers: CORS });
    }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: CORS });
    }
    const upstream = await fetch(url, { headers: { 'User-Agent': 'gif2sticker' }, cf: { cacheTtl: 86400 } });
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
