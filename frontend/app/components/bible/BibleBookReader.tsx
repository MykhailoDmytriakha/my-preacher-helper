'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { useRevealShellHeader, useShellHeader, useShellHeaderPageMoved } from '@/components/navigation/shellHeader';
import { LeavingBar } from '@/components/ui/LeavingBar';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { STICKY_PANEL_GAP_PX, useStickyOffsets } from '@/hooks/useStickyOffsets';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { wayBackKind } from '@/utils/bibleLink';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { bookSlug, fetchBookText, verseWords, type BookText } from '@/utils/bibleText';
import { actedVerses, linkOnScreen, type SeenVerses } from '@/utils/placeTrail';
import { placeIn, placesIn } from '@/utils/versification';

import { BibleMinimap, visibleVerseRange } from './BibleMinimap';
import { BookPicker, ChapterPicker, ReadingPill, SearchPicker, TranslationPicker } from './BiblePicker';
import { BibleSettingsLink } from './BibleSettingsLink';
import { bookSequence, booksOf } from './bookOrder';
import { ARRIVAL_ATTRIBUTE, BookRibbon } from './BookRibbon';
import { CrossReferenceSheet } from './CrossReferenceSheet';
import { currentEntryId, placeInBook, readEntryArrival, readEntryPlace, saveEntryArrival, saveEntryPlace, saveLastPlace, type LastPlace } from './lastPlace';
import { MarkedElsewhereSheet } from './marks/MarkedElsewhereSheet';
import { useReaderMarks } from './marks/useReaderMarks';
import { MineSheet } from './MineSheet';
import { buildMinimapLayout } from './minimapLayout';
import { PhoneReaderTools } from './PhoneReaderTools';
import { useReaderTrail, type TrailBack } from './PlaceTrail';
import { arriveOnTrail, changeTranslationOnTrail, leaveOnTrail, openedForTranslation, ownTrailPlace, stepOnTrail } from './placeTrailStore';
import { readingSurface } from './readingSurface';
import { useBookCrossRefs } from './useBookCrossRefs';
import { useBookUsage } from './useBookUsage';
import { chapterAtLine, useChapterWindow } from './useChapterWindow';
import { useFollowAfterClose } from './useFollowAfterClose';
import { useVerseCopy } from './verseCopy/useVerseCopy';
import { VerseCopyBar } from './verseCopy/VerseCopyBar';
import { VerseHoldSurface } from './verseCopy/VerseHoldSurface';
import { VerseMenu } from './verseCopy/VerseMenu';

import type { AppLocale } from '@/utils/appLocale';
import type { CrossReference } from '@/utils/crossReferences';

type Place = { chapter: number; verse: number };

type BibleBookReaderProps = {
  bookId: string;
  /** The Bible read: its text, its numbering, its order of books. */
  bible: BibleId;
  initialPlace: Place | null;
  /** The Bible `initialPlace` is numbered in (a link's `tr`); the place is found in `bible`. */
  initialBible: BibleId;
  /** The last verse of the passage a link named (its `to`), numbered as `initialPlace`: lit on arrival. */
  passageEnd?: number | null;
  /** The screen the link was tapped on (its `from`): the way back when no other book is. */
  cameFrom?: string | null;
  /**
   * Another book, at a place of `bible`: a new history entry that remembers the place it was opened
   * from. A passage's last verse (`toVerse`) is lit on arrival, as a link's is.
   */
  onOpenBook: (slug: string, place: Place & { toVerse?: number }, from: LastPlace) => void;
  /** Another Bible: the page reads the same place in it. */
  onChangeBible: (bible: BibleId) => void;
};

type LoadState = { status: 'loading' } | { status: 'ready'; text: BookText } | { status: 'error' };

/** How long the verse stays lit before it starts to fade (the owner, 2026-10-15: five seconds). */
const ARRIVAL_LIT_MS = 5000;
const ARRIVAL_FADE_MS = 3600;

/** "← Rom 5": back to the place in the book this one was opened from. */
function WayBack({ label, phone = false, onClick }: { label: string; phone?: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('bible.backToLabel', { place: label })}
      className={phone
        ? 'inline-flex min-h-9 min-w-4 max-w-[4.5rem] items-center truncate whitespace-nowrap text-xs font-semibold text-indigo-700 dark:text-indigo-300'
        : 'mr-3 inline-flex min-h-9 shrink-0 items-center rounded-full border border-gray-200 bg-white px-3 text-[13px] font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40'}
    >
      {t('bible.backTo', { place: label })}
    </button>
  );
}

/** The end of the book leads on in the translation's order: after Jude comes Romans in the Synodal. */
function BookEnd({ bookId, bible, locale, wide, onOpen }: { bookId: string; bible: BibleId; locale: AppLocale; wide: boolean; onOpen: (bookId: string) => void }) {
  const { t } = useTranslation();
  const order = bookSequence(booksOf(bible));
  const at = order.indexOf(bookId);
  const nextBook = at >= 0 ? order[at + 1] : undefined;
  const previousBook = at > 0 ? order[at - 1] : undefined;
  return (
    <footer className={`mt-8 flex gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:p-5 dark:border-gray-700 dark:bg-gray-950 ${wide ? 'flex-wrap items-center' : 'flex-col'}`}>
      <div className={`flex flex-col gap-0.5 ${wide ? 'mr-auto' : ''}`}>
        <span className="text-[13px] text-gray-500 dark:text-gray-400">{t('bible.endOfBook')}</span>
        <span className="text-lg font-bold text-gray-900 dark:text-white">{getLocalizedBookName(bookId, locale)}</span>
      </div>
      {previousBook ? (
        <button
          type="button"
          onClick={() => onOpen(previousBook)}
          className={`${wide ? '' : 'order-last'} min-h-11 rounded-xl border border-gray-300 px-4 text-[15px] font-medium text-indigo-700 transition hover:bg-indigo-50 dark:border-gray-600 dark:text-indigo-300 dark:hover:bg-indigo-950/40`}
        >
          {t('bible.previousBook', { book: getLocalizedBookName(previousBook, locale) })}
        </button>
      ) : null}
      {nextBook ? (
        <button
          type="button"
          onClick={() => onOpen(nextBook)}
          className="min-h-12 rounded-xl border border-indigo-500 bg-indigo-600 px-5 text-base font-bold text-white transition hover:bg-indigo-500"
        >
          {t('bible.nextBook', { book: getLocalizedBookName(nextBook, locale) })}
        </button>
      ) : null}
    </footer>
  );
}

