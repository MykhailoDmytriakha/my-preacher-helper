import { focusInside, isAvailableFocusTarget } from './focusableElements';

type Layer = { element: HTMLElement; returnTargets: HTMLElement[]; zIndex: number };
const layers: Layer[] = [];

/** The top layer alone owns Escape and keyboard focus. */
export function isTopmostLayer(element: HTMLElement): boolean {
  return layers.at(-1)?.element === element;
}

/** Shared by dialogs, full-screen keyboards and page gestures. */
export function hasOpenLayer(): boolean {
  const root = document.documentElement.style;
  const body = document.body.style;
  if (root.overflow === 'hidden' || body.overflow === 'hidden' || body.position === 'fixed') return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-layer], [aria-modal="true"], dialog[open], [role="menu"]'))
    .some(element => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
}

/** A third-party dialog (Headless UI) owns its own trap outside our portalled overlay. */
export function hasExternalDialogFocus(container: HTMLElement): boolean {
  const active = document.activeElement;
  const dialog = active instanceof HTMLElement
    ? active.closest<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]') : null;
  return Boolean(dialog && !container.contains(dialog) && !dialog.closest('[data-modal-layer]'));
}

export function registerModalLayer(element: HTMLElement, opener: HTMLElement | null, fallback: HTMLElement | null): () => void {
  const entry = { element, zIndex: Number(getComputedStyle(element).zIndex) || 0, returnTargets: [...new Set([opener, fallback].filter((node): node is HTMLElement => node !== null))] };
  layers.push(entry);
  // Child layout effects run first for portals mounted together. Keyboard ownership follows
  // visual layers; equal layers keep opening order. Lower registration cannot take focus back.
  layers.sort((left, right) => left.zIndex - right.zIndex);
  const top = layers.at(-1)!;
  // React autoFocus and a caller's chosen input take precedence over the default first control.
  if (isAvailableFocusTarget(top.element) && (!top.element.contains(document.activeElement) ||
    (document.activeElement instanceof HTMLElement && !isAvailableFocusTarget(document.activeElement)))) focusInside(top.element);
  return () => {
    const wasTop = isTopmostLayer(element);
    const index = layers.indexOf(entry);
    if (index < 0) return;
    layers.splice(index, 1);
    // Removing a lower layer must not strand the remaining layer's eventual return target.
    for (const layer of layers) {
      layer.returnTargets = [...new Set(layer.returnTargets.flatMap(target => element.contains(target) ? entry.returnTargets : [target]))];
    }
    if (!wasTop) return;
    const parent = layers.at(-1)?.element;
    const target = entry.returnTargets.find(node => node.isConnected && isAvailableFocusTarget(node) && (!parent || parent.contains(node)));
    if (target) {
      target.focus({ preventScroll: true });
    } else if (parent && !parent.contains(document.activeElement)) {
      focusInside(parent);
    }
  };
}
