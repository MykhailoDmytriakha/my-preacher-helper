'use client';

import { useLayoutEffect, type RefObject } from 'react';

import { scrollInput, type ScrollAxis } from '@/utils/scrollInput';

/** Keep the selected item in view through layout changes until the person scrolls the list. */
export function useScrollSelection(ref: RefObject<HTMLElement | null>, axis: ScrollAxis, selector: string, identity: string): void {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return undefined;
    const content = list.firstElementChild;
    const current = list.querySelector<HTMLElement>(selector);
    if (!current) return undefined;
    const dimensions = () => {
      const item = current.getBoundingClientRect();
      const frame = list.getBoundingClientRect();
      return axis === 'vertical'
        ? [list.clientHeight, list.scrollHeight, item.top - frame.top + list.scrollTop, item.height]
        : [list.clientWidth, list.scrollWidth, item.left - frame.left + list.scrollLeft, item.width];
    };
    let previous = dimensions();
    let following = true;
    const center = () => {
      const box = list.getBoundingClientRect();
      const at = current.getBoundingClientRect();
      if (axis === 'vertical') list.scrollTop = Math.max(0, list.scrollTop + at.top - box.top - (list.clientHeight - at.height) / 2);
      else list.scrollLeft = Math.max(0, list.scrollLeft + at.left - box.left - (list.clientWidth - at.width) / 2);
    };
    const resized = () => {
      const next = dimensions();
      if (next.every((value, index) => Math.abs(value - previous[index]) < 0.5)) return;
      previous = next;
      const focused = document.activeElement;
      if (axis === 'horizontal' && focused instanceof HTMLElement && focused !== current
        && focused !== list && list.contains(focused)) {
        if (!focused.matches(':focus-visible')) return;
        const frame = list.getBoundingClientRect();
        const item = focused.getBoundingClientRect();
        const inset = frame.left + list.clientLeft;
        const right = inset + list.clientWidth;
        if (item.left < inset) list.scrollLeft += item.left - inset;
        else if (item.right > right) list.scrollLeft += item.right - right;
        return;
      }
      if (following) center();
    };
    let touchStart: Touch | undefined;
    const beforeInput = (event: Event) => {
      if (axis === 'horizontal' && event.type === 'touchstart') {
        touchStart = (event as TouchEvent).touches[0];
        return;
      }
      if (axis === 'horizontal' && event.type === 'touchmove') {
        const touch = Array.from((event as TouchEvent).touches).find(point => point.identifier === touchStart?.identifier);
        if (touch && touchStart && Math.abs(touch.clientX - touchStart.clientX) > Math.abs(touch.clientY - touchStart.clientY)) {
          following = false;
        }
        return;
      }
      if (scrollInput(event, list, axis)) following = false;
    };
    const pointerMove = (event: PointerEvent) => { if (event.buttons) beforeInput(event); };
    const inputs = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const input of inputs) list.addEventListener(input, beforeInput, { capture: true, passive: true });
    list.addEventListener('pointermove', pointerMove, { capture: true, passive: true });
    center();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    observer?.observe(list);
    if (content) observer?.observe(content);
    observer?.observe(current);
    if (axis === 'horizontal') {
      for (const sibling of Array.from(current.parentElement?.children ?? [])) {
        if (sibling !== current) observer?.observe(sibling);
      }
    }
    return () => {
      observer?.disconnect();
      for (const input of inputs) list.removeEventListener(input, beforeInput, true);
      list.removeEventListener('pointermove', pointerMove, true);
    };
  }, [axis, identity, ref, selector]);
}