/** The place as a reference names it, "16:21", on the chapter button; a book of one chapter has no button to open. */
function ChapterControl({ bookId, bible, locale, current, verse, text, wide, onOpen }: {
  bookId: string; bible: BibleId; locale: AppLocale; current: number; verse: number; text: BookText; wide: boolean; onOpen: (place: Place & { toVerse?: number }) => void;
}) {
  const { t } = useTranslation();
  if (text.chapters.length === 1) {
    return (
      <span aria-label={t('bible.placeVerse', { chapter: t('bible.oneChapter'), verse })} className="shrink-0 px-2.5 text-[15px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
        {current}:{verse}
      </span>
    );
  }
  return <ChapterPicker bookId={bookId} bible={bible} current={current} verse={verse} text={text} locale={locale} wide={wide} onOpen={onOpen} />;
}

/** While the text is on its way, and when it could not be opened. */
function LoadNotice({ status, onRetry }: { status: LoadState['status']; onRetry: () => void }) {
  const { t } = useTranslation();
  if (status === 'loading') {
    return <p role="status" className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t('bible.loading')}</p>;
  }
  if (status !== 'error') return null;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
      <p className="text-sm text-gray-700 dark:text-gray-200">{t('bible.loadError')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-300"
      >
        {t('bible.retry')}
      </button>
    </div>
  );
}

/**
 * The way back as a phone's header says it: «← 8:7» within this book, the place's own label elsewhere —
 * the book's name is already beside it (BUG-20261023-phone-bar-crowded: «← Рим 8:7» did not fit at 360 px).
 */
function shortWayBack(returnTo: Place | null, back: TrailBack | null, bookId: string, label: string | null): string | null {
  if (returnTo) return `${returnTo.chapter}:${returnTo.verse}`;
  if (back?.kind === 'link' && back.book === bookId) return `${back.place.chapter}:${back.place.verse}`;
  return label;
}

/**
 * A phone's controls, lent to the app's header (`shellHeader.tsx`): the way back, the place, the trail, the search.
 * While the text loads, or did not load, the book's own picker stands for the place: another book and the search
 * stay at hand (Codex, 2026-10-26: a book that answered 503 left only «Повторить»).
 */
function PhoneHeader({ wayBack, onWayBack, trailButton, bookId, bible, currentChapter, currentVerse, text, locale, onOpen }: {
  wayBack: string | null; onWayBack: () => void; trailButton: ReactNode;
  bookId: string; bible: BibleId; currentChapter: number; currentVerse: number; text: BookText | null; locale: AppLocale; onOpen: (bookId: string, place: Place) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
      {wayBack ? <WayBack label={wayBack} phone onClick={onWayBack} /> : null}
      {text
        ? <ReadingPill bookId={bookId} bible={bible} currentChapter={currentChapter} currentVerse={currentVerse} text={text} locale={locale} onOpen={onOpen} look="header" />
        : <BookPicker bookId={bookId} bible={bible} currentChapter={currentChapter} currentVerse={currentVerse} text={null} locale={locale} wide={false} onOpen={onOpen} />}
      {trailButton}
      <SearchPicker bookId={bookId} bible={bible} locale={locale} wide={false} look="header" onOpen={onOpen} />
    </div>
  );
}

/**
 * THE BOOK'S LINE, from 768 px: the book, the chapter and the search at the text's left edge, the translation at
 * its right one, above the text's pane, so both are at hand anywhere in the book. It stays one row — a tool's
 * colours open in it (`MarkToolbar`), and a second row would move the whole text down — so short of room the
 * translation's name is cut, never the book's. A phone lends its controls to the app's header (`PhoneHeader`).
 */
