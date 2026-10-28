'use client';

import { useEffect, useInsertionEffect, useLayoutEffect, useRef } from 'react';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';
import { isAvailableFocusTarget } from '@/utils/focusableElements';
import { hasExternalDialogFocus, isTopmostLayer, registerModalLayer, updateModalLayerFocusRing } from '@/utils/modalLayerRegistry';

export { hasOpenLayer, isTopmostLayer } from '@/utils/modalLayerRegistry';

/**
 * WHAT IT MEANS TO BE A MODAL WINDOW IN THIS APP — in one place.
 *
 * Thirty-eight components draw their own `fixed inset-0` overlay, and each decided for itself
 * what a modal window owes the person: barely half said they were dialogs, a third answered
 * Escape, and none of them held the page still. The owner found that the last way round: he
 * scrolled his sermon list away while the "New sermon" form stood open in front of it.
 *
 * Rewriting thirty-eight components into one is a change nobody can review. So the RULES move
 * into a hook and the markup stays where it is: a window calls this, spreads the props it
 * returns onto the overlay it already draws, and from then on it locks the page, answers
 * Escape and keeps keyboard focus inside — without changing its layout.
 *
 * Deliberately NOT here: the backdrop click. What a click on the dark area should do differs
 * by window — a form with typing in it must not vanish that way — so the caller keeps it.
 */
export interface ModalLayerOptions {
  /** How this window closes. Escape calls it. */
  onClose: () => void;
  /**
   * Nothing may close the window right now — a save is in flight, say. Escape stays silent,
   * exactly as the ✕ and the backdrop do.
   */
  closeDisabled?: boolean;
  /** `false` for a window that is mounted but not shown; it then holds nothing. */
  active?: boolean;
  /** A window that is a dialog in every way except that Escape is not its way out. */
  closeOnEscape?: boolean;
  /** An opener inside a menu may have disappeared before this dialog mounts. */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  /** An explicit Tab ring inside the layer, when the overlay includes other reading content. */
  focusRing?: React.RefObject<HTMLElement | null>;
}

export interface ModalLayerProps<T extends HTMLElement = HTMLDivElement> {
  ref: React.RefObject<T | null>;
  'data-modal-layer': 'true' | undefined;
}

export function useModalLayer<T extends HTMLElement = HTMLDivElement>({
  onClose,
  closeDisabled = false,
  active = true,
  closeOnEscape = true,
  returnFocusTo,
  focusRing,
}: ModalLayerOptions): ModalLayerProps<T> {
  const ref = useRef<T>(null);
  useScrollLock(active);

  const opener = useRef<HTMLElement | null>(null);
  const registration = useRef<{ element: HTMLElement; release: () => void } | null>(null);
  // Capture before React's layout-time autoFocus; reading in a passive effect loses the opener.
  useInsertionEffect(() => {
    if (active) opener.current = document.activeElement as HTMLElement | null;
  }, [active]);

  // Synchronize the actual ref on every commit: some portals first render after mount. A stable
  // element keeps its registration, so typing/rerenders never reset focus or the return target.
  useLayoutEffect(() => {
    const element = active ? ref.current : null;
    if (registration.current?.element === element) {
      if (element) updateModalLayerFocusRing(element, focusRing?.current ?? element);
      return;
    }
    registration.current?.release();
    registration.current = element
      ? { element, release: registerModalLayer(element, returnFocusTo?.current ?? null, opener.current, focusRing?.current ?? element) }
      : null;
  });
  useLayoutEffect(() => () => {
    registration.current?.release();
    registration.current = null;
  }, []);
  useFocusTrap(focusRing ?? ref, active);

  useEffect(() => {
    if (!active || !closeOnEscape || closeDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // ONLY THE TOPMOST WINDOW CLOSES. Two windows both closing on one press is a form
      // disappearing because the picker in front of it was dismissed.
      const element = ref.current;
      if (!element || !isTopmostLayer(element) || !isAvailableFocusTarget(element) || hasExternalDialogFocus(element)) return;
      event.stopPropagation();
      onClose();
    };
    // Bound to the WINDOW, not the document: a key event dispatched at either one reaches it
    // (document bubbles up to window), so no caller can be listened to more narrowly than it
    // used to be. Several windows here had their own `window` listener before this hook.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, closeDisabled, closeOnEscape, onClose]);

  return { ref, 'data-modal-layer': active ? 'true' : undefined };
}

export default useModalLayer;
