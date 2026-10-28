/** Visibility and availability without layout measurements, which are absent in jsdom. */
export function isAvailableFocusTarget(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ visibilityProperty: true })) return false;
  if (element.matches(':disabled, input[type="hidden"]') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

/** Controls in the browser's Tab sequence. */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, summary, [tabindex], [contenteditable="true"]');
  const available = [...candidates].filter(element => isAvailableFocusTarget(element) &&
    (element.tabIndex >= 0 || (!element.hasAttribute('tabindex') && element.getAttribute('contenteditable') === 'true')));
  return available.filter(element => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true;
    const group = available.filter((node): node is HTMLInputElement => node instanceof HTMLInputElement &&
      node.type === 'radio' && node.name === element.name && node.form === element.form);
    return element === (group.find(node => node.checked) ?? group[0]);
  }).sort((left, right) => {
    const order = (node: HTMLElement) => node.tabIndex > 0 ? node.tabIndex : Infinity;
    return order(left) - order(right) || 0;
  });
}

/** A dialog with no enabled controls still owns keyboard focus. */
export function focusInside(container: HTMLElement): void {
  const first = focusableElements(container)[0];
  if (first) {
    first.focus({ preventScroll: true });
    return;
  }
  const panel = container.matches('[role="dialog"], [role="alertdialog"]')
    ? container : container.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? container;
  if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
}
