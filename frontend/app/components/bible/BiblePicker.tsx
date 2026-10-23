'use client';

import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useLongPress, type LongPressState } from '@/hooks/useLongPress';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useModalLayer } from '@/hooks/useModalLayer';
import { getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { BIBLE_IDS, BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, verseWords, type BookText } from '@/utils/bibleText';
import { chapterCount, verseCount } from '@/utils/versification';

import { booksOf } from './bookOrder';
import { BibleSearch } from './search/BibleSearch';

import type { AppLocale } from '@/utils/appLocale';


type Place = { chapter: number; verse: number; toVerse?: number };

/** Room kept between a window and the edges of the screen. */
const GUTTER = 16;
/** Room under its button a window takes before it looks above: a few rows of numbers and the line under them. */
const ROOM_UNDER = 320;
/** The narrowest a window shaped by its content gets: the line under the grid stays readable. */
const FIT_MIN_WIDTH = 380;
/** Ten to a row at most; a short book's row is as long as the book. */
const PER_ROW = 10;
/**
 * A computer's window of numbers is as wide as its row: tiles of 2.75rem with 0.375rem between, the window's
 * padding (1.25rem) and border on both sides — and no narrower than the line under the grid needs. Shaped by
 * its content alone, it was kept off the right edge as if 380 px wide, and verses, ten to a row almost
 * always, ran off an iPad (2026-10-23). Counted in the page's own rem: a larger font in the browser keeps
 * the row whole.
 */
function gridWindowWidth(columns: number): number {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.max(FIT_MIN_WIDTH, Math.ceil((columns * 2.75 + (columns - 1) * 0.375 + 2 * 1.25) * rem + 2));
}
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
  /** A phone's sheet as tall as the screen allows: a line typed in at its top stays above the keyboard. */
  tall?: boolean;
  label: string;
  children: ReactNode;
};

/**
 * A window of the reader's pickers: a modal layer like every window here (`.howto/open-a-modal.md`) —
 * portalled, the page held still, Escape and a press beside it close it, and Tab kept inside it: the
 * reader's buttons behind it are out of the keyboard's reach (Codex review, 2026-10-23 — Shift+Tab
 * from the search window opened the translation's window over it).
 */
function PickerWindow({ open, onClose, anchorRef, align, width, wide, tall = false, label, children }: PickerWindowProps) {
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panelRef, open);

  if (!open || typeof document === 'undefined') return null;

  let placed: CSSProperties | undefined;
  if (wide && anchor) {
    const room = window.innerWidth - GUTTER * 2;
    // Under its button while a window fits there; above it when the room is there instead — a book low on
    // the list of books: the page is held still, and a window running off the bottom could not be reached.
    const below = window.innerHeight - anchor.bottom - 8 - GUTTER;
    const above = anchor.top - 8 - GUTTER;
    const vertical: CSSProperties = below >= ROOM_UNDER || below >= above
      ? { top: anchor.bottom + 8, maxHeight: below }
      : { bottom: window.innerHeight - anchor.top + 8, maxHeight: above };
    placed = {
      ...vertical,
      maxWidth: room,
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={placed}
        className={wide
          ? 'absolute overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5 dark:border-gray-700 dark:bg-gray-900'
          : `absolute inset-x-0 bottom-0 ${tall ? 'h-[85dvh]' : 'max-h-[80dvh]'} overflow-y-auto rounded-t-3xl border-t border-gray-200 bg-white px-4 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5 shadow-2xl dark:border-gray-700 dark:bg-gray-900`}
      >
        {wide ? null : <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />}
        {children}
      </div>
    </div>,
    document.body
  );
}

/** A button that a hold fills from the bottom: half a second, then lifting does the long action (`useLongPress`). */
const HOLDABLE = 'relative overflow-hidden select-none touch-manipulation [-webkit-touch-callout:none]';

