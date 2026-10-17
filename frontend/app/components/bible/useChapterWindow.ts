'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import { useTextScaleValue } from '@/providers/TextScaleProvider';

import { chapterWeight, FIRST_GUESS_PX, inSpan, nextSpan, pixelsPerWeight, sameSpan, spanAround, type ChapterSpan } from './chapterWindow';

import type { ReadingSurface } from './readingSurface';
import type { BookText } from '@/utils/bibleText';

/** The scroll counts as resting this long after its last move: then the chapters above come in. */
const REST_MS = 160;

/** A chapter of the ribbon, drawn or a box (`BookRibbon`). */
const CHAPTER = 'section[data-chapter]';

/** What the ribbon draws: the chapters of `span` in full, every other one as a box `height(chapter)` tall. */
export type ChapterBoxes = { span: ChapterSpan; height: (chapter: number) => number };

/**
 * The chapter under the reading line, and whether it stands there as a box: the rows of a box are not in
 * the page, and the verse they would show cannot be read from them. A line below every chapter (the room
 * under the book, scrolled to its very end) is in the last one; a page not laid out yet has none.
 */
export function chapterAtLine(article: HTMLElement, line: number): { section: HTMLElement; chapter: number; box: boolean } | null {
  const sections = article.querySelectorAll<HTMLElement>(CHAPTER);
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sections[middle].getBoundingClientRect().bottom > line) high = middle;
    else low = middle + 1;
  }
  const section = sections[Math.min(low, sections.length - 1)];
  if (!section || section.getBoundingClientRect().height === 0) return null;
  return { section, chapter: Number(section.dataset.chapter), box: section.hasAttribute('data-box') };
}

/**
 * What must stay still while chapters change: the first verse drawn on the screen at or below the reading
 * line — the text the person sees. A box under the line is blank, and what it will hold may land anywhere
 * in it; the verses drawn below it on the screen may not move. With no verse drawn on the screen, the box.
 */
function anchorAt(article: HTMLElement, line: number, bottom: number): HTMLElement | null {
  const at = chapterAtLine(article, line);
  if (!at) return null;
  for (let section: Element | null = at.section; section instanceof HTMLElement && section.matches(CHAPTER); section = section.nextElementSibling) {
    if (section.getBoundingClientRect().top >= bottom) break;
    if (section.hasAttribute('data-box')) continue;
    for (const row of section.querySelectorAll<HTMLElement>('[data-verse]')) {
      if (row.getBoundingClientRect().bottom > line) return row;
    }
  }
  return at.section;
}

/** The chapter an anchor stands in. */
const chapterOf = (element: HTMLElement): number => Number(element.closest<HTMLElement>(CHAPTER)?.dataset.chapter);

type Options = {
  text: BookText | null;
  textRef: RefObject<HTMLElement | null>;
  surfaceRef: { current: ReadingSurface };
  /** Where the reading top is on the screen. */
  readingLine: () => number;
  /** The text took a new width or size: the screen brings the person back to the verse read. */
  onReflow?: () => void;
  /**
   * Other chapters were drawn, or a jump landed: another verse may stand at the reading line now.
   * `moved` is how far the window itself moved the page to keep the line (0 when it moved nothing).
   */
  onDrawn?: (moved: number) => void;
};

/**
 * THE CHAPTERS IN THE PAGE (`chapterWindow.ts`): which are drawn, how tall the boxes of the others stand,
 * and the text the person sees kept still while they change.
 *
 * - `show(place, then)` — a jump: the chapter is drawn first, then `then` runs once it is in the page.
 * - `follow()` — the scroll: the chapters follow the one at the reading line, as it stands when the frame
 *   is drawn (a place noted before a jump is not followed after it). A chapter taken away leaves a box of
 *   its own height, so nothing moves; a box drawn above the text seen moves it by the guess's error, and
 *   the scroll is moved back by it in the same task, before the frame is shown — a guessed box above
 *   waits until the scroll rests (`nextSpan`). Only the window's own changes are kept still this way:
 *   holding the text through every change of height on the page (an emulated scroll anchoring) broke in
 *   eight ways under Codex's second attack (2026-10-16), and the one change that mattered — the verse a
 *   jump came to, pushed down by the links' chips arriving — the reader keeps itself.
 * - A new width (the iPad turned) or text size: the boxes are guessed again from the chapters drawn and
 *   `onReflow` brings the person back to the verse read.
 * - `doubt()` — something else changed the chapters' heights (the links' chips, the signs of marks): the
 *   heights measured before are no longer trusted to draw a chapter above the text seen while scrolling.
 */
