'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import {
  MINIMAP_GEOMETRY,
  firstVisibleLine,
  fitPressedFrame,
  frameOnMap,
  MINIMAP_INSET,
  minimapMarkRects,
  minimapOffset,
  settleOffset,
  verseAtY,
  type MinimapFrame,
  type MinimapLayout,
  type MinimapMark,
} from './minimapLayout';
import { USAGE_KIND_LOOK } from './usageKinds';

import type { ReadingSurface } from './readingSurface';
import type { ScriptureUsageKind } from '@/utils/scriptureUsage';

type VersePlace = { chapter: number; verse: number };

type BibleMinimapProps = {
  layout: MinimapLayout;
  /** The article holding the verse rows (`data-verse="c:v"`). */
  textRef: RefObject<HTMLElement | null>;
  chapterLabel: (chapter: number) => string;
  placeLabel: (place: VersePlace) => string;
  /** The words on the mark that brings a map leafed away back to the verse being read. */
  readingLabel: (place: VersePlace) => string;
  title: string;
  /** A jump; `then` runs once it is made (a chapter of a big book not drawn yet is drawn first). */
  onJump: (place: VersePlace, then?: () => void) => void;
  /** What the text scrolls in: the page, or its own pane beside the minimap (`readingSurface.ts`). */
  surface: ReadingSurface;
  /** Where reading starts below the surface's top edge: "the verse I am at" is measured from here. */
  readingInset: number;
  /** The chapters drawn of a big book (`useChapterWindow`): its rows change as the place moves. */
  drawn?: unknown;
  /** The person's material: a mark of each kind's colour on the map's right edge, at its verse (`useBookUsage`). */
  marks?: readonly MinimapMark<ScriptureUsageKind>[];
  /** The verses the search shown in the Bible found (`search/foundInBible.ts`): a thin amber band across the map at each, all alike. */
  found?: readonly MinimapFound[];
};

/** The verse rows in the text: a big book draws some chapters only, and they change as the place moves. */
const versesIn = (root: HTMLElement | null): HTMLElement[] => Array.from(root?.querySelectorAll<HTMLElement>('[data-verse]') ?? []);

const MAP_WIDTH = 132;
const BOTTOM_MARGIN = 24;
/**
 * A strip of a row thinner than this under the reading top is no line a person reads: the browser
 * scrolls by whole pixels and lays text out at fractions of one, so a verse jumped to lands up to a
 * pixel low and leaves the one above that sliver — which counted as the place, a verse higher.
 */
const SLIVER_PX = 1;
/** Pointer travel that makes a press a drag of the map rather than a press on a verse. */
const CLICK_SLOP_PX = 4;
/** A page scroll this soon after the map was handled is momentum, not the person reading. */
const MAP_INPUT_GRACE_MS = 400;
/** The map brought back from far away: long enough to be followed by the eye. */
const RETURN_MS = 360;
/** A frame pressed at the bottom edge brought whole into the box: short, the answer to the press. */
const FIT_MS = 220;

const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
const easeInOut = (progress: number) => (progress < 0.5 ? 4 * progress ** 3 : 1 - (2 - 2 * progress) ** 3 / 2);
const samePlace = (a: VersePlace, b: VersePlace) => a.chapter === b.chapter && a.verse === b.verse;

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

type Press = { id: number; touch: boolean; startY: number; startTop: number; moved: boolean };
type Edge = { direction: 'up' | 'down'; place: VersePlace };
type Handlers = { draw: () => void; onPageScroll: () => void; measure: () => void; follow: () => void };

