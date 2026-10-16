'use client';

import { ArrowDownIcon, ArrowUpIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useModalLayer } from '@/hooks/useModalLayer';
import { useOpenInBible } from '@/hooks/useOpenInBible';
import { resolveAppLocale } from '@/utils/appLocale';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, type BookText } from '@/utils/bibleText';
import { formatScriptureReference } from '@/utils/scriptureReference';

import { ARRIVAL_ATTRIBUTE, BookRibbon } from './BookRibbon';
import { CrossReferenceSheet } from './CrossReferenceSheet';
import { readTranslation } from './translation';
import { useBookCrossRefs } from './useBookCrossRefs';
import { passageAway, passageKeys, restingScrollTop, type PassageBox, type SheetReference } from './verseSheetGeometry';

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
};

/**
 * THE VERSE WINDOW — the text of a passage over whatever screen is open, so reading it leaves that
 * screen as it was: a meeting's block and timers, a sermon being preached. The whole book scrolls,
 * the passage stays lit (a whole chapter all of it), it opens in the middle of the window, and "back
 * to the verse" brings it back from wherever it was scrolled. A screen gives a reference and a way
 * to close; the Bible read, its text (kept on the device) and the numbering (`utils/versification`)
 * are this module's — the same ones the Bible page reads with.
 */
export function VerseSheet({ reference, onClose, keepVisible }: VerseSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!reference || !mounted) return null;
  const key = `${reference.bible}|${reference.book}|${reference.chapter ?? ''}:${reference.fromVerse ?? ''}-${reference.toChapter ?? ''}:${reference.toVerse ?? ''}`;
  // Over everything the page draws, a meeting's own full-screen layer included.
  return createPortal(<Sheet key={key} reference={reference} onClose={onClose} keepVisible={keepVisible} />, document.body);
}

type LoadState = { status: 'loading' } | { status: 'ready'; text: BookText } | { status: 'error' };

function Sheet({ reference, onClose, keepVisible }: { reference: SheetReference; onClose: () => void; keepVisible: VerseSheetProps['keepVisible'] }) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n?.language);
  // The Bible this device reads, as on the Bible page.
  const reading: BibleId = useMemo(() => readTranslation(locale), [locale]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  const [away, setAway] = useState<'up' | 'down' | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // A window like every other: the page under it holds still, Escape closes the topmost window only.
  const layer = useModalLayer({ onClose });
  useFocusTrap(dialogRef);
  // Cross references here only when the person asked for them in passage windows too; "Open" goes to
  // the Bible page, whose way back is the screen this window lies over.
  const crossRefs = useBookCrossRefs(reference.book, reading, state.status === 'ready' ? state.text : null, 'window');
  const { openReference: openInBible } = useOpenInBible();
  const restedAtRef = useRef<number | null>(null);

  const keys = useMemo(() => passageKeys(reference, reading), [reference, reading]);
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

  // The passage lit for as long as the window is open, and brought to the middle once the text is in.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (state.status !== 'ready' || !pane) return undefined;
    for (const key of keys) pane.querySelector(`[data-verse="${key}"]`)?.setAttribute(ARRIVAL_ATTRIBUTE, 'on');
    rest(false);
    setAway(null);
    // The serif can arrive after the first layout and move every line: rest again, unless the person has scrolled.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive && paneRef.current && paneRef.current.scrollTop === restedAtRef.current) rest(false);
    });
    return () => { alive = false; };
  }, [state, keys, rest]);

  const onScroll = () => {
    const pane = paneRef.current;
    const box = passageBox();
    if (!pane || !box) return;
    setAway(passageAway(box, pane.scrollTop, pane.clientHeight));
  };

  const notFound = state.status === 'ready' && !firstKey;

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
        {/* Reachable by Tab, so the keyboard scrolls the text too. */}
        <div ref={paneRef} tabIndex={0} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24 pt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 sm:px-7">
          {state.status === 'ready' ? (
            <>
              {notFound && <p role="status" className="py-4 text-center text-sm text-gray-600 dark:text-gray-300">{t('bible.goToNotFound')}</p>}
              {/* `isolate`: the light of a passage lies under the text and over this card. */}
              <article className="isolate">
                <BookRibbon text={state.text} lang={BIBLES[reading].language} chapterWord={chapterWord} crossRefs={crossRefs.ribbon} />
              </article>
              <CrossReferenceSheet
                at={crossRefs.openAt}
                bookId={reference.book}
                bible={reading}
                locale={locale}
                set={crossRefs.set}
                verseText={crossRefs.verseText}
                onClose={crossRefs.close}
                onOpenReference={(target) => openInBible({ bible: reading, book: target.book, chapter: target.chapter, fromVerse: target.fromVerse, toVerse: target.toVerse })}
                layerClassName="z-[260]"
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
        {away && (
          // Where the passage went, the button sits: at the top for a passage scrolled off the top, at the bottom otherwise.
          <button
            type="button"
            onClick={() => rest(true)}
            className={`absolute left-1/2 z-10 inline-flex min-h-12 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-indigo-600 py-2 pl-4 pr-5 text-[0.9375rem] font-semibold text-white shadow-lg transition hover:bg-indigo-700 ${away === 'up' ? 'top-[5.25rem] sm:top-[4.75rem]' : 'bottom-5'}`}
          >
            {away === 'up' ? <ArrowUpIcon className="h-5 w-5" aria-hidden="true" /> : <ArrowDownIcon className="h-5 w-5" aria-hidden="true" />}
            {wholeChapter ? t(isPsalms ? 'bible.sheet.backToPsalm' : 'bible.sheet.backToChapter', { number: Number(firstKey?.split(':')[0] ?? reference.chapter) }) : t('bible.sheet.backToPassage')}
          </button>
        )}
      </div>
    </div>
  );
}

