# GIF → Sticker

Turn a GIF, video, image, **X/Twitter post** or **any page with a GIF** into a WhatsApp sticker.
Decoding, editing and encoding all run in the browser tab, in a Web Worker. The only server code is a small link service that fetches media the browser isn't allowed to.

## Features

- **Sources:** pick a file, drag & drop, paste (⌘/Ctrl+V), or paste an `x.com` / `twitter.com` post link, or any other link: a GIF / video file, or a web page (Pinterest, news sites…) whose link preview is a GIF or video. Twitter GIFs are really MP4s, so the app reads the post's GIF, video or photo via public CORS-enabled embed APIs (fxtwitter, with vxtwitter as fallback).
- **Dragging a GIF from a web page** (e.g. Google Images): browsers hand over only a still snapshot of the image, so the app fetches the original GIF from the URL that comes with the drag. If even the link service can't get it, it falls back to the still and says so.
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

There's no build step. To run everything, including the link service:

```sh
npx wrangler dev   # then open http://localhost:8787
```

Any static server works too, but then non-Twitter links fail because `/api/media` is missing:

```sh
python3 -m http.server 8080 -d public   # then open http://localhost:8080
```

(Opening `index.html` from disk won't work because module workers need http(s).)

## Hosting (≈ $0)

It's deployed on **Cloudflare Workers** (Free plan): private GitHub repos are supported, static requests are free and unlimited, and `_headers` caching rules apply. `wrangler.jsonc` serves only the `public/` folder as files, so repo files such as the README or `worker/` source are never served. Put anything the site needs in `public/`, and nothing else.

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick this repo.
2. Build command: *(none)* · Deploy command: `npx wrangler deploy`.

On a plain static host (Netlify, GitHub Pages…) everything except the link service works.

Each visitor downloads about 240 KB gzipped, and the encoder files are then cached for a week. All processing happens on the visitor's device, so hosting cost doesn't grow with usage.

### Link service (`/api/media`)

A browser can't read another website's pages, and some media hosts (Twitter's `video.twimg.com`, many image hosts) refuse requests that come from another website. So the site's Worker (`worker/`) does it, on the same domain:

1. Text that isn't an `http(s)://` link never leaves the device. A link is tried directly from the browser first. Only when the browser is blocked (CORS), the site refuses hotlinking (401/403), or the link is a web page does the app ask `/api/media?url=…`. Any other error (404, 500…) is shown without asking the server.
2. A GIF / image / video link is streamed through as-is.
3. A web page is read up to `</head>` for the preview its owner publishes for link previews (`og:video`, `og:image`, `twitter:image`…). A video wins over a GIF, and a GIF over a still image.

Only the requests under `/api/*` run the Worker; every other request is a free static-asset request. Each pasted link costs one Worker request, so the Free plan's **100,000 requests/day** is the cost ceiling: past it, link pasting pauses until midnight UTC and you are never billed.

Abuse protection:
- **Rate limit:** 10 links per minute per visitor IP (Cloudflare's rate-limiting binding in `wrangler.jsonc`, counted per Cloudflare location).
- **Only this site:** requests from other websites (`Sec-Fetch-Site` / `Origin`) are refused.
- **Only media:** public `https` links only (no IP addresses, ports or `localhost`). Only GIF, PNG, JPEG, WebP, MP4, WebM and MOV are returned, up to 50 MB, with `nosniff` and a sandboxing CSP. It is not a general-purpose proxy.
- If abuse still shows up in the dashboard, add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) (free) so only real browsers can call it.

**Logs:** Workers Logs are on (`observability` in `wrangler.jsonc`) to spot abuse and failures: status, timing and request details for Worker requests only. `redact_query_string` strips `?url=…`, so pasted links are never logged. Retention is up to 7 days, and on the Free plan logging pauses for the day when the daily allowance is used up; it never bills. The privacy text on the site (`index.html`, `llms.txt`) says the same, so update both if this changes.

Note: reading a page's link-preview tags is what chat apps do for link previews, but some sites' terms restrict automated access. Each request is a single fetch, made only because a person pasted that link.

## Project layout

Everything the site serves lives in `public/`:

```
index.html, css/style.css     UI (mobile-first)
js/app.js                     wiring: inputs, state, copy/save
js/sources.js                 GIF / video / image → frames
js/twitter.js                 post link → media URL
js/net.js                     link → Blob (direct, else via the link service)
js/transfer.js                drop / paste → file or link (prefers an animated original)
js/renderer.js                512×512 frame: fit, borders, caption
js/preview.js                 live animated preview
js/encoder.js                 renders frames, talks to the worker
js/encoder.worker.js          GIF (gifenc) / WebP (libwebp WASM) encoding + fit-to-size loop
js/webp-meta.js               WhatsApp EXIF metadata chunk
vendor/                       wasm-webp (libwebp), gifuct-js, gifenc; see vendor/LICENSES.md
```

The link service lives outside `public/`:

```
worker/index.js               routing, origin check, rate limit, safe response headers
worker/media.js               link → media (direct file, or a page's preview)
worker/preview.js             reads a page's link-preview tags
```
