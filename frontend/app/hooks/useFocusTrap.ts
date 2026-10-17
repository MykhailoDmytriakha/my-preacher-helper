'use client';

import { useEffect, type RefObject } from 'react';

import { isTopmostLayer } from '@/hooks/useModalLayer';

/**
 * What Tab can reach. No visibility filter: jsdom lays nothing out, and a filter on layout would empty the
 * ring in tests. An element taken out of the tab order (`tabindex="-1"` — a duplicate of a row's button for
 * a finger) is never the ring's first or last: counted, Shift+Tab landed on it and Tab left the window.
 */
const REACHABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'textarea:not([disabled])', 'select:not([disabled])', '[tabindex]',
].map((selector) => `${selector}:not([tabindex="-1"])`).join(', ');

/**
 * KEEPS TAB INSIDE A WINDOW — the keyboard agrees with the eye. From the last control Tab goes to the
 * first and Shift+Tab from the first to the last; focus that got out (its element unmounted, a click
 * beside the window) comes back in. It listens before anything on the page does, and the page's own
 * keyboard handlers do not see Tab while the window is open: a screen with a trap of its own (a
 * council's meeting) cannot pull focus out from under the window above it.
 *
 * Four older windows still keep their own copy of this (`SourceNotePickerModal`,
 * `CreateSermonFromNoteModal`, the council's meeting `Shell`, `CustomTimePicker`); they differ in
 * small ways, so moving them here is its own change, checked window by window.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      // A window opened above this one (a question asked over it) has the keyboard.
      const layer = container.closest<HTMLElement>('[data-modal-layer]');
      if (layer && !isTopmostLayer(layer)) return;
      event.stopPropagation();
      const reachable = Array.from(container.querySelectorAll<HTMLElement>(REACHABLE));
      if (reachable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = reachable[0];
      const last = reachable[reachable.length - 1];
      const current = document.activeElement;
      if (!container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active, containerRef]);
}

export default useFocusTrap;