/** The fill of a held button and its text above it, white once the fill has risen past it. */
function HoldFill({ state }: { state: LongPressState }) {
  return <span aria-hidden="true" className={`absolute inset-x-0 bottom-0 bg-indigo-600 ${state === 'idle' ? 'h-0' : 'h-full transition-[height] duration-500 ease-linear'}`} />;
}
const heldText = (state: LongPressState) => (state === 'idle' ? 'relative' : 'relative text-white transition-colors delay-200');

const TILE_CURRENT = 'border-indigo-400 bg-indigo-600 text-white';
const TILE_OTHER = 'border-gray-200 bg-gray-50 text-gray-800 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-800 dark:border-gray-700/80 dark:bg-gray-950 dark:text-gray-100 dark:hover:border-indigo-400 dark:hover:bg-indigo-950 dark:hover:text-indigo-100';

/** A phone's tile is a tenth of the row: three digits (Psalm 118 has 176 verses) take a smaller size to fit. */
function tileClasses(number: number, current: boolean, wide: boolean): string {
  const size = number >= 100 && !wide ? 'text-[14px]' : 'text-[15px]';
  return `${HOLDABLE} ${wide ? 'h-10' : 'h-11'} rounded-[10px] border ${size} font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${current ? TILE_CURRENT : TILE_OTHER}`;
}

type NumberTileProps = {
  number: number;
  label: string;
  current: boolean;
  autoFocus: boolean;
  wide: boolean;
  onPick: (number: number) => void;
  onHold?: (number: number) => void;
  onPoint?: (number: number) => void;
};

function NumberTile({ number, label, current, autoFocus, wide, onPick, onHold, onPoint }: NumberTileProps) {
  const { state, handlers } = useLongPress({ onPress: () => onPick(number), onLongPress: onHold ? () => onHold(number) : undefined });
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      aria-label={label}
      aria-current={current ? 'true' : undefined}
      {...handlers}
      onMouseEnter={onPoint ? () => onPoint(number) : undefined}
      // A key that brought the focus here, not the focus the window gives on opening.
      onKeyUp={onPoint ? () => onPoint(number) : undefined}
      className={tileClasses(number, current, wide)}
    >
      <HoldFill state={state} />
      <span className={heldText(state)}>{number}</span>
    </button>
  );
}

type NumberGridProps = {
  count: number;
  /** The chapter or verse the person is at, when this grid is of the place open now. */
  current?: number;
  label: (number: number) => string;
  /** A press: the next step. */
  onPick: (number: number) => void;
  /** A hold: open at once (chapters; a verse is opened by a press). */
  onHold?: (number: number) => void;
  /** A computer only: the number under the pointer or the keyboard, for the line under the grid. */
  onPoint?: (number: number) => void;
  wide: boolean;
};

/** Ten to a row: a row is a ten, so chapter 37 is the seventh of the fourth row; verses the same. */
function NumberGrid({ count, current, label, onPick, onHold, onPoint, wide }: NumberGridProps) {
  return (
    <div
      className={`grid ${wide ? 'gap-1.5' : 'grid-cols-10 gap-1'}`}
      style={wide ? { gridTemplateColumns: `repeat(${Math.min(count, PER_ROW)}, 2.75rem)` } : undefined}
    >
      {Array.from({ length: count }, (_, index) => {
        const number = index + 1;
        return (
          <NumberTile
            key={number}
            number={number}
            label={label(number)}
            current={number === current}
            autoFocus={number === current || ((current === undefined || current > count) && number === 1)}
            wide={wide}
            onPick={onPick}
            onHold={onHold}
            onPoint={onPoint}
          />
        );
      })}
    </div>
  );
}

/** The line under a grid on a computer: what the pointed number holds, or what to do. */
function PointedLine({ text }: { text: string }) {
  // As wide as the grid above it, never wider: `w-0 min-w-full` keeps the line out of the window's own width.
  return <p className="mt-3 min-h-[3.75rem] w-0 min-w-full text-[13px] leading-5 text-gray-500 dark:text-gray-400">{text}</p>;
}

