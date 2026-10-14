'use client';

import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { getLocalizedAbbrev, getLocalizedBookName, type BibleLocale } from '@/(pages)/(private)/studies/bibleData';
import { useModalLayer } from '@/hooks/useModalLayer';
import { BIBLE_IDS, BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, verseWords, type BookText } from '@/utils/bibleText';
import { chapterCount } from '@/utils/versification';

import { booksOf } from './bookOrder';
import { placeFromReference, type GoToPlace } from './goTo';


type Place = { chapter: number; verse: number };

/** Room kept between a window and the edges of the screen. */
const GUTTER = 16;
/** The narrowest a window shaped by its content gets: the line under the grid stays readable. */
const FIT_MIN_WIDTH = 380;
/** Ten to a row at most; a short book's row is as long as the book. */
const PER_ROW = 10;
const SNIPPET_LENGTH = 120;

const snippet = (words: string) => (words.length > SNIPPET_LENGTH ? `${words.slice(0, SNIPPET_LENGTH - 2).trim()}…` : words);
const firstWordsOf = (text: BookText | null, chapter: number) => {
  const raw = text?.chapters[chapter - 1]?.[0];
  return raw ? snippet(verseWords(raw)) : null;
};

type PickerWindowProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Which edge of the button the window lines up with on a computer. */
  align: 'start' | 'end';
  /** A fixed width on a computer; without it the window is as wide as what it holds. */
  width?: number;
  /** A computer: a window under its button. A phone: a sheet that rises from the bottom edge. */
  wide: boolean;
  label: string;
  children: ReactNode;
};

/**
 * A window of the reader's pickers: a modal layer like every window here (`.howto/open-a-modal.md`) —
 * portalled, the page held still, Escape and a press beside it close it.
 */
function PickerWindow({ open, onClose, anchorRef, align, width, wide, label, children }: PickerWindowProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  // Measured once, BEFORE the page is held still — this effect is declared above the modal layer,
  // and React runs a component's layout effects in order. Holding the page makes the body a scroll
  // box of its own, and a button in a sticky line (the reader's) drops back to its place at the top
  // of the book: measured after the hold, the window went off the screen with it. For the same
  // reason a resize does not measure again.
  useLayoutEffect(() => {
    if (open && wide) setAnchor(anchorRef.current?.getBoundingClientRect() ?? null);
  }, [anchorRef, open, wide]);
  const layer = useModalLayer({ onClose, active: open });

  if (!open || typeof document === 'undefined') return null;

  let placed: CSSProperties | undefined;
  if (wide && anchor) {
    const room = window.innerWidth - GUTTER * 2;
    const top = anchor.bottom + 8;
    placed = {
      top,
      maxWidth: room,
      maxHeight: Math.max(240, window.innerHeight - top - GUTTER),
      ...(width ? { width: Math.min(width, room) } : { width: 'max-content', minWidth: Math.min(FIT_MIN_WIDTH, room) }),
      ...(align === 'end'
        ? { right: Math.max(GUTTER, window.innerWidth - anchor.right) }
        : { left: Math.min(Math.max(GUTTER, anchor.left), window.innerWidth - GUTTER - Math.min(width ?? FIT_MIN_WIDTH, room)) }),
    };
  }

  return createPortal(
    <div {...layer} className="fixed inset-0 z-[100]">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('bible.closePicker')}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-gray-950/30 dark:bg-gray-950/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={placed}
        className={wide
          ? 'absolute overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5 dark:border-gray-700 dark:bg-gray-900'
          : 'absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-gray-200 bg-white px-4 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5 shadow-2xl dark:border-gray-700 dark:bg-gray-900'}
      >
        {wide ? null : <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />}
        {children}
      </div>
    </div>,
    document.body
  );
}

type ChapterGridProps = {
  count: number;
  /** The chapter the person is in, when this grid is of the book open now. */
  current?: number;
  chapterLabel: (chapter: number) => string;
  onPick: (chapter: number) => void;
  /** A computer only: the chapter under the pointer or the keyboard, for the line under the grid. */
  onPoint?: (chapter: number) => void;
  wide: boolean;
};

