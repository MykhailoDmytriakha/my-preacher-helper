'use client';

import { ArrowDownIcon, ArrowUpIcon, BookOpenIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useModalLayer } from '@/hooks/useModalLayer';
import { resolveAppLocale } from '@/utils/appLocale';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, type BookText } from '@/utils/bibleText';
import { formatScriptureReference } from '@/utils/scriptureReference';

import { visibleVerseRange } from './BibleMinimap';
import { ARRIVAL_ATTRIBUTE, BookRibbon } from './BookRibbon';
import { inSpan } from './chapterWindow';
import { CrossReferenceSheet } from './CrossReferenceSheet';
import { readingSurface } from './readingSurface';
import { readTranslation } from './translation';
import { useBookCrossRefs } from './useBookCrossRefs';
import { chapterAtLine, useChapterWindow } from './useChapterWindow';
import { passageAway, passageKeys, restingScrollTop, type PassageBox, type SheetReference } from './verseSheetGeometry';

import type { CrossReference } from '@/utils/crossReferences';

export type { SheetReference } from './verseSheetGeometry';

/** Below this the window between the bars is too short to read in: it takes the screen under the top bar instead. */
const MIN_WINDOW_HEIGHT = 320;

type VerseSheetProps = {
  /** The passage to show; null keeps the window closed. */
  reference: SheetReference | null;
  onClose: () => void;
  /**
   * What must stay in sight while the window is open — a meeting's timer bar above, its block timer
   * and buttons below. The window lies between them and never covers them.
   */
  keepVisible?: { top?: RefObject<HTMLElement | null>; bottom?: RefObject<HTMLElement | null> };
  /**
   * Optional personal material alongside the reader; both views retain their reading positions.
   * `count`, once known, sits on the tab as a badge, so the reader sees there is something without opening it.
   */
  related?: { label: string; count?: number; render: (returnToText: () => void) => ReactNode };
  /**
   * THE WINDOW'S ONE WAY OUT — the Bible page at a passage, its way back the screen under the window,
   * through the screen's own rule (saving first, or not at all while unsaved words would be lost): the
   * passage itself ("Open in the Bible") and a cross-reference read in it ("Open"). None — over a
   * meeting, a sermon being preached, a plan point being edited — and the window never leaves: a
   * cross-reference is read in place.
   */
  openInBible?: (reference: SheetReference) => void;
};

/**
 * THE VERSE WINDOW — the text of a passage over whatever screen is open, so reading it leaves that
 * screen as it was: a meeting's block and timers, a sermon being preached. The whole book scrolls,
 * the passage stays lit (a whole chapter all of it), it opens in the middle of the window, and "back
 * to the verse" brings it back from wherever it was scrolled. A screen gives a reference and a way
 * to close; the Bible read, its text (kept on the device) and the numbering (`utils/versification`)
 * are this module's — the same ones the Bible page reads with.
 */
export function VerseSheet({ reference, onClose, keepVisible, related, openInBible }: VerseSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!reference || !mounted) return null;
  const key = `${reference.bible}|${reference.book}|${reference.chapter ?? ''}:${reference.fromVerse ?? ''}-${reference.toChapter ?? ''}:${reference.toVerse ?? ''}`;
  // Over everything the page draws, a meeting's own full-screen layer included.
  return createPortal(<Sheet key={key} reference={reference} onClose={onClose} keepVisible={keepVisible} related={related} openInBible={openInBible} />, document.body);
}

type LoadState = { status: 'loading' } | { status: 'ready'; text: BookText } | { status: 'error' };

/** "Open" on a cross-reference read in the window: the screen's way out, at that passage in the Bible read; none without one. */
const crossReferenceExit = (openInBible: VerseSheetProps['openInBible'], bible: BibleId) =>
  openInBible
    ? (target: CrossReference) => openInBible({ bible, book: target.book, chapter: target.chapter, fromVerse: target.fromVerse, toVerse: target.toVerse })
    : undefined;

