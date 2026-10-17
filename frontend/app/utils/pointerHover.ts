import type { PointerEvent } from 'react';

/*
 * HOVER FOR WHAT CAN HOVER — a mouse, a trackpad, an Apple Pencil held over the screen — never a finger.
 * CSS `:hover` cannot tell them apart on an iPad: a finger's tap leaves it on, and the `(hover: hover)`
 * media query answers "no hover" there even with a Pencil over the glass (the owner, 2026-10-16: the
 * links lit up under the Pencil, the marker, pencil and eraser did not). An element spreads these
 * handlers and styles itself with `data-[hover]:` instead of `hover:`.
 */
export const pointerHover = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') event.currentTarget.setAttribute('data-hover', '');
  },
  onPointerLeave: (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.removeAttribute('data-hover');
  },
};
