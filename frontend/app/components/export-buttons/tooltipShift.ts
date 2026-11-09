import { placeTooltipLabel } from '@/utils/tooltipPlacement';

const watching = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * On hover, slides the slot's tooltip back inside the window. A tooltip is centred on its button,
 * so above the last export button on a phone the reason it gives ("Недостаточно оставшегося
 * AI-использования.") ran off the right edge and could not be read. The arrow keeps pointing at
 * the button (`--tooltip-shift` in TooltipStyles). While the pointer stays, a tooltip whose text
 * changes (the reason arrives after the hover began) is placed again; the shift itself never
 * changes the size, so this cannot loop.
 */
export function keepTooltipOnScreen(event: { currentTarget: HTMLElement }): void {
  const slot = event.currentTarget;
  const tip = slot.querySelector<HTMLElement>('.tooltiptext');
  if (!tip || typeof document === 'undefined') return;
  placeTooltipLabel(tip);
  if (typeof ResizeObserver === 'undefined' || watching.has(slot)) return;
  const observer = new ResizeObserver(() => placeTooltipLabel(tip));
  observer.observe(tip);
  watching.set(slot, observer);
  slot.addEventListener('mouseleave', () => {
    observer.disconnect();
    watching.delete(slot);
  }, { once: true });
}
