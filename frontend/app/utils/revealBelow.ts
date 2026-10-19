import { scrollPinnedPageBy } from '@/hooks/useScrollLock';

/** Reveal an existing page control below a measured sticky top, without moving an already visible one. */
export function revealBelow(element: HTMLElement, top: number): void {
  const box = element.getBoundingClientRect();
  if (box.top >= top && box.bottom <= window.innerHeight) return;
  const delta = box.top - top;
  if (!scrollPinnedPageBy(delta)) window.scrollBy({ top: delta });
}
