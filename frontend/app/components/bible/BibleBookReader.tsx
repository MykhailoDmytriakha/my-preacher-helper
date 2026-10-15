'use client';

import { useRouter } from 'next/navigation';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { STICKY_PANEL_GAP_PX, useStickyOffsets } from '@/hooks/useStickyOffsets';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { wayBackKind } from '@/utils/bibleLink';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { bookIdFromSlug, bookSlug, fetchBookText, parseVerse, type BookText, type VerseSegment } from '@/utils/bibleText';
import { placeIn, placesIn } from '@/utils/versification';

import { BibleMinimap, visibleVerseRange } from './BibleMinimap';
import { BookPicker, ChapterPicker, ReadingPill, TranslationPicker } from './BiblePicker';
import { bookSequence, booksOf } from './bookOrder';
import { currentEntryId, placeInBook, readEntryArrival, readEntryFrom, readEntryPlace, saveEntryArrival, saveEntryPlace, saveLastPlace, type LastPlace } from './lastPlace';
import { buildMinimapLayout } from './minimapLayout';

import type { AppLocale } from '@/utils/appLocale';

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
  /** Another book, at a place of `bible`: a new history entry that remembers the place it was opened from. */
  onOpenBook: (slug: string, place: Place, from: LastPlace) => void;
  /** Another Bible: the page reads the same place in it. */
  onChangeBible: (bible: BibleId) => void;
};

type LoadState = { status: 'loading' } | { status: 'ready'; text: BookText } | { status: 'error' };

function Segment({ segment }: { segment: Extract<VerseSegment, { kind: 'text' }> }) {
  const className = [
    segment.added ? 'italic text-gray-500 dark:text-gray-400' : '',
    segment.jesus ? 'text-rose-800 dark:text-rose-300' : '',
  ].filter(Boolean).join(' ');
  return className ? <span className={className}>{segment.text}</span> : <>{segment.text}</>;
}

/**
 * A verse a link came to is lit at once (`data-arrival="on"`) and, the attribute taken away, fades
 * back to the page on its own. The light is one layer under the text (`::before`, below the text
 * card's own layer — the card is `isolate`), 6 px wider than the verse on every side, so it moves
 * no line. One layer, not a background plus a ring: rows stand on fractional pixels, and the two
 * edges, each smoothed on its own, left a light line between lit verses. The colour is solid, the
 * indigo tint already mixed into the card: the layers of a passage overlap, and a see-through tint
 * darkens where they meet. Lit verses standing together are one block — only the first rounds its
 * top corners and only the last its bottom ones, so the edges run straight.
 */
const ARRIVAL_CLASSES = [
  'relative before:pointer-events-none before:absolute before:-inset-1.5 before:-z-10 before:rounded-lg',
  '[[data-arrival]+&]:before:rounded-t-none [&:has(+[data-arrival])]:before:rounded-b-none',
  'before:transition-[background-color] before:duration-[3600ms] before:ease-out data-[arrival=on]:before:duration-0',
  'data-[arrival=on]:before:bg-[#e8e8fd] dark:data-[arrival=on]:before:bg-[#272f51]',
].join(' ');
/** How long the verse stays lit before it starts to fade (the owner, 2026-10-15: five seconds). */
const ARRIVAL_LIT_MS = 5000;
const ARRIVAL_ATTRIBUTE = 'data-arrival';
const ARRIVAL_FADE_MS = 3600;

function VerseRow({ chapter, verse, raw, lang }: { chapter: number; verse: number; raw: string; lang: string }) {
  const { opensParagraph, segments } = parseVerse(raw);
  return (
    // A verse jumped to stands where "the verse I am at" is measured from: the same `--reading-top`.
    <div data-verse={`${chapter}:${verse}`} style={{ scrollMarginTop: 'var(--reading-top)' }} className={`flex gap-3 ${ARRIVAL_CLASSES} ${opensParagraph && verse > 1 ? 'mt-2' : ''}`}>
      <span className="w-7 shrink-0 select-none pt-[0.35rem] text-right text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500">
        {verse}
      </span>
      {/* The text is in its Bible's language whatever the interface speaks: a screen reader reads it so. */}
      <p lang={lang} className="min-w-0 flex-1 font-serif text-[1.1875rem] leading-[1.65] text-gray-800 dark:text-gray-100">
        {segments.map((segment, index) =>
          segment.kind === 'break' ? <br key={index} /> : <Fragment key={index}><Segment segment={segment} /></Fragment>
        )}
      </p>
    </div>
  );
}

