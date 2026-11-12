# GIF → Sticker

Turn a GIF, video, image, or **X/Twitter post** into a WhatsApp sticker, entirely in the browser.
There is no backend: decoding, editing and encoding all run in the tab, in a Web Worker.

## Features

- **Sources:** pick a file, drag & drop, paste (⌘/Ctrl+V), or paste an `x.com` / `twitter.com` post link or a `tenor.com/view/…` GIF link. Twitter GIFs are really MP4s, so the app reads the post's GIF, video or photo via public CORS-enabled embed APIs (fxtwitter, with vxtwitter as fallback).
- **Dragging a GIF from a web page** (e.g. Google Images): browsers hand over only a still snapshot of the image, so the app fetches the original GIF from the URL that comes with the drag. If that site blocks cross-site requests, it falls back to the still and says so.
- **Copy & paste into WhatsApp, animated:** the result is a transparent animated GIF. WhatsApp mobile turns a *pasted GIF* into an animated **Custom sticker**. A pasted or dragged WebP gets flattened to a still sticker, which is why the GIF is the main output.
- **Borders:** die-cut *Sticker* edge (follows transparency), Rounded, Circle, Square or None, with any width and color.
- **Captions:** emoji-friendly text, top/bottom, three font styles, text and outline colors, auto-wrap and auto-shrink.
- **Trim & smoothness** for clips (WhatsApp allows ≤ 10 s).
- **Fits WhatsApp's limits automatically:** output is kept under **500 KB**.
  - The GIF uses one shared palette and stores only the pixels that changed between frames. If that's still too big, it shrinks from 512 px towards 320 px, and drops frames only as a last resort.
  - **Save WebP** gives WhatsApp's native 512×512 animated WebP (libwebp compiled to WebAssembly). It embeds sticker metadata: pack name, author and up to 3 emoji tags.

## Getting it into WhatsApp

| Device | How |
| --- | --- |
| iPhone / Android | Hold the finished sticker → **Copy**. In a WhatsApp chat, hold the message box → **Paste**, then send it as a **Custom sticker**. Tap it → *Add to Favorites* to keep it. If the browser won't copy, tap **Save GIF** and paste or share it from your gallery. |
| WhatsApp Web / Desktop | **Save WebP**, then try dragging it into a chat. This route hasn't been verified. |

If WhatsApp doesn't offer *Custom sticker*, the GIF is probably too large: shorten the clip or choose **Light**.

## Run locally

It's plain static files with no build step and no dependencies:

```sh
python3 -m http.server 8080 -d public   # then open http://localhost:8080
```

(Opening `index.html` from disk won't work because module workers need http(s).)

## Hosting (≈ $0)

Any static host works. It's deployed on **Cloudflare Workers** (static assets, Free plan): private GitHub repos are supported, static requests are free and unlimited, and `_headers` caching rules apply. `wrangler.jsonc` deploys only the `public/` folder, so repo files such as the README, `.gitignore` or `proxy/` are never served. Put anything the site needs in `public/`, and nothing else.

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick this repo.
2. Build command: *(none)* · Deploy command: `npx wrangler deploy`.

Netlify works too. GitHub Pages also works, but it needs a paid plan for a **private** repo.

Each visitor downloads about 240 KB gzipped, and the encoder files are then cached for a week. All processing happens on the visitor's device, so hosting cost doesn't grow with usage.

### CORS proxy (needed for X/Twitter and Tenor links)

The app fetches post media directly first, sending no referrer. Twitter's video CDN (`video.twimg.com`) may still answer requests coming from another website with **403**. The same link works when you open it in a tab, because then it's not a cross-site request. Tenor share pages (`tenor.com/view/…`) don't allow cross-site requests at all. A browser can't hide the fact that a request is cross-site, so the fix is a tiny proxy on Cloudflare Workers' free plan (100k requests/day). It only forwards Twitter and Tenor API and media hosts.

```sh
cd proxy
npx wrangler login     # free Cloudflare account
npx wrangler deploy    # prints https://gif2sticker-proxy.<you>.workers.dev
```

Then set `CORS_PROXY` in `public/js/config.js` to `'https://gif2sticker-proxy.<you>.workers.dev/?url='`. The app tries the direct request first and uses the proxy only when that fails. Files, pastes and other links never touch it.

## Project layout

Everything the site serves lives in `public/`:

```
index.html, css/style.css     UI (mobile-first)
js/app.js                     wiring: inputs, state, copy/save
js/sources.js                 GIF / video / image → frames
js/twitter.js, js/tenor.js    post / GIF page link → media URL
js/net.js                     media URL → Blob (direct, then via the proxy)
js/transfer.js                drop / paste → file or link (prefers an animated original)
js/renderer.js                512×512 frame: fit, borders, caption
js/preview.js                 live animated preview
js/encoder.js                 renders frames, talks to the worker
js/encoder.worker.js          GIF (gifenc) / WebP (libwebp WASM) encoding + fit-to-size loop
js/webp-meta.js               WhatsApp EXIF metadata chunk
vendor/                       wasm-webp (libwebp), gifuct-js, gifenc; see vendor/LICENSES.md
proxy/worker.js               optional Cloudflare Worker CORS proxy
```
