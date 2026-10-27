/** Real-browser regression: jsdom cannot measure the reader header's rendered geometry. */
export function inspectBibleBookLineLayout(root: HTMLElement) {
  const rect = (element: Element) => {
    const b = element.getBoundingClientRect();
    return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
  };
  const frame = rect(root);
  const controls = Array.from(root.querySelectorAll('button')).filter(button => {
    const b = button.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(button).visibility !== 'hidden';
  }).map(button => {
    const box = rect(button), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      label: button.getAttribute('aria-label') || button.textContent, box,
      hit: !!hit && button.contains(hit), expanded: button.getAttribute('aria-expanded'),
    };
  });
  const overlap = (a: typeof frame, b: typeof frame) =>
    Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
  const checks = {
    frameInViewport: frame.x >= -1 && frame.right <= innerWidth + 1 && frame.y >= -1 && frame.bottom <= innerHeight + 1,
    controlsInside: controls.every(({ box }) => box.x >= frame.x - 1 && box.right <= frame.right + 1 && box.y >= frame.y - 1 && box.bottom <= frame.bottom + 1),
    controlsInViewport: controls.every(({ box }) => box.x >= -1 && box.right <= innerWidth + 1 && box.y >= -1 && box.bottom <= innerHeight + 1),
    controlsReachable: controls.every(c => c.hit && c.box.width >= 28 && c.box.height >= 28),
    controlsDoNotOverlap: controls.every((c, i) => controls.slice(i + 1).every(other => !overlap(c.box, other.box))),
  };
  return {
    viewport: { width: innerWidth, height: innerHeight }, frame, controls,
    overflowPx: Math.max(0, ...controls.map(c => c.box.right - frame.right)), checks,
    pass: controls.length >= 6 && Object.values(checks).every(Boolean),
  };
}
