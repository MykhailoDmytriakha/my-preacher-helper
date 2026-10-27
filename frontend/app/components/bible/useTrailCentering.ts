'use client';

import { useLayoutEffect, type RefObject } from 'react';

import { scrollInput, type ScrollAxis } from './scrollInput';

/** Center the chosen place through layout settling, until the person deliberately scrolls the trail. */
export function useTrailCentering(ref: RefObject<HTMLElement | null>, axis: ScrollAxis, identity: string): void {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return undefined;
    const content = list.firstElementChild;
    const dimensions = () => [list.clientWidth, list.clientHeight, content?.scrollWidth ?? 0, content?.scrollHeight ?? 0];
    let previous = dimensions();
    let following = true;
    const center = () => {
      const current = list.querySelector<HTMLElement>('[aria-current="location"]');
      if (!current) return;
      const box = list.getBoundingClientRect();
      const at = current.getBoundingClientRect();
      if (axis === 'vertical') list.scrollTop = Math.max(0, list.scrollTop + at.top - box.top - (list.clientHeight - at.height) / 2);
      else list.scrollLeft = Math.max(0, list.scrollLeft + at.left - box.left - (list.clientWidth - at.width) / 2);
    };
    const resized = () => {
      if (!following) return;
      const next = dimensions();
      if (next.every((value, index) => value === previous[index])) return;
      previous = next;
      center();
    };
    const beforeInput = (event: Event) => { if (scrollInput(event, list, axis)) following = false; };
    const pointerMove = (event: PointerEvent) => { if (event.buttons) beforeInput(event); };
    const inputs = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const input of inputs) list.addEventListener(input, beforeInput, { capture: true, passive: true });
    list.addEventListener('pointermove', pointerMove, { capture: true, passive: true });
    center();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    observer?.observe(list);
    if (content) observer?.observe(content);
    return () => {
      observer?.disconnect();
      for (const input of inputs) list.removeEventListener(input, beforeInput, true);
      list.removeEventListener('pointermove', pointerMove, true);
    };
  }, [axis, identity, ref]);
}