/** The strokes, the chapter labels and the frame that show in a box of the map scrolled to `offset`. */
function paintMap(
  context: CanvasRenderingContext2D,
  layout: MinimapLayout,
  chapterLabel: (chapter: number) => string,
  offset: number,
  boxHeight: number,
  frame: MinimapFrame | null,
  marks?: readonly MinimapMark<ScriptureUsageKind>[],
  found?: readonly MinimapFound[],
) {
  const dark = isDark();
  context.fillStyle = dark ? '#475569' : '#cbd5e1';
  // Only the strokes inside the box: a long book has thousands, and this runs on every scroll frame.
  for (let index = firstVisibleLine(layout, offset - MINIMAP_GEOMETRY.lineStep); index < layout.lines.length; index++) {
    const line = layout.lines[index];
    const y = line.y - offset;
    if (y > boxHeight) break;
    context.fillRect(MINIMAP_INSET, y, line.width, 2);
  }
  context.fillStyle = dark ? '#cbd5e1' : '#4b5563';
  context.font = '700 9px system-ui, -apple-system, sans-serif';
  context.textBaseline = 'top';
  for (const label of layout.labels) {
    const y = label.y - offset;
    if (y < -12 || y > boxHeight) continue;
    context.fillText(chapterLabel(label.chapter), MINIMAP_INSET, y);
  }
  if (frame) {
    const top = frame.top - offset;
    context.fillStyle = dark ? 'rgba(129, 140, 248, 0.18)' : 'rgba(99, 102, 241, 0.12)';
    context.strokeStyle = dark ? '#818cf8' : '#a5b4fc';
    context.lineWidth = 1;
    // The whole width: the person's marks at the right end stand inside it, and its edges keep the box's
    // padding on both sides. It left 12 px free once, for a scrollbar the map no longer shows.
    context.fillRect(0, top, MAP_WIDTH, frame.height);
    context.strokeRect(0.5, top + 0.5, MAP_WIDTH - 1, frame.height - 1);
  }
  if (found?.length) paintFound(context, layout, found, offset, boxHeight, dark);
  if (marks?.length) paintMarks(context, layout, marks, offset, boxHeight, dark);
}

/** A found verse on the map: where it stands in the book, at a glance. */
export type MinimapFound = { chapter: number; verse: number };

/** The found verses: a thin band across the map at each verse's first line, under the person's marks — all of one thickness and colour; the one stood at is shown in the text and the column, not here (the owner, 30.10). */
function paintFound(context: CanvasRenderingContext2D, layout: MinimapLayout, found: readonly MinimapFound[], offset: number, boxHeight: number, dark: boolean) {
  for (const one of found) {
    const top = layout.verseTop[one.chapter - 1]?.[one.verse - 1];
    if (top === undefined) continue;
    const height = 3;
    const y = top - offset - (height - 2) / 2;
    if (y + height < 0 || y > boxHeight) continue;
    context.fillStyle = dark ? 'rgba(251, 191, 36, 0.7)' : 'rgba(245, 158, 11, 0.75)';
    context.fillRect(MINIMAP_INSET, y, MAP_WIDTH - MINIMAP_INSET * 2, height);
  }
}

/** The person's marks over everything. */
function paintMarks(context: CanvasRenderingContext2D, layout: MinimapLayout, marks: readonly MinimapMark<ScriptureUsageKind>[], offset: number, boxHeight: number, dark: boolean) {
  const pill = (x: number, y: number, width: number, height: number) => {
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, height / 2);
    else context.rect(x, y, width, height);
    context.fill();
  };
  for (const rect of minimapMarkRects(layout, marks, MAP_WIDTH)) {
    const y = rect.y - offset;
    if (y + rect.height < 0 || y > boxHeight) continue;
    context.fillStyle = dark ? USAGE_KIND_LOOK[rect.kind].dot.dark : USAGE_KIND_LOOK[rect.kind].dot.light;
    pill(rect.x, y, rect.width, rect.height);
  }
}

/** The edge a frame has gone past in a map scrolled to `offset`, or null while some of it shows. */
function edgePassed(frame: MinimapFrame, offset: number, boxHeight: number): Edge['direction'] | null {
  const top = frame.top - offset;
  if (top + frame.height < 4) return 'up';
  return top > boxHeight - 4 ? 'down' : null;
}

/**
 * The book's minimap, like an editor's: the whole text as thin strokes, chapter labels, and a frame
 * around what is on screen. Drawn on a canvas: a long book has thousands of strokes, too many for
 * elements.
 *
 * TWO SCROLLS, EACH WHERE THE POINTER IS (owner, 2026-10-15): over the map the wheel, the trackpad,
 * a finger or a drag leaf through the map itself — a map pixel is about eight of the text, so it goes
 * chapter by chapter — and the text stays where it is. A press on the map moves the text there; the
 * map stays and the frame lands under the pointer. Hovering names the verse. While the text is read
 * the map follows it; one leafed away comes back as soon as the text moves, and a frame gone past the
 * edge leaves a mark at that edge that brings the map back.
 */
