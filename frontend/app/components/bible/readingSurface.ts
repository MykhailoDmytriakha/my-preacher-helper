/**
 * WHAT THE READER SCROLLS (owner, 2026-10-16, iPad): on a phone the page itself; on a screen wide
 * enough for the minimap, the text's own pane beside it. A page coasting under its own momentum
 * takes a finger put on any scroller nested inside it — the minimap went on scrolling the text until
 * the text stopped — so there the page never scrolls and the two panes are siblings, as a study's
 * are (BUG-20260905-ipad-study-scroll-handoff). One description of the reading position for all that
 * reads or moves it: the reader, its room under the book, the place it keeps, the minimap.
 */
export type ReadingSurface = {
  /** Where its scroll events come from. */
  target: Window | HTMLElement;
  /** How far it is scrolled. */
  top: () => number;
  scrollTo: (top: number) => void;
  /** How much of it shows, and how tall is all it holds. */
  height: () => number;
  contentHeight: () => number;
  /** Where its visible part starts and ends on the screen. */
  edge: () => number;
  bottom: () => number;
  /**
   * Whether the browser may scroll it by itself to keep what shows in place while the text above grows
   * (scroll anchoring, `overflow-anchor`). Off while a verse jumped to holds: the reader keeps that verse
   * itself, and the browser's own scroll was taken for the person's (BUG-20261020-ipad-arrival-place-verse-early).
   */
  anchoring: (on: boolean) => void;
};

/**
 * The pane when the text has one, else the page. `pageMoved` hears of each move the reader makes of the
 * page itself: a phone's header folds for the person reading, not for the reader keeping its place.
 */
export function readingSurface(pane: HTMLElement | null, pageMoved?: () => void): ReadingSurface {
  if (!pane) {
    return {
      target: window,
      top: () => window.scrollY,
      scrollTo: (top) => {
        const was = window.scrollY;
        window.scrollTo({ top });
        if (window.scrollY !== was) pageMoved?.();
      },
      height: () => window.innerHeight,
      contentHeight: () => document.documentElement.scrollHeight,
      edge: () => 0,
      bottom: () => window.innerHeight,
      anchoring: (on) => {
        document.documentElement.style.overflowAnchor = on ? '' : 'none';
      },
    };
  }
  return {
    target: pane,
    top: () => pane.scrollTop,
    scrollTo: (top) => {
      pane.scrollTop = top;
    },
    height: () => pane.clientHeight,
    contentHeight: () => pane.scrollHeight,
    edge: () => pane.getBoundingClientRect().top,
    bottom: () => pane.getBoundingClientRect().bottom,
    anchoring: (on) => {
      pane.style.overflowAnchor = on ? '' : 'none';
    },
  };
}
