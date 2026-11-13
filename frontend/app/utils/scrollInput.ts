/** Input that deliberately scrolls a pane; a button's Space remains its activation. */
export type ScrollAxis = 'vertical' | 'horizontal';

const VERTICAL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
const HORIZONTAL_KEYS = new Set(['ArrowLeft', 'ArrowRight']);

export function scrollInput(event: Event, pane: HTMLElement, axis: ScrollAxis = 'vertical'): boolean {
  if (event.type === 'wheel') {
    const { deltaX, deltaY, shiftKey } = event as WheelEvent;
    return axis === 'horizontal' ? deltaX !== 0 || (shiftKey && deltaY !== 0) : deltaY !== 0;
  }
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key;
    const onButton = event.target instanceof Element && event.target.closest('button, [role="button"]');
    return (axis === 'horizontal' ? HORIZONTAL_KEYS : VERTICAL_KEYS).has(key) && !((key === ' ' || key === 'Spacebar') && onButton);
  }
  if (event.type.startsWith('pointer')) return event.target === pane;
  return event.type === 'touchmove';
}
