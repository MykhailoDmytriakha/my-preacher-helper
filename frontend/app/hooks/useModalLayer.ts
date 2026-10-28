'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { addLayer, hasModalLayers, isTopmostLayer } from '@/hooks/modalLayers';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';

export { isTopmostLayer } from '@/hooks/modalLayers';

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
 * Escape, keeps Tab inside and names itself — without a line of its layout changing.
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
  /**
   * Where Tab turns round, when it is not the whole overlay: the panel inside it (a menu beside the verse it
   * was opened from, a sheet over a dimmed page). The ring is kept either way — 14 windows that drew a
   * layer and forgot it let Tab walk onto the page under them (BUG-20261023-windows-let-tab-out).
   */
  focusRing?: RefObject<HTMLElement | null>;
}

export interface ModalLayerProps {
  /** The overlay says when it comes and goes: it can come after the window's first render. */
  ref: (element: HTMLDivElement | null) => void;
  'data-modal-layer': 'true';
}

/**
 * Whether any window stands over the page — a held page, a modal, a dialog, an open menu. What is
 * under it answers neither the page's gestures nor its keyboard shortcuts.
 */
export function hasOpenLayer(): boolean {
  // A held page: the scroll lock holds the root, and on iOS pins the body too (useScrollLock).
  const root = document.documentElement.style;
  const body = document.body.style;
  if (root.overflow === 'hidden' || body.overflow === 'hidden' || body.position === 'fixed') return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-layer], [aria-modal="true"], dialog[open], [role="menu"]'))
    .some(element => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
}

export function useModalLayer({
  onClose,
  closeDisabled = false,
  active = true,
  closeOnEscape = true,
  focusRing,
}: ModalLayerOptions): ModalLayerProps {
  const ref = useRef<HTMLDivElement>(null);
  useScrollLock(active);
  useFocusTrap(focusRing ?? ref, active);

  // The overlay can come after the window's first render — a portal waits for the page to mount — and the window
  // is on screen from then: registered only at its first render, such a window was never the topmost, and its
  // ring (`useFocusTrap`) let Tab be. One more render, when the overlay comes or goes.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    setElement(node);
  }, []);

  // Registration is by the order windows come on screen, and unregistration is by identity: a window
  // closing from the middle of the stack must not shift the one above it out of "topmost".
  useEffect(() => {
    if (!active || !element) return;
    return addLayer(element);
  }, [active, element]);

  useEffect(() => {
    if (!active || !closeOnEscape || closeDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // ONLY THE TOPMOST WINDOW CLOSES. Two windows both closing on one press is a form
      // disappearing because the picker in front of it was dismissed.
      const element = ref.current;
      if (element && hasModalLayers() && !isTopmostLayer(element)) return;
      event.stopPropagation();
      onClose();
    };
    // Bound to the WINDOW, not the document: a key event dispatched at either one reaches it
    // (document bubbles up to window), so no caller can be listened to more narrowly than it
    // used to be. Several windows here had their own `window` listener before this hook.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, closeDisabled, closeOnEscape, onClose]);

  return { ref: attach, 'data-modal-layer': 'true' };
}

export default useModalLayer;
