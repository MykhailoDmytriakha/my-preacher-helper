'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useAuth } from '@/providers/AuthProvider';
import { countVerseWords, firstChangedVerse, markedElsewhere, signsHere, verseOrder, versesElsewhere, type MarkedElsewhere } from '@/utils/bibleMarks';
import { usePageZoomed } from '@/utils/pageZoom';

import { MarkLegend } from './MarkLegend';
import { useBookMarks, type MarksChange } from './markStore';
import { useMarkTool } from './markTool';
import { MarkToolbar } from './MarkToolbar';
import { MARK_SWATCH, PENCIL_SWATCH } from './MarkToolIcons';
import { marksSupported, useMarkHighlights } from './useMarkHighlights';
import { useMarkStrokes } from './useMarkStrokes';

import type { AnalysisMarks } from '../analysis/useAnalysisMarks';
import type { RibbonSigns } from '../BookRibbon';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

/*
 * THE MARKS IN THE READER — one call for the reader (`BibleBookReader.tsx`): the tool in hand, this
 * book's marks on every device of the person, the stroke being drawn, all painted over the ribbon. The reader places
 * what it gets — the tools in its line, the legend in its "T" menu, the text's attributes — and knows
 * nothing of how marks work. Only a signed-in reader in a browser that can
 * paint them gets any of it.
 */
type ReaderMarks = {
  /** The three tools for the reader's line on a wider screen, or nothing. */
  tools: ReactNode;
  /** The same tool state for the phone's combined tools and text button. */
  phoneTool: ReturnType<typeof useMarkTool> | null;
  /** What the colours mean, for the "T" menu, or nothing. */
  legend: ReactNode;
  /** The translation's place in the line: after the tools on a wide screen. */
  translationClass: string;
  /** While a tool is in hand: the text keeps the page's swipe back off (`navigation/gestures`). */
  gestureIgnore: '' | undefined;
  /** A tool is in hand: a press on the text paints, and is nothing else's (a verse's menu waits). */
  toolInHand: boolean;
  /** A text the Apple Pencil writes on: a Pencil there never starts the page's swipe back. */
  penSurface: '' | undefined;
  /**
   * The text's manner wherever marks can be made, never switched with the tool: a pull along the line is
   * the page's to take (a stroke), up and down and a pinch stay the browser's. Switched with the tool it
   * restyled every word of the book on each tap: half a second in the iPad's Psalms (2026-10-16). Pinched
   * bigger with no tool in hand, the sideways pull is the browser's again, to pan to the clipped side.
   */
  textClass: string;
  /** Verses marked in the person's other Bibles: a sign beside each, for the ribbon (2.9.3). */
  signs: RibbonSigns | undefined;
  /** What the book's marks need from the person, if anything (a verse changed on two devices at once). */
  syncStatus: ReactNode;
  /** The window of the verse whose sign was tapped (`MarkedElsewhereSheet`). */
  elsewhere: { at: { chapter: number; verse: number } | null; entries: { bible: BibleId; verses: MarkedElsewhere[] }[]; close: () => void };
  /**
   * The book's marks lent to a passage's analysis over the reader (`analysis/useAnalysisMarks.tsx`): kept by this same
   * form, so the analysis never opens a second one for the book. Nothing while the person or the marks are not read.
   */
  analysisMarks: AnalysisMarks | null;
};

const subscribeNever = () => () => undefined;

