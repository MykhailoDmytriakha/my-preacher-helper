'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import { MINIMAP_GEOMETRY, firstVisibleLine, minimapOffset, verseAtY, type MinimapLayout } from './minimapLayout';

type VersePlace = { chapter: number; verse: number };

type BibleMinimapProps = {
  layout: MinimapLayout;
  /** The article holding the verse rows (`data-verse="c:v"`). */
  textRef: RefObject<HTMLElement | null>;
  chapterLabel: (chapter: number) => string;
  placeLabel: (place: VersePlace) => string;
  title: string;
  onJump: (place: VersePlace) => void;
  /** Where the reading area starts, under every sticky bar: "the verse I am at" is measured from here. */
  readingTop: number;
};

const MAP_WIDTH = 132;
const BOTTOM_MARGIN = 24;
/**
 * A strip of a row thinner than this under the reading top is no line a person reads: the browser
 * scrolls by whole pixels and lays text out at fractions of one, so a verse jumped to lands up to a
 * pixel low and leaves the one above that sliver — which counted as the place, a verse higher.
 */
const SLIVER_PX = 1;

const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/** The first and the last verse row that show on screen below the sticky header (binary search over rows). */
export function visibleVerseRange(rows: HTMLElement[], topInset: number, viewportHeight: number): [VersePlace, VersePlace] | null {
  if (rows.length === 0) return null;
  // Rows run down the page, so "is below y" turns true once and stays true: the first true row is found by halving.
  const firstWhere = (test: (row: HTMLElement) => boolean) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (test(rows[middle])) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const place = (row: HTMLElement): VersePlace => {
    const [chapter, verse] = (row.dataset.verse ?? '1:1').split(':').map(Number);
    return { chapter, verse };
  };
  const first = Math.min(rows.length - 1, firstWhere((row) => row.getBoundingClientRect().bottom > topInset + SLIVER_PX));
  // A row with no size is not laid out (the page is not shown yet): there is no place to read, and
  // "the last verse" — what the search lands on then — must not be taken for one.
  const firstBox = rows[first].getBoundingClientRect();
  if (firstBox.width === 0 && firstBox.height === 0) return null;
  const last = Math.max(first, firstWhere((row) => row.getBoundingClientRect().top >= viewportHeight) - 1);
  return [place(rows[first]), place(rows[last])];
}

/**
 * The book's minimap, like an editor's: the whole text as thin strokes, chapter labels, and a frame
 * around what is on screen. Pressing or dragging on it moves the page there; hovering names the
 * verse. A map taller than the window scrolls with the page. Drawn on a canvas: a long book has
 * thousands of strokes, too many for elements.
 */
export function BibleMinimap({ layout, textRef, chapterLabel, placeLabel, title, onJump, readingTop }: BibleMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowsRef = useRef<HTMLElement[]>([]);
  const offsetRef = useRef(0);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const [boxHeight, setBoxHeight] = useState(() => Math.min(layout.height, 600));
  // The place, not its words: the label is built at render, so a change of language reaches it.
  const [hover, setHover] = useState<{ y: number; place: VersePlace } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const height = boxHeight;
    if (canvas.width !== MAP_WIDTH * ratio || canvas.height !== height * ratio) {
      canvas.width = MAP_WIDTH * ratio;
      canvas.height = height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, MAP_WIDTH, height);

    const viewportHeight = window.innerHeight;
    const scrollable = Math.max(1, document.documentElement.scrollHeight - viewportHeight);
    const offset = minimapOffset(layout.height, height, window.scrollY / scrollable);
    offsetRef.current = offset;
    const dark = isDark();

    context.fillStyle = dark ? '#475569' : '#cbd5e1';
    // Only the strokes inside the box: a long book has thousands, and this runs on every scroll frame.
    for (let index = firstVisibleLine(layout, offset - MINIMAP_GEOMETRY.lineStep); index < layout.lines.length; index++) {
      const line = layout.lines[index];
      const y = line.y - offset;
      if (y > height) break;
      context.fillRect(0, y, line.width, 2);
    }
    context.fillStyle = dark ? '#cbd5e1' : '#4b5563';
    context.font = '700 9px system-ui, -apple-system, sans-serif';
    context.textBaseline = 'top';
    for (const label of layout.labels) {
      const y = label.y - offset;
      if (y < -12 || y > height) continue;
      context.fillText(chapterLabel(label.chapter), 0, y);
    }

    const range = visibleVerseRange(rowsRef.current, readingTop, viewportHeight);
    if (range) {
      const [first, last] = range;
      const top = (layout.verseTop[first.chapter - 1]?.[first.verse - 1] ?? 0) - offset - 2;
      const bottom = (layout.verseTop[last.chapter - 1]?.[last.verse - 1] ?? 0) - offset + MINIMAP_GEOMETRY.lineStep * 2;
      context.fillStyle = dark ? 'rgba(129, 140, 248, 0.18)' : 'rgba(99, 102, 241, 0.12)';
      context.strokeStyle = dark ? '#818cf8' : '#a5b4fc';
      context.lineWidth = 1;
      context.fillRect(0, top, MAP_WIDTH - 12, Math.max(6, bottom - top));
      context.strokeRect(0.5, top + 0.5, MAP_WIDTH - 13, Math.max(6, bottom - top) - 1);
    }
  }, [boxHeight, chapterLabel, layout, readingTop]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    rowsRef.current = Array.from(textRef.current?.querySelectorAll<HTMLElement>('[data-verse]') ?? []);
    const measure = () => {
      setHover(null);
      setBoxHeight(Math.max(120, Math.min(layout.height, window.innerHeight - readingTop - BOTTOM_MARGIN)));
      scheduleDraw();
    };
    measure();
    // The map moves under a still pointer while the page scrolls: the hover label would name a verse that is no longer there.
    const onScroll = () => {
      setHover(null);
      scheduleDraw();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    const themeObserver = new MutationObserver(scheduleDraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      themeObserver.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [layout, readingTop, scheduleDraw, textRef]);

  useEffect(() => {
    draw();
  }, [draw]);

  const placeAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - box.top;
    return { y, place: verseAtY(layout, y + offsetRef.current) };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const { place } = placeAt(event);
    if (place) onJump(place);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const { y, place } = placeAt(event);
    if (!place) return;
    if (draggingRef.current) onJump(place);
    setHover({ y, place });
  };

  const stopDragging = () => {
    draggingRef.current = false;
  };

  return (
    <div className="relative" style={{ width: MAP_WIDTH }} title={title} aria-hidden="true" data-testid="bible-minimap">
      <canvas
        ref={canvasRef}
        style={{ width: MAP_WIDTH, height: boxHeight, touchAction: 'none' }}
        className="block cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={() => setHover(null)}
      />
      {hover ? (
        <div
          className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-700 shadow-md dark:border-indigo-500/40 dark:bg-gray-900 dark:text-indigo-300"
          style={{ top: Math.max(0, hover.y - 10) }}
        >
          {placeLabel(hover.place)}
        </div>
      ) : null}
    </div>
  );
}
