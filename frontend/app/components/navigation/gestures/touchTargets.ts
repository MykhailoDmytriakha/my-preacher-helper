import { hasOpenLayer } from '@/hooks/useModalLayer';

const OWN_GESTURES = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [draggable="true"], [data-rfd-drag-handle-draggable-id], [data-gesture-ignore], video, audio, canvas';

/** The reason a touch in a pane that scrolls only up and down gives: the pull is its own, the way back is not. */
export const NESTED_UP_AND_DOWN = 'nested-up-and-down';

export function gestureBlockReason(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || target.closest(OWN_GESTURES)) return 'control';
  if (hasOpenLayer()) return 'open-layer';
  if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return 'focused-editor';
  if (window.getSelection()?.toString()) return 'selected-text';
  // A nested scroller owns its gesture even at its boundary. Do not pull the page behind it. One that
  // scrolls only up and down owns only that axis: a swipe across it is still the page's way back — a
  // text in its own pane (a study, the Bible beside its minimap) goes back as a text in the page did.
  let upAndDown = false;
  for (let element: Element | null = target; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
    const style = getComputedStyle(element);
    if ((/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth)
      || style.touchAction === 'none') return 'nested-gesture';
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) upAndDown = true;
  }
  return upAndDown ? NESTED_UP_AND_DOWN : null;
}

export function pageAtTop(): boolean {
  return Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop) <= 0;
}
