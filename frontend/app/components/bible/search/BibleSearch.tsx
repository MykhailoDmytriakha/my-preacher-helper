'use client';

import { ClockIcon, MagnifyingGlassIcon, QuestionMarkCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useClipboard } from '@/hooks/useClipboard';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useStableHandler } from '@/hooks/useStableHandler';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { chooseReading } from '@/utils/bibleSearch/lineChoice';
import { readSearch, type LineReading } from '@/utils/bibleSearch/query';
import { answerSearch, isBibleWord } from '@/utils/bibleSearch/results';
import { useSearchIndex } from '@/utils/bibleSearch/searchIndexStore';
import { lineKey } from '@/utils/bibleSearch/words';
import { isBrowserOffline } from '@/utils/connectivity';
import { withModifier } from '@/utils/keyboardModifier';
import { verseCopyText } from '@/utils/verseCopy';

import { booksOf, bookSequence } from '../bookOrder';
import { clearSearchHistory, rememberSearch, restoreSearchHistory, useSearchHistory, type SearchHistoryEntry } from '../searchHistoryStore';
import { copyNamesOf } from '../verseCopy/useVerseCopy';

import { lastSearchOf, openedFrom, rememberOpened } from './lastSearch';
import { SearchHelp } from './SearchHelp';
import { SearchHistory, type HistoryRow } from './SearchHistory';
import { searchToKeep } from './searchKeeping';
import { buildSearchModel, rowForEnter, SHOWN_VERSES, type Intent, type OpenTarget } from './searchModel';
import { SearchResults, type VerseRow } from './SearchResults';
import { SignBar, type SearchSign } from './SignBar';
import { useSearchKeeping } from './useSearchKeeping';

import type { AppLocale } from '@/utils/appLocale';

/**
 * THE ONE LINE OF THE BIBLE (canvas v58, the owner 2026-10-23: «вот это то, что нужно»): a place to open
 * or words to find, «где + что». Its grey text says what it takes; «?» opens «Как искать», the clock the
 * searches a verse was opened from. Under it, as one types: the place with «Открыть», or the verses
 * with where they were looked for, the forms found and the wider places to look, forty at a time
 * («Показать ещё»). On a computer the arrows choose and Enter opens; Escape clears, then closes. It
 * always opens empty (the owner, 2026-10-23: the book's window showed the last search back after it was
 * cleared); a search of the history opens on the verse last opened from it. The reading of the line is
 * `utils/bibleSearch`; this component holds the line's state and draws it.
 */
type Panel = 'none' | 'help' | 'history';

export type BibleSearchProps = {
  bible: BibleId;
  locale: AppLocale;
  /** A computer's width: the results beside their «Открыть», the help in two columns on a page. */
  wide: boolean;
  /** On the Bible page (cards under the line) or inside the reader's window (the window is the card). */
  surface: 'page' | 'window';
  /** The book being read: «8:28» opens there. */
  hereBook?: string | null;
  autoFocus?: boolean;
  /** The reader's search window: the searches kept are under the empty line, or «Как искать» when there are none. */
  openWithRecent?: boolean;
  onOpen: (target: OpenTarget) => void;
  /** What stands under an empty line: the books, the trail, the chapters. */
  children?: ReactNode;
};

const ICON_BUTTON = 'inline-flex shrink-0 items-center justify-center rounded-[10px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

/** The row lit in the results: on a touch screen only one chosen by a press or the arrows, on a computer the arrows' row. */
const litKeyOf = (touch: boolean, chosenKey: string | null, activeKey: string | null): string | null => {
  if (!touch) return activeKey;
  return chosenKey !== null && chosenKey === activeKey ? chosenKey : null;
};

/**
 * The line let go: the bar of signs leaves after the press that took the focus has landed — it stands above the
 * results, and gone at once it moved them under the finger, a pressed verse was missed (2026-10-27).
 */
const blurAfterPress = (input: HTMLInputElement | null, setFocused: (focused: boolean) => void) => {
  window.setTimeout(() => { if (document.activeElement !== input) setFocused(false); }, 0);
};