/** The one line that tells a phone what a hold does (the owner, 2026-10-23: «справочку добавить»). */
function HoldHint({ text }: { text: string }) {
  return <p className="mt-3 w-0 min-w-full text-[13px] leading-5 text-gray-500 dark:text-gray-400">{text}</p>;
}

const verseSnippet = (text: BookText | null, chapter: number, verse: number) => {
  const raw = text?.chapters[chapter - 1]?.[verse - 1];
  return raw ? snippet(verseWords(raw)) : null;
};

/** «‹ All books · Romans · 16 chapters»: the way back, where the window is, how many there are. */
function StepHead({ back, title, count }: { back: { label: string; onClick: () => void } | null; title: string; count: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      {back ? (
        <button
          type="button"
          onClick={back.onClick}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 dark:border-gray-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </button>
      ) : null}
      <span className="text-[17px] font-bold text-gray-900 dark:text-white">{title}</span>
      <span className="text-sm text-gray-500 dark:text-gray-400">{count}</span>
    </div>
  );
}

type PlaceStepsProps = {
  bookId: string;
  bible: BibleId;
  /** The book's text, for how a chapter begins and what a verse says. */
  text: BookText | null;
  locale: AppLocale;
  wide: boolean;
  /** Where the person reads, when it is in this book: that chapter and that verse are filled. */
  here?: { chapter: number; verse: number };
  /** The chapter whose verses show; null — the chapters. A book of one chapter is at its verses from the start. */
  chapter: number | null;
  onChapter: (chapter: number | null) => void;
  /** «All books» in front of the chapters (the book window); the chapter button's window has none. */
  onBooks?: () => void;
  onOpen: (place: Place) => void;
};

/**
 * BOOK → CHAPTER → VERSE, a press a step (the owner, 2026-10-23). A chapter pressed shows its verses; a
 * chapter held opens at its first verse, unlit; a verse pressed opens there and is lit, as a verse found
 * by the search is. So the verse is reached by a finger alone, and a reader of whole chapters still opens
 * one with one touch — held. Verse 1 opens the chapter from its start too: nothing is reachable only by a hold.
 */
function PlaceSteps(props: PlaceStepsProps) {
  return props.chapter === null ? <ChapterStep {...props} /> : <VerseStep {...props} chapter={props.chapter} />;
}

/** The chapters: a press shows the verses of one, a hold opens it at its first verse. */
function ChapterStep({ bookId, bible, text, locale, wide, here, onChapter, onBooks, onOpen }: PlaceStepsProps) {
  const { t, chapterLabel, countLabel } = usePickerWords();
  const [pointed, setPointed] = useState<number | null>(null);
  const label = chapterLabel(bookId);
  const words = pointed ? firstWordsOf(text, pointed) : null;
  const hint = t(bookId === 'Psalms' ? 'bible.holdPsalmHint' : 'bible.holdChapterHint');
  return (
    <>
      <StepHead back={onBooks ? { label: t('bible.allBooks'), onClick: onBooks } : null} title={getLocalizedBookName(bookId, locale)} count={countLabel(bookId, bible)} />
      <NumberGrid
        count={chapterCount(bible, bookId)}
        current={here?.chapter}
        label={label}
        wide={wide}
        onPick={onChapter}
        onHold={(held) => onOpen({ chapter: held, verse: 1 })}
        onPoint={wide ? setPointed : undefined}
      />
      {wide ? <PointedLine text={pointed && words ? t('bible.chapterStartsWith', { chapter: label(pointed), text: words }) : hint} /> : <HoldHint text={hint} />}
    </>
  );
}

/**
 * The verses of one chapter: a press opens there, lit. Back goes to the chapters, or to the books for a book
 * of one chapter. What a verse says shows under them for a pointer that can hover — a mouse, a trackpad —
 * never told to a finger: an iPad is wide, and «point at a number» there asked for what it cannot do.
 */
