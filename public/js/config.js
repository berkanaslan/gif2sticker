// WhatsApp sticker requirements: https://faq.whatsapp.com/ (third-party sticker guidelines)
export const STICKER_SIZE = 512;
export const ANIMATED_LIMIT_BYTES = 500 * 1024;
export const STATIC_LIMIT_BYTES = 100 * 1024;
export const MAX_DURATION_S = 10;

// Keeps memory sane on phones (each 512×512 frame is 1 MB of RGBA).
export const MAX_FRAMES = 100;
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

// The site's own link service (worker/): fetches media the browser may not, and finds the
// GIF or video a web page previews. Same origin, so no CORS setup is needed.
export const MEDIA_SERVICE = '/api/media?url=';
