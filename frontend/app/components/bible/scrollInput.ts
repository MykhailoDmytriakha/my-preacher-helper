/** The scroll input shared by Bible panes and the trail; a button's Space remains its activation. */
export type ScrollAxis = 'vertical' | 'horizontal';

const VERTICAL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
const HORIZONTAL_KEYS = new Set([...VERTICAL_KEYS, 'ArrowLeft', 'ArrowRight']);

export function scrollInput(event: Event, pane: HTMLElement, axis: ScrollAxis = 'vertical'): boolean {
  if (event.type === 'wheel') return (event as WheelEvent).deltaY !== 0 || (axis === 'horizontal' && (event as WheelEvent).deltaX !== 0);
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key;
    const onButton = event.target instanceof Element && event.target.closest('button, [role="button"]');
    return (axis === 'horizontal' ? HORIZONTAL_KEYS : VERTICAL_KEYS).has(key) && !((key === ' ' || key === 'Spacebar') && onButton);
  }
  if (event.type.startsWith('pointer')) return event.target === pane;
  return event.type === 'touchmove';
}
