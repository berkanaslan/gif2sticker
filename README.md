# GIF → Sticker

Turn a GIF, video, image, or **X/Twitter post** into a WhatsApp sticker, entirely in the browser.
There is no backend: decoding, editing and WebP encoding all run in the tab (libwebp compiled to WebAssembly, in a Web Worker).

## Features

- **Sources:** pick a file, drag & drop, paste (⌘/Ctrl+V), or paste an `x.com` / `twitter.com` post link. Twitter GIFs are really MP4s, so the app reads the post's GIF, video or photo via public CORS-enabled embed APIs (fxtwitter, with vxtwitter as fallback).
- **Hold & release to send:** press and hold the big button. It arms after ~0.5 s and you release to open the share sheet (WhatsApp). The finished sticker preview can also be long-pressed on iPhone → *Copy* → paste into a WhatsApp chat.
- **Borders:** die-cut *Sticker* edge (follows transparency), Rounded, Circle, Square or None, with any width and color.
- **Captions:** emoji-friendly text, top/bottom, three font styles, text and outline colors, auto-wrap and auto-shrink.
- **Trim & smoothness** for clips (WhatsApp allows ≤ 10 s).
- **WhatsApp-ready output:** 512×512 animated WebP, automatically shrunk under WhatsApp's **500 KB** limit (100 KB for still images) by lowering quality and then frame rate. It also embeds WhatsApp sticker metadata (pack name, author and up to 3 emoji tags).

## Getting it into WhatsApp

| Device | How |
| --- | --- |
| iPhone / Android | Hold → release → pick WhatsApp in the share sheet. Or long-press the preview → Copy → paste in a chat. |
| WhatsApp Web / Desktop | Click **Save**, then drag the `.webp` into a chat (it's sent as a sticker). |

## Run locally

It's plain static files with no build step and no dependencies:

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

(Opening `index.html` from disk won't work because module workers need http(s).)

## Hosting (≈ $0)

Any static host works. **Cloudflare Pages** is the recommended free option: it supports private GitHub repos, has unlimited bandwidth on the free plan, and applies the caching rules in `_headers`.

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Build command: *(none)* · Output directory: `/`.

Netlify works the same way. GitHub Pages also works, but it needs a paid plan for a **private** repo.

Each visitor downloads about 250 KB gzipped once, and then it's cached for a year. All processing happens on the visitor's device, so hosting cost doesn't grow with usage.

### CORS proxy (needed for X/Twitter links)

The app fetches post media directly first, sending no referrer. Twitter's video CDN (`video.twimg.com`) may still answer requests coming from another website with **403**. The same link works when you open it in a tab, because then it's not a cross-site request. A browser can't hide the fact that a request is cross-site, so the fix is a tiny proxy on Cloudflare Workers' free plan (100k requests/day). It only forwards Twitter API and media hosts.

```sh
cd proxy
npx wrangler login     # free Cloudflare account
npx wrangler deploy    # prints https://gif2sticker-proxy.<you>.workers.dev
```

Then set `CORS_PROXY` in `js/config.js` to `'https://gif2sticker-proxy.<you>.workers.dev/?url='`. The app tries the direct request first and uses the proxy only when that fails. Files, pastes and other links never touch it.

## Project layout

```
index.html, css/style.css     UI (mobile-first)
js/app.js                     wiring: inputs, state, hold-to-send
js/sources.js                 GIF / video / image → frames
js/twitter.js, js/net.js      post link → media URL → Blob
js/renderer.js                512×512 frame: fit, borders, caption
js/preview.js                 live animated preview
js/encoder.js                 renders frames, talks to the worker
js/encoder.worker.js          libwebp (WASM) encoding + fit-to-size loop
js/webp-meta.js               WhatsApp EXIF metadata chunk
js/hold.js                    press-and-hold gesture
vendor/                       wasm-webp (libwebp) and gifuct-js, see vendor/LICENSES.md
proxy/worker.js               optional Cloudflare Worker CORS proxy
```
