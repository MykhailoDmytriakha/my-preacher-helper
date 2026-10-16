'use client';

import { useMemo, useSyncExternalStore, type ReactNode, type RefObject } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { countVerseWords, verseOrder } from '@/utils/bibleMarks';

import { MarkLegend } from './MarkLegend';
import { useBookMarks } from './markStore';
import { useMarkTool } from './markTool';
import { MarkToolbar } from './MarkToolbar';
import { marksSupported, useMarkHighlights } from './useMarkHighlights';
import { useMarkStrokes } from './useMarkStrokes';

import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

/*
 * THE MARKS IN THE READER — one call for the reader (`BibleBookReader.tsx`): the tool in hand, this
 * book's marks on every device of the person, the stroke being drawn, all painted over the ribbon. The reader places
 * what it gets — the tools in its line, the legend in its "T" menu, the text's attributes while a tool
 * is in hand — and knows nothing of how marks work. Only a signed-in reader in a browser that can
 * paint them gets any of it.
 */
type ReaderMarks = {
  /** The three tools for the reader's line, or nothing. */
  tools: ReactNode;
  /**
   * A phone, reading: the line has scrolled away (the pill at the bottom holds the book), so the tools
   * stand at the bottom right in a column over the "T", under the thumb (the owner, 2026-10-16).
   */
  floatingTools: ReactNode;
  /** What the colours mean, for the "T" menu, or nothing. */
  legend: ReactNode;
  /** The translation's place in the line: after the tools on a wide screen. */
  translationClass: string;
  /** While a tool is in hand: the text keeps the page's swipe back off (`navigation/gestures`). */
  gestureIgnore: '' | undefined;
  /** While a tool is in hand: the text answers a pull along the line and still scrolls up and down. */
  textClass: string;
};

const subscribeNever = () => () => undefined;

export function useReaderMarks({ textRef, text, ready, lineGone, bible, bookId }: {
  textRef: RefObject<HTMLElement | null>;
  text: BookText | null;
  /** The ribbon is on the page. */
  ready: boolean;
  /** A phone, and the reader's line has scrolled away. */
  lineGone: boolean;
  bible: BibleId;
  bookId: string;
}): ReaderMarks {
  const { user } = useAuth();
  const owner = user?.uid ?? null;
  // Whether the browser can paint marks does not change while the page is open.
  const canMark = useSyncExternalStore(subscribeNever, marksSupported, () => false);
  const tool = useMarkTool();
  const { marks: stored, save, ready: storeReady } = useBookMarks(owner, bible, bookId);
  const marking = canMark && Boolean(owner) && storeReady;
  const order = useMemo(() => (text ? verseOrder(text.chapters, countVerseWords) : null), [text]);
  const shown = useMarkStrokes({
    rootRef: textRef,
    ready,
    order,
    marks: stored,
    save,
    armed: tool.inHand !== null,
    begin: tool.beginStroke,
    enabled: marking,
  });
  useMarkHighlights(textRef, ready && marking, shown, text);

  const showTools = marking && Boolean(text);
  const armed = marking && tool.inHand !== null;
  return {
    // On a phone the line has no room for the tools: they take a line of their own under it, at its right edge.
    tools: showTools ? <MarkToolbar tool={tool} className="order-last w-full justify-end pt-1 md:order-none md:ml-auto md:w-auto md:pt-0" /> : null,
    floatingTools: showTools && lineGone ? (
      <div className="fixed bottom-[calc(10rem+env(safe-area-inset-bottom))] right-[1.125rem] z-30 rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-gray-900/10 backdrop-blur-md md:hidden dark:bg-gray-900/95 dark:ring-white/10">
        <MarkToolbar tool={tool} vertical />
      </div>
    ) : null,
    legend: marking ? (
      <div className="mt-1 border-t border-gray-200 pt-1 dark:border-gray-700">
        <MarkLegend />
      </div>
    ) : null,
    translationClass: showTools ? 'ml-auto md:ml-3' : 'ml-auto',
    gestureIgnore: armed ? '' : undefined,
    textClass: armed ? 'cursor-crosshair touch-pan-y [-webkit-touch-callout:none]' : '',
  };
}
