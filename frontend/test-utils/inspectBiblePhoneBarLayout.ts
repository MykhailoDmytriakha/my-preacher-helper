/** Real-browser geometry regression; jsdom does not lay out the reader. */
export function inspectBiblePhoneBarLayout(root: HTMLElement) {
  const rect = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
  };
  const frame = rect(root);
  const buttons = Array.from(root.querySelectorAll('button')).map((button) => {
    const bounds = rect(button);
    const textRects: { x: number; y: number; width: number; height: number }[] = [];
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || node.parentElement?.closest('svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textRects.push(...Array.from(range.getClientRects()).map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.height })));
    }
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return { text: button.textContent ?? '', aria: button.getAttribute('aria-label'), bounds, textRects,
      centreHit: !!hit && button.contains(hit), scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
  });
  const checks = {
    fourActions: buttons.length === 4,
    inside: buttons.every(({ bounds }) => bounds.x >= Math.max(0, frame.x) - 1 && bounds.right <= Math.min(innerWidth, frame.right) + 1),
    touchTargets: buttons.every(({ bounds }) => bounds.height >= 44 && bounds.width >= 44),
    hitTargets: buttons.every((button) => button.centreHit),
    noOverlap: buttons.every(({ bounds }, index) => !index || bounds.x >= buttons[index - 1].bounds.right - 1),
    oneLine: buttons.every(({ textRects }) => new Set(textRects.map((box) => Math.round(box.y))).size <= 1),
    textFits: buttons.every(({ bounds, textRects, scrollWidth, clientWidth }) => scrollWidth <= clientWidth + 1 && textRects.every((box) =>
      box.x >= bounds.x - 1 && box.x + box.width <= bounds.right + 1 && box.y >= bounds.y - 1 && box.y + box.height <= bounds.bottom + 1)),
  };
  return { viewport: innerWidth, frame, buttons, checks, pass: Object.values(checks).every(Boolean) };
}
