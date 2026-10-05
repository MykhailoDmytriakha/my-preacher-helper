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
