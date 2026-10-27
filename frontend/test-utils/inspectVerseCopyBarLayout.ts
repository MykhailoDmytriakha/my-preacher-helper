/** Real-browser regression: jsdom cannot measure the copy bar's rendered width. */
export function inspectVerseCopyBarLayout(root: HTMLElement) {
  const rect = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  };
  const frame = rect(root);
  const buttons = Array.from(root.querySelectorAll('button')).map(button => {
    const box = rect(button);
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { label: button.textContent || button.getAttribute('aria-label'), box,
      hit: !!hit && button.contains(hit), textFits: button.scrollWidth <= button.clientWidth + 1 };
  });
  const overlaps = (a: typeof frame, b: typeof frame) =>
    Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
  const checks = {
    frameInViewport: frame.x >= -1 && frame.right <= innerWidth + 1 && frame.y >= -1 && frame.bottom <= innerHeight + 1,
    controlsInside: buttons.every(({ box }) => box.x >= frame.x - 1 && box.right <= frame.right + 1 && box.y >= frame.y - 1 && box.bottom <= frame.bottom + 1),
    controlsReachable: buttons.every(button => button.hit && button.box.width >= 32 && button.box.height >= 32),
    labelsFit: buttons.every(button => button.textFits),
    controlsDoNotOverlap: buttons.every((button, index) => buttons.slice(index + 1).every(other => !overlaps(button.box, other.box))),
    placeVisible: (root.querySelector('[data-copy-place]')?.getBoundingClientRect().width ?? 0) >= 64,
  };
  return { viewport: { width: innerWidth, height: innerHeight }, frame, buttons,
    overflowPx: Math.max(0, ...buttons.map(({ box }) => box.right - frame.right)), checks, pass: Object.values(checks).every(Boolean) };
}
