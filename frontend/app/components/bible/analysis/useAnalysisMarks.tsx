'use client';

import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react';

import { applyStroke, marksKey, marksOnWord, strokeErases, type BookMarks, type StrokeKind, type VerseOrder, type WordAt } from '@/utils/bibleMarks';

import { MARK_FILL_CLASS, PENCIL_LINE_CLASS } from '../marks/markPaint';
import { useMarkTool } from '../marks/markTool';
import { MarkToolbar } from '../marks/MarkToolbar';

import type { MarksChange } from '../marks/markStore';
import type { AnalysisWord } from '@/utils/passageAnalysis';

/**
 * The reader's marks of this book, lent to the analysis by the reader (`useReaderMarks`): the same form of the book
 * writes them — the engine keeps one form per book, and a second one opened here could push the reader's out.
 * `mark` keeps a stroke — false when it cannot be kept now, said to the person; `lost` runs if it is not kept after all.
 */
export type AnalysisMarks = { marks: BookMarks; order: VerseOrder; mark: (change: MarksChange, lost: () => void) => boolean };

type Stroke = { pointerId: number; start: WordAt; last: WordAt; kind: StrokeKind; erase: boolean };
const NO_MARKS: BookMarks = {};
/** How long a stroke let go is shown while its save is on its way, at most. */
const HOLD_MS = 3_000;

/**
 * THE READER'S MARKS IN AN ANALYSIS (case 2026-10-12-block-diagram, 3.42; the owner, 2026-10-30: «раскраска маркером и
 * карандашом — всё как обычно… отображается на структуре… переносится на стих»): the marker, the pencil and the eraser
 * of the reader, in the analysis's bar; a word pressed, or pulled along, is painted as in the reader, and the stroke is
 * the reader's own — the same rules (`utils/bibleMarks.ts`), the same form of the book — so a mark made here is in the
 * verse, and one made in the verse is here. The words are elements of their own, so they are painted by classes
 * (`markPaint.ts`), not by the browser's highlights. A stroke let go stays shown until its save arrives, as in the reader.
 */
export function useAnalysisMarks({ source, words }: { source: AnalysisMarks | null; words: readonly AnalysisWord[] }) {
  const tool = useMarkTool();
  const [stroke, setStroke] = useState<Stroke | null>(null);
  const [held, setHeld] = useState<MarksChange[]>([]);
  const stored = source?.marks ?? NO_MARKS;

  // A stroke let go is let go of, from the oldest, once the stored marks hold it — in order: strokes over the same words
  // must stay in theirs.
  useEffect(() => {
    let kept = 0;
    while (kept < held.length && marksKey(held[kept](stored)) === marksKey(stored)) kept += 1;
    if (kept) setHeld((list) => list.slice(kept));
  }, [held, stored]);
  useEffect(() => {
    if (!held.length) return undefined;
    const timer = setTimeout(() => setHeld([]), HOLD_MS);
    return () => clearTimeout(timer);
  }, [held]);

  const base = useMemo(() => held.reduce((marks, change) => change(marks), stored), [held, stored]);
  const order = source?.order ?? null;
  const shown = stroke && order ? applyStroke(base, order, stroke.start, stroke.last, stroke.kind, stroke.erase) : base;

  const painting = Boolean(source) && tool.inHand !== null;
  const placeOf = (index: number | null): WordAt | null => {
    const word = index === null ? undefined : words[index];
    return word ? { verse: `${word.chapter}:${word.verse}`, index: word.at } : null;
  };
  const wordUnder = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y)?.closest('[data-word]');
    return hit ? Number(hit.getAttribute('data-word')) : null;
  };

  // A stroke: pressed on a word, pulled along the words, let go — kept; a pull the page takes for a scroll cancels it.
  const strokeEvents = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!painting || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      const start = placeOf(wordUnder(event.clientX, event.clientY));
      const kind = start ? tool.beginStroke(false) : null;
      if (!start || !kind) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setStroke({ pointerId: event.pointerId, start, last: start, kind, erase: strokeErases(base, start, kind) });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!stroke || event.pointerId !== stroke.pointerId) return;
      const last = placeOf(wordUnder(event.clientX, event.clientY));
      if (last && (last.verse !== stroke.last.verse || last.index !== stroke.last.index)) setStroke({ ...stroke, last });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!stroke || event.pointerId !== stroke.pointerId || !source || !order) return;
      setStroke(null);
      const { start, last, kind, erase } = stroke;
      const change: MarksChange = (marks) => applyStroke(marks, order, start, last, kind, erase);
      // A stroke that changes nothing shown is not held: it would hide a mark arriving from another device.
      if (marksKey(change(base)) === marksKey(base)) return;
      if (source.mark(change, () => setHeld((list) => list.filter((item) => item !== change)))) setHeld((list) => [...list, change]);
    },
    onPointerCancel: () => setStroke(null),
  };

  /** The marker's colour and the pencil's line on a word of the passage. */
  const paintOf = (index: number): { fill: string; pencil: string } => {
    const word = words[index];
    const on = word ? marksOnWord(shown[`${word.chapter}:${word.verse}`], word.at) : { color: null, pencil: null };
    return { fill: on.color ? MARK_FILL_CLASS[on.color] : '', pencil: on.pencil ? PENCIL_LINE_CLASS[on.pencil] : '' };
  };

  const toolbar: ReactNode = source ? <MarkToolbar tool={tool} /> : null;
  return {
    toolbar, painting, paintOf, strokeEvents,
    /** A finger with a tool in hand paints along a line and still scrolls up and down, as in the reader. */
    paneClass: painting ? '[touch-action:pan-y_pinch-zoom]' : '',
  };
}