export function useChapterWindow({ text, textRef, surfaceRef, readingLine, onReflow, onDrawn }: Options) {
  const [state, setState] = useState<{ text: BookText | null; span: ChapterSpan | null }>({ text: null, span: null });
  if (state.text !== text) setState({ text, span: text ? spanAround(text.chapters, 1) : null });
  const span = state.text === text ? state.span : null;
  const [perWeight, setPerWeight] = useState(FIRST_GUESS_PX);
  const [reflowed, setReflowed] = useState(0);

  const textNow = useRef(text);
  textNow.current = text;
  const spanNow = useRef(span);
  spanNow.current = span;
  const lineNow = useRef(readingLine);
  lineNow.current = readingLine;
  const reflowNow = useRef(onReflow);
  reflowNow.current = onReflow;
  const drawnNow = useRef(onDrawn);
  drawnNow.current = onDrawn;

  /** Each chapter's height when it was taken away, at this width and size. */
  const measuredRef = useRef(new Map<number, number>());
  /** Heights measured before something else changed the chapters: kept for their boxes, not trusted. */
  const doubtedRef = useRef(new Set<number>());
  const calibrateRef = useRef(true);
  const pendingRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);
  const restRef = useRef<number | null>(null);

  const weights = useMemo(() => text?.chapters.map(chapterWeight) ?? [], [text]);

  // Another book: nothing of it measured yet.
  useLayoutEffect(() => {
    measuredRef.current = new Map();
    doubtedRef.current = new Set();
    calibrateRef.current = true;
  }, [text]);

  // After each change of the chapters drawn: the boxes guessed again when asked (a new book, width or
  // size) from the chapters drawn, then what waited for it — a jump, or the way back to the place.
  useLayoutEffect(() => {
    const article = textRef.current;
    if (!article || !text || !span) return;
    if (calibrateRef.current) {
      calibrateRef.current = false;
      const drawn = Array.from(article.querySelectorAll<HTMLElement>(`${CHAPTER}:not([data-box])`), (section) => ({
        height: section.getBoundingClientRect().height,
        weight: weights[Number(section.dataset.chapter) - 1] ?? 0,
      }));
      const next = pixelsPerWeight(drawn);
      if (next !== null && Math.abs(next - perWeight) > perWeight * 0.002) {
        setPerWeight(next);
        return;
      }
    }
    const run = pendingRef.current;
    pendingRef.current = null;
    run?.();
  }, [perWeight, reflowed, span, text, textRef, weights]);

  const show = useCallback((place: { chapter: number }, then: () => void) => {
    const book = textNow.current;
    const current = spanNow.current;
    if (!book) return;
    // Landed, the reader reads its place again: a jump that moved no pixel sends no scroll event.
    const land = () => {
      then();
      drawnNow.current?.(0);
    };
    if (!current || inSpan(current, place.chapter)) {
      land();
      return;
    }
    pendingRef.current = land;
    setState({ text: book, span: spanAround(book.chapters, place.chapter) });
  }, []);

  const apply = useCallback((scrolling: boolean) => {
    const book = textNow.current;
    const current = spanNow.current;
    const article = textRef.current;
    const at = article ? chapterAtLine(article, lineNow.current()) : null;
    if (!book || !current || !article || !at) return;
    const anchor = anchorAt(article, lineNow.current(), surfaceRef.current.bottom());
    const seen = anchor ? chapterOf(anchor) : at.chapter;
    const known = (chapter: number) => measuredRef.current.has(chapter) && !doubtedRef.current.has(chapter);
    const next = nextSpan(book.chapters, current, at.chapter, scrolling, known, seen);
    if (sameSpan(next, current)) return;
    const before = anchor?.getBoundingClientRect().top ?? null;
    // A chapter taken away leaves a box exactly its height.
    for (let chapter = current.first; chapter <= current.last; chapter += 1) {
      if (inSpan(next, chapter)) continue;
      const section = article.querySelector<HTMLElement>(`${CHAPTER}[data-chapter="${chapter}"]`);
      if (!section) continue;
      measuredRef.current.set(chapter, section.getBoundingClientRect().height);
      doubtedRef.current.delete(chapter);
    }
    flushSync(() => setState({ text: book, span: next }));
    // What the window itself moved the page by: the reader tells it from a move of the person's.
    let moved = 0;
    if (anchor?.isConnected && before !== null) {
      const surface = surfaceRef.current;
      const shift = anchor.getBoundingClientRect().top - before;
      if (Math.abs(shift) >= 0.5) {
        const was = surface.top();
        surface.scrollTo(was + shift);
        moved = surface.top() - was;
      }
    }
    drawnNow.current?.(moved);
  }, [surfaceRef, textRef]);

  const follow = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        apply(true);
      });
    }
    if (restRef.current !== null) window.clearTimeout(restRef.current);
    restRef.current = window.setTimeout(() => {
      restRef.current = null;
      apply(false);
    }, REST_MS);
  }, [apply]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (restRef.current !== null) window.clearTimeout(restRef.current);
    frameRef.current = null;
    restRef.current = null;
  }, []);

  // A new width or text size: the heights kept are of the old one. The boxes are guessed anew from the
  // chapters drawn, and the screen brings the person back. A jump waiting for its chapter goes on: it
  // lands where it is going.
  const reflow = useCallback((now: boolean) => {
    measuredRef.current = new Map();
    doubtedRef.current = new Set();
    calibrateRef.current = true;
    pendingRef.current ??= () => reflowNow.current?.();
    if (now) flushSync(() => setReflowed((count) => count + 1));
    else setReflowed((count) => count + 1);
  }, []);

  // A new width: the iPad turned, a window resized.
  useEffect(() => {
    const article = textRef.current;
    if (!article || !text || typeof ResizeObserver === 'undefined') return undefined;
    let width = article.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const now = article.getBoundingClientRect().width;
      if (Math.abs(now - width) < 1) return;
      width = now;
      reflow(true);
    });
    observer.observe(article);
    return () => observer.disconnect();
  }, [reflow, text, textRef]);

  const scale = useTextScaleValue();
  const seenScaleRef = useRef(scale);
  useEffect(() => {
    if (seenScaleRef.current === scale) return;
    seenScaleRef.current = scale;
    reflow(false);
  }, [reflow, scale]);

  const doubt = useCallback(() => {
    doubtedRef.current = new Set(measuredRef.current.keys());
  }, []);

  // A font that arrives late reflows every line: the heights measured before it are doubted too.
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts?.addEventListener) return undefined;
    fonts.addEventListener('loadingdone', doubt);
    return () => fonts.removeEventListener('loadingdone', doubt);
  }, [doubt]);

  /** A jump waits for its chapter to be drawn: the page is not yet where it is going. */
  const jumping = useCallback(() => pendingRef.current !== null, []);

  const boxes = useMemo<ChapterBoxes | null>(() => {
    if (!span) return null;
    // `reflowed`: a new width or size gives the boxes new heights.
    void reflowed;
    return { span, height: (chapter: number) => measuredRef.current.get(chapter) ?? perWeight * (weights[chapter - 1] ?? 0) };
  }, [perWeight, reflowed, span, weights]);

  return { boxes, show, follow, jumping, doubt };
}