function BibleMinimapStrip({ layout, textRef, chapterLabel, placeLabel, readingLabel, title, onJump, surface, readingInset, drawn, marks, found }: BibleMinimapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowsRef = useRef<HTMLElement[]>([]);
  const drawFrameRef = useRef<number | null>(null);
  const glideRef = useRef<number | null>(null);
  // The map leafed or pressed away from following the text.
  const freeRef = useRef(false);
  // A scroll this code made itself is told from one the person made by the position it was asked for.
  const expectedMapTopRef = useRef<number | null>(null);
  const expectedPageYRef = useRef<number | null>(null);
  const lastMapInputRef = useRef(0);
  const pressRef = useRef<Press | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const previousRef = useRef<{ frame: MinimapFrame; attached: number; pageY: number } | null>(null);
  const edgeKeyRef = useRef('');
  const handlersRef = useRef<Handlers | null>(null);
  const [boxHeight, setBoxHeight] = useState(() => Math.min(layout.height, 600));
  // The place, not its words: the label is built at render, so a change of language reaches it.
  const [hover, setHover] = useState<{ y: number; place: VersePlace } | null>(null);
  const [edge, setEdge] = useState<Edge | null>(null);

  const reading = (): { place: VersePlace; frame: MinimapFrame } | null => {
    const range = visibleVerseRange(rowsRef.current, surface.edge() + readingInset, surface.bottom());
    return range ? { place: range[0], frame: frameOnMap(layout, range) } : null;
  };
  const followingTop = (frame: MinimapFrame) => minimapOffset(layout.height, boxHeight, frame);

  const setMapTop = (top: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.scrollTop = top;
    expectedMapTopRef.current = map.scrollTop;
  };

  const remember = () => {
    const now = reading();
    if (now) previousRef.current = { frame: now.frame, attached: followingTop(now.frame), pageY: surface.top() };
  };

  const stopGlide = () => {
    if (glideRef.current !== null) window.cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
  };

  const glide = (duration: number, targetOf: () => number, done: () => void) => {
    stopGlide();
    const map = mapRef.current;
    if (!map) return;
    const from = map.scrollTop;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setMapTop(from + (targetOf() - from) * easeInOut(progress));
      if (progress < 1) {
        glideRef.current = window.requestAnimationFrame(step);
      } else {
        glideRef.current = null;
        done();
      }
      handlersRef.current?.draw();
    };
    glideRef.current = window.requestAnimationFrame(step);
  };

  const returnToReading = () => {
    glide(
      RETURN_MS,
      () => {
        const now = reading();
        return now ? followingTop(now.frame) : (mapRef.current?.scrollTop ?? 0);
      },
      () => {
        freeRef.current = false;
        remember();
      },
    );
  };

  const showHover = () => {
    const y = pointerYRef.current;
    const map = mapRef.current;
    const place = y === null || !map ? null : verseAtY(layout, y + map.scrollTop);
    setHover((shown) => {
      if (!place || y === null) return shown === null ? shown : null;
      return shown && shown.y === y && samePlace(shown.place, place) ? shown : { y, place };
    });
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !map || !context) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== MAP_WIDTH * ratio || canvas.height !== boxHeight * ratio) {
      canvas.width = MAP_WIDTH * ratio;
      canvas.height = boxHeight * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, MAP_WIDTH, boxHeight);

    const offset = map.scrollTop;
    const now = reading();
    paintMap(context, layout, chapterLabel, offset, boxHeight, now ? now.frame : null, marks, found);

    // The frame gone past an edge of a map leafed away: a mark at that edge brings the map back.
    const direction = freeRef.current && glideRef.current === null && now ? edgePassed(now.frame, offset, boxHeight) : null;
    const next: Edge | null = direction && now ? { direction, place: now.place } : null;
    const key = next ? `${next.direction} ${next.place.chapter}:${next.place.verse}` : '';
    if (key !== edgeKeyRef.current) {
      edgeKeyRef.current = key;
      setEdge(next);
    }
    // The map moves under a still pointer: the label names the verse under it now.
    if (pointerYRef.current !== null) showHover();
  };

  const scheduleDraw = () => {
    if (drawFrameRef.current !== null) return;
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null;
      handlersRef.current?.draw();
    });
  };

  // The map follows the text unless it was leafed or pressed away; then a frame still in sight comes to
  // its place as the person reads, and one gone past the edge is brought back.
  const onPageScroll = () => {
    const pageY = surface.top();
    const expected = expectedPageYRef.current;
    expectedPageYRef.current = null;
    const ours = expected !== null && Math.abs(pageY - expected) < 2;
    const fromMap = performance.now() - lastMapInputRef.current < MAP_INPUT_GRACE_MS;
    const now = reading();
    const map = mapRef.current;
    if (now && map) {
      const attached = followingTop(now.frame);
      const previous = previousRef.current;
      if (!freeRef.current) {
        if (glideRef.current === null) setMapTop(attached);
      } else if (!ours && !fromMap && glideRef.current === null && previous) {
        const shownTop = previous.frame.top - map.scrollTop;
        if (shownTop + previous.frame.height > 0 && shownTop < boxHeight) {
          const textHeight = Math.max(1, textRef.current?.scrollHeight ?? 1);
          const step = settleOffset({
            mapTop: map.scrollTop,
            attachedBefore: previous.attached,
            attachedNow: attached,
            reading: (pageY - previous.pageY) * (layout.height / textHeight),
            frame: now.frame,
            boxHeight,
          });
          setMapTop(step.top);
          if (step.settled) freeRef.current = false;
        } else {
          returnToReading();
        }
      }
      previousRef.current = { frame: now.frame, attached, pageY };
    }
    scheduleDraw();
  };

  const measure = () => {
    pointerYRef.current = null;
    setHover(null);
    setBoxHeight(Math.max(120, Math.min(layout.height, surface.bottom() - surface.edge() - readingInset - BOTTOM_MARGIN)));
    scheduleDraw();
  };

  const follow = () => {
    const now = reading();
    if (now && !freeRef.current) setMapTop(followingTop(now.frame));
    remember();
    draw();
  };

  useLayoutEffect(() => {
    handlersRef.current = { draw, onPageScroll, measure, follow };
  });

  // The person's material changed (a note written on another device, the setting switched): paint the marks anew.
  useEffect(() => {
    handlersRef.current?.draw();
  }, [marks, found]);

  // A new book, surface or reading top: its rows, a map that follows the text, the box measured again.
  useEffect(() => {
    rowsRef.current = versesIn(textRef.current);
    freeRef.current = false;
    previousRef.current = null;
    handlersRef.current?.measure();
  }, [layout, readingInset, surface, textRef]);

  // Other chapters of a big book drawn: the rows the reading frame is read from, and the frame drawn from them.
  useEffect(() => {
    rowsRef.current = versesIn(textRef.current);
    handlersRef.current?.follow();
  }, [drawn, textRef]);

  useEffect(() => {
    handlersRef.current?.follow();
  }, [boxHeight, chapterLabel, layout, readingInset, surface]);

  // The text's scroll, wherever it happens; a pane that changes size (a line that wraps, a notice above) measures the box again.
  useEffect(() => {
    const onScroll = () => handlersRef.current?.onPageScroll();
    const onResize = () => handlersRef.current?.measure();
    surface.target.addEventListener('scroll', onScroll, { passive: true });
    const paneObserver = surface.target instanceof HTMLElement && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (surface.target instanceof HTMLElement) paneObserver?.observe(surface.target);
    return () => {
      surface.target.removeEventListener('scroll', onScroll);
      paneObserver?.disconnect();
    };
  }, [surface]);

  useEffect(() => {
    const onResize = () => handlersRef.current?.measure();
    const redraw = () => handlersRef.current?.draw();
    window.addEventListener('resize', onResize);
    const themeObserver = new MutationObserver(redraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('resize', onResize);
      themeObserver.disconnect();
      if (drawFrameRef.current !== null) window.cancelAnimationFrame(drawFrameRef.current);
      if (glideRef.current !== null) window.cancelAnimationFrame(glideRef.current);
      drawFrameRef.current = null;
      glideRef.current = null;
    };
  }, []);

  const onMapScroll = () => {
    const map = mapRef.current;
    if (!map) return;
    const expected = expectedMapTopRef.current;
    if (expected === null || Math.abs(map.scrollTop - expected) >= 1.5) {
      expectedMapTopRef.current = null;
      freeRef.current = true;
      lastMapInputRef.current = performance.now();
      stopGlide();
    }
    scheduleDraw();
  };

  const pointY = (event: ReactPointerEvent<HTMLDivElement>) => event.clientY - event.currentTarget.getBoundingClientRect().top;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    pressRef.current = { id: event.pointerId, touch, startY: event.clientY, startTop: event.currentTarget.scrollTop, moved: false };
    // A finger leafs the map with the browser's own scroll; a mouse drags it here.
    if (!touch) event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      pointerYRef.current = pointY(event);
      showHover();
    }
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId || press.touch) return;
    const dy = event.clientY - press.startY;
    if (!press.moved && Math.abs(dy) > CLICK_SLOP_PX) {
      press.moved = true;
      event.currentTarget.style.cursor = 'grabbing';
    }
    if (press.moved) {
      lastMapInputRef.current = performance.now();
      event.currentTarget.scrollTop = press.startTop - dy;
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    const map = event.currentTarget;
    map.style.cursor = '';
    if (!press || press.id !== event.pointerId) return;
    // A drag, or a finger that leafed the map, is no press on a verse.
    if (press.moved || Math.abs(map.scrollTop - press.startTop) > 2) return;
    const place = verseAtY(layout, pointY(event) + map.scrollTop);
    if (!place) return;
    stopGlide();
    freeRef.current = true;
    onJump(place, () => {
      // The chapters drawn may be others now: the rows the frame is read from, read again first.
      rowsRef.current = versesIn(textRef.current);
      expectedPageYRef.current = surface.top();
      remember();
      const now = reading();
      const fit = now ? fitPressedFrame(now.frame, map.scrollTop, boxHeight) : null;
      if (fit !== null) glide(FIT_MS, () => fit, remember);
      scheduleDraw();
    });
  };

  const stopPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    pressRef.current = null;
    event.currentTarget.style.cursor = '';
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    pointerYRef.current = null;
    setHover(null);
  };

  return (
    <div className="relative" style={{ width: MAP_WIDTH }} title={title} aria-hidden="true" data-testid="bible-minimap">
      <div
        ref={mapRef}
        data-testid="bible-minimap-scroller"
        style={{ height: boxHeight, touchAction: 'pan-y' }}
        className="cursor-pointer select-none overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={onMapScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={stopPress}
        onPointerLeave={handlePointerLeave}
      >
        <div style={{ height: Math.max(layout.height, boxHeight) }}>
          <canvas ref={canvasRef} style={{ width: MAP_WIDTH, height: boxHeight }} className="sticky top-0 block" />
        </div>
      </div>
      {hover ? (
        <div
          className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-700 shadow-md dark:border-indigo-500/40 dark:bg-gray-900 dark:text-indigo-300"
          style={{ top: Math.max(0, hover.y - 10) }}
        >
          {placeLabel(hover.place)}
        </div>
      ) : null}
      {edge ? (
        // The minimap is a pointer's shortcut (the chapter control serves the keyboard): out of the tab order.
        <button
          type="button"
          tabIndex={-1}
          data-testid="bible-minimap-back"
          onClick={returnToReading}
          className={`absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 ${
            edge.direction === 'up' ? 'top-2' : 'bottom-2'
          }`}
        >
          {edge.direction === 'up' ? '↑' : '↓'} {readingLabel(edge.place)}
        </button>
      ) : null}
    </div>
  );
}

/** Drawn again only when the book or the reading top changes: the reader's line re-renders on every verse. */
export const BibleMinimap = memo(BibleMinimapStrip);