/** Ten to a row: a row is a ten, so chapter 37 is the seventh of the fourth row. */
function ChapterGrid({ count, current, chapterLabel, onPick, onPoint, wide }: ChapterGridProps) {
  return (
    <div
      className={`grid ${wide ? 'gap-1.5' : 'grid-cols-10 gap-1'}`}
      style={wide ? { gridTemplateColumns: `repeat(${Math.min(count, PER_ROW)}, 2.75rem)` } : undefined}
    >
      {Array.from({ length: count }, (_, index) => {
        const chapter = index + 1;
        const isCurrent = chapter === current;
        return (
          <button
            key={chapter}
            type="button"
            autoFocus={isCurrent || (current === undefined && chapter === 1)}
            aria-label={chapterLabel(chapter)}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onPick(chapter)}
            onMouseEnter={onPoint ? () => onPoint(chapter) : undefined}
            // A key that brought the focus here, not the focus the window gives on opening.
            onKeyUp={onPoint ? () => onPoint(chapter) : undefined}
            className={`${wide ? 'h-10' : 'h-11'} rounded-[10px] border text-[15px] font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isCurrent
              ? 'border-indigo-400 bg-indigo-600 text-white'
              : 'border-gray-200 bg-gray-50 text-gray-800 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-800 dark:border-gray-700/80 dark:bg-gray-950 dark:text-gray-100 dark:hover:border-indigo-400 dark:hover:bg-indigo-950 dark:hover:text-indigo-100'}`}
          >
            {chapter}
          </button>
        );
      })}
    </div>
  );
}

/** The line under a grid: how the pointed chapter begins, or what to do. */
function PointedLine({ text }: { text: string }) {
  // As wide as the grid above it, never wider: `w-0 min-w-full` keeps the line out of the window's own width.
  return <p className="mt-3 min-h-[3.75rem] w-0 min-w-full text-[13px] leading-5 text-gray-500 dark:text-gray-400">{text}</p>;
}

const usePickerWords = () => {
  const { t } = useTranslation();
  return {
    t,
    chapterLabel: (bookId: string) => (chapter: number) => t(bookId === 'Psalms' ? 'bible.psalm' : 'bible.chapter', { number: chapter }),
    countLabel: (bookId: string, bible: BibleId) => {
      const count = chapterCount(bible, bookId);
      return t(bookId === 'Psalms' ? 'bible.psalmCount' : 'bible.chapterCount', { count });
    },
  };
};

const TRIGGER_OPEN = 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/60';
/** A trigger of a window shows a border only while its window is open. */
const triggerBorder = (open: boolean) => (open ? TRIGGER_OPEN : 'border-transparent');

type ChapterPickerProps = {
  bookId: string;
  bible: BibleId;
  bookName: string;
  current: number;
  /** The open book's text, for how a chapter begins. */
  text: BookText | null;
  wide: boolean;
  onPick: (chapter: number) => void;
};

