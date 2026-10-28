'use client';

import { useEffect, type RefObject } from 'react';

import { hasModalLayers, isTopmostLayer } from '@/hooks/modalLayers';

/**
 * What Tab can reach. An element taken out of the tab order (`tabindex="-1"` — a duplicate of a row's button for
 * a finger) is never the ring's first or last: counted, Shift+Tab landed on it and Tab left the window.
 */
const REACHABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'textarea:not([disabled])', 'select:not([disabled])', 'summary', '[tabindex]',
].map((selector) => `${selector}:not([tabindex="-1"])`).join(', ');

/**
 * Whether the browser shows the element. A control the screen does not show (a phone's button hidden on a
 * computer) is no end of the ring: Tab from the last control shown would leave the window. `checkVisibility`
 * says it with `visibility: hidden` counted too (the option is opt-in); where a browser has none (Safari before
 * 17.4, jsdom) the element's own style and its parents' up to the ring say it. Never by layout (`offsetParent`):
 * jsdom lays nothing out, and such a filter would empty the ring in tests.
 */
function shown(element: HTMLElement, ring: HTMLElement, hiddenParts: Map<HTMLElement, boolean>): boolean {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true });
  if (getComputedStyle(element).visibility === 'hidden') return false;
  return !hiddenPart(element, ring, hiddenParts);
}

/** Whether the element or a parent up to the ring is `display: none` — each part asked once per key press. */
function hiddenPart(node: HTMLElement | null, ring: HTMLElement, known: Map<HTMLElement, boolean>): boolean {
  if (!node || node === ring.parentElement) return false;
  const seen = known.get(node);
  if (seen !== undefined) return seen;
  const hidden = getComputedStyle(node).display === 'none' || hiddenPart(node.parentElement, ring, known);
  known.set(node, hidden);
  return hidden;
}

/**
 * A surface opened over the window — a form's calendar, a question portalled out of the window, another library's
 * dialog: focus in it is its own to keep, not focus that got out. "Over" is said by time: the surfaces already on
 * the page when the ring began to be kept lie beneath it (a menu of the page, Codex 2026-10-28), and so does a window
 * of this app's list; focus that fell there is brought back.
 */
const SURFACES = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-headlessui-portal]';
function inSurfaceOpenedOver(element: Element | null, ring: HTMLElement, beneath: ReadonlySet<Element>): boolean {
  const surface = element?.closest(SURFACES);
  return !!surface && !beneath.has(surface) && !surface.contains(ring) && !ring.contains(surface) && !surface.closest('[data-modal-layer]');
}

/**
 * KEEPS TAB INSIDE — the keyboard agrees with the eye. From the last control Tab goes to the first and
 * Shift+Tab from the first to the last; focus that got out (its element unmounted, a click beside the
 * window) comes back in. Every window drawn on `useModalLayer` keeps its ring here; a screen that covers the
 * application without being a window (the council's meeting) calls this itself. It listens before anything
 * on the page does, and the page's own keyboard handlers do not see Tab while the ring is kept. The keyboard
 * belongs to the topmost window: a window beneath another, and a screen beneath any window, let Tab be.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    const beneath = new Set(document.querySelectorAll(SURFACES));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      // A window opened above this one (a question asked over it) has the keyboard.
      const layer = container.closest<HTMLElement>('[data-modal-layer]');
      if (layer ? !isTopmostLayer(layer) : hasModalLayers()) return;
      // Focus in a surface of its own above the window: the key goes on to it untouched.
      const current = document.activeElement;
      if (!container.contains(current) && inSurfaceOpenedOver(current, container, beneath)) return;
      event.stopPropagation();
      // Inactive reader panels stay laid out to keep their scroll position, but are not reachable.
      const hiddenParts = new Map<HTMLElement, boolean>();
      const reachable = Array.from(container.querySelectorAll<HTMLElement>(REACHABLE)).filter((element) => !element.closest('[inert]') && shown(element, container, hiddenParts));
      if (reachable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = reachable[0];
      const last = reachable[reachable.length - 1];
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
