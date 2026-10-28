/**
 * THE WINDOWS ON SCREEN, oldest first — so the topmost one can answer alone. Kept apart from the hooks that
 * use it: `useModalLayer` puts its window here and keeps Tab inside it through `useFocusTrap`, and the trap asks
 * here which window has the keyboard.
 */
const layers: HTMLElement[] = [];

/** A window comes on screen: it is the topmost until another comes. */
export function addLayer(element: HTMLElement): () => void {
  layers.push(element);
  // Taken away by identity: a window closing from the middle of the stack must not shift the one above it.
  return () => {
    const at = layers.indexOf(element);
    if (at >= 0) layers.splice(at, 1);
  };
}

/** Whether `element` is the topmost window on screen — the one the keyboard belongs to. */
export function isTopmostLayer(element: HTMLElement): boolean {
  return layers.length > 0 && layers[layers.length - 1] === element;
}

/** Whether any window stands on screen: a screen beneath it (the council's meeting) leaves the keyboard to it. */
export function hasModalLayers(): boolean {
  return layers.length > 0;
}
