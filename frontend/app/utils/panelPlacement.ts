import { clampTooltipCentre } from './tooltipPlacement';

/** Retain the existing two-rem viewport allowance on microphone recovery panels. */
export const PANEL_EDGE_PADDING = 16;

/** Slide the measured panel inside its visible area using the canonical tooltip edge rule. */
export function panelShift(rect: { left: number; right: number }, viewportWidth: number, offset = 0): number {
  const centre = (rect.left + rect.right) / 2;
  return offset + clampTooltipCentre(centre - offset, rect.right - rect.left, viewportWidth, PANEL_EDGE_PADDING) - centre;
}


const CLIPPING_OVERFLOW = new Set(['auto', 'scroll', 'hidden', 'clip']);

/** Intersect the viewport with ancestor scrollports, including their borders/scrollbar. */
export function panelHorizontalSpace(panel: HTMLElement, viewportWidth: number): { left: number; right: number } {
  let left = 0;
  let right = viewportWidth;
  for (let ancestor = panel.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (!CLIPPING_OVERFLOW.has(window.getComputedStyle(ancestor).overflowX) || !ancestor.clientWidth) continue;
    const rect = ancestor.getBoundingClientRect();
    const clipLeft = rect.left + ancestor.clientLeft;
    left = Math.max(left, clipLeft);
    right = Math.min(right, clipLeft + ancestor.clientWidth);
  }
  left = Math.min(left, viewportWidth);
  return { left, right: Math.max(left, right) };
}