/** "Chapter 12 ▾": every chapter of the book in one window. */
export function ChapterPicker({ bookId, bible, bookName, current, text, wide, onPick }: ChapterPickerProps) {
  const { t, chapterLabel, countLabel } = usePickerWords();
  const [open, setOpen] = useState(false);
  const [pointed, setPointed] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const label = chapterLabel(bookId);

  const close = () => {
    setOpen(false);
    setPointed(null);
    triggerRef.current?.focus();
  };
  const words = pointed ? firstWordsOf(text, pointed) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('bible.changeChapter', { chapter: label(current) })}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[15px] font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40 ${triggerBorder(open)}`}
      >
        {wide ? label(current) : t(bookId === 'Psalms' ? 'bible.psalmShort' : 'bible.chapterShort', { number: current })}
        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <PickerWindow open={open} onClose={close} anchorRef={triggerRef} align="start" wide={wide} label={t('bible.chooseChapter')}>
        <div className="mb-3 flex items-baseline gap-2.5">
          <span className="text-[17px] font-bold text-gray-900 dark:text-white">{bookName}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{countLabel(bookId, bible)}</span>
        </div>
        <ChapterGrid
          count={chapterCount(bible, bookId)}
          current={current}
          chapterLabel={label}
          wide={wide}
          onPick={(chapter) => { close(); onPick(chapter); }}
          onPoint={wide ? setPointed : undefined}
        />
        {wide ? (
          <PointedLine text={pointed && words ? t('bible.chapterStartsWith', { chapter: label(pointed), text: words }) : t('bible.chapterHint')} />
        ) : null}
      </PickerWindow>
    </>
  );
}

type BookChoicesProps = {
  bookId: string;
  bible: BibleId;
  locale: BibleLocale;
  wide: boolean;
  /** The open book takes the focus; not where the line above it does. */
  focusCurrent: boolean;
  onPick: (bookId: string) => void;
};

/** Every book, grouped as on the list of books; the open one is filled. */
function BookChoices({ bookId, bible, locale, wide, focusCurrent, onPick }: BookChoicesProps) {
  const { t } = useTranslation();
  // In the order the Bible being read prints them.
  const testaments = booksOf(bible).map((testament) => ({
    ...testament,
    title: t(testament.key === 'old' ? 'bible.oldTestament' : 'bible.newTestament'),
  }));
  return (
    <div className={`grid gap-6 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {testaments.map((testament) => (
        <section key={testament.key} aria-label={testament.title} className="flex flex-col gap-3.5">
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">{testament.title}</h2>
          {testament.groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t(`bible.groups.${group.key}`)}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {group.ids.map((id) => {
                  const isCurrent = id === bookId;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        autoFocus={focusCurrent && isCurrent}
                        aria-current={isCurrent ? 'true' : undefined}
                        onClick={() => onPick(id)}
                        className={`inline-flex ${wide ? 'min-h-9' : 'min-h-11'} items-center rounded-[10px] border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isCurrent
                          ? 'border-indigo-400 bg-indigo-600 text-white'
                          : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300'}`}
                      >
                        {getLocalizedBookName(id, locale)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * The reader's own numbering — the Synodal text's, as its headings show it — so it is spelled here,
 * like the reader's other labels, and not through the stored-reference formatter (which renumbers psalms).
 */
const placeName = (place: GoToPlace, locale: BibleLocale) =>
  `${getLocalizedBookName(place.bookId, locale)} ${place.chapter}${place.verse > 1 ? `:${place.verse}` : ''}`;

/** "John 3:16" in one line: the place it points to shows under it while typing; Enter opens it. */
function GoToLine({ bible, locale, wide, onGo }: { bible: BibleId; locale: BibleLocale; wide: boolean; onGo: (place: GoToPlace) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const typed = query.trim() !== '';
  const place = typed ? placeFromReference(query, bible) : null;
  const hint = !typed
    ? t('bible.goToHint')
    : place ? t('bible.goToTarget', { place: placeName(place, locale) }) : t('bible.goToNotFound');
  const hintTone = !typed
    ? 'text-gray-500 dark:text-gray-400'
    : place ? 'text-indigo-700 dark:text-indigo-300' : 'text-rose-700 dark:text-rose-300';

  return (
    // As wide as what the window holds below it, never wider: the hint must not widen a short book's window.
    <form className="mb-4 w-0 min-w-full" onSubmit={(event) => { event.preventDefault(); if (place) onGo(place); }}>
      <div className="flex gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-gray-300 bg-white px-3 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:border-gray-600 dark:bg-gray-950">
          <MagnifyingGlassIcon className="h-[18px] w-[18px] shrink-0 text-gray-400" aria-hidden="true" />
          <span className="sr-only">{t('bible.goToLabel')}</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // A computer: type at once. A phone: no keyboard over the list until the line is tapped.
            autoFocus={wide}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={t('bible.goToPlaceholder')}
            // 16px: a smaller field makes iOS zoom the page in on focus.
            className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-gray-500"
          />
        </label>
        <button
          type="submit"
          disabled={!place}
          className="min-h-11 shrink-0 rounded-xl border border-indigo-500 bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-default disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:border-gray-700 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
        >
          {t('bible.goTo')}
        </button>
      </div>
      <p aria-live="polite" className={`mt-2 text-[13px] leading-5 ${hintTone}`}>{hint}</p>
    </form>
  );
}

type NavigatorProps = {
  /** Where the window opens: every book, or the open book's chapters (the phone's bar at the bottom). */
  start: 'books' | 'chapters';
  bookId: string;
  bible: BibleId;
  currentChapter: number;
  /** The open book's text, for how its chapters begin. */
  text: BookText | null;
  locale: BibleLocale;
  wide: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpen: (bookId: string, place: Place) => void;
};

/**
 * One window for getting anywhere: a reference typed in one line, every book as on the list, and the
 * chapters of a book chosen there. A book of one chapter opens at once. Mounted only while open, so
 * each opening starts where its button says.
 */
function BookNavigator({ start, bookId, bible, currentChapter, text, locale, wide, anchorRef, onClose, onOpen }: NavigatorProps) {
  const { t, chapterLabel, countLabel } = usePickerWords();
  const [step, setStep] = useState<{ bookId: string; text: BookText | null } | null>(
    start === 'chapters' ? { bookId, text } : null
  );
  const [pointed, setPointed] = useState<number | null>(null);

  const pickBook = (chosen: string) => {
    if (chapterCount(bible, chosen) === 1) {
      onOpen(chosen, { chapter: 1, verse: 1 });
      return;
    }
    setPointed(null);
    setStep({ bookId: chosen, text: chosen === bookId ? text : null });
    if (chosen === bookId && text) return;
    // How each chapter begins: the book is on the device once the reader has warmed it.
    void fetchBookText(chosen, bible).then(
      (loaded) => setStep((now) => (now?.bookId === chosen ? { bookId: chosen, text: loaded } : now)),
      () => undefined
    );
  };

  const stepLabel = step ? chapterLabel(step.bookId) : null;
  const stepWords = step && pointed ? firstWordsOf(step.text, pointed) : null;

  return (
    <PickerWindow open onClose={onClose} anchorRef={anchorRef} align="start" width={step ? undefined : 780} wide={wide} label={step ? t('bible.chooseChapter') : t('bible.chooseBook')}>
      <GoToLine bible={bible} locale={locale} wide={wide} onGo={({ bookId: chosen, chapter, verse }) => onOpen(chosen, { chapter, verse })} />
      {step && stepLabel ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { setStep(null); setPointed(null); }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 dark:border-gray-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
            >
              <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
              {t('bible.allBooks')}
            </button>
            <span className="text-[17px] font-bold text-gray-900 dark:text-white">{getLocalizedBookName(step.bookId, locale)}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{countLabel(step.bookId, bible)}</span>
          </div>
          <div>
            <ChapterGrid
              count={chapterCount(bible, step.bookId)}
              current={step.bookId === bookId ? currentChapter : undefined}
              chapterLabel={stepLabel}
              wide={wide}
              onPick={(chapter) => onOpen(step.bookId, { chapter, verse: 1 })}
              onPoint={wide ? setPointed : undefined}
            />
          </div>
          {wide ? (
            <PointedLine text={pointed && stepWords ? t('bible.chapterStartsWith', { chapter: stepLabel(pointed), text: stepWords }) : t('bible.pickChapterOfBook')} />
          ) : null}
        </>
      ) : (
        <BookChoices bookId={bookId} bible={bible} locale={locale} wide={wide} focusCurrent={!wide} onPick={pickBook} />
      )}
    </PickerWindow>
  );
}

type BookPickerProps = {
  bookId: string;
  bible: BibleId;
  currentChapter: number;
  text: BookText | null;
  locale: BibleLocale;
  wide: boolean;
  onOpen: (bookId: string, place: Place) => void;
};

/** The book's name is the button: it opens the window of every book. */
export function BookPicker({ bookId, bible, currentChapter, text, locale, wide, onOpen }: BookPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const bookName = getLocalizedBookName(bookId, locale);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      {/* The pull to the left sits on the heading, not on the button: on the button it made the heading
          eight pixels narrower than its button, and the last word wrapped with room to spare. */}
      <h1 className="m-0 -ml-2 min-w-0 max-w-full">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('bible.changeBook', { book: bookName })}
          onClick={() => (open ? close() : setOpen(true))}
          className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border px-2 text-left text-lg font-extrabold tracking-tight text-gray-900 transition hover:bg-indigo-50 dark:text-white dark:hover:bg-indigo-950/40 ${triggerBorder(open)}`}
        >
          {/* Never cut: the longest names ("1 Фессалоникийцам", "Повторення Закону") wrap instead. */}
          <span className="min-w-0 break-words">{bookName}</span>
          <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </h1>
      {open ? (
        <BookNavigator
          start="books"
          bookId={bookId}
          bible={bible}
          currentChapter={currentChapter}
          text={text}
          locale={locale}
          wide={wide}
          anchorRef={triggerRef}
          onClose={close}
          onOpen={(chosen, place) => { close(); onOpen(chosen, place); }}
        />
      ) : null}
    </>
  );
}

/**
 * A phone, reading: "Gen 12 ▴" under the thumb once the line at the top has gone. It opens the same
 * window at this book's chapters; "All books" there leads to every book.
 */
export function ReadingPill({ bookId, bible, currentChapter, text, locale, onOpen }: Omit<BookPickerProps, 'wide'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const manyChapters = chapterCount(bible, bookId) > 1;
  const label = manyChapters ? `${getLocalizedAbbrev(bookId, locale)} ${currentChapter}` : getLocalizedBookName(bookId, locale);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('bible.navigate', { place: label })}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-12 items-center gap-2 rounded-full border border-gray-300 bg-white/90 pl-5 pr-4 text-base font-bold text-gray-900 shadow-lg shadow-gray-900/15 backdrop-blur-md transition dark:border-gray-600 dark:bg-gray-900/90 dark:text-white dark:shadow-black/40"
      >
        {label}
        <ChevronUpIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <BookNavigator
          start={manyChapters ? 'chapters' : 'books'}
          bookId={bookId}
          bible={bible}
          currentChapter={currentChapter}
          text={text}
          locale={locale}
          wide={false}
          anchorRef={triggerRef}
          onClose={close}
          onOpen={(chosen, place) => { close(); onOpen(chosen, place); }}
        />
      ) : null}
    </>
  );
}

/**
 * The Bible being read, at the right edge of the book's line: every Bible the app has, named in its
 * own language. Choosing one reads the same place in it.
 */
export function TranslationPicker({ bible, wide, onPick }: { bible: BibleId; wide: boolean; onPick: (bible: BibleId) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const name = (id: BibleId) => t(`bible.translations.${id}.name`);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('bible.changeTranslation', { translation: name(bible) })}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-sm text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white ${triggerBorder(open)}`}
      >
        <span lang={BIBLES[bible].language}>{name(bible)}</span>
        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <PickerWindow open={open} onClose={close} anchorRef={triggerRef} align="end" width={320} wide={wide} label={t('bible.chooseTranslation')}>
        <ul className="flex flex-col gap-1">
          {BIBLE_IDS.map((id) => {
            const isCurrent = id === bible;
            return (
              <li key={id}>
                <button
                  type="button"
                  autoFocus={isCurrent}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => { close(); if (!isCurrent) onPick(id); }}
                  className={`flex min-h-14 w-full items-center justify-between gap-4 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isCurrent
                    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/60 dark:bg-indigo-950/50'
                    : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  <span lang={BIBLES[id].language} className="flex flex-col">
                    <span className="text-[15px] font-semibold text-gray-900 dark:text-white">{name(id)}</span>
                    <span className="text-[13px] text-gray-500 dark:text-gray-400">{t(`bible.translations.${id}.language`)}</span>
                  </span>
                  {isCurrent ? <CheckIcon className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PickerWindow>
    </>
  );
}
