'use client';

import { useEffect, useRef } from 'react';

import { useScrollLock } from '@/hooks/useScrollLock';

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
 * Escape and names itself — without a line of its layout changing.
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
}

export interface ModalLayerProps {
  ref: React.RefObject<HTMLDivElement | null>;
  'data-modal-layer': 'true';
}

/** Every layer currently on screen, oldest first — so the topmost one can answer alone. */
const layers: HTMLElement[] = [];

export function useModalLayer({
  onClose,
  closeDisabled = false,
  active = true,
  closeOnEscape = true,
}: ModalLayerOptions): ModalLayerProps {
  const ref = useRef<HTMLDivElement>(null);
  useScrollLock(active);

  // Registration is by mounting order, and unregistration is by identity: a window closing
  // from the middle of the stack must not shift the one above it out of "topmost".
  useEffect(() => {
    if (!active) return;
    const element = ref.current;
    if (!element) return;
    layers.push(element);
    return () => {
      const at = layers.indexOf(element);
      if (at >= 0) layers.splice(at, 1);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !closeOnEscape || closeDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // ONLY THE TOPMOST WINDOW CLOSES. Two windows both closing on one press is a form
      // disappearing because the picker in front of it was dismissed.
      const element = ref.current;
      if (element && layers.length > 0 && layers[layers.length - 1] !== element) return;
      event.stopPropagation();
      onClose();
    };
    // Bound to the WINDOW, not the document: a key event dispatched at either one reaches it
    // (document bubbles up to window), so no caller can be listened to more narrowly than it
    // used to be. Several windows here had their own `window` listener before this hook.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, closeDisabled, closeOnEscape, onClose]);

  return { ref, 'data-modal-layer': 'true' };
}

export default useModalLayer;
