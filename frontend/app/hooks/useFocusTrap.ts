'use client';

import { useEffect, type RefObject } from 'react';

import { focusableElements, focusInside, isAvailableFocusTarget } from '@/utils/focusableElements';
import { EXTERNAL_FOCUS_SURFACES, hasExternalDialogFocus, hasModalLayers, isTopmostLayer } from '@/utils/modalLayerRegistry';

/** One Tab ring for a modal, or a full-screen workspace when no modal is above it. */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    const beneath = new Set(document.querySelectorAll(EXTERNAL_FOCUS_SURFACES));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const container = containerRef.current;
      if (!container || !isAvailableFocusTarget(container) || hasExternalDialogFocus(container, beneath)) return;
      // A window opened above this one (a question asked over it) has the keyboard.
      const layer = container.closest<HTMLElement>('[data-modal-layer]');
      if (layer ? !isTopmostLayer(layer) : hasModalLayers()) return;
      event.stopPropagation();
      const reachable = focusableElements(container);
      if (reachable.length === 0) {
        event.preventDefault();
        focusInside(container);
        return;
      }
      const first = reachable[0];
      const last = reachable[reachable.length - 1];
      const current = document.activeElement;
      if (!reachable.includes(current as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, containerRef]);
}

export default useFocusTrap;