/** ⌘C / Ctrl+C on the line with nothing selected in it: the chosen verse is copied, a selection stays the line's. */
const isCopyVerseKey = (event: React.KeyboardEvent<HTMLInputElement>) =>
  (event.metaKey || event.ctrlKey) && event.code === 'KeyC' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd;

export function BibleSearch({ bible, locale, wide, surface, hereBook = null, autoFocus = false, openWithRecent = false, onOpen, children }: BibleSearchProps) {
  const { t, i18n } = useTranslation();
  const touch = useMediaQuery('(pointer: coarse)', false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();
  const optionId = useCallback((key: string) => `${baseId}-option-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`, [baseId]);
  const history = useSearchHistory().filter((entry) => entry.bible === bible).slice(0, 10);
  const [line, setLine] = useState('');
  const [panel, setPanel] = useState<Panel>(() => (openWithRecent ? (history.length ? 'history' : 'help') : 'none'));
  const [asWords, setAsWords] = useState(false);
  // The row the arrows are on, by what it is — a verse that moves down as books arrive stays chosen.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A row chosen by the person — pressed, or reached by the arrows (an iPad's keyboard too): on a touch screen it alone
  // is lit with its buttons; the first row is chosen by itself only for Enter.
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  // «Показать ещё» for the line it was pressed on: another line starts again from the first forty.
  const [more, setMore] = useState<{ line: string; asWords: boolean; limit: number } | null>(null);
  const [allBooks, setAllBooks] = useState(false);
  const [fixChapters, setFixChapters] = useState(false);
  const [focused, setFocused] = useState(false);
  const [historySelected, setHistorySelected] = useState(0);
  const [cleared, setCleared] = useState<SearchHistoryEntry[] | null>(null);

  const deferred = useDeferredValue(line);
  const books = useMemo(() => booksOf(bible), [bible]);
  const order = useMemo(() => bookSequence(booksOf(bible)), [bible]);
  const language = BIBLES[bible].language;
  const index = useSearchIndex(bible, order, focused || deferred.trim() !== '' || panel === 'history');

  // The line read — and read again with the English layout turned, when that is what makes it mean
  // something — and what to show under it. A function of the text, so Enter reads the line as it is now.
  const offline = isBrowserOffline();
  // How many verses a line shows: forty, or as many as «Показать ещё» opened on this very line.
  const limitFor = useCallback((text: string) => (more && more.line === lineKey(text) && more.asWords === asWords ? more.limit : SHOWN_VERSES), [more, asWords]);
  const answering = useMemo(() => ({
    answerFor: (each: LineReading) => (each.kind === 'search' && index.indexed > 0 ? answerSearch(index.index, each.query, books) : null),
    isWord: (word: string) => isBibleWord(index.index, word),
  }), [index, books]);
  const understand = useCallback((text: string) => {
    const { reading, answer, layoutFixed, booksBegun } = chooseReading(text, { bible, books, hereBook, asWords }, answering);
    const searched = layoutFixed ?? text;
    const readAs = asWords ? readSearch(searched, { bible, books }).scope : null;
    const model = buildSearchModel({
      reading, books, answer, index, bible, locale, t, wide, asWords, bookReadAs: readAs?.kind === 'book' ? readAs.bookId : null, allBooks, fixChapters,
      opened: openedFrom(bible, searched, asWords), offline, layoutFixed, limit: limitFor(text),
      booksBegun,
    }, (bookId, chapter, verse) => index.index.verseText(bookId, chapter, verse));
    return { model, searched, keep: searchToKeep(reading, answer, searched, asWords, model.rows.some((row) => row.type === 'verse')) };
    // `index` changes whenever a book joins it: a new book answers again.
  }, [bible, books, hereBook, asWords, index, answering, locale, t, wide, allBooks, fixChapters, offline, limitFor]);

  const { model, searched: searchedLine, keep } = useMemo(() => understand(deferred), [understand, deferred]);

  // The history keeps a search worked with (`searchKeeping.ts`).
  // An IME's word being composed is not yet the line: no clock, no keys (Codex review, 2026-10-27).
  const [composing, setComposing] = useState(false);
  const { keepLine, keepShown, forgetEntry, declineAll, launched } = useSearchKeeping(keep, bible, line.trim() !== '' && panel === 'none' && deferred === line && !composing, line);

  const pickable = model.rows.filter((row) => row.type === 'place' || row.type === 'book' || row.type === 'verse' || row.type === 'showMore');
  // Nothing chosen yet: the first row. A chosen row that left the list (beyond those shown) chooses
  // none — Enter never opens another verse in its place.
  const active = selectedKey === null ? (pickable.length ? 0 : null) : (() => {
    const at = pickable.findIndex((row) => row.key === selectedKey);
    return at >= 0 ? at : null;
  })();
  const activeRow = active !== null ? pickable[active] : null;
  const activeKey = activeRow?.key ?? null;

  // The first row shown is chosen by what it is, once the rows are of the line as typed: books arriving
  // later add verses above it, and Enter still opens the verse that was shown chosen.
  useEffect(() => {
    if (selectedKey === null && deferred === line && pickable.length) setSelectedKey(pickable[0].key);
  }, [deferred, line, pickable, selectedKey]);

  // A row brought into sight: the one the arrows came to, and once the verse a search of the history
  // was last opened at, when its rows are there.
  const bringIntoSight = useCallback((key: string) => {
    requestAnimationFrame(() => document.getElementById(optionId(key))?.scrollIntoView?.({ block: 'nearest' }));
  }, [optionId]);
  const awaitedInSight = useRef<string | null>(null);
  useEffect(() => {
    if (!awaitedInSight.current || activeKey !== awaitedInSight.current) return;
    awaitedInSight.current = null;
    bringIntoSight(activeKey);
  }, [activeKey, bringIntoSight]);

  const focusLine = () => requestAnimationFrame(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  const write = (next: string, wordsOn = false) => {
    setLine(next);
    setAsWords(wordsOn);
    setSelectedKey(null);
    setAllBooks(false);
    setFixChapters(false);
    setPanel('none');
    focusLine();
  };

  /**
   * A search of the history, again: back on the verse last opened from it in this visit, when it was one —
   * with as many verses shown as then, so a verse found after «Показать ещё» is there to stand on.
   */
  const writeAgain = (entry: SearchHistoryEntry) => {
    const wordsOn = Boolean(entry.asWords);
    // Run again, it is used again: to the top at once.
    rememberSearch(entry.line, bible, wordsOn);
    write(entry.line, wordsOn);
    const last = lastSearchOf(bible, entry.line, wordsOn);
    if (last) {
      if (last.limit > SHOWN_VERSES) setMore({ line: lineKey(entry.line), asWords: wordsOn, limit: last.limit });
      setSelectedKey(last.lastKey);
      awaitedInSight.current = last.lastKey;
    }
  };

  // A verse copied from the results, as the reader copies it: «Ис 47:4: "…"», the Bible named when not the interface's.
  // One way for the button and for ⌘C / Ctrl+C, so the tick stands on the verse copied either way.
  const { isCopied, copyToClipboard } = useClipboard({ successDuration: 2000, onError: () => toast.error(t('bible.copy.failed')) });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyVerse = (row: VerseRow) => {
    if (row.run.kind !== 'open') return;
    const { bookId, chapter, verse } = row.run.target;
    setCopiedKey(row.key);
    keepShown();
    void copyToClipboard(verseCopyText([{ chapter, verse, words: row.pieces.map((piece) => piece.text).join('') }], 'quote', copyNamesOf(bible, bookId, i18n.language, t)));
  };

  // `from`: the line as searched (turned from the English layout when it was typed so); `typed`: as it
  // stands in the field — what «Показать ещё» is kept by.
  const run = (intent: Intent, from = searchedLine, typed = deferred) => {
    switch (intent.kind) {
      case 'open': {
        if (intent.fromSearch) {
          keepLine(from, asWords);
          rememberOpened(bible, from, asWords, `${intent.target.bookId} ${intent.target.chapter}:${intent.target.verse}`, limitFor(typed));
        }
        onOpen(intent.target);
        break;
      }
      case 'write':
        launched(intent.line, Boolean(intent.asWords), intent.line);
        write(intent.line, intent.asWords);
        break;
      case 'asWords':
        launched(from, intent.on, line);
        setAsWords(intent.on);
        setSelectedKey(null);
        if (!touch) focusLine();
        break;
      case 'showChapters':
        setFixChapters(true);
        break;
      case 'more':
        keepShown();
        setMore({ line: lineKey(typed), asWords, limit: intent.limit });
        setSelectedKey(intent.next);
        if (!touch) {
          awaitedInSight.current = intent.next;
          focusLine();
        }
        break;
    }
  };

  // How many verses each kept search finds now — counted only while the history is in sight, and only
  // over the whole index: a count while books still arrive would change under the eye.
  const historyKey = history.map((entry) => `${entry.at}:${entry.asWords ? 1 : 0}:${entry.line}`).join('|');
  const historyCounts = useMemo(() => {
    if (panel !== 'history' || index.loading || !index.indexed) return null;
    // Counted as the line is shown: with the books its first letters begin, or its layout turned, when so it finds more.
    return history.map((entry) => {
      const { reading, answer } = chooseReading(entry.line, { bible, books, asWords: entry.asWords }, answering);
      return reading.kind === 'search' ? answer?.hits.length ?? 0 : null;
    });
    // `historyKey` stands for the entries; `index.version` for the books searched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, historyKey, index.version, bible, books, answering]);
  const historyRows: HistoryRow[] = history.map((entry, i) => ({ entry, count: historyCounts?.[i] ?? null }));
  const historyActive = history.length ? Math.min(historySelected, history.length - 1) : null;

  const openPanel = (next: Panel) => {
    setPanel((now) => (now === next ? 'none' : next));
    setHistorySelected(0);
    setCleared(null);
    // A computer: the keys stay with the line — the arrows walk the history, Escape closes it.
    if (!touch) focusLine();
  };

  const clear = () => {
    setLine('');
    setAsWords(false);
    setSelectedKey(null);
    setAllBooks(false);
    setFixChapters(false);
    focusLine();
  };

  const step = (event: React.KeyboardEvent) => (event.key === 'ArrowDown' ? 1 : -1);
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const choosing = event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter';
    // The keys belong to what is in sight: the history walks its searches, the help takes none, and only
    // the results — when nothing covers them — are chosen and opened.
    // Shift+Delete takes the chosen search out of the history, as in a browser's address line.
    if (panel === 'history' && event.key === 'Delete' && event.shiftKey && historyActive !== null) {
      event.preventDefault();
      forgetEntry(history[historyActive]);
      return;
    }
    if (panel === 'history' && choosing) {
      event.preventDefault();
      if (historyActive === null) return;
      if (event.key === 'Enter') writeAgain(history[historyActive]);
      else setHistorySelected(Math.max(0, Math.min(history.length - 1, historyActive + step(event))));
      return;
    }
    if (panel === 'help' && choosing) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    // ⌘C / Ctrl+C with nothing selected in the line copies the chosen verse: the keyboard's «Копировать».
    if (panel === 'none' && isCopyVerseKey(event) && activeRow?.type === 'verse') {
      event.preventDefault();
      copyVerse(activeRow);
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && pickable.length) {
      event.preventDefault();
      const now = active ?? -1;
      const next = pickable[Math.max(0, Math.min(pickable.length - 1, now + step(event)))].key;
      setSelectedKey(next);
      setChosenKey(next);
      // A verse reached is a verse chosen; a book's name among the suggestions is still being typed («Иоа»).
      if (pickable.find((row) => row.key === next)?.type === 'verse') keepShown();
      bringIntoSight(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Typed fast and Enter at once: the rows on screen may still be of a shorter line («Пс 2» for «Пс 22»).
      if (deferred !== line) {
        const fresh = understand(line);
        const now = rowForEnter(fresh.model.rows, selectedKey);
        if (now) run(now.run, fresh.searched, line);
        return;
      }
      if (activeRow && 'run' in activeRow) run(activeRow.run);
    }
  };

  // Escape anywhere in the line, its panels or its results — a result button too: a panel goes first,
  // then the words; only an empty line lets the window around it close. Not a key from a window opened
  // over the page from inside the line's part of it (a book of the list below): portalled, its keys still
  // bubble here through React, and this took Escape from that window (Codex review, 2026-10-23).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !rootRef.current?.contains(event.target as Node)) return;
    // The reader's search window opens on its kept searches: with the line empty they are the window itself,
    // and one Escape closes it.
    const opening = openWithRecent && !line.trim();
    if (panel !== 'none' && !opening) {
      event.stopPropagation();
      setPanel('none');
      focusLine();
    } else if (line) {
      event.stopPropagation();
      clear();
    }
  };

  const insertSign = (sign: SearchSign) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? line.length;
    const end = input?.selectionEnd ?? line.length;
    const chosen = line.slice(start, end);
    const next = sign === '"' ? `${line.slice(0, start)}"${chosen}"${line.slice(end)}` : `${line.slice(0, start)}${sign}${line.slice(end)}`;
    const caret = sign === '"' ? start + 1 + chosen.length + (chosen ? 1 : 0) : start + 1;
    setLine(next);
    setSelectedKey(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  // A computer's width is known after the first paint (`useMediaQuery`): the cursor goes into the line
  // then, once, unless the person is already somewhere else on the page.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!autoFocus || focusedOnce.current) return;
    focusedOnce.current = true;
    const elsewhere = document.activeElement && document.activeElement !== document.body;
    if (!elsewhere) inputRef.current?.focus();
  }, [autoFocus]);

  const typed = line.trim() !== '';
  // A phone: «?» and the clock sit in the line while it is empty; while typing, «Как искать» is in the
  // bar over the keyboard, and the line keeps its room for the words.
  const showTools = !touch || wide || !typed;
  const showSigns = touch && focused;
  const iconSize = touch ? 'h-11 w-11' : 'h-[34px] w-[34px]';
  const placeholder = t(`bible.search.examples.${bible}.${wide ? 'placeholderWide' : 'placeholderNarrow'}`);
  const listId = `${baseId}-list`;
  const historyId = `${baseId}-history`;
  const showResults = typed && panel === 'none';
  // The results are drawn again only when they change: a letter typed leaves the hundred verses shown alone while the
  // deferred search catches up (Codex review, 2026-10-27; `SearchResults` is memoized).
  const onResultRun = useStableHandler((intent: Intent) => run(intent));
  const onResultChoose = useStableHandler((key: string) => {
    setSelectedKey(key);
    setChosenKey(key);
    keepShown();
  });
  const onResultCopy = useStableHandler(copyVerse);
  const onResultHowTo = useStableHandler(() => setPanel('help'));
  const onResultToggleBooks = useStableHandler(() => setAllBooks((now) => !now));
  const showKeys = !touch && pickable.length > 1;
  const keysCopy = activeRow?.type === 'verse' ? withModifier('C') : null;
  const keysHint = useMemo(() => (showKeys ? { esc: t('bible.search.keysClear'), copy: keysCopy } : null), [showKeys, keysCopy, t]);
  const card = surface === 'page'
    ? 'mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900'
    : 'mt-2';

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col" onKeyDown={onEscape}>
      <div className={surface === 'window' ? 'sticky top-0 z-10 -mx-1 bg-white px-1 pb-1 dark:bg-gray-900' : 'w-full'}>
        <div
          className={`flex items-center gap-2 rounded-xl border bg-white pl-3.5 transition dark:bg-gray-950 ${wide ? 'h-[52px] pr-2' : 'h-12 pr-1'} ${focused
            ? 'border-indigo-500 ring-[3px] ring-indigo-500/20 dark:border-indigo-400 dark:ring-indigo-400/25'
            : 'border-gray-300 shadow-sm dark:border-gray-600'}`}
          onMouseDown={(event) => {
            // A press on the line's empty room puts the cursor in it, as a field does.
            if (event.target === event.currentTarget) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={t('bible.search.label')}
            aria-expanded={showResults && pickable.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showResults && !touch && activeRow ? optionId(activeRow.key) : undefined}
            value={line}
            onChange={(event) => {
              setLine(event.target.value);
              setSelectedKey(null);
              setAsWords(false);
              setAllBooks(false);
              setFixChapters(false);
              if (panel !== 'none') setPanel('none');
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onBlur={() => blurAfterPress(inputRef.current, setFocused)}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={placeholder}
            // 16px on a phone: a smaller field makes iOS zoom the page in on focus.
            className={`min-w-0 flex-1 bg-transparent text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-gray-500 ${wide ? 'text-lg' : 'text-base'}`}
          />
          {typed ? (
            <button type="button" onClick={clear} aria-label={t('bible.search.clear')} title={t('bible.search.clear')} className={`${ICON_BUTTON} ${iconSize} text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800`}>
              <XCircleIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          {showTools ? (
            <>
              <button
                type="button"
                onClick={() => openPanel('history')}
                aria-label={t('bible.search.history')}
                aria-expanded={panel === 'history'}
                title={t('bible.search.history')}
                className={`${ICON_BUTTON} ${iconSize} ${panel === 'history' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800'}`}
              >
                <ClockIcon className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => openPanel('help')}
                aria-label={t('bible.search.help')}
                aria-expanded={panel === 'help'}
                title={t('bible.search.help')}
                className={`${ICON_BUTTON} ${iconSize} ${panel === 'help' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800'}`}
              >
                <QuestionMarkCircleIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
        {showSigns ? <SignBar onSign={insertSign} onHelp={() => setPanel('help')} /> : null}
      </div>

      {panel === 'help' ? (
        <div className={`${card} ${surface === 'page' ? 'px-4 pb-4 pt-3.5' : 'px-1 pt-2'}`}>
          <SearchHelp bible={bible} columns={wide && surface === 'page' ? 2 : 1} touch={touch} onTry={(example) => write(example)} />
        </div>
      ) : null}

      {panel === 'history' ? (
        <section id={historyId} aria-label={t('bible.search.history')} className={`${card} ${surface === 'page' ? 'px-4 pb-3 pt-3.5' : 'px-1 pt-2'}`}>
          <SearchHistory
            rows={historyRows}
            selected={touch ? null : historyActive}
            touch={touch}
            cleared={cleared !== null}
            example={t(`bible.search.examples.${bible}.book`)}
            onPick={writeAgain}
            onTry={(example) => write(example)}
            onRemove={forgetEntry}
            onClear={() => {
              declineAll();
              setCleared(clearSearchHistory());
            }}
            onUndo={() => {
              if (cleared) restoreSearchHistory(cleared);
              setCleared(null);
            }}
          />
          {!touch && history.length ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-4 border-t border-gray-100 pt-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <span>↑ ↓ {t('bible.search.keysPick')}</span>
              <span>↵ {t('bible.search.keysAgain')}</span>
              <span>Esc {t('bible.search.keysClose')}</span>
              <span>Shift+Delete {t('bible.search.keysRemove')}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {showResults ? (
        <div className={`${card} ${surface === 'window' ? '-mx-1' : ''}`}>
          <SearchResults
            model={model}
            listId={listId}
            textLang={language}
            selectedKey={litKeyOf(touch, chosenKey, activeKey)}
            wide={wide}
            touch={touch}
            showHowTo={touch && !wide && !focused && surface === 'page'}
            keysHint={keysHint}
            optionId={optionId}
            onRun={onResultRun}
            onChoose={onResultChoose}
            onCopy={onResultCopy}
            copiedKey={isCopied ? copiedKey : null}
            onHowTo={onResultHowTo}
            onToggleBooks={onResultToggleBooks}
          />
        </div>
      ) : null}

      {!typed && (surface === 'page' || panel === 'none') ? children : null}
    </div>
  );
}