function BookLine({ lineRef, wayBack, onWayBack, trailButton, tools, translationClass, bookId, bible, currentChapter, currentVerse, text, locale, onOpen, onChangeBible }: {
  lineRef: (element: HTMLElement | null) => void; wayBack: string | null; onWayBack: () => void; trailButton: ReactNode; tools: ReactNode; translationClass: string;
  bookId: string; bible: BibleId; currentChapter: number; currentVerse: number; text: BookText | null; locale: AppLocale;
  onOpen: (bookId: string, place: Place) => void; onChangeBible: (bible: BibleId) => void;
}) {
  return (
    <header ref={lineRef} className="relative z-30 mb-3 flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 bg-white/90 py-1.5 backdrop-blur-md md:flex-nowrap dark:bg-gray-900/90">
      {wayBack ? <WayBack label={wayBack} onClick={onWayBack} /> : null}
      {trailButton}
      <BookPicker bookId={bookId} bible={bible} currentChapter={currentChapter} currentVerse={currentVerse} text={text} locale={locale} wide onOpen={onOpen} />
      {text ? <ChapterControl bookId={bookId} bible={bible} locale={locale} current={currentChapter} verse={currentVerse} text={text} wide onOpen={(place) => onOpen(bookId, place)} /> : null}
      <SearchPicker bookId={bookId} bible={bible} locale={locale} wide look="line" onOpen={onOpen} />
      {tools}
      <span className={`flex min-w-0 ${translationClass}`}>
        <TranslationPicker bible={bible} wide onPick={onChangeBible} />
      </span>
      {/* The gap under the stuck line shows a strip of the verse above the one read: it fades out
          instead of being cut by a hard edge. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-white/90 to-transparent dark:from-gray-900/90" />
    </header>
  );
}

/** How long the line saying "going to another screen" waits for that screen before it gives up. */
const LEAVING_GIVES_UP_MS = 10_000;

/** The verses of a passage (`"chapter:verse"`), for the light of an arrival. */
function passageKeys(chapter: number, fromVerse: number, toVerse: number): string[] {
  return Array.from({ length: Math.max(0, toVerse - fromVerse + 1) }, (_, index) => `${chapter}:${fromVerse + index}`);
}

/**
 * FOLLOWING A CROSS REFERENCE. Within the book: a jump to the passage, lit, which comes to the trail of
 * places — the way back to the verse it was opened from is the trail's link left of it. Within the same
 * chapter the trail has no new link (a place is a chapter): the verse it was opened from is kept as the
 * way back (`keepWayBack`). Into another book: `openElsewhere`, a new history entry like any other book.
 */
function useCrossReferenceTravel({ bookId, jumpTo, light, openElsewhere, arrive, keepWayBack }: {
  bookId: string;
  jumpTo: (place: Place, then?: () => void) => void;
  light: (reference: CrossReference) => void;
  openElsewhere: (reference: CrossReference, origin: Place) => void;
  arrive: (place: Place) => void;
  keepWayBack: (origin: Place) => void;
}) {
  return useCallback((reference: CrossReference, origin: Place) => {
    if (reference.book !== bookId) {
      openElsewhere(reference, origin);
      return;
    }
    const target = { chapter: reference.chapter, verse: reference.fromVerse };
    arrive(target);
    if (reference.chapter === origin.chapter) keepWayBack(origin);
    jumpTo(target, () => light(reference));
  }, [arrive, bookId, jumpTo, keepWayBack, light, openElsewhere]);
}

/**
 * The room the page needs under the book for its last verse to stand at the reading top, and no
 * more. A pixel over: measured in fractions of a pixel, the last verse stopped a hair short of the
 * top and the verse above it stayed the place.
 */
export function roomBelow(lastVerseTop: number, readingTop: number, viewportHeight: number, pageHeight: number): number {
  return Math.max(0, Math.ceil(lastVerseTop - readingTop + viewportHeight - pageHeight) + 1);
}

/**
 * The reader's frame: on a computer the page stands still, the book's line stands above the text,
 * and the text scrolls in its own pane beside the minimap — focusable, so the keys scroll it as they
 * scrolled the page (`readingSurface.ts`); on a phone the page scrolls and leaves room for its tools.
 */
function readerFrame(wide: boolean) {
  return wide
    ? { root: 'flex min-h-0 flex-1 flex-col', row: 'min-h-0 flex-1', pane: 'min-h-0 min-w-0 flex-1 self-stretch overflow-y-auto overscroll-contain', paneTabIndex: 0, card: 'rounded-2xl border border-gray-200 px-3 py-5 sm:px-6 dark:border-gray-700' }
    // A phone's text has no card: the page's own 16 px sides are its margins.
    : { root: 'pb-24', row: '', pane: 'min-w-0 flex-1', paneTabIndex: undefined, card: '' };
}

/**
 * A ribbon's way into a verse's window (its links, its badges, its signs of marks elsewhere) that also puts the
 * verse on the trail: opening a verse's window is an act on it (the owner, 2026-10-27).
 */
function useActedOpen<T extends { onOpen: (chapter: number, verse: never) => void }>(
  ribbon: T | undefined, acted: (chapter: number, verse: number) => void
): T | undefined {
  return useMemo(() => {
    if (!ribbon) return undefined;
    const open = ribbon.onOpen as (chapter: number, verse: number | null) => void;
    // A whole chapter's window (the badges of what names a chapter, `verse` null) is no verse's.
    const onOpen = (chapter: number, verse: number | null) => {
      if (verse !== null) acted(chapter, verse);
      open(chapter, verse);
    };
    return { ...ribbon, onOpen } as T;
  }, [acted, ribbon]);
}

export function BibleBookReader({ bookId, bible, initialPlace, initialBible, passageEnd = null, cameFrom = null, onOpenBook, onChangeBible }: BibleBookReaderProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveAppLocale(i18n.language);
  const wide = useMediaQuery('(min-width: 768px)', false);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [currentVerse, setCurrentVerse] = useState(1);
  const textRef = useRef<HTMLElement | null>(null);
  const entryRef = useRef<string | null>(null);
  const placeRef = useRef<Place | null>(null);

  useEffect(() => {
    entryRef.current = currentEntryId();
  }, []);

  // WHAT THE TEXT SCROLLS IN: on a phone the page; on a screen with the minimap its own pane beside
  // it, so a finger on the minimap is the minimap's even while the text still glides (`readingSurface.ts`).
  // The pane is drawn before the text comes: the first jump and the room under the book use it.
  const [pane, setPane] = useState<HTMLElement | null>(null);
  // The page's own moves are told to a phone's header, which folds for the person reading only.
  const pageMoved = useShellHeaderPageMoved();
  const surface = useMemo(() => readingSurface(wide ? pane : null, pageMoved), [pageMoved, pane, wide]);
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  // THE TOP OF THE READING AREA, measured from the top of what the text scrolls in: on a phone under
  // the app's nav, in the pane at its top. "The verse I am at" is read from here and a verse jumped to
  // is put here — one number for both: with the jump lower than the reading, the verse above showed a
  // strip and counted as the place, so every Back landed a verse higher.
  const { setHeaderRef, navHeight } = useStickyOffsets();
  const readingInset = (wide ? 0 : navHeight) + STICKY_PANEL_GAP_PX;
  const readingInsetRef = useRef(readingInset);
  readingInsetRef.current = readingInset;


  const isPsalms = bookId === 'Psalms';
  const chapterWord = useCallback(
    (chapter: number) => t(isPsalms ? 'bible.psalm' : 'bible.chapter', { number: chapter }),
    [isPsalms, t]
  );
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const placeLabel = useCallback(({ chapter, verse }: Place) => `${abbrev} ${chapter}:${verse}`, [abbrev]);
  const readingLabel = useCallback((place: Place) => t('bible.minimapReading', { place: placeLabel(place) }), [placeLabel, t]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchBookText(bookId, bible).then(
      (text) => { if (!cancelled) setState({ status: 'ready', text }); },
      () => { if (!cancelled) setState({ status: 'error' }); }
    );
    return () => { cancelled = true; };
  }, [bible, bookId, attempt]);

  const text = state.status === 'ready' ? state.text : null;
  // Cross references: the chips with the verses and the window of one verse's links.
  const crossRefs = useBookCrossRefs(bookId, bible, text, 'reader');
  const closeCrossRefs = crossRefs.close;
  // The person's own material on the verses it names: badges with the text, dots on the minimap, a list.
  const mine = useBookUsage(bookId, bible, locale, Boolean(text));
  const layout = useMemo(() => (text ? buildMinimapLayout(text.chapters) : null), [text]);

  // A BIG BOOK IS DRAWN AROUND THE PLACE READ (`useChapterWindow`): the chapters near it are in the
  // page, the others stand as boxes of their height. A new width or text size brings the person back to
  // the verse read, as the boxes are measured anew.
  const keepPlaceRef = useRef<() => void>(() => undefined);
  const notePlaceRef = useRef<() => void>(() => undefined);
  const holdBroughtRef = useRef<(moved: number) => boolean>(() => false);
  const chapterWindow = useChapterWindow({
    text,
    textRef,
    surfaceRef,
    readingLine: () => surfaceRef.current.edge() + readingInsetRef.current,
    onReflow: () => keepPlaceRef.current(),
    onDrawn: (moved) => {
      if (!holdBroughtRef.current(moved)) notePlaceRef.current();
    },
  });
  const showChapter = chapterWindow.show;
  const followChapter = chapterWindow.follow;
  const jumping = chapterWindow.jumping;
  const drawnSpan = chapterWindow.boxes?.span;
  const drawnRef = useRef(drawnSpan);
  drawnRef.current = drawnSpan;

  // An act on verses — a mark, a copy, a send, their links or badges opened, a verse's menu — puts each on the
  // trail: one link a run of verses, in the order they were chosen (the owner, 2026-10-27). The way back then goes
  // along the trail from it, not to a verse a link was opened from before (Codex review, 2026-10-27).
  const [returnTo, setReturnTo] = useState<Place | null>(null);
  const actOn = useCallback((verses: readonly Place[]) => {
    const length = (chapter: number) => text?.chapters[chapter - 1]?.length;
    const acted = actedVerses(verses, length);
    if (acted.length) setReturnTo(null);
    for (const at of acted) arriveOnTrail({ book: bookId, chapter: at.chapter, verse: at.verse, bible });
  }, [bible, bookId, text]);
  const actOnVerse = useCallback((chapter: number, verse: number) => actOn([{ chapter, verse }]), [actOn]);
  const ribbonCrossRefs = useActedOpen(crossRefs.ribbon, actOnVerse);
  const ribbonMine = useActedOpen(mine.ribbon, actOnVerse);

  // MARKS IN THE TEXT: the tools, the legend and the text's manner while a tool is in hand (`marks/`).
  const marks = useReaderMarks({ textRef, text, ready: Boolean(text && layout), bible, bookId, drawn: drawnSpan, onMarked: actOnVerse });
  const ribbonSigns = useActedOpen(marks.signs, actOnVerse);
  // TAKING VERSES OUT: a verse held opens its menu, several are chosen for the bar (`verseCopy/`).
  const verseCopy = useVerseCopy({ textRef, text, bible, bookId, drawn: drawnSpan, crossRefs: ribbonCrossRefs, enabled: !marks.toolInHand, onActed: actOn });
  // The links' chips and the signs of marks shape a chapter's height: those measured before are doubted.
  const doubtHeights = chapterWindow.doubt;
  useEffect(() => {
    doubtHeights();
  }, [crossRefs.ribbon, doubtHeights, marks.signs, mine.ribbon]);

  // ROOM UNDER THE BOOK: the text scrolls on until the last verse stands at the reading top, and no
  // further — so a verse near the end (Rom 16:21) comes to the top like any other (the owner, 2026-10-15).
  // The room is the text card's bottom margin, inside what scrolls: on a phone a block below the card
  // would do as well, but in the pane only what is in it scrolls.
  const fitRoom = useCallback(() => {
    const article = textRef.current;
    const rows = article?.querySelectorAll<HTMLElement>('[data-verse]');
    const last = rows?.[rows.length - 1];
    if (!article || !last) return;
    const surface = surfaceRef.current;
    // The book's end is a box (a big book read far from it): a screen of room is enough until its
    // chapters are drawn, and then the room is measured.
    if (article.querySelector('section[data-chapter]:last-of-type')?.hasAttribute('data-box')) {
      article.style.marginBottom = `${Math.max(parseFloat(article.style.marginBottom) || 0, surface.height())}px`;
      return;
    }
    // The text's own height, without the room: a text shorter than what shows it measures as that
    // (`scrollHeight` never goes below it), so it is measured with a room of a screen at least, and
    // that room taken off. Never less than the room there is, so a book read at its end does not
    // shrink under the reader and lose the place. Both writes land before the next paint.
    const probe = Math.max(parseFloat(article.style.marginBottom) || 0, surface.height());
    article.style.marginBottom = `${probe}px`;
    const pageHeight = surface.contentHeight() - probe;
    const lastTop = last.getBoundingClientRect().top - surface.edge() + surface.top();
    article.style.marginBottom = `${roomBelow(lastTop, readingInsetRef.current, surface.height(), pageHeight)}px`;
  }, []);

  // A chapter opens at its heading, so "Chapter 12" shows above its first verse; any other verse
  // at the verse itself. A verse the chapter does not have opens the chapter.
  // The verse jumped to is the place until the page moves from where the jump left it: a verse near
  // the end of a book cannot reach the top, and the verse that does is not where the person is.
  // A chapter of a big book not drawn yet is drawn first; `then` runs once the jump is made.
  const broughtRef = useRef<{ place: Place; scrollY: number } | null>(null);
  // A phone's header folded while reading opens on a jump: the way back is what the person needs then.
  const revealHeader = useRevealShellHeader();
  const jumpTo = useCallback(({ chapter, verse }: Place, then?: () => void) => {
    revealHeader();
    showChapter({ chapter }, () => {
      const root = textRef.current;
      const row = verse > 1 ? root?.querySelector<HTMLElement>(`[data-verse="${chapter}:${verse}"]`) : null;
      const target = row ?? root?.querySelector<HTMLElement>(`[data-chapter="${chapter}"]`);
      if (!target) return;
      // The room first: without it a verse near the end of the book cannot come to the top.
      fitRoom();
      // On a phone the page itself moves: the shell's header is told, so it does not fold for it. Asked of the
      // surface, not of the width — a jump that changed with the width ran the opening's jump again (Codex, 2026-10-26).
      const surface = surfaceRef.current;
      const was = surface.top();
      target.scrollIntoView({ block: 'start' });
      if (surface.target === window && surface.top() !== was) pageMoved();
      broughtRef.current = { place: { chapter, verse: row ? verse : 1 }, scrollY: surfaceRef.current.top() };
      // While the verse holds, the reader keeps it (jumped to again as the text grows); the browser's own
      // scroll to keep what shows would be taken for the person's and let the verse go early.
      surfaceRef.current.anchoring(false);
      then?.();
    });
  }, [fitRoom, pageMoved, revealHeader, showChapter]);
  useEffect(() => {
    keepPlaceRef.current = () => {
      if (placeRef.current) jumpTo(placeRef.current);
    };
  }, [jumpTo]);

  // The chapters drawn around the place changed, and the window moved the page by `moved` to keep what
  // stood on the line (`useChapterWindow`). While the verse a jump came to holds and the page stood where
  // the jump left it before that move, the move is the window's, not the person's: the verse is jumped to
  // again. The window's correction can miss it, and taken for a scroll it let the place go
  // (BUG-20261016-bible-deeplink-lands-early-verse: a link to Synodal Ps 22:1 read in the King James stood
  // at 23:1, then at 22:27). A scroll of the person's whose event has not come yet leaves the page
  // elsewhere than the jump left it, and is not undone.
  useEffect(() => {
    holdBroughtRef.current = (moved) => {
      const brought = broughtRef.current;
      if (!brought || leavingRef.current || Math.abs(moved) < 1) return false;
      if (Math.abs(surfaceRef.current.top() - moved - brought.scrollY) >= 1) return false;
      jumpTo(brought.place);
      return true;
    };
  }, [jumpTo]);

  // THE VERSE A JUMP CAME TO STAYS AT THE TOP until the person scrolls: what arrives after the jump —
  // the links' chips on every verse above it, a late font, the book's line wrapping — grows the page
  // above it, and Safari before 27 does not keep the verse in place (no scroll anchoring). A link opened
  // on a phone landed hundreds to thousands of pixels above its verse (2026-10-16, measured, the old
  // ribbon too). The page and the text are watched; while the jump's place holds, it is jumped to again.
  const readerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!text || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const brought = broughtRef.current;
      if (brought && !leavingRef.current) jumpTo(brought.place);
    });
    if (readerRef.current) observer.observe(readerRef.current);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [jumpTo, text]);

  // THE VERSE A LINK CAME TO: lit at once, then fading back on its own — near the end of a book it
  // cannot be told by where it stands. The light belongs to the arrival, not to the text it was put
  // on, and lasts its own time: the passage drawn again within it — in another Bible, as on a new
  // device, where the interface's language, and the Bible with it, arrives a moment after the first
  // text; or by Back or a reload in those seconds — is lit for the time left (the arrival is kept
  // with the history entry: `saveEntryArrival`). After it, Back and a reload bring the place unlit.
  // The light is kept by the verses (`"chapter:verse"`), not by their elements: a chapter of a big book
  // that leaves the page and comes back within the light's time is lit as it was.
  const arrivalTimersRef = useRef<number[]>([]);
  const arrivalRef = useRef<{ keys: string[]; phase: 'on' | 'off' } | null>(null);
  const paintArrival = useCallback(() => {
    const root = textRef.current;
    const lit = arrivalRef.current;
    // A new passage takes the light from the one before.
    root?.querySelectorAll<HTMLElement>(`[${ARRIVAL_ATTRIBUTE}]`).forEach((row) => {
      if (!lit || !lit.keys.includes(row.dataset.verse ?? '')) row.removeAttribute(ARRIVAL_ATTRIBUTE);
    });
    lit?.keys.forEach((key) => root?.querySelector(`[data-verse="${key}"]`)?.setAttribute(ARRIVAL_ATTRIBUTE, lit.phase));
  }, []);
  const lightArrival = useCallback((keys: string[], litMs: number) => {
    arrivalTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    arrivalRef.current = { keys, phase: 'on' };
    paintArrival();
    arrivalTimersRef.current = [
      window.setTimeout(() => {
        arrivalRef.current = { keys, phase: 'off' };
        paintArrival();
      }, litMs),
      window.setTimeout(() => {
        arrivalRef.current = null;
        paintArrival();
      }, litMs + ARRIVAL_FADE_MS),
    ];
  }, [paintArrival]);
  useEffect(() => () => arrivalTimersRef.current.forEach((timer) => window.clearTimeout(timer)), []);
  useLayoutEffect(() => {
    paintArrival();
  }, [drawnSpan, paintArrival]);

  // Where to open: where this history entry was read (Back, Forward, a reload, another Bible chosen),
  // else the verse the link asked for — or its chapter, when the chapter has no such verse — else the
  // start of the book. A place read in another Bible is found in this one (`utils/versification`).
  const startChapter = initialPlace?.chapter;
  const startVerse = initialPlace?.verse;
  // Before the first paint of the text: the book shows at its place and the chapter button names it
  // at once — painted first, a long book (the Psalter) showed its start and "Psalm 1" for a second.
  useLayoutEffect(() => {
    if (!text) return;
    const here = (place: Place | null, of: BibleId): Place | null => {
      if (!place || of === bible) return place;
      const found = placeIn(bible, of, { book: bookId, ...place });
      return found ? { chapter: found.chapter, verse: found.verse } : null;
    };
    const asked = here(startChapter && startVerse ? { chapter: startChapter, verse: startVerse } : null, initialBible);
    const entry = entryRef.current ? readEntryPlace(entryRef.current) : null;
    const entryPlace = entry ? here(entry, entry.bible) : null;
    const linked = placeInBook(text.chapters, entryPlace) ? null : placeInBook(text.chapters, asked);
    const target = placeInBook(text.chapters, entryPlace)
      ?? linked
      ?? placeInBook(text.chapters, asked ? { chapter: asked.chapter, verse: 1 } : null);
    // A link numbered in another Bible is this entry's place as the link named it, until the person
    // moves — as a place read in another Bible is.
    if (linked && initialBible !== bible && startChapter && startVerse && entryRef.current) {
      saveEntryPlace(entryRef.current, { chapter: startChapter, verse: startVerse, bible: initialBible });
    }
    setCurrentChapter(target?.chapter ?? 1);
    setCurrentVerse(target?.verse ?? 1);
    // The book opened at its place comes to the trail of places: a link from another book, a book chosen,
    // Back or Forward, a reload — the last ones land on a recent link and only light it.
    // Opened from a screen of the app (a note's reference): the link keeps it, and the way back from it goes there.
    // The same place in another translation is no arrival: the trail stays as it was.
    if (!openedForTranslation(bookId)) {
      arriveOnTrail({ book: bookId, ...(target ?? { chapter: 1, verse: 1 }), bible, ...(cameFrom ? { screen: cameFrom } : {}) });
    }
    // The passage the link named, each verse found in this Bible: "Rom 12:1-2" lights both — once its
    // chapter is in the page.
    const link = `${bookId} ${initialBible} ${startChapter}:${startVerse}-${passageEnd}`;
    if (linked && passageEnd) saveEntryArrival({ link, litUntil: Date.now() + ARRIVAL_LIT_MS });
    const arrival = passageEnd ? readEntryArrival() : null;
    const litMs = arrival?.link === link ? arrival.litUntil - Date.now() : 0;
    const lightPassage = () => {
      if (!(litMs > 0 && passageEnd && startChapter && startVerse)) return;
      const last = Math.min(Math.max(passageEnd, startVerse), startVerse + 200);
      const keys = new Set<string>();
      for (let verse = startVerse; verse <= last; verse += 1) {
        placesIn(bible, initialBible, { book: bookId, chapter: startChapter, verse }).forEach((found) => keys.add(`${found.chapter}:${found.verse}`));
      }
      lightArrival(Array.from(keys), litMs);
    };
    if (target) {
      jumpTo(target, lightPassage);
    } else {
      fitRoom();
      surfaceRef.current.scrollTo(0);
      lightPassage();
    }
  }, [bible, bookId, cameFrom, fitRoom, initialBible, jumpTo, lightArrival, passageEnd, startChapter, startVerse, text]);

  // The room follows the page: a resized window, a font that came late, the line growing on a phone.
  useEffect(() => {
    if (!text) return undefined;
    fitRoom();
    const article = textRef.current;
    const observer = typeof ResizeObserver === 'undefined' || !article ? null : new ResizeObserver(() => fitRoom());
    if (article) observer?.observe(article);
    // Read to the very end, the last verse stands at the top. A taller window clamps the page before
    // the room catches up, and the verse slid down by the growth: the end is kept as the end.
    let atEnd = false;
    const onScroll = () => {
      atEnd = surface.top() >= surface.contentHeight() - surface.height() - 1;
    };
    const onResize = () => {
      const keepEnd = atEnd;
      fitRoom();
      if (keepEnd) surface.scrollTo(surface.contentHeight() - surface.height());
    };
    surface.target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      surface.target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [fitRoom, readingInset, surface, text]);

  // The text moved to another surface (a window made narrow or wide): the room is measured in it again
  // and the person kept at the verse they were reading — the new one opens at its own top.
  const shownSurfaceRef = useRef(surface);
  useLayoutEffect(() => {
    if (shownSurfaceRef.current === surface) return;
    shownSurfaceRef.current = surface;
    const here = placeRef.current;
    if (!text || !here) return;
    fitRoom();
    jumpTo(here);
  }, [fitRoom, jumpTo, surface, text]);

  // Remember where the person is ("Continue" on the list, Back to this entry, the way back from
  // another book) and keep the chapter button on the chapter. The place is read on every scroll (a
  // binary search, cheap); only the write waits, and a pending write is done on the way out —
  // leaving within the wait must not lose the place.
  const flushPlaceRef = useRef<() => void>(() => undefined);
  const leavingRef = useRef(false);
  // The verses on the screen: the trail lights its link only while its verse is among them.
  const seenRef = useRef<SeenVerses | null>(null);
  const [seen, setSeen] = useState<SeenVerses | null>(null);
  const noteSeen = useCallback((next: SeenVerses) => {
    const now = seenRef.current;
    if (now && now.first.chapter === next.first.chapter && now.first.verse === next.first.verse
      && now.last.chapter === next.last.chapter && now.last.verse === next.last.verse) return;
    seenRef.current = next;
    setSeen(next);
  }, []);
  useEffect(() => {
    if (!text) return;
    leavingRef.current = false;
    // The rows drawn: a big book draws the chapters around the place, and they change as it moves —
    // read again when the chapters drawn are others.
    const drawnRows = () => Array.from(textRef.current?.querySelectorAll<HTMLElement>('[data-verse]') ?? []);
    let rows = drawnRows();
    let rowsOf = drawnRef.current;
    let timer: number | null = null;
    const store = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      const current = placeRef.current;
      if (!current) return;
      // Brought here from another Bible and not moved: the place stays as it was read there. One
      // verse here can hold two of that Bible (a psalm's title and its first words), and the way
      // back from this one would open the first of them.
      const kept = entryRef.current ? readEntryPlace(entryRef.current) : null;
      const opened = kept && kept.bible !== bible ? placeIn(bible, kept.bible, { book: bookId, chapter: kept.chapter, verse: kept.verse }) : null;
      const place = kept && opened && opened.chapter === current.chapter && opened.verse === current.verse ? kept : { ...current, bible };
      saveLastPlace({ slug: bookSlug(bookId), ...place });
      if (entryRef.current) saveEntryPlace(entryRef.current, place);
    };
    const note = () => {
      // Leaving, or a jump waiting for its chapter: the page is not where the person reads.
      if (leavingRef.current || jumping()) return;
      // Moved from where a jump left the page: from here the place is what the top shows.
      if (broughtRef.current && Math.abs(surface.top() - broughtRef.current.scrollY) >= 1) {
        broughtRef.current = null;
        surface.anchoring(true);
      }
      // A fast scroll can bring a chapter's box to the reading line before its verses are drawn: the
      // place is that chapter, and the chapters drawn follow it.
      const line = surface.edge() + readingInsetRef.current;
      if (rowsOf !== drawnRef.current) {
        rows = drawnRows();
        rowsOf = drawnRef.current;
      }
      const box = textRef.current ? chapterAtLine(textRef.current, line) : null;
      const range = visibleVerseRange(rows, line, surface.bottom());
      const here = broughtRef.current?.place ?? (box?.box ? { chapter: box.chapter, verse: 1 } : range?.[0]);
      if (range) noteSeen({ first: range[0], last: range[1] });
      if (here) {
        placeRef.current = here;
        setCurrentChapter(here.chapter);
        setCurrentVerse(here.verse);
      }
      followChapter();
      if (timer === null) timer = window.setTimeout(store, 400);
    };
    flushPlaceRef.current = store;
    notePlaceRef.current = note;
    note();
    surface.target.addEventListener('scroll', note, { passive: true });
    return () => {
      surface.target.removeEventListener('scroll', note);
      surface.anchoring(true);
      if (timer !== null) store();
      flushPlaceRef.current = () => undefined;
      notePlaceRef.current = () => undefined;
    };
  }, [bible, bookId, followChapter, jumping, noteSeen, surface, text]);

  // THE TRAIL OF PLACES (`placeTrailStore.ts`, the rule `utils/placeTrail.ts`): every move the person makes to
  // a place within the book — a link followed, a chapter chosen, the way back, a link of the trail — comes to it;
  // another book comes to it when it opens; so does every act on a verse (a mark, a copy, its links, its menu).
  // Reading writes nothing there. Leaving, the verse the person stopped at joins it — unless the place last put
  // there is still on the screen: then that is where they are (the owner, 2026-10-27).
  const leaveHere = useCallback(() => {
    const stop = placeRef.current;
    if (!stop || linkOnScreen(ownTrailPlace(), bookId, seenRef.current, bible)) return;
    leaveOnTrail({ book: bookId, chapter: stop.chapter, verse: stop.verse, bible });
  }, [bible, bookId]);
  const leave = useCallback(() => {
    flushPlaceRef.current();
    leaveHere();
  }, [leaveHere]);
  const arrive = useCallback((place: Place) => {
    leave();
    // Any move to a place forgets the way back to a verse of the same chapter.
    setReturnTo(null);
    arriveOnTrail({ book: bookId, chapter: place.chapter, verse: place.verse, bible });
  }, [bible, bookId, leave]);
  // Leaving the reader for another screen, the app closing or put away (an iPhone's installed app is only hidden,
  // never closed): where the person stopped joins the trail.
  const leaveHereRef = useRef(leaveHere);
  leaveHereRef.current = leaveHere;
  useEffect(() => {
    const away = () => {
      if (!leavingRef.current) leaveHereRef.current();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') away();
    };
    window.addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', away);
      document.removeEventListener('visibilitychange', hidden);
      away();
    };
  }, []);

  // The same book: a jump within the ribbon. Another: a new history entry that carries this place
  // as its way back. The place is written first, and the scroll that follows is not taken for reading.
  // A place with a passage to light (a verse found by the search line): lit on arrival, as a link's is.
  const openPlace = useCallback((chosenBook: string, place: Place & { toVerse?: number }) => {
    if (chosenBook === bookId) {
      arrive(place);
      jumpTo(place, place.toVerse ? () => lightArrival(passageKeys(place.chapter, place.verse, place.toVerse as number), ARRIVAL_LIT_MS) : undefined);
      return;
    }
    leave();
    leavingRef.current = true;
    const here = placeRef.current ?? { chapter: currentChapter, verse: 1 };
    onOpenBook(bookSlug(chosenBook), place, { slug: bookSlug(bookId), chapter: here.chapter, verse: here.verse, bible });
  }, [arrive, bible, bookId, currentChapter, jumpTo, leave, lightArrival, onOpenBook]);

  // A verse chosen on the minimap — pointed at and pressed, its place said under the pointer — is a move to a place
  // (the owner, 2026-10-27); a drag along the map is reading.
  const jumpFromMap = useCallback((place: Place, then?: () => void) => {
    arrive(place);
    jumpTo(place, then);
  }, [arrive, jumpTo]);
  const trail = useReaderTrail({ bible, locale, wide, here: { book: bookId, chapter: currentChapter, verse: currentVerse, bible }, seen, openPlace });

  // A cross reference opened. In this book: a jump that leaves the way back to the verse it was opened
  // from ("← Ис 19:1"). In another: a new history entry, as any other book, whose way back is that
  // verse. Either way the passage is lit on arrival.
  const lightReference = useCallback((reference: CrossReference) => {
    lightArrival(passageKeys(reference.chapter, reference.fromVerse, reference.toVerse), ARRIVAL_LIT_MS);
  }, [lightArrival]);
  const openElsewhere = useCallback((reference: CrossReference, origin: Place) => {
    leave();
    leavingRef.current = true;
    onOpenBook(
      bookSlug(reference.book),
      { chapter: reference.chapter, verse: reference.fromVerse, toVerse: reference.toVerse },
      { slug: bookSlug(bookId), chapter: origin.chapter, verse: origin.verse, bible }
    );
  }, [bible, bookId, leave, onOpenBook]);
  const followReference = useCrossReferenceTravel({ bookId, jumpTo, light: lightReference, openElsewhere, arrive, keepWayBack: setReturnTo });
  const openReference = useFollowAfterClose(Boolean(crossRefs.openAt), closeCrossRefs, followReference);

  // The same place in another Bible: this one is written down first, and the page opens the book
  // in the other Bible, which finds it there.
  const changeBible = useCallback((next: BibleId) => {
    flushPlaceRef.current();
    leavingRef.current = true;
    changeTranslationOnTrail(bookId);
    onChangeBible(next);
  }, [bookId, onChangeBible]);

  const openInBible = useFollowAfterClose(Boolean(marks.elsewhere.at), marks.elsewhere.close, changeBible);
  // A row of the person's list leaves the Bible for that note or sermon: the window closes first, so the
  // place read is written down from the page, not from a page pinned under a window (iOS). The line along
  // the top says at once that the app is going there; the next screen takes it away, and if the app has not
  // left within ten seconds (the way was cancelled) it goes by itself.
  const [leaving, setLeaving] = useState(false);
  const goToScreen = useCallback((href: string) => {
    setLeaving(true);
    router.push(href);
  }, [router]);
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => setLeaving(false), LEAVING_GIVES_UP_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const openMineEntry = useFollowAfterClose(Boolean(mine.openAt), mine.close, goToScreen);

  // THE WAY BACK goes left along the trail of places, one link at a time (the owner, 2026-10-20: a swap
  // between the last two places never reached the third). The light steps onto that link first, so its
  // place, however long ago it was added, arrives there instead of joining the end. On the first link,
  // a Bible opened from a screen of the app (a note's reference) goes back to that screen.
  // A link followed within the same chapter comes first: its way back is the very verse ("← Ис 19:1"),
  // while the person stays in that chapter — the minimap or a scroll that takes them elsewhere forgets it.
  useEffect(() => {
    if (returnTo && returnTo.chapter !== currentChapter) setReturnTo(null);
  }, [currentChapter, returnTo]);
  const trailBack = trail.back;
  const backLabel = trailBack?.kind === 'screen' ? t(`bible.wayBack.${wayBackKind(trailBack.screen)}`) : trailBack?.label ?? null;
  const wayBackLabel = (returnTo ? placeLabel(returnTo) : null) ?? backLabel;
  const frame = readerFrame(wide);
  const goBack = () => {
    if (returnTo) {
      arrive(returnTo);
      jumpTo(returnTo);
      return;
    }
    // The light steps back first; leaving then adds where the person stopped without moving it.
    if (trailBack?.kind === 'link') stepOnTrail(trailBack.index);
    leave();
    if (trailBack?.kind === 'screen') {
      leavingRef.current = true;
      router.push(trailBack.screen);
    } else if (trailBack) {
      openPlace(trailBack.book, trailBack.place);
    }
  };

  useShellHeader(!wide ? (
    <PhoneHeader
      wayBack={shortWayBack(returnTo, trailBack, bookId, backLabel)}
      onWayBack={goBack}
      trailButton={trail.phoneButton}
      bookId={bookId}
      bible={bible}
      currentChapter={currentChapter}
      currentVerse={currentVerse}
      text={text}
      locale={locale}
      onOpen={openPlace}
    />
  ) : null, `${abbrev} ${currentChapter}:${currentVerse}`);

  return (
    // With the minimap the reader holds its panes and the page itself stands still (`data-reader-panes`, globals.css).
    <div
      ref={readerRef}
      data-reader-panes={wide ? '' : undefined}
      className={`mx-auto w-full ${trail.readerWidth} ${frame.root}`}
      style={{ '--reading-top': `${readingInset}px` } as CSSProperties}
    >
      {wide ? (
        <BookLine
          lineRef={setHeaderRef}
          wayBack={wayBackLabel}
          onWayBack={goBack}
          trailButton={trail.inLine}
          tools={marks.tools}
          translationClass={marks.translationClass}
          bookId={bookId}
          bible={bible}
          currentChapter={currentChapter}
          currentVerse={currentVerse}
          text={text}
          locale={locale}
          onOpen={openPlace}
          onChangeBible={changeBible}
        />
      ) : null}
      {trail.underLine}

      <LoadNotice status={state.status} onRetry={() => setAttempt((value) => value + 1)} />
      {marks.syncStatus}

      <div className={`flex items-start gap-5 ${frame.row}`}>
        {/* The trail as a column, on a screen with room for it: the reader has widened left by it. */}
        {trail.beside}
        <div ref={setPane} tabIndex={frame.paneTabIndex} className={frame.pane}>
          {text && layout ? (
            // Where marks can be made the text answers a pull along the line and still scrolls up and down
            // (`marks.textClass`, set once); a tool in hand keeps the page's own swipe back off it
            // (`data-gesture-ignore`, navigation/gestures). A finger's hold opens a verse's menu, never the
            // system's selection: on a touch screen the words are not selected.
            <VerseHoldSurface
              copy={verseCopy}
              articleRef={textRef}
              gestureIgnore={marks.gestureIgnore}
              penSurface={marks.penSurface}
              className={`isolate min-w-0 bg-white dark:bg-gray-900 [-webkit-touch-callout:none] [@media(hover:none)]:select-none ${frame.card} ${marks.textClass}`}
            >
              <BookRibbon text={text} lang={BIBLES[bible].language} chapterWord={chapterWord} crossRefs={ribbonCrossRefs} signs={ribbonSigns} mine={ribbonMine} boxes={chapterWindow.boxes} />
              <BookEnd bookId={bookId} bible={bible} locale={locale} wide={wide} onOpen={(chosen) => openPlace(chosen, { chapter: 1, verse: 1 })} />
            </VerseHoldSurface>
          ) : null}
        </div>
        {wide && text && layout ? (
          <aside className="shrink-0 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
            <BibleMinimap
              layout={layout}
              textRef={textRef}
              chapterLabel={chapterWord}
              placeLabel={placeLabel}
              readingLabel={readingLabel}
              title={t('bible.minimap')}
              surface={surface}
              readingInset={readingInset}
              drawn={drawnSpan}
              marks={mine.mapMarks}
              onJump={jumpFromMap}
            />
          </aside>
        ) : null}
      </div>

      {trail.drawer}

      <CrossReferenceSheet
        at={crossRefs.openAt}
        bookId={bookId}
        bible={bible}
        locale={locale}
        set={crossRefs.set}
        verseText={crossRefs.verseText}
        onClose={crossRefs.close}
        onOpenReference={openReference}
      />
      {leaving ? <LeavingBar /> : null}
      <MineSheet
        at={mine.openAt}
        bookId={bookId}
        locale={locale}
        chapterWord={chapterWord}
        verseText={mine.openAt?.verse && text ? verseWords(text.chapters[mine.openAt.chapter - 1]?.[mine.openAt.verse - 1] ?? '') : undefined}
        listed={mine.listed}
        onClose={mine.close}
        onOpenEntry={openMineEntry}
      />
      <MarkedElsewhereSheet
        at={marks.elsewhere.at}
        bookId={bookId}
        locale={locale}
        entries={marks.elsewhere.entries}
        onClose={marks.elsewhere.close}
        onOpenBible={openInBible}
      />
      <VerseMenu copy={verseCopy} />
      <VerseCopyBar copy={verseCopy} wide={wide} />
      {/* While verses are chosen their bar stands where the tools are: the tools wait. */}
      {verseCopy.picking ? null : wide ? (
        <FloatingTextScaleControls>
          {marks.legend}
          <BibleSettingsLink />
        </FloatingTextScaleControls>
      ) : (
        <PhoneReaderTools tool={marks.phoneTool}>
          {(returnFocusRef) => <>
            {marks.legend}
            <TranslationPicker bible={bible} wide={false} onPick={changeBible} returnFocusRef={returnFocusRef} />
            <BibleSettingsLink />
          </>}
        </PhoneReaderTools>
      )}
    </div>
  );
}
