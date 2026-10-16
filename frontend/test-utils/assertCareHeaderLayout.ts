/** Browser regression: run on a populated care list after its interface language has loaded. */
export const assertCareHeaderLayout = () => {
  const header = document.querySelector('main header');
  const heading = header?.querySelector('h1');
  const title = heading?.querySelector('span');
  if (!header || !heading || !title) throw new Error('The care list header is not loaded');

  const headingRect = heading.getBoundingClientRect();
  const titleRect = title.getBoundingClientRect();
  const actions = Array.from(header.querySelectorAll('button')).map(button => {
    const rect = button.getBoundingClientRect();
    return {
      label: button.textContent,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      clipped: button.scrollWidth > button.clientWidth + 1,
      outsideViewport: rect.left < -1 || rect.right > innerWidth + 1,
      overlapsHeading: rect.left < headingRect.right && rect.right > headingRect.left &&
        rect.top < headingRect.bottom && rect.bottom > headingRect.top,
    };
  }).filter(action => action.width > 0 && action.height > 0);
  if (actions.length === 0) throw new Error('This regression requires a populated list with header actions');

  const metrics = {
    route: location.pathname,
    viewport: [innerWidth, innerHeight],
    title: title.textContent,
    titleWidth: title.clientWidth,
    titleRequiredWidth: title.scrollWidth,
    titleClipped: title.scrollWidth > title.clientWidth + 1,
    titleOutsideViewport: titleRect.left < -1 || titleRect.right > innerWidth + 1 || titleRect.height <= 0,
    actions,
  };
  if (metrics.titleClipped || metrics.titleOutsideViewport ||
      actions.some(action => action.clipped || action.outsideViewport || action.overlapsHeading)) {
    throw new Error('Care header layout failed: ' + JSON.stringify(metrics));
  }
  return metrics;
};
