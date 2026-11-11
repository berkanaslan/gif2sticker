/**
 * Press-and-hold gesture: `onStart` on press, `onArmed` once held for `holdMs`,
 * then `onRelease(armed)` when the finger lifts. `onRelease` runs inside the
 * pointerup event, so it may call user-activation APIs such as navigator.share.
 */
export function bindHold(el, { holdMs = 450, onStart, onArmed, onRelease, onCancel }) {
  let timer = null;
  let armed = false;
  let active = false;

  const reset = () => {
    clearTimeout(timer);
    active = armed = false;
    el.classList.remove('holding', 'armed');
  };

  el.addEventListener('pointerdown', (e) => {
    if (el.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    el.setPointerCapture?.(e.pointerId);
    active = true;
    el.classList.add('holding');
    onStart?.();
    timer = setTimeout(() => {
      armed = true;
      el.classList.add('armed');
      navigator.vibrate?.(20);
      onArmed?.();
    }, holdMs);
  });

  el.addEventListener('pointerup', () => {
    if (!active) return;
    const wasArmed = armed;
    reset();
    onRelease?.(wasArmed);
  });

  el.addEventListener('pointercancel', () => {
    if (!active) return;
    reset();
    onCancel?.();
  });

  // iOS long-press would otherwise open the callout / text selection menu.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.style.setProperty('--hold-ms', `${holdMs}ms`);
}
