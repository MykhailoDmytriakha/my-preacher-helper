'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/providers/AuthProvider';
import { countVerseWords, markedElsewhere, signsHere, verseOrder, versesElsewhere, type MarkedElsewhere } from '@/utils/bibleMarks';

import { MarkLegend } from './MarkLegend';
import { useBookMarks } from './markStore';
import { useMarkTool } from './markTool';
import { MarkToolbar } from './MarkToolbar';
import { MARK_SWATCH, PENCIL_SWATCH } from './MarkToolIcons';
import { marksSupported, useMarkHighlights } from './useMarkHighlights';
import { useMarkStrokes } from './useMarkStrokes';

import type { RibbonSigns } from '../BookRibbon';
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
  /** The three tools for the reader's line on a wider screen, or nothing. */
  tools: ReactNode;
  /**
   * A phone: the tools always stand at the bottom right in a column over the "T", under the thumb, and
   * never in the line, which has no room for them (the owner, 2026-10-16, from his Android phone).
   */
  floatingTools: ReactNode;
  /** What the colours mean, for the "T" menu, or nothing. */
  legend: ReactNode;
  /** The translation's place in the line: after the tools on a wide screen. */
  translationClass: string;
  /** While a tool is in hand: the text keeps the page's swipe back off (`navigation/gestures`). */
  gestureIgnore: '' | undefined;
  /** A text the Apple Pencil writes on: a Pencil there never starts the page's swipe back. */
  penSurface: '' | undefined;
  /** While a tool is in hand: the text answers a pull along the line and still scrolls up and down. */
  textClass: string;
  /** Verses marked in the person's other Bibles: a sign beside each, for the ribbon (2.9.3). */
  signs: RibbonSigns | undefined;
  /** The window of the verse whose sign was tapped (`MarkedElsewhereSheet`). */
  elsewhere: { at: { chapter: number; verse: number } | null; entries: { bible: BibleId; verses: MarkedElsewhere[] }[]; close: () => void };
};

const subscribeNever = () => () => undefined;

export function useReaderMarks({ textRef, text, ready, bible, bookId }: {
  textRef: RefObject<HTMLElement | null>;
  text: BookText | null;
  /** The ribbon is on the page. */
  ready: boolean;
  bible: BibleId;
  bookId: string;
}): ReaderMarks {
  const { t } = useTranslation();
  const { user } = useAuth();
  const owner = user?.uid ?? null;
  // Whether the browser can paint marks does not change while the page is open.
  const canMark = useSyncExternalStore(subscribeNever, marksSupported, () => false);
  const tool = useMarkTool();
  const { marks: stored, save, ready: storeReady, others } = useBookMarks(owner, bible, bookId);
  const marking = canMark && Boolean(owner) && storeReady;
  const order = useMemo(() => (text ? verseOrder(text.chapters, countVerseWords) : null), [text]);
  const preview = useMarkHighlights(textRef, ready && marking, stored, text);
  useMarkStrokes({
    rootRef: textRef,
    ready,
    order,
    marks: stored,
    save,
    armed: tool.inHand !== null,
    begin: tool.beginStroke,
    preview,
    enabled: marking,
  });

  // MARKS MADE IN ANOTHER BIBLE: a sign at the same place here, its verse there whole on a tap. Signs
  // need no painting by the browser: the window draws its words itself.
  const elsewhere = useMemo(() => markedElsewhere(bible, bookId, others), [bible, bookId, others]);
  const [openAt, setOpenAt] = useState<{ chapter: number; verse: number } | null>(null);
  useEffect(() => setOpenAt(null), [bible, bookId]);
  const closeElsewhere = useCallback(() => setOpenAt(null), []);
  const signs = useMemo<RibbonSigns | undefined>(() => {
    const at = new Map([...signsHere(elsewhere)].map(([verse, strokes]) => [
      verse, strokes.map((stroke) => (stroke.tool === 'marker' ? MARK_SWATCH[stroke.color] : PENCIL_SWATCH[stroke.color])),
    ]));
    return at.size ? { at, label: (verse) => t('bible.marks.elsewhereSign', { verse }), onOpen: (chapter, verse) => setOpenAt({ chapter, verse }) } : undefined;
  }, [elsewhere, t]);
  const entries = useMemo(() => (openAt ? versesElsewhere(elsewhere, `${openAt.chapter}:${openAt.verse}`) : []), [elsewhere, openAt]);

  const showTools = marking && Boolean(text);
  const armed = marking && tool.inHand !== null;
  return {
    tools: showTools ? <MarkToolbar tool={tool} className="max-md:hidden md:ml-auto" /> : null,
    floatingTools: showTools ? (
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
    penSurface: marking ? '' : undefined,
    textClass: armed ? 'cursor-crosshair touch-pan-y [-webkit-touch-callout:none]' : '',
    signs,
    elsewhere: { at: entries.length ? openAt : null, entries, close: closeElsewhere },
  };
}
