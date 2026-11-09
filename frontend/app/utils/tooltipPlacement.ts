/** How far every tooltip keeps from the sides of the window. */
export const TOOLTIP_EDGE_PADDING = 12;

/**
 * Where a tooltip centred on its trigger must put its centre to stay inside the window: the
 * trigger's centre, pulled in from either side by the padding. ONE rule for the shared `Tooltip`
 * (a fixed help panel) and the export buttons' instant hover labels — not two near-copies.
 */
export function clampTooltipCentre(
  triggerCentreX: number,
  tooltipWidth: number,
  viewportWidth: number,
  padding = TOOLTIP_EDGE_PADDING
): number {
  return Math.min(
    Math.max(triggerCentreX, padding + tooltipWidth / 2),
    viewportWidth - padding - tooltipWidth / 2
  );
}

/** How far to slide a tooltip centred on its trigger so it keeps the shared edge padding; 0 when it fits. */
export function tooltipShift(rect: { left: number; right: number }, viewportWidth: number): number {
  const centre = (rect.left + rect.right) / 2;
  return clampTooltipCentre(centre, rect.right - rect.left, viewportWidth) - centre;
}

export function placeTooltipLabel(tip: HTMLElement): void {
  tip.style.setProperty('--tooltip-shift', '0px');
  const rect = tip.getBoundingClientRect();
  if (!rect.width) return;
  const shift = tooltipShift(rect, document.documentElement.clientWidth || window.innerWidth);
  if (shift) tip.style.setProperty('--tooltip-shift', `${Math.round(shift)}px`);
}