function VerseStep({ bookId, bible, text, locale, wide, here, chapter, onChapter, onBooks, onOpen }: PlaceStepsProps & { chapter: number }) {
  const { t } = usePickerWords();
  const canHover = useMediaQuery('(hover: hover)', true);
  const [pointed, setPointed] = useState<number | null>(null);
  const psalms = bookId === 'Psalms';
  const oneChapter = chapterCount(bible, bookId) === 1;
  const name = getLocalizedBookName(bookId, locale);
  const verses = verseCount(bible, bookId, chapter);
  const said = pointed ? verseSnippet(text, chapter, pointed) : null;
  const toChapters = { label: t(psalms ? 'bible.psalmsBack' : 'bible.chaptersBack'), onClick: () => onChapter(null) };
  const toBooks = onBooks ? { label: t('bible.allBooks'), onClick: onBooks } : null;
  const title = oneChapter ? name : psalms ? t('bible.psalm', { number: chapter }) : `${name} ${chapter}`;
  return (
    <>
      <StepHead back={oneChapter ? toBooks : toChapters} title={title} count={t('bible.verseCount', { count: verses })} />
      <NumberGrid
        key={chapter}
        count={verses}
        current={here?.chapter === chapter ? here.verse : undefined}
        label={(verse) => t('bible.verseNumber', { number: verse })}
        wide={wide}
        onPick={(verse) => onOpen({ chapter, verse, toVerse: verse })}
        onPoint={wide && canHover ? setPointed : undefined}
      />
      {wide && canHover ? <PointedLine text={pointed && said ? t('bible.verseLine', { verse: pointed, text: said }) : t('bible.verseHint')} /> : null}
    </>
  );
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

/** A window's name for its step: the chapters, or the verses of one chapter. */
const stepLabel = (chapter: number | null) => (chapter === null ? 'bible.chooseChapter' : 'bible.chooseVerse');

const TRIGGER_OPEN = 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/60';
/** A trigger of a window shows a border only while its window is open. */
const triggerBorder = (open: boolean) => (open ? TRIGGER_OPEN : 'border-transparent');

type ChapterPickerProps = {
  bookId: string;
  bible: BibleId;
  current: number;
  /** The verse the person is at: the button names the place as a reference does, "12:3". */
  verse: number;
  /** The open book's text, for how a chapter begins and what a verse says. */
  text: BookText | null;
  locale: AppLocale;
  wide: boolean;
  onOpen: (place: Place) => void;
};

/** "12:3 ▾": the place; its window — every chapter of the book, then the verses of the one pressed. */
export function ChapterPicker({ bookId, bible, current, verse, text, locale, wide, onOpen }: ChapterPickerProps) {
  const { t, chapterLabel } = usePickerWords();
  const [open, setOpen] = useState(false);
  const [chapter, setChapter] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const label = chapterLabel(bookId);
  const columns = Math.min(PER_ROW, chapter === null ? chapterCount(bible, bookId) : verseCount(bible, bookId, chapter));

  const close = () => {
    setOpen(false);
    setChapter(null);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('bible.changeChapter', { chapter: t('bible.placeVerse', { chapter: label(current), verse }) })}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[15px] font-semibold tabular-nums text-indigo-700 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40 ${triggerBorder(open)}`}
      >
        {current}:{verse}
        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <PickerWindow open={open} onClose={close} anchorRef={triggerRef} align="start" width={open && wide ? gridWindowWidth(columns) : undefined} wide={wide} label={t(stepLabel(chapter))}>
        <PlaceSteps
          bookId={bookId}
          bible={bible}
          text={text}
          locale={locale}
          wide={wide}
          here={{ chapter: current, verse }}
          chapter={chapter}
          onChapter={setChapter}
          onOpen={(place) => { close(); onOpen(place); }}
        />
      </PickerWindow>
    </>
  );
}

type BookChipProps = {
  id: string;
  name: string;
  current: boolean;
  autoFocus: boolean;
  wide: boolean;
  onPick: (bookId: string) => void;
  onHold: (bookId: string) => void;
};

/** A book: a press shows its chapters, a hold opens it at its start. */
function BookChip({ id, name, current, autoFocus, wide, onPick, onHold }: BookChipProps) {
  const { state, handlers } = useLongPress({ onPress: () => onPick(id), onLongPress: () => onHold(id) });
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      aria-current={current ? 'true' : undefined}
      {...handlers}
      className={`${HOLDABLE} inline-flex ${wide ? 'min-h-9' : 'min-h-11'} items-center rounded-[10px] border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${current
        ? 'border-indigo-400 bg-indigo-600 text-white'
        : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300'}`}
    >
      <HoldFill state={state} />
      <span className={heldText(state)}>{name}</span>
    </button>
  );
}

type BookChoicesProps = {
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  wide: boolean;
  /** The open book takes the focus; not where the line above it does. */
  focusCurrent: boolean;
  onPick: (bookId: string) => void;
  onHold: (bookId: string) => void;
};

/** Every book, grouped as on the list of books; the open one is filled. */
function BookChoices({ bookId, bible, locale, wide, focusCurrent, onPick, onHold }: BookChoicesProps) {
  const { t } = useTranslation();
  // In the order the Bible being read prints them.
  const testaments = booksOf(bible).map((testament) => ({
    ...testament,
    title: t(testament.key === 'old' ? 'bible.oldTestament' : 'bible.newTestament'),
  }));
  return (
    <>
      <div className={`grid gap-6 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {testaments.map((testament) => (
          <section key={testament.key} aria-label={testament.title} className="flex flex-col gap-3.5">
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">{testament.title}</h2>
            {testament.groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t(`bible.groups.${group.key}`)}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {group.ids.map((id) => (
                    <li key={id}>
                      <BookChip
                        id={id}
                        name={getLocalizedBookName(id, locale)}
                        current={id === bookId}
                        autoFocus={focusCurrent && id === bookId}
                        wide={wide}
                        onPick={onPick}
                        onHold={onHold}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
      <HoldHint text={t('bible.holdBookHint')} />
    </>
  );
}

type NavigatorProps = {
  /** Where the window opens: every book, or the open book's chapters (the phone's bar at the bottom). */
  start: 'books' | 'chapters';
  bookId: string;
  bible: BibleId;
  currentChapter: number;
  currentVerse: number;
  /** The open book's text, for how its chapters begin and what its verses say. */
  text: BookText | null;
  locale: AppLocale;
  wide: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpen: (bookId: string, place: Place) => void;
};

/**
 * One window for getting anywhere: a reference typed in one line, every book as on the list, then the
 * chapters of a book chosen there and the verses of a chapter (`PlaceSteps`). A book held opens at its
 * start. Mounted only while open, so each opening starts where its button says.
 */
function BookNavigator({ start, bookId, bible, currentChapter, currentVerse, text, locale, wide, anchorRef, onClose, onOpen }: NavigatorProps) {
  const { t } = useTranslation();
  const firstChapter = (book: string) => (chapterCount(bible, book) === 1 ? 1 : null);
  const [step, setStep] = useState<{ bookId: string; text: BookText | null; chapter: number | null } | null>(
    start === 'chapters' ? { bookId, text, chapter: firstChapter(bookId) } : null
  );

  const pickBook = (chosen: string) => {
    setStep({ bookId: chosen, text: chosen === bookId ? text : null, chapter: firstChapter(chosen) });
    if (chosen === bookId && text) return;
    // How each chapter begins and what a verse says: the book is on the device once the reader has warmed it.
    void fetchBookText(chosen, bible).then(
      (loaded) => setStep((now) => (now?.bookId === chosen ? { ...now, text: loaded } : now)),
      () => undefined
    );
  };

  const label = step ? stepLabel(step.chapter) : 'bible.chooseBook';
  return (
    <PickerWindow open onClose={onClose} anchorRef={anchorRef} align="start" width={780} wide={wide} label={t(label)}>
      <BibleSearch
        bible={bible}
        locale={locale}
        wide={wide}
        surface="window"
        hereBook={bookId}
        autoFocus={wide}
        onOpen={({ bookId: chosen, chapter, verse, toVerse }) => onOpen(chosen, { chapter, verse, toVerse })}
      >
        <div className="mt-4">
          {step ? (
            <PlaceSteps
              key={step.bookId}
              bookId={step.bookId}
              bible={bible}
              text={step.text}
              locale={locale}
              wide={wide}
              here={step.bookId === bookId ? { chapter: currentChapter, verse: currentVerse } : undefined}
              chapter={step.chapter}
              onChapter={(chapter) => setStep((now) => (now ? { ...now, chapter } : now))}
              onBooks={() => setStep(null)}
              onOpen={(place) => onOpen(step.bookId, place)}
            />
          ) : (
            <BookChoices
              bookId={bookId}
              bible={bible}
              locale={locale}
              wide={wide}
              focusCurrent={!wide}
              onPick={pickBook}
              onHold={(held) => onOpen(held, { chapter: 1, verse: 1 })}
            />
          )}
        </div>
      </BibleSearch>
    </PickerWindow>
  );
}

/**
 * A BOOK ON THE LIST OF BOOKS (the Bible page) works as a book in the reader's window (the owner, 2026-10-23:
 * «там тоже это должно работать, так же само»): a press opens its chapters — then a chapter's verses — in a
 * window under it, a hold opens the book at its start. Where the person stopped in this book is filled.
 */
export function BookOnList({ bookId, bible, locale, wide, here, onOpen }: {
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  wide: boolean;
  here?: { chapter: number; verse: number };
  onOpen: (bookId: string, place: Place) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [chapter, setChapter] = useState<number | null>(null);
  const [text, setText] = useState<BookText | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const oneChapter = chapterCount(bible, bookId) === 1;
  const columns = Math.min(PER_ROW, chapter === null ? chapterCount(bible, bookId) : verseCount(bible, bookId, chapter));

  const show = () => {
    setChapter(oneChapter ? 1 : null);
    setOpen(true);
    // How each chapter begins and what a verse says: the book is on the device once the reader has warmed it.
    void fetchBookText(bookId, bible).then(setText, () => undefined);
  };
  const close = () => {
    setOpen(false);
    setChapter(null);
    triggerRef.current?.focus();
  };
  const { state, handlers } = useLongPress({ onPress: show, onLongPress: () => onOpen(bookId, { chapter: 1, verse: 1 }) });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        {...handlers}
        className={`${HOLDABLE} inline-flex min-h-10 items-center rounded-xl border px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${open
          ? TRIGGER_OPEN + ' text-indigo-700 dark:text-indigo-300'
          : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300'}`}
      >
        <HoldFill state={state} />
        <span className={heldText(state)}>{getLocalizedBookName(bookId, locale)}</span>
      </button>
      <PickerWindow open={open} onClose={close} anchorRef={triggerRef} align="start" width={open && wide ? gridWindowWidth(columns) : undefined} wide={wide} label={t(stepLabel(chapter))}>
        <PlaceSteps
          bookId={bookId}
          bible={bible}
          text={text}
          locale={locale}
          wide={wide}
          here={here}
          chapter={chapter}
          onChapter={setChapter}
          onOpen={(place) => { close(); onOpen(bookId, place); }}
        />
      </PickerWindow>
    </>
  );
}

type BookPickerProps = {
  bookId: string;
  bible: BibleId;
  currentChapter: number;
  currentVerse: number;
  text: BookText | null;
  locale: AppLocale;
  wide: boolean;
  onOpen: (bookId: string, place: Place) => void;
};

/** The book's name is the button: it opens the window of every book. */
export function BookPicker({ bookId, bible, currentChapter, currentVerse, text, locale, wide, onOpen }: BookPickerProps) {
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
      {/* On a wide line the name keeps its width whole; the line gives way elsewhere (`BibleBookReader`). */}
      <h1 className="m-0 -ml-2 min-w-0 max-w-full md:shrink-0">
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
          currentVerse={currentVerse}
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

type SearchPickerProps = {
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  wide: boolean;
  /** In a phone's bar under the thumb, round like its neighbours; else in the book's line. */
  look: 'line' | 'bar';
  onOpen: (bookId: string, place: Place) => void;
};

/**
 * The search while reading (the owner, 2026-10-23: «кнопку поиска нужно, когда книгу читаешь, чтобы было
 * видно»): in the book's line — «Поиск» by its magnifier on a computer, the magnifier alone on a phone —
 * and in the phone's bar under the thumb once that line has gone. It opens the one line, empty, with the
 * searches kept under it; «8:28» there opens in this book.
 */
export function SearchPicker({ bookId, bible, locale, wide, look, onOpen }: SearchPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const label = t('bible.search.openSearch');

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const shape = look === 'bar'
    ? 'pointer-events-auto h-12 w-12 justify-center rounded-full border-gray-300 bg-white/90 text-gray-800 shadow-lg shadow-gray-900/15 backdrop-blur-md dark:border-gray-600 dark:bg-gray-900/90 dark:text-gray-100 dark:shadow-black/40'
    : `min-h-11 rounded-xl text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-300 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300 ${wide ? 'ml-1 gap-1.5 pl-2.5 pr-3 text-[15px] font-medium' : 'w-11 justify-center'} ${open ? TRIGGER_OPEN : 'border-gray-200 dark:border-gray-700'}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? close() : setOpen(true))}
        className={`inline-flex shrink-0 items-center border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${shape}`}
      >
        <MagnifyingGlassIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {wide && look === 'line' ? <span aria-hidden="true">{t('bible.search.searchButton')}</span> : null}
      </button>
      <PickerWindow open={open} onClose={close} anchorRef={triggerRef} align="start" width={780} wide={wide} tall label={label}>
        <BibleSearch
          bible={bible}
          locale={locale}
          wide={wide}
          surface="window"
          hereBook={bookId}
          autoFocus
          openWithRecent
          onOpen={({ bookId: chosen, chapter, verse, toVerse }) => { close(); onOpen(chosen, { chapter, verse, toVerse }); }}
        />
      </PickerWindow>
    </>
  );
}

/**
 * A phone, reading: "Gen 12 ▴" under the thumb once the line at the top has gone. It opens the same
 * window at this book's chapters — a book of one chapter at its verses; "All books" there leads to every book.
 */
export function ReadingPill({ bookId, bible, currentChapter, currentVerse, text, locale, onOpen }: Omit<BookPickerProps, 'wide'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const manyChapters = chapterCount(bible, bookId) > 1;
  // The place as a reference names it: "Rom 16:21"; a book of one chapter by its verse alone, "Jude 3".
  const label = `${getLocalizedAbbrev(bookId, locale)} ${manyChapters ? `${currentChapter}:${currentVerse}` : currentVerse}`;

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
          start="chapters"
          bookId={bookId}
          bible={bible}
          currentChapter={currentChapter}
          currentVerse={currentVerse}
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
        className={`inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-xl border px-2.5 text-sm text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white ${triggerBorder(open)}`}
      >
        {/* Short of room, the name is cut, never the line broken: the colours of a tool in hand need the
            room in the reader's line (`MarkToolbar`), and a line broken in two moved the whole text down. */}
        <span lang={BIBLES[bible].language} className="truncate">{name(bible)}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
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
