import { renderSticker } from './renderer.js';

/** Plays frames on a canvas, re-rendering each with the current style. */
export class PreviewPlayer {
  #frames = [];
  #style = null;
  #index = 0;
  #elapsed = 0;
  #last = 0;
  #dirty = true;

  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    requestAnimationFrame((t) => this.#tick(t));
  }

  show(frames, style) {
    if (frames !== this.#frames) {
      this.#index = 0;
      this.#elapsed = 0;
    }
    this.#frames = frames;
    this.#style = style;
    this.#dirty = true;
  }

  #tick(now) {
    const delta = Math.min(now - this.#last, 250);
    this.#last = now;
    const frames = this.#frames;
    if (frames.length > 1) {
      this.#elapsed += delta;
      while (this.#elapsed >= frames[this.#index].duration) {
        this.#elapsed -= frames[this.#index].duration;
        this.#index = (this.#index + 1) % frames.length;
        this.#dirty = true;
      }
    }
    if (this.#dirty && frames.length) {
      renderSticker(this.ctx, frames[Math.min(this.#index, frames.length - 1)].image, this.#style);
      this.#dirty = false;
    }
    requestAnimationFrame((t) => this.#tick(t));
  }
}
