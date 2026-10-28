import { focusInside, isAvailableFocusTarget } from './focusableElements';

type Layer = { element: HTMLElement; focusRoot: HTMLElement; surfacesBeneath: ReadonlySet<Element>; returnTargets: HTMLElement[]; zIndex: number };
const layers: Layer[] = [];

/** The top layer alone owns Escape and keyboard focus. */
export function isTopmostLayer(element: HTMLElement): boolean {
  return layers.at(-1)?.element === element;
}

/** Registered windows above a full-screen keyboard scope; its own dialog markup is not another layer. */
export function hasModalLayers(): boolean {
  return layers.length > 0;
}

/** Shared by dialogs, full-screen keyboards and page gestures. */
export function hasOpenLayer(): boolean {
  const root = document.documentElement.style;
  const body = document.body.style;
  if (root.overflow === 'hidden' || body.overflow === 'hidden' || body.position === 'fixed') return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-layer], [aria-modal="true"], dialog[open], [role="menu"]'))
    .some(element => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
}

/** Other libraries may open their own keyboard surface above a retained window. */
export const EXTERNAL_FOCUS_SURFACES = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-headlessui-portal]';

/** A true external modal owns its trap even when mounted together; only newer nonmodal surfaces outrank the ring. */
export function hasExternalDialogFocus(container: HTMLElement, beneath?: ReadonlySet<Element>): boolean {
  const active = document.activeElement;
  const selector = beneath ? EXTERNAL_FOCUS_SURFACES : '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
  const surface = active instanceof HTMLElement ? active.closest<HTMLElement>(selector) : null;
  return Boolean(surface && !container.contains(surface) && !surface.contains(container) &&
    !surface.closest('[data-modal-layer]') && (!beneath || !beneath.has(surface) || surface.getAttribute('aria-modal') === 'true'));
}

export function registerModalLayer(element: HTMLElement, opener: HTMLElement | null, fallback: HTMLElement | null, focusRoot: HTMLElement = element): () => void {
  const entry = { element, focusRoot, surfacesBeneath: new Set(document.querySelectorAll(EXTERNAL_FOCUS_SURFACES)), zIndex: Number(getComputedStyle(element).zIndex) || 0, returnTargets: [...new Set([opener, fallback].filter((node): node is HTMLElement => node !== null))] };
  layers.push(entry);
  // Child layout effects run first for portals mounted together. Keyboard ownership follows
  // visual layers; equal layers keep opening order. Lower registration cannot take focus back.
  layers.sort((left, right) => left.zIndex - right.zIndex);
  focusTopLayer();
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
    const parent = layers.at(-1)?.focusRoot;
    const target = entry.returnTargets.find(node => node.isConnected && isAvailableFocusTarget(node) && (!parent || parent.contains(node)));
    if (target) {
      target.focus({ preventScroll: true });
    } else if (parent && !parent.contains(document.activeElement)) {
      focusInside(parent);
    }
  };
}

/** Keyboard focus follows the named ring while the outer element retains layer identity and z-order. */
function focusTopLayer(): void {
  const top = layers.at(-1);
  if (!top || !isAvailableFocusTarget(top.focusRoot)) return;
  if (!top.focusRoot.contains(document.activeElement) ||
    (document.activeElement instanceof HTMLElement && !isAvailableFocusTarget(document.activeElement))) focusInside(top.focusRoot);
}

/** A late panel changes the ring without unregistering the window or replacing its return targets. */
export function updateModalLayerFocusRing(element: HTMLElement, focusRoot: HTMLElement): void {
  const layer = layers.find(entry => entry.element === element);
  if (!layer || layer.focusRoot === focusRoot) return;
  layer.focusRoot = focusRoot;
  if (isTopmostLayer(element) && !hasExternalDialogFocus(element, layer.surfacesBeneath)) focusTopLayer();
}
