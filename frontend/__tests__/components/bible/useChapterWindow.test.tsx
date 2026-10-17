import { act, render } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';

import { BookRibbon } from '@/components/bible/BookRibbon';
import { readingSurface } from '@/components/bible/readingSurface';
import { useChapterWindow } from '@/components/bible/useChapterWindow';

import type { BookText } from '@/utils/bibleText';

/*
 * THE WINDOW OF CHAPTERS ON A LAID-OUT PAGE. jsdom lays nothing out, so a small model does: each chapter
 * is its heading and its verses one under another, a box is the height it is given, the pane shows 600 px
 * and scrolls. What is checked is what the person sees: the verse on the screen stays where it stood
 * while chapters come and go (2026-10-16, the owner's iPad; Codex's two attacks).
 */
let mockScale: number | null = null;
jest.mock('@/providers/TextScaleProvider', () => ({ useTextScaleValue: () => mockScale }));

const ROW = 40;
const HEAD = 28;
const GAP = 24;
const LINE = 8;
const SCREEN = 600;

// Thirty chapters of thirty verses; chapter 12's verses are long in letters but take one line each, so its
// guessed box is far taller than the chapter drawn.
const text: BookText = {
  id: 'Genesis',
  chapters: Array.from({ length: 30 }, (_, index) => Array.from({ length: 30 }, () => (index === 11 ? 'x'.repeat(400) : 'In the beginning.'))),
} as BookText;

/** Extra height a chapter's verses took after they were drawn (the links' chips arriving). */
let grown: Record<number, number> = {};
/** How wide the text is; narrower, each verse takes two lines (an iPad turned to stand upright). */
let textWidth = 100;
const rowHeight = () => (textWidth < 100 ? ROW * 2 : ROW);
let pane: HTMLDivElement;
let scrollTop = 0;

const sectionsOf = () => Array.from(pane.querySelectorAll<HTMLElement>('section[data-chapter]'));
const heightOf = (section: HTMLElement) => (section.hasAttribute('data-box')
  ? parseFloat(section.style.height)
  : HEAD + section.querySelectorAll('[data-verse]').length * rowHeight() + (grown[Number(section.dataset.chapter)] ?? 0));
/** Where a chapter starts in the text, from the top of the text. */
function offsetOf(target: HTMLElement): number {
  let top = 0;
  for (const [index, section] of sectionsOf().entries()) {
    if (index > 0) top += GAP;
    if (section === target) return top;
    top += heightOf(section);
  }
  return top;
}
const textHeight = () => {
  const sections = sectionsOf();
  const last = sections[sections.length - 1];
  return last ? offsetOf(last) + heightOf(last) : 0;
};
const box = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: textWidth, width: textWidth, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this === pane) return box(0, SCREEN);
    if (this.matches?.('article')) return box(-scrollTop, textHeight());
    if (this.matches?.('section[data-chapter]')) return box(offsetOf(this) - scrollTop, heightOf(this));
    if (this.matches?.('[data-verse]')) {
      const section = this.closest<HTMLElement>('section[data-chapter]') as HTMLElement;
      const index = Array.from(section.querySelectorAll('[data-verse]')).indexOf(this);
      const chapter = Number(section.dataset.chapter);
      const share = (grown[chapter] ?? 0) / 30;
      return box(offsetOf(section) + HEAD + index * (rowHeight() + share) - scrollTop, rowHeight() + share);
    }
    return realRect.call(this);
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

/** A ResizeObserver the test fires: jsdom has none. */
let observed: (() => void) | null = null;
beforeEach(() => {
  jest.useFakeTimers();
  grown = {};
  textWidth = 100;
  scrollTop = 0;
  mockScale = null;
  observed = null;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(private callback: () => void) { observed = () => this.callback(); }
    observe() { return undefined; }
    disconnect() { observed = null; }
  };
});
afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

type Window = ReturnType<typeof useChapterWindow>;
let windowNow: Window;
const onDrawn = jest.fn();
const onReflow = jest.fn();

/** `jump`: a chapter to open as the reader opens a link — from its layout effect, as the text arrives. */
function Reader({ jump, onLanded }: { jump?: number; onLanded?: () => void }) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef(readingSurface(null));
  useLayoutEffect(() => {
    pane = paneRef.current as HTMLDivElement;
    Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => SCREEN });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => textHeight() + SCREEN });
    surfaceRef.current = readingSurface(pane);
  }, []);
  windowNow = useChapterWindow({ text, textRef, surfaceRef, readingLine: () => LINE, onDrawn, onReflow });
  const show = windowNow.show;
  useLayoutEffect(() => {
    if (jump) show({ chapter: jump }, () => onLanded?.());
  }, [jump, onLanded, show]);
  return (
    <div ref={paneRef}>
      <article ref={textRef}>
        <BookRibbon text={text} lang="en" chapterWord={(chapter) => `Chapter ${chapter}`} boxes={windowNow.boxes} />
      </article>
    </div>
  );
}

