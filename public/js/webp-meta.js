// Adds WhatsApp's sticker metadata (pack name, publisher, emoji tags) as an EXIF chunk.
// Format matches what WhatsApp's own sticker tooling writes: a minimal TIFF IFD whose
// single tag (0x5741) holds a JSON payload.

const VP8X_EXIF_FLAG = 0x08;
const VP8X_ALPHA_FLAG = 0x10;
const text = (s) => new TextEncoder().encode(s);
const fourCC = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));

function chunk(type, payload) {
  const padded = payload.length + (payload.length & 1);
  const out = new Uint8Array(8 + padded);
  out.set(text(type), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function exifPayload(meta) {
  const json = text(JSON.stringify(meta));
  const header = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0, 0, 0, 0, 0x16, 0x00, 0x00, 0x00];
  const out = new Uint8Array(header.length + json.length);
  out.set(header);
  new DataView(out.buffer).setUint32(14, json.length, true);
  out.set(json, header.length);
  return out;
}

function vp8x(width, height, flags) {
  const payload = new Uint8Array(10);
  payload[0] = flags;
  const w = width - 1;
  const h = height - 1;
  payload.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
  return chunk('VP8X', payload);
}

/** Returns a new WebP with an EXIF chunk; `size` is the canvas size used when adding VP8X. */
export function withStickerMetadata(webp, meta, size) {
  if (fourCC(webp, 0) !== 'RIFF' || fourCC(webp, 8) !== 'WEBP') throw new Error('Not a WebP file.');
  let body = webp.subarray(12);
  if (fourCC(body, 0) === 'VP8X') {
    body = body.slice();
    body[8] |= VP8X_EXIF_FLAG;
  } else {
    const flags = VP8X_EXIF_FLAG | (fourCC(body, 0) === 'VP8L' ? VP8X_ALPHA_FLAG : 0);
    body = concat(vp8x(size, size, flags), body);
  }
  body = concat(body, chunk('EXIF', exifPayload(meta)));

  const out = new Uint8Array(12 + body.length);
  out.set(text('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(text('WEBP'), 8);
  out.set(body, 12);
  return out;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
