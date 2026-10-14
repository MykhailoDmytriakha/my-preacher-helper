const OWN_GESTURES = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [draggable="true"], [data-rfd-drag-handle-draggable-id], [data-gesture-ignore], video, audio, canvas';

export function hasOpenLayer(): boolean {
  // A held page: the scroll lock holds the root, and on iOS pins the body too (useScrollLock).
  const root = document.documentElement.style;
  const body = document.body.style;
  if (root.overflow === 'hidden' || body.overflow === 'hidden' || body.position === 'fixed') return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-layer], [aria-modal="true"], dialog[open], [role="menu"]'))
    .some(element => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
}

export function gestureBlockReason(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || target.closest(OWN_GESTURES)) return 'control';
  if (hasOpenLayer()) return 'open-layer';
  if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return 'focused-editor';
  if (window.getSelection()?.toString()) return 'selected-text';
  // A nested scroller owns its gesture even at its boundary. Do not pull the page behind it.
  for (let element: Element | null = target; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
    const style = getComputedStyle(element);
    if ((/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight)
      || (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth)
      || style.touchAction === 'none') return 'nested-gesture';
  }
  return null;
}

export function pageAtTop(): boolean {
  return Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop) <= 0;
}