/** The passage on the Bible page, where the screen gives a way out; on a phone the short word leaves the reference its room. */
function OpenInBibleButton({ reference, openInBible }: { reference: SheetReference; openInBible: VerseSheetProps['openInBible'] }) {
  const { t } = useTranslation();
  if (!openInBible) return null;
  return (
    <button
      type="button"
      onClick={() => openInBible(reference)}
      aria-label={t('bible.sheet.openInBible')}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
    >
      <BookOpenIcon className="h-5 w-5" aria-hidden="true" />
      <span className="sm:hidden">{t('bible.sheet.toBible')}</span>
      <span className="hidden sm:inline">{t('bible.sheet.openInBible')}</span>
    </button>
  );
}

function Sheet({ reference, onClose, keepVisible, related, openInBible }: { reference: SheetReference; onClose: () => void; keepVisible: VerseSheetProps['keepVisible']; related: VerseSheetProps['related']; openInBible: VerseSheetProps['openInBible'] }) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n?.language);
  // The Bible this device reads, as on the Bible page.
  const reading: BibleId = useMemo(() => readTranslation(locale), [locale]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  const [away, setAway] = useState<'up' | 'down' | null>(null);
  const [showRelated, setShowRelated] = useState(false);
  const relatedOpen = Boolean(related && showRelated);
  const viewId = useId();
  const textTabRef = useRef<HTMLButtonElement | null>(null);
  const relatedTabRef = useRef<HTMLButtonElement | null>(null);
  const returnToText = () => {
    setShowRelated(false);
    textTabRef.current?.focus({ preventScroll: true });
  };
  const paneRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  // What the text scrolls in: the window's own pane.
  const surfaceRef = useRef(readingSurface(null));
  useLayoutEffect(() => {
    if (paneRef.current) surfaceRef.current = readingSurface(paneRef.current);
  }, []);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // A window like every other: the page under it holds still, Escape closes the topmost window only.
  const layer = useModalLayer({ onClose, focusRing: dialogRef });
  // Cross references here only when the person asked for them in passage windows too; "Open" leaves
  // by the screen's own way out (`openInBible`), and without one a link is read in place.
  const crossRefs = useBookCrossRefs(reference.book, reading, state.status === 'ready' ? state.text : null, 'window');
  const restedAtRef = useRef<number | null>(null);

  const keys = useMemo(() => passageKeys(reference, reading), [reference, reading]);
  // A book named whole ("Руфь" on a note's chip) opens at its start, with nothing lit and nothing to come back to.
  const wholeBook = !reference.chapter;
  const wholeChapter = !reference.fromVerse;
  const label = reference.label ?? formatScriptureReference(reference, { locale, style: 'short' });
  const firstKey = keys[0];
  const isPsalms = reference.book === 'Psalms';
  const chapterWord = useCallback((chapter: number) => t(isPsalms ? 'bible.psalm' : 'bible.chapter', { number: chapter }), [isPsalms, t]);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetchBookText(reference.book, reading).then(
      (text) => { if (alive) setState({ status: 'ready', text }); },
      () => { if (alive) setState({ status: 'error' }); },
    );
    return () => { alive = false; };
  }, [reference.book, reading, attempt]);

  // The window lies between what must stay in sight, measured again whenever those bars change size
  // (a turned phone, a timer that grows a line). With too little room left — a phone on its side
  // during a meeting — reading wins: the window takes the screen under the top bar.
  const topRef = keepVisible?.top;
  const bottomRef = keepVisible?.bottom;
  useLayoutEffect(() => {
    const measure = () => {
      const top = Math.max(0, topRef?.current?.getBoundingClientRect().bottom ?? 0);
      const bottomTop = bottomRef?.current?.getBoundingClientRect().top;
      const bottom = bottomTop === undefined ? 0 : Math.max(0, window.innerHeight - bottomTop);
      const next = { top, bottom: window.innerHeight - top - bottom < MIN_WINDOW_HEIGHT ? 0 : bottom };
      setInsets((now) => (now.top === next.top && now.bottom === next.bottom ? now : next));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const bar of [topRef?.current, bottomRef?.current]) if (bar) observer?.observe(bar);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [topRef, bottomRef]);

  // Focus goes into the window when it opens and back where it was when it closes — once, not on
  // every render of the screen under it (a meeting's timer renders it every second).
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  const passageBox = useCallback((): PassageBox | null => {
    const pane = paneRef.current;
    if (!pane || keys.length === 0) return null;
    const rows = keys
      .map((key) => pane.querySelector<HTMLElement>(`[data-verse="${key}"]`))
      .filter((row): row is HTMLElement => Boolean(row));
    if (rows.length === 0) return null;
    // A chapter named whole starts at its heading.
    const head = wholeChapter ? rows[0].closest<HTMLElement>('[data-chapter]') : null;
    const top = Math.min(...rows.map((row) => row.offsetTop), head ? head.offsetTop : Infinity);
    const bottom = Math.max(...rows.map((row) => row.offsetTop + row.offsetHeight));
    return { top, bottom };
  }, [keys, wholeChapter]);

  const rest = useCallback((smooth: boolean) => {
    const pane = paneRef.current;
    const box = passageBox();
    if (!pane) return;
    // Measured at the moment, never remembered: a font that came late or a turned phone moves every line.
    const top = box ? restingScrollTop(box, pane.clientHeight, pane.scrollHeight) : 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (smooth && !reduced && typeof pane.scrollTo === 'function') pane.scrollTo({ top, behavior: 'smooth' });
    else pane.scrollTop = top;
    restedAtRef.current = top;
  }, [passageBox]);

  // A BIG BOOK IS DRAWN AROUND THE PASSAGE (`useChapterWindow`, as in the reader): the chapters near the
  // place read are in the window, the others stand as boxes of their height. A new width or text size
  // brings the passage back to the middle if the person never scrolled away from it, else the verse they
  // were reading back to the top.
  const text = state.status === 'ready' ? state.text : null;
  const passageChapter = Number(firstKey?.split(':')[0] ?? reference.chapter ?? 1);
  const readingLine = () => surfaceRef.current.edge() + 8;
  /** The verse at the top of the window, noted as the person scrolls. */
  const readRef = useRef<string | null>(null);
  const noteAwayRef = useRef<() => void>(() => undefined);
  const noteReadRef = useRef<() => void>(() => undefined);
  const chapterWindow = useChapterWindow({
    text,
    textRef: articleRef,
    surfaceRef,
    readingLine,
    onReflow: () => {
      const pane = paneRef.current;
      if (!pane) return;
      if (pane.scrollTop === restedAtRef.current) {
        rest(false);
        return;
      }
      const row = readRef.current ? pane.querySelector<HTMLElement>(`[data-verse="${readRef.current}"]`) : null;
      if (row) pane.scrollTop += row.getBoundingClientRect().top - readingLine();
    },
    // Other chapters drawn with no scroll can put another verse at the top, and bring the passage into the
    // window: both are read again. A landing on the passage (`rest`) has settled the arrow already.
    onDrawn: () => {
      noteReadRef.current();
      if (paneRef.current && paneRef.current.scrollTop !== restedAtRef.current) noteAwayRef.current();
    },
  });
  const showChapter = chapterWindow.show;
  const drawnSpan = chapterWindow.boxes?.span;
  // The links' chips shape a chapter's height: those measured before are doubted.
  const doubtHeights = chapterWindow.doubt;
  useEffect(() => {
    doubtHeights();
  }, [crossRefs.ribbon, doubtHeights]);

  // The passage lit for as long as the window is open — its verses lit again whenever they come back
  // into the page — and brought to the middle once the text is in.
  const lightPassage = useCallback(() => {
    for (const key of keys) paneRef.current?.querySelector(`[data-verse="${key}"]`)?.setAttribute(ARRIVAL_ATTRIBUTE, 'on');
  }, [keys]);
  useLayoutEffect(() => {
    lightPassage();
  }, [drawnSpan, lightPassage]);
  useLayoutEffect(() => {
    if (state.status !== 'ready' || !paneRef.current) return undefined;
    showChapter({ chapter: passageChapter }, () => {
      lightPassage();
      rest(false);
      setAway(null);
    });
    // The serif can arrive after the first layout and move every line: rest again, unless the person has scrolled.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive && paneRef.current && paneRef.current.scrollTop === restedAtRef.current) rest(false);
    });
    return () => { alive = false; };
  }, [state, keys, rest, lightPassage, passageChapter, showChapter]);

  // Where the passage is from what shows: above, below, or in sight.
  const noteAway = () => {
    const pane = paneRef.current;
    const box = passageBox();
    if (!pane || wholeBook) return;
    // The passage's chapter not drawn (scrolled far from it): it is above or below by its number.
    if (!box) {
      const at = articleRef.current ? chapterAtLine(articleRef.current, readingLine()) : null;
      if (at && at.chapter !== passageChapter) setAway(at.chapter > passageChapter ? 'up' : 'down');
      return;
    }
    setAway(passageAway(box, pane.scrollTop, pane.clientHeight));
  };
  noteAwayRef.current = noteAway;

  // The verse at the top of the window.
  const noteRead = () => {
    const rows = Array.from(articleRef.current?.querySelectorAll<HTMLElement>('[data-verse]') ?? []);
    const read = visibleVerseRange(rows, readingLine(), surfaceRef.current.bottom())?.[0];
    readRef.current = read ? `${read.chapter}:${read.verse}` : null;
  };
  noteReadRef.current = noteRead;

  const onScroll = () => {
    chapterWindow.follow();
    noteRead();
    noteAway();
  };

  const notFound = state.status === 'ready' && !firstKey && !wholeBook;

  return (
    // Above a meeting or the preaching view (z-[200]), under a question asked over it (z-[300]).
    <div {...layer} className="fixed inset-x-0 z-[250]" style={{ top: insets.top, bottom: insets.bottom }}>
      <button type="button" tabIndex={-1} aria-label={t('bible.sheet.close')} onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-gray-950/50" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="absolute inset-x-0 bottom-0 top-6 flex flex-col overflow-hidden rounded-t-3xl border border-b-0 border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:top-4 sm:w-[min(48rem,calc(100%-3rem))] sm:-translate-x-1/2 sm:rounded-2xl sm:border-b"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 sm:hidden" />
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 py-3 pl-5 pr-3 dark:border-gray-700 sm:pl-6">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-gray-900 dark:text-gray-50">{label}</h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{t(`bible.translations.${reading}.name`)}</p>
          </div>
          <OpenInBibleButton reference={reference} openInBible={openInBible} />
          <button
            ref={closeRef}
            type="button"
            aria-label={t('bible.sheet.close')}
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {related && <div role="tablist" aria-label={t('bible.sheet.views')} className="flex shrink-0 gap-1 border-b border-gray-200 px-4 dark:border-gray-700 sm:px-6">
          {[{ active: !relatedOpen, ref: textTabRef, id: 'text', label: t('bible.sheet.text'), count: undefined }, { active: relatedOpen, ref: relatedTabRef, id: 'related', label: related.label, count: related.count }].map((tab, index) => <button
            key={tab.id}
            ref={tab.ref}
            type="button"
            role="tab"
            id={`${viewId}-${tab.id}-tab`}
            aria-controls={`${viewId}-${tab.id}`}
            aria-selected={tab.active}
            tabIndex={tab.active ? 0 : -1}
            onClick={() => setShowRelated(index === 1)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const next = event.key === 'Home' ? false : event.key === 'End' ? true : !relatedOpen;
              setShowRelated(next);
              (next ? relatedTabRef : textTabRef).current?.focus({ preventScroll: true });
            }}
            className={`inline-flex min-h-12 items-center border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${tab.active ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}`}
          >{tab.label}{tab.count !== undefined && <>{' '}<span data-testid="related-count" className={`ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs leading-none tabular-nums ${tab.count ? 'bg-indigo-600 text-white dark:bg-indigo-400 dark:text-gray-900' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>{tab.count}</span></>}</button>)}
        </div>}
        {/* Both panes keep their geometry: hiding the book with display:none would lose its reading anchor. */}
        <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]">
        <div ref={paneRef} tabIndex={0} onScroll={onScroll} role={related ? 'tabpanel' : undefined} id={`${viewId}-text`} aria-labelledby={related ? `${viewId}-text-tab` : undefined} aria-hidden={relatedOpen || undefined} inert={relatedOpen} className={`relative col-start-1 row-start-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 pb-24 pt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 sm:px-7 ${relatedOpen ? 'invisible' : ''}`}>
          {state.status === 'ready' ? (
            <>
              {notFound && <p role="status" className="py-4 text-center text-sm text-gray-600 dark:text-gray-300">{t('bible.goToNotFound')}</p>}
              {/* `isolate`: the light of a passage lies under the text and over this card. */}
              <article ref={articleRef} className="isolate">
                <BookRibbon text={state.text} lang={BIBLES[reading].language} chapterWord={chapterWord} crossRefs={crossRefs.ribbon} boxes={chapterWindow.boxes} />
              </article>
              <CrossReferenceSheet
                at={crossRefs.openAt}
                bookId={reference.book}
                bible={reading}
                locale={locale}
                set={crossRefs.set}
                verseText={crossRefs.verseText}
                onClose={crossRefs.close}
                onOpenReference={crossReferenceExit(openInBible, reading)}
                layerClassName="z-[260]"
                linkLayerClassName="z-[270]"
              />
            </>
          ) : state.status === 'loading' ? (
            <p role="status" className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t('bible.loading')}</p>
          ) : (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-gray-700 dark:text-gray-200">{t('bible.loadError')}</p>
              <button
                type="button"
                onClick={() => setAttempt((count) => count + 1)}
                className="min-h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                {t('bible.retry')}
              </button>
            </div>
          )}
        </div>
        {related && <div role="tabpanel" id={`${viewId}-related`} aria-labelledby={`${viewId}-related-tab`} aria-hidden={!relatedOpen || undefined} inert={!relatedOpen} tabIndex={0} className={`col-start-1 row-start-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain px-5 py-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 sm:px-7 ${!relatedOpen ? 'invisible' : ''}`}>
          {related.render(returnToText)}
        </div>}
        </div>
        {!relatedOpen && away && (
          // Where the passage went, the button sits: at the top for a passage scrolled off the top, at the bottom otherwise.
          <button
            type="button"
            onClick={() => {
              // Gliding back across chapters not drawn would end where their guessed heights said: a
              // passage out of the page is brought at once instead.
              if (drawnSpan && !inSpan(drawnSpan, passageChapter)) showChapter({ chapter: passageChapter }, () => rest(false));
              else rest(true);
            }}
            className={`absolute left-1/2 z-10 inline-flex min-h-12 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-indigo-600 py-2 pl-4 pr-5 text-[0.9375rem] font-semibold text-white shadow-lg transition hover:bg-indigo-700 ${away === 'up' ? (related ? 'top-[8.25rem] sm:top-[7.75rem]' : 'top-[5.25rem] sm:top-[4.75rem]') : 'bottom-5'}`}
          >
            {away === 'up' ? <ArrowUpIcon className="h-5 w-5" aria-hidden="true" /> : <ArrowDownIcon className="h-5 w-5" aria-hidden="true" />}
            {wholeChapter ? t(isPsalms ? 'bible.sheet.backToPsalm' : 'bible.sheet.backToChapter', { number: Number(firstKey?.split(':')[0] ?? reference.chapter) }) : t('bible.sheet.backToPassage')}
          </button>
        )}
      </div>
    </div>
  );
}