/** The whole book as one ribbon: chapters follow each other with only a thin line between them. */
const BookRibbon = memo(function BookRibbon({ text, lang, chapterWord }: { text: BookText; lang: string; chapterWord: (chapter: number) => string }) {
  return (
    <>
      {text.chapters.map((verses, chapterIndex) => {
        const chapter = chapterIndex + 1;
        return (
          // The room above a chapter is a margin, outside the section: a jump puts the heading at the
          // reading top and the last verse of the chapter before stays above it, not counted as the place.
          <section key={chapter} aria-label={chapterWord(chapter)} data-chapter={chapter} style={{ scrollMarginTop: 'var(--reading-top)' }} className={chapterIndex === 0 ? '' : 'mt-6'}>
            <div className="flex items-center gap-3 pb-2 pl-10">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">{chapterWord(chapter)}</h2>
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
            </div>
            {verses.map((raw, verseIndex) => (
              <VerseRow key={verseIndex} chapter={chapter} verse={verseIndex + 1} raw={raw} lang={lang} />
            ))}
          </section>
        );
      })}
    </>
  );
});

/** "← Rom 5": back to the place in the book this one was opened from. */
function WayBack({ label, floating, onClick }: { label: string; floating: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('bible.backToLabel', { place: label })}
      className={floating
        ? 'pointer-events-auto inline-flex min-h-12 shrink-0 items-center rounded-full border border-gray-300 bg-white/90 px-4 text-sm font-semibold text-indigo-700 shadow-lg shadow-gray-900/15 backdrop-blur-md dark:border-gray-600 dark:bg-gray-900/90 dark:text-indigo-300 dark:shadow-black/40'
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
function ChapterControl({ bookId, bible, locale, current, verse, text, wide, onPick }: {
  bookId: string; bible: BibleId; locale: AppLocale; current: number; verse: number; text: BookText; wide: boolean; onPick: (chapter: number) => void;
}) {
  const { t } = useTranslation();
  if (text.chapters.length === 1) {
    return (
      <span aria-label={t('bible.placeVerse', { chapter: t('bible.oneChapter'), verse })} className="shrink-0 px-2.5 text-[15px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
        {current}:{verse}
      </span>
    );
  }
  return <ChapterPicker bookId={bookId} bible={bible} bookName={getLocalizedBookName(bookId, locale)} current={current} verse={verse} text={text} wide={wide} onPick={onPick} />;
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

/** A phone, reading: the way back and the book's pill under the thumb. Nothing when neither is due. */
function PhoneBar({ wayBack, onWayBack, showPill, bookId, bible, currentChapter, currentVerse, text, locale, onOpen }: {
  wayBack: string | null; onWayBack: () => void; showPill: boolean;
  bookId: string; bible: BibleId; currentChapter: number; currentVerse: number; text: BookText; locale: AppLocale; onOpen: (bookId: string, place: Place) => void;
}) {
  if (!wayBack && !showPill) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-center gap-2">
      {wayBack ? <WayBack label={wayBack} floating onClick={onWayBack} /> : null}
      {showPill ? (
        <span className="pointer-events-auto">
          <ReadingPill bookId={bookId} bible={bible} currentChapter={currentChapter} currentVerse={currentVerse} text={text} locale={locale} onOpen={onOpen} />
        </span>
      ) : null}
    </div>
  );
}

/** The way back, in the Bible being read even when the place was left in another one. */
function wayBackPlace(from: LastPlace | null, bookId: string | undefined, bible: BibleId): Place | null {
  if (!from || !bookId) return null;
  if (from.bible === bible) return { chapter: from.chapter, verse: from.verse };
  return placeIn(bible, from.bible, { book: bookId, chapter: from.chapter, verse: from.verse });
}

/**
 * The room the page needs under the book for its last verse to stand at the reading top, and no
 * more. A pixel over: measured in fractions of a pixel, the last verse stopped a hair short of the
 * top and the verse above it stayed the place.
 */
export function roomBelow(lastVerseTop: number, readingTop: number, viewportHeight: number, pageHeight: number): number {
  return Math.max(0, Math.ceil(lastVerseTop - readingTop + viewportHeight - pageHeight) + 1);
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
  const [from, setFrom] = useState<LastPlace | null>(null);
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [rowGone, setRowGone] = useState(false);
  const textRef = useRef<HTMLElement | null>(null);
  const entryRef = useRef<string | null>(null);
  const placeRef = useRef<Place | null>(null);

  useEffect(() => {
    entryRef.current = currentEntryId();
    setFrom(readEntryFrom());
  }, []);

  // THE TOP OF THE READING AREA, measured: under the app's nav, and on a computer under the book's
  // own line too, which sticks there. "The verse I am at" is read from here and a verse jumped to is
  // put here — one number for both: with the jump lower than the reading, the verse above showed a
  // strip and counted as the place, so every Back landed a verse higher.
  const { setHeaderRef, navHeight, belowHeader } = useStickyOffsets();
  const readingTop = (wide ? belowHeader : navHeight) + STICKY_PANEL_GAP_PX;
  const readingTopRef = useRef(readingTop);
  readingTopRef.current = readingTop;
  const setRowRef = useCallback((element: HTMLElement | null) => {
    setHeaderRef(element);
    setRow(element);
  }, [setHeaderRef]);

  const isPsalms = bookId === 'Psalms';
  const chapterWord = useCallback(
    (chapter: number) => t(isPsalms ? 'bible.psalm' : 'bible.chapter', { number: chapter }),
    [isPsalms, t]
  );
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const placeLabel = useCallback(({ chapter, verse }: Place) => `${abbrev} ${chapter}:${verse}`, [abbrev]);

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
  const layout = useMemo(() => (text ? buildMinimapLayout(text.chapters) : null), [text]);

  // A chapter opens at its heading, so "Chapter 12" shows above its first verse; any other verse
  // at the verse itself. A verse the chapter does not have opens the chapter.
  // The verse jumped to is the place until the page moves from where the jump left it: a verse near
  // the end of a book cannot reach the top, and the verse that does is not where the person is.
  const broughtRef = useRef<{ place: Place; scrollY: number } | null>(null);
  const jumpTo = useCallback(({ chapter, verse }: Place) => {
    const root = textRef.current;
    const row = verse > 1 ? root?.querySelector<HTMLElement>(`[data-verse="${chapter}:${verse}"]`) : null;
    const target = row ?? root?.querySelector<HTMLElement>(`[data-chapter="${chapter}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    broughtRef.current = { place: { chapter, verse: row ? verse : 1 }, scrollY: window.scrollY };
  }, []);

  // ROOM UNDER THE BOOK: the page scrolls on until the last verse stands at the reading top, and no
  // further — so a verse near the end (Rom 16:21) comes to the top like any other (the owner, 2026-10-15).
  // The room is the text card's bottom margin: the minimap sticks inside the row it shares with the
  // card, and only within that row's content — a block below the row, or the row's own padding, let
  // the row end with the text and pushed the minimap up under the nav (live, 326 px).
  const fitRoom = useCallback(() => {
    const article = textRef.current;
    const rows = article?.querySelectorAll<HTMLElement>('[data-verse]');
    const last = rows?.[rows.length - 1];
    if (!article || !last) return;
    // The page's own height, without the room: a page shorter than the window measures as the window
    // (`scrollHeight` never goes below it), so it is measured with a room of a window at least, and
    // that room taken off. Never less than the room there is, so a page read at its end does not
    // shrink under the reader and lose the place. Both writes land before the next paint.
    const probe = Math.max(parseFloat(article.style.marginBottom) || 0, window.innerHeight);
    article.style.marginBottom = `${probe}px`;
    const pageHeight = document.documentElement.scrollHeight - probe;
    const lastTop = last.getBoundingClientRect().top + window.scrollY;
    article.style.marginBottom = `${roomBelow(lastTop, readingTopRef.current, window.innerHeight, pageHeight)}px`;
  }, []);

  // THE VERSE A LINK CAME TO: lit at once, then fading back on its own — near the end of a book it
  // cannot be told by where it stands. The light belongs to the arrival, not to the text it was put
  // on, and lasts its own time: the passage drawn again within it — in another Bible, as on a new
  // device, where the interface's language, and the Bible with it, arrives a moment after the first
  // text; or by Back or a reload in those seconds — is lit for the time left (the arrival is kept
  // with the history entry: `saveEntryArrival`). After it, Back and a reload bring the place unlit.
  const arrivalTimersRef = useRef<number[]>([]);
  const litRowsRef = useRef<HTMLElement[]>([]);
  const lightArrival = useCallback((rows: HTMLElement[], litMs: number) => {
    arrivalTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    // A new passage takes the light from the one before: that one's timers are gone, so its light goes too.
    litRowsRef.current.forEach((row) => { if (!rows.includes(row)) row.removeAttribute(ARRIVAL_ATTRIBUTE); });
    litRowsRef.current = rows;
    rows.forEach((row) => row.setAttribute(ARRIVAL_ATTRIBUTE, 'on'));
    arrivalTimersRef.current = [
      window.setTimeout(() => rows.forEach((row) => row.setAttribute(ARRIVAL_ATTRIBUTE, 'off')), litMs),
      window.setTimeout(() => rows.forEach((row) => row.removeAttribute(ARRIVAL_ATTRIBUTE)), litMs + ARRIVAL_FADE_MS),
    ];
  }, []);
  useEffect(() => () => arrivalTimersRef.current.forEach((timer) => window.clearTimeout(timer)), []);

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
    // The room first: without it a verse near the end of the book cannot come to the top.
    fitRoom();
    if (target) jumpTo(target);
    else window.scrollTo({ top: 0 });
    // The passage the link named, each verse found in this Bible: "Rom 12:1-2" lights both.
    const link = `${bookId} ${initialBible} ${startChapter}:${startVerse}-${passageEnd}`;
    if (linked && passageEnd) saveEntryArrival({ link, litUntil: Date.now() + ARRIVAL_LIT_MS });
    const arrival = passageEnd ? readEntryArrival() : null;
    const litMs = arrival?.link === link ? arrival.litUntil - Date.now() : 0;
    if (litMs > 0 && passageEnd && startChapter && startVerse) {
      const last = Math.min(Math.max(passageEnd, startVerse), startVerse + 200);
      const keys = new Set<string>();
      for (let verse = startVerse; verse <= last; verse += 1) {
        placesIn(bible, initialBible, { book: bookId, chapter: startChapter, verse }).forEach((found) => keys.add(`${found.chapter}:${found.verse}`));
      }
      const rows = Array.from(keys, (key) => textRef.current?.querySelector<HTMLElement>(`[data-verse="${key}"]`)).filter((row): row is HTMLElement => Boolean(row));
      lightArrival(rows, litMs);
    }
  }, [bible, bookId, fitRoom, initialBible, jumpTo, lightArrival, passageEnd, startChapter, startVerse, text]);

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
      atEnd = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1;
    };
    const onResize = () => {
      const keepEnd = atEnd;
      fitRoom();
      if (keepEnd) window.scrollTo({ top: document.documentElement.scrollHeight - window.innerHeight });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [fitRoom, readingTop, text]);

  // Remember where the person is ("Continue" on the list, Back to this entry, the way back from
  // another book) and keep the chapter button on the chapter. The place is read on every scroll (a
  // binary search, cheap); only the write waits, and a pending write is done on the way out —
  // leaving within the wait must not lose the place.
  const flushPlaceRef = useRef<() => void>(() => undefined);
  const leavingRef = useRef(false);
  useEffect(() => {
    if (!text) return;
    leavingRef.current = false;
    const rows = Array.from(textRef.current?.querySelectorAll<HTMLElement>('[data-verse]') ?? []);
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
      if (leavingRef.current) return;
      // Moved from where a jump left the page: from here the place is what the top shows.
      if (broughtRef.current && Math.abs(window.scrollY - broughtRef.current.scrollY) >= 1) broughtRef.current = null;
      const here = broughtRef.current?.place ?? visibleVerseRange(rows, readingTopRef.current, window.innerHeight)?.[0];
      if (here) {
        placeRef.current = here;
        setCurrentChapter(here.chapter);
        setCurrentVerse(here.verse);
      }
      if (timer === null) timer = window.setTimeout(store, 400);
    };
    flushPlaceRef.current = store;
    note();
    window.addEventListener('scroll', note, { passive: true });
    return () => {
      window.removeEventListener('scroll', note);
      if (timer !== null) store();
      flushPlaceRef.current = () => undefined;
    };
  }, [bible, bookId, text]);

  // A phone: once the book's line has scrolled away, a pill at the bottom holds the book and chapter.
  useEffect(() => {
    if (wide || !row || typeof IntersectionObserver === 'undefined') {
      setRowGone(false);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setRowGone(!entry.isIntersecting));
    observer.observe(row);
    return () => observer.disconnect();
  }, [row, wide]);

  // The same book: a jump within the ribbon. Another: a new history entry that carries this place
  // as its way back. The place is written first, and the scroll that follows is not taken for reading.
  const openPlace = useCallback((chosenBook: string, place: Place) => {
    if (chosenBook === bookId) {
      jumpTo(place);
      return;
    }
    flushPlaceRef.current();
    leavingRef.current = true;
    const here = placeRef.current ?? { chapter: currentChapter, verse: 1 };
    onOpenBook(bookSlug(chosenBook), place, { slug: bookSlug(bookId), chapter: here.chapter, verse: here.verse, bible });
  }, [bible, bookId, currentChapter, jumpTo, onOpenBook]);

  // The same place in another Bible: this one is written down first, and the page opens the book
  // in the other Bible, which finds it there.
  const changeBible = useCallback((next: BibleId) => {
    flushPlaceRef.current();
    leavingRef.current = true;
    onChangeBible(next);
  }, [onChangeBible]);

  const fromBookId = from ? bookIdFromSlug(from.slug) : undefined;
  const fromPlace = wayBackPlace(from, fromBookId, bible);
  const fromLabel = fromPlace && fromBookId ? `${getLocalizedAbbrev(fromBookId, locale)} ${fromPlace.chapter}` : null;
  // Back is a swap: from Genesis 3 back to Romans 5, and that entry offers Genesis 3 again.
  // Opened from a screen of the app (a note's reference) and no other book read since: back to it.
  const cameFromLabel = !fromLabel && cameFrom ? t(`bible.wayBack.${wayBackKind(cameFrom)}`) : null;
  const wayBackLabel = fromLabel ?? cameFromLabel;
  const goBack = () => {
    if (fromPlace && fromBookId) {
      openPlace(fromBookId, { chapter: fromPlace.chapter, verse: fromPlace.verse });
    } else if (cameFrom) {
      flushPlaceRef.current();
      leavingRef.current = true;
      router.push(cameFrom);
    }
  };

  return (
    <div className={`mx-auto w-full max-w-7xl ${wide ? '' : 'pb-24'}`} style={{ '--reading-top': `${readingTop}px` } as CSSProperties}>
      {/* THE BOOK'S LINE, from the start: the book and the chapter at the text's left edge, the
          translation at its right one. On a computer it
          sticks under the app's nav, so both buttons are at hand anywhere in the book; on a phone it
          stays at the top and a pill at the bottom takes over while reading. A long name wraps. */}
      <header
        ref={setRowRef}
        style={wide ? { top: navHeight } : undefined}
        className={`${wide ? 'sticky z-30 py-1.5' : 'relative py-1'} mb-3 flex flex-wrap items-center gap-x-1 gap-y-0.5 bg-white/90 backdrop-blur-md dark:bg-gray-900/90`}
      >
        {wide && wayBackLabel ? <WayBack label={wayBackLabel} floating={false} onClick={goBack} /> : null}
        <BookPicker bookId={bookId} bible={bible} currentChapter={currentChapter} text={text} locale={locale} wide={wide} onOpen={openPlace} />
        {text ? <ChapterControl bookId={bookId} bible={bible} locale={locale} current={currentChapter} verse={currentVerse} text={text} wide={wide} onPick={(chapter) => jumpTo({ chapter, verse: 1 })} /> : null}
        <span className="ml-auto">
          <TranslationPicker bible={bible} wide={wide} onPick={changeBible} />
        </span>
        {/* The gap under the stuck line shows a strip of the verse above the one read: it fades out
            instead of being cut by a hard edge. */}
        {wide ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-white/90 to-transparent dark:from-gray-900/90" />
        ) : null}
      </header>

      <LoadNotice status={state.status} onRetry={() => setAttempt((value) => value + 1)} />

      {text && layout ? (
        <div className="flex items-start gap-5">
          <article
            ref={textRef}
            className="isolate min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-5 sm:px-6 dark:border-gray-700 dark:bg-gray-900"
          >
            <BookRibbon text={text} lang={BIBLES[bible].language} chapterWord={chapterWord} />
            <BookEnd bookId={bookId} bible={bible} locale={locale} wide={wide} onOpen={(chosen) => openPlace(chosen, { chapter: 1, verse: 1 })} />
          </article>
          {wide ? (
            <aside style={{ top: readingTop }} className="sticky shrink-0 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
              <BibleMinimap
                layout={layout}
                textRef={textRef}
                chapterLabel={chapterWord}
                placeLabel={placeLabel}
                title={t('bible.minimap')}
                readingTop={readingTop}
                onJump={jumpTo}
              />
            </aside>
          ) : null}
        </div>
      ) : null}

      {!wide && text ? (
        <PhoneBar wayBack={wayBackLabel} onWayBack={goBack} showPill={rowGone} bookId={bookId} bible={bible} currentChapter={currentChapter} currentVerse={currentVerse} text={text} locale={locale} onOpen={openPlace} />
      ) : null}
    </div>
  );
}
