/** Browser regression: date labels must stay readable in the populated group list. */
export const assertGroupMeetingDatesReadable = () => {
  const labels = Array.from(document.querySelectorAll('main a[href^="/groups/"] .grid.grid-cols-3 > div:last-child span'));
  if (!labels.length) throw new Error('The populated group list is not loaded');
  const metrics = labels.map(label => ({
    text: label.textContent,
    width: label.clientWidth,
    neededWidth: label.scrollWidth,
    height: label.clientHeight,
    neededHeight: label.scrollHeight,
  }));
  if (metrics.some(label => label.neededWidth > label.width + 1 || label.neededHeight > label.height + 1)) {
    throw new Error('A group meeting date is clipped: ' + JSON.stringify(metrics));
  }
  return { viewport: [innerWidth, innerHeight], labels: metrics };
};
