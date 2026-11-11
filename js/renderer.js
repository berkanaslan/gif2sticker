import { STICKER_SIZE as SIZE } from './config.js';

const PADDING = 8;
const OUTLINE_STEPS = 24;
const FONTS = {
  bold: '900 SIZEpx "Arial Black", "Helvetica Neue", system-ui, sans-serif',
  rounded: '800 SIZEpx ui-rounded, "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif',
  hand: '700 SIZEpx "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive',
};

const scratch = () => Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
const silhouette = scratch();
const subject = scratch();

function roundedRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Each shape traces a path for a rect grown by `grow` px on every side.
const SHAPES = {
  square: (ctx, r, grow) => ctx.rect(r.x - grow, r.y - grow, r.w + grow * 2, r.h + grow * 2),
  rounded: (ctx, r, grow) =>
    roundedRect(ctx, r.x - grow, r.y - grow, r.w + grow * 2, r.h + grow * 2, Math.min(r.w, r.h) * 0.16 + grow),
  circle: (ctx, r, grow) => ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + grow, 0, Math.PI * 2),
};

/** Where the image goes: a centered "contain" rect, or the full square for cover/circle. */
function layout(image, { fit, shape, borderWidth }) {
  const margin = PADDING + (shape === 'none' ? 0 : borderWidth);
  const avail = SIZE - margin * 2;
  if (fit === 'cover' || shape === 'circle') return { x: margin, y: margin, w: avail, h: avail, cover: true };
  const scale = avail / Math.max(image.width, image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: (SIZE - w) / 2, y: (SIZE - h) / 2, w, h, cover: false };
}

function drawImage(ctx, image, rect) {
  if (!rect.cover) return ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
  const scale = Math.max(rect.w / image.width, rect.h / image.height);
  const sw = rect.w / scale;
  const sh = rect.h / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, rect.x, rect.y, rect.w, rect.h);
}

function drawShaped(ctx, image, rect, { shape, borderWidth, borderColor }) {
  const trace = SHAPES[shape];
  ctx.save();
  ctx.beginPath();
  trace(ctx, rect, 0);
  ctx.clip();
  drawImage(ctx, image, rect);
  ctx.restore();
  if (!borderWidth) return;
  ctx.beginPath();
  trace(ctx, rect, borderWidth / 2);
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = borderColor;
  ctx.stroke();
}

/** Die-cut "sticker edge": dilate the subject's alpha and fill it with the border color. */
function drawOutlined(ctx, image, rect, { borderWidth, borderColor }) {
  const sctx = subject.getContext('2d');
  sctx.clearRect(0, 0, SIZE, SIZE);
  drawImage(sctx, image, rect);

  if (borderWidth > 0) {
    const octx = silhouette.getContext('2d');
    octx.globalCompositeOperation = 'source-over';
    octx.clearRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < OUTLINE_STEPS; i++) {
      const angle = (i / OUTLINE_STEPS) * Math.PI * 2;
      octx.drawImage(subject, Math.cos(angle) * borderWidth, Math.sin(angle) * borderWidth);
    }
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = borderColor;
    octx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(silhouette, 0, 0);
  }
  ctx.drawImage(subject, 0, 0);
}

function wrapLines(ctx, text, maxWidth) {
  return text.split('\n').flatMap((paragraph) => {
    const lines = [];
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    return line ? [...lines, line] : lines;
  });
}

function drawCaption(ctx, { captionText, captionPos, captionSize, captionFont, captionColor, captionStroke }) {
  const text = captionText.trim();
  if (!text) return;
  const maxWidth = SIZE - PADDING * 4;
  let size = captionSize;
  let lines;
  // Shrink until every line fits and the caption stays within ~40% of the sticker.
  for (;;) {
    ctx.font = (FONTS[captionFont] ?? FONTS.bold).replace('SIZE', size);
    lines = wrapLines(ctx, text, maxWidth);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (size <= 14 || (widest <= maxWidth && lines.length * size * 1.1 <= SIZE * 0.4)) break;
    size -= 2;
  }

  const lineHeight = size * 1.1;
  const blockHeight = lines.length * lineHeight;
  const top = captionPos === 'top' ? PADDING * 2 : SIZE - PADDING * 2 - blockHeight;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.22);
  ctx.strokeStyle = captionStroke;
  ctx.fillStyle = captionColor;
  lines.forEach((line, i) => {
    const y = top + i * lineHeight;
    ctx.strokeText(line, SIZE / 2, y);
    ctx.fillText(line, SIZE / 2, y);
  });
}

/** Draws one sticker frame (512×512, transparent) onto `ctx`. */
export function renderSticker(ctx, image, style) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const rect = layout(image, style);
  if (style.shape === 'outline') drawOutlined(ctx, image, rect, style);
  else if (style.shape === 'none') drawImage(ctx, image, rect);
  else drawShaped(ctx, image, rect, style);
  drawCaption(ctx, style);
}