export function useReaderMarks({ textRef, text, ready, bible, bookId, drawn, onMarked }: {
  textRef: RefObject<HTMLElement | null>;
  text: BookText | null;
  /** The ribbon is on the page. */
  ready: boolean;
  bible: BibleId;
  bookId: string;
  /** The chapters drawn of a big book (`useChapterWindow`): verses come into the page and leave it. */
  drawn?: unknown;
  /** A stroke that changed marks — made or wiped some: the first verse it changed (the reader puts it on the trail). */
  onMarked?: (chapter: number, verse: number) => void;
}): ReaderMarks {
  const { t } = useTranslation();
  const { user } = useAuth();
  const owner = user?.uid ?? null;
  // Whether the browser can paint marks does not change while the page is open.
  const canMark = useSyncExternalStore(subscribeNever, marksSupported, () => false);
  const tool = useMarkTool();
  const zoomed = usePageZoomed();
  const { marks: stored, save, ready: storeReady, writable, others, sync } = useBookMarks(owner, bible, bookId);
  // A stroke starts only when it can be kept: while the book's form cannot write (the device's storage
  // silent for seconds after an iPad wakes) the reader says to wait instead of showing a stroke it would lose.
  // A choice the person made in the form's status runs for a moment: no stroke until it has, or the
  // choice would sweep the stroke away with the draft it replaces.
  const [deciding, setDeciding] = useState(false);
  const writableRef = useRef(writable && !deciding);
  writableRef.current = writable && !deciding;
  // Why a stroke cannot start: a choice that waits for the person, or the device's storage.
  const decisionRef = useRef(false);
  decisionRef.current = deciding || ['conflict', 'refused', 'deleted', 'localFailure', 'blocked'].includes(sync?.status?.phase ?? '');
  const waitSaid = useRef(0);
  const beginStroke = tool.beginStroke;
  const sayWhy = useCallback(() => {
    if (Date.now() - waitSaid.current <= 4_000) return;
    waitSaid.current = Date.now();
    toast(t(decisionRef.current ? 'bible.marks.decideFirst' : 'bible.marks.wait'));
  }, [t]);
  const begin = useCallback((pen: boolean) => {
    if (writableRef.current) return beginStroke(pen);
    sayWhy();
    return null;
  }, [beginStroke, sayWhy]);
  const marking = canMark && Boolean(owner) && storeReady;
  const order = useMemo(() => (text ? verseOrder(text.chapters, countVerseWords) : null), [text]);
  const painter = useMarkHighlights(textRef, ready && marking, stored, text, drawn);
  // A stroke begun before a choice and let go while it runs is checked again when it would be kept;
  // one whose save fails is no longer shown.
  const markedRef = useRef(onMarked);
  markedRef.current = onMarked;
  const marksNow = useRef(stored);
  marksNow.current = stored;
  const keep = useCallback((change: MarksChange) => {
    if (writableRef.current) {
      const first = order ? firstChangedVerse(marksNow.current, change(marksNow.current), order) : null;
      save(change, () => painter.drop(change));
      const [chapter, verse] = first ? first.split(':').map(Number) : [];
      if (chapter && verse) markedRef.current?.(chapter, verse);
      return true;
    }
    sayWhy();
    return false;
  }, [order, painter, save, sayWhy]);
  // A stroke made in an analysis: kept by this form as a stroke in the text is, put on the trail the same way.
  const markFromAnalysis = useCallback((change: MarksChange, lost: () => void) => {
    if (!writableRef.current) { sayWhy(); return false; }
    const first = order ? firstChangedVerse(marksNow.current, change(marksNow.current), order) : null;
    save(change, lost);
    const [chapter, verse] = first ? first.split(':').map(Number) : [];
    if (chapter && verse) markedRef.current?.(chapter, verse);
    return true;
  }, [order, save, sayWhy]);
  const analysisMarks = useMemo<AnalysisMarks | null>(() => (owner && storeReady && order ? { marks: stored, order, mark: markFromAnalysis } : null),
    [markFromAnalysis, order, owner, storeReady, stored]);
  useMarkStrokes({
    rootRef: textRef,
    ready,
    order,
    save: keep,
    armed: tool.inHand !== null,
    begin,
    painter,
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
    phoneTool: showTools ? tool : null,
    // The "T" card puts its rule above what it is given: a rule of the legend's own drew a second one.
    legend: marking ? <MarkLegend /> : null,
    translationClass: showTools ? 'ml-auto md:ml-3' : 'ml-auto',
    gestureIgnore: armed ? '' : undefined,
    toolInHand: armed,
    penSurface: marking ? '' : undefined,
    textClass: canMark && owner ? `${armed || !zoomed ? '[touch-action:pan-y_pinch-zoom] ' : ''}[-webkit-touch-callout:none]` : '',
    signs,
    // Refused strokes say so themselves (a toast); the status shows only what waits for a choice.
    syncStatus: sync ? (
      <DataSyncStatus subject={sync.recoveryIdentity} status={sync.status} error={sync.state ? null : sync.error} className="mb-3"
        onRetry={() => sync.retry()}
        onKeepLocal={() => { setDeciding(true); return sync.keepLocal().finally(() => setDeciding(false)); }}
        onAcceptRemote={() => { setDeciding(true); return sync.acceptRemote().finally(() => setDeciding(false)); }} />
    ) : null,
    elsewhere: { at: entries.length ? openAt : null, entries, close: closeElsewhere },
    analysisMarks,
  };
}
