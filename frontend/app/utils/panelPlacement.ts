import { clampTooltipCentre } from './tooltipPlacement';

/** Retain the existing two-rem viewport allowance on microphone recovery panels. */
export const PANEL_EDGE_PADDING = 16;

/** Slide the measured panel inside its visible area using the canonical tooltip edge rule. */
export function panelShift(rect: { left: number; right: number }, viewportWidth: number, offset = 0): number {
  const centre = (rect.left + rect.right) / 2;
  return offset + clampTooltipCentre(centre - offset, rect.right - rect.left, viewportWidth, PANEL_EDGE_PADDING) - centre;
}


const CLIPPING_OVERFLOW = new Set(['auto', 'scroll', 'hidden', 'clip']);

/** Intersect one viewport axis with clipping ancestor scrollports. */
function panelAxisSpace(panel: HTMLElement, viewportSize: number, axis: 'x' | 'y'): { start: number; end: number } {
  let start = 0;
  let end = viewportSize;
  for (let ancestor = panel.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const size = axis === 'x' ? ancestor.clientWidth : ancestor.clientHeight;
    const overflow = window.getComputedStyle(ancestor)[axis === 'x' ? 'overflowX' : 'overflowY'];
    if (!CLIPPING_OVERFLOW.has(overflow) || !size) continue;
    const rect = ancestor.getBoundingClientRect();
    const clipStart = axis === 'x' ? rect.left + ancestor.clientLeft : rect.top + ancestor.clientTop;
    start = Math.max(start, clipStart);
    end = Math.min(end, clipStart + size);
  }
  start = Math.min(start, viewportSize);
  return { start, end: Math.max(start, end) };
}

export function panelHorizontalSpace(panel: HTMLElement, viewportWidth: number): { left: number; right: number } {
  const space = panelAxisSpace(panel, viewportWidth, 'x');
  return { left: space.start, right: space.end };
}

export function panelVerticalSpace(panel: HTMLElement, viewportHeight: number): { top: number; bottom: number } {
  const space = panelAxisSpace(panel, viewportHeight, 'y');
  return { top: space.start, bottom: space.end };
}

export type PanelSide = 'above' | 'below';

/** The reachable room on either side, even when a saved anchor is outside the current viewport. */
export function panelVerticalRooms(
  anchor: { top: number; bottom: number }, space: { top: number; bottom: number }
) {
  const top = space.top + PANEL_EDGE_PADDING;
  const bottom = Math.max(top, space.bottom - PANEL_EDGE_PADDING);
  const aboveEnd = Math.max(top, Math.min(bottom, anchor.top - 8));
  const belowStart = Math.min(bottom, Math.max(top, anchor.bottom + 8));
  return {
    above: { end: aboveEnd, size: aboveEnd - top },
    below: { start: belowStart, size: bottom - belowStart },
  };
}

/** Prefer the existing side; otherwise flip, or scroll within the roomier side. */
export function panelVerticalPlacement(
  anchor: { top: number; bottom: number }, height: number,
  space: { top: number; bottom: number }, preferred: PanelSide
): { top: number; maxHeight: number } {
  const { above, below } = panelVerticalRooms(anchor, space);
  const rooms = { above: above.size, below: below.size };
  const other = preferred === 'above' ? 'below' : 'above';
  const side = height > rooms[preferred] && (height <= rooms[other] || rooms[other] > rooms[preferred]) ? other : preferred;
  const maxHeight = rooms[side];
  return { top: side === 'above' ? above.end - Math.min(height, maxHeight) : below.start, maxHeight };
}