const section = (chapter: number) => pane.querySelector<HTMLElement>(`section[data-chapter="${chapter}"]`) as HTMLElement;
const row = (key: string) => pane.querySelector<HTMLElement>(`[data-verse="${key}"]`) as HTMLElement;
/** Opens the book at a chapter, as a jump does: drawn, then its heading at the reading line. */
function openAt(chapter: number) {
  render(<Reader />);
  act(() => {
    windowNow.show({ chapter }, () => { scrollTop = offsetOf(section(chapter)) - LINE; });
  });
}
/** The person scrolls: the scroll moves, and the reader tells the window. */
function scrollTo(top: number) {
  scrollTop = top;
  act(() => {
    windowNow.follow();
    jest.advanceTimersByTime(20);
  });
}
const rest = () => act(() => { jest.advanceTimersByTime(200); });

describe('the chapters of a big book around the place read', () => {
  it('keeps a guessed box above the verse seen while scrolling, and draws it at rest without moving that verse', () => {
    openAt(15);
    expect(section(12)).toHaveAttribute('data-box');
    // Scrolling up: the reading line inside chapter 12's box, chapter 13's first verses on the screen below it.
    scrollTo(offsetOf(section(13)) - 300);
    expect(section(12)).toHaveAttribute('data-box');
    const seen = row('13:1').getBoundingClientRect().top;
    onDrawn.mockClear();
    rest();
    expect(section(12)).not.toHaveAttribute('data-box');
    expect(row('13:1').getBoundingClientRect().top).toBeCloseTo(seen, 0);
    // Other chapters drawn: the reader reads its place again.
    expect(onDrawn).toHaveBeenCalled();
  });

  it('lands a jump that waits for its chapter even when a new text size arrives in the same moment', () => {
    const landed = jest.fn();
    const view = render(<Reader />);
    // A link far in the book opened while the size the person chose is being applied (Codex, 2026-10-16).
    act(() => {
      mockScale = 1.25;
      view.rerender(<Reader jump={28} onLanded={landed} />);
    });
    expect(landed).toHaveBeenCalledTimes(1);
    expect(section(28)).not.toHaveAttribute('data-box');
  });

  it('guesses the boxes again at a new width (the iPad turned) and asks the screen to bring the person back', () => {
    openAt(15);
    const before = parseFloat(section(5).style.height);
    onReflow.mockClear();
    textWidth = 80;
    act(() => { observed?.(); });
    // Each verse takes two lines now: the chapters drawn measure taller, and so do the boxes guessed from them.
    expect(parseFloat(section(5).style.height)).toBeGreaterThan(before * 1.5);
    expect(onReflow).toHaveBeenCalledTimes(1);
  });
  it('does not trust a height measured before the links\' chips changed the chapters: that chapter waits for the rest', () => {
    openAt(15);
    // Read down, so chapter 14 leaves the page with its height measured.
    scrollTo(offsetOf(section(17)) - LINE);
    rest();
    expect(section(14)).toHaveAttribute('data-box');
    act(() => { windowNow.doubt(); });
    // Back up while scrolling: the line in chapter 14's box, chapter 15's verses on the screen below it.
    scrollTo(offsetOf(section(15)) - 300);
    expect(section(14)).toHaveAttribute('data-box');
    rest();
    expect(section(14)).not.toHaveAttribute('data-box');
  });

  it('does not trust a height measured before a late font reflowed the lines', () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    try {
      openAt(15);
      scrollTo(offsetOf(section(17)) - LINE);
      rest();
      expect(section(14)).toHaveAttribute('data-box');
      act(() => { fonts.dispatchEvent(new Event('loadingdone')); });
      scrollTo(offsetOf(section(15)) - 300);
      expect(section(14)).toHaveAttribute('data-box');
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('draws the end of the book when the scroll reaches past every chapter', () => {
    openAt(2);
    expect(section(30)).toHaveAttribute('data-box');
    scrollTo(textHeight() + 100);
    rest();
    expect(section(30)).not.toHaveAttribute('data-box');
  });
});
