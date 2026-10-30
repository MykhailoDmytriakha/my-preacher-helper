'use client';

import { CheckIcon, ChevronDownIcon, ChevronRightIcon, DocumentDuplicateIcon, QuestionMarkCircleIcon, SignalSlashIcon } from '@heroicons/react/24/outline';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { HOVER_ROW, KEYCAP, SELECTED_ROW } from './searchStyles';

import type { Intent, ModelRow, SearchModel } from './searchModel';

/**
 * WHAT THE LINE FOUND, drawn from its model (`searchModel.ts`): first the notes that change how the rest
 * reads (no connection; the keyboard layout turned), then where it looked and what it found, then the
 * rows. The choices — places, books, verses — are the options of one listbox the line controls: each
 * option is itself what is pressed, with nothing to press inside it (the combobox pattern); headings,
 * fixes and chapter tiles stand outside the list. The option the arrows are on carries what Enter does —
 * «Открыть ↵» on a computer. Scripture is marked with its own language, apart from the interface's.
 */
type Props = {
  model: SearchModel;
  /** The key of the row the arrows are on, or the verse pressed. */
  selectedKey: string | null;
  wide: boolean;
  touch: boolean;
  /** «Как искать» under a fix: only where the line has no «?» of its own at hand. */
  showHowTo: boolean;
  keysHint: { esc: string; copy: string | null } | null;
  /** The id of the list of choices: the line's `aria-controls`. */
  listId: string;
  /** The language of the Bible's text (`lang` of the verses). */
  textLang: string;
  optionId: (key: string) => string;
  onRun: (intent: Intent) => void;
  /** A verse pressed: chosen, not opened. */
  onChoose: (key: string) => void;
  /** A verse copied, and which one was just copied — its sign is a tick for a moment. */
  onCopy: (row: VerseRow) => void;
  copiedKey: string | null;
  onHowTo: () => void;
  onToggleBooks: () => void;
  /** «Все 9 — в Библии»: the found verses beside the reader's text (`foundInBible.ts`); none — the window cannot show them. */
  allInBible?: { label: string; onPress: () => void } | null;
  /** What pressing a place does, where it is not opening it (a comment moved: «Сюда»); by default «Открыть». */
  actionLabel?: string;
};

const PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-[10px] bg-indigo-600 px-3.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900';
const SECONDARY = 'inline-flex items-center justify-center rounded-[10px] border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-800 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const CHIP = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 text-[13px] font-medium text-gray-800 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

function EnterKey() {
  return (
    <span aria-hidden="true" className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-white/20">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 5v6a4 4 0 0 1-4 4H5" /><path d="m9 11-4 4 4 4" />
      </svg>
    </span>
  );
}

function ChapterTiles({ count, touch, onPick }: { count: number; touch: boolean; onPick: (chapter: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => i + 1).map((chapter) => (
        <button
          key={chapter}
          type="button"
          onClick={() => onPick(chapter)}
          className={`${touch ? 'h-11 w-11' : 'h-10 w-10'} rounded-[10px] border border-gray-200 bg-gray-50 text-[15px] font-semibold tabular-nums text-gray-800 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:hover:border-indigo-400 dark:hover:bg-indigo-950`}
        >
          {chapter}
        </button>
      ))}
    </div>
  );
}

type OptionRow = Extract<ModelRow, { type: 'place' | 'book' | 'verse' | 'showMore' }>;
const isOption = (row: ModelRow): row is OptionRow => row.type === 'place' || row.type === 'book' || row.type === 'verse' || row.type === 'showMore';

export type VerseRow = Extract<ModelRow, { type: 'verse' }>;
type OptionProps = {
  selected: boolean; wide: boolean; touch: boolean; textLang: string; id: string; onRun: (intent: Intent) => void;
  onChoose: (key: string) => void; onCopy: (row: VerseRow) => void; copiedKey: string | null; actionLabel?: string;
};

/**
 * An option of the list: pressed as a whole; on a computer the press keeps the cursor in the line. A verse pressed is
 * only chosen — the search stays, to think over it — and it is copied or opened by its own buttons (the owner,
 * 2026-10-27: «нажал на стих — он пока что просто выделяется»); Enter still opens the chosen one.
 */
function Option({ row, selected, wide, touch, id, onRun, onChoose, className, children }: OptionProps & { row: OptionRow; className: string; children: React.ReactNode }) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      // A mouse keeps the line its keys, in a narrow window too; a finger lets the phone's keyboard down.
      onMouseDown={(event) => { if (wide || !touch) event.preventDefault(); }}
      onClick={() => (row.type === 'verse' ? onChoose(row.key) : onRun(row.run))}
      className={`cursor-pointer border-b border-gray-100 last:border-b-0 dark:border-gray-800 ${selected && (wide || row.type === 'verse') ? SELECTED_ROW : HOVER_ROW} ${className}`}
    >
      {children}
    </li>
  );
}

function PlaceOption({ row, ...props }: OptionProps & { row: Extract<ModelRow, { type: 'place' }> }) {
  const { t } = useTranslation();
  const { wide, selected, textLang } = props;
  const action = props.actionLabel ?? t('bible.search.open');
  return (
    <Option row={row} {...props} className="px-4 py-3.5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold tracking-tight text-gray-900 dark:text-white">{row.title}</span>
          {row.text ? <span lang={textLang} className="mt-1 block max-w-[46rem] font-serif text-base leading-relaxed text-gray-700 dark:text-gray-300">{row.text}</span> : null}
          {row.meta ? <span className="mt-1 block text-[13px] text-gray-500 dark:text-gray-400">{row.meta}</span> : null}
          {row.note ? <span className="mt-2 inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{row.note}</span> : null}
        </div>
        {/* What Enter does, drawn as a button; the option itself is what is pressed. */}
        {wide && selected ? (
          <span aria-hidden="true" className={`${PRIMARY} h-9 shrink-0 pr-2`}>
            {action}
            <EnterKey />
          </span>
        ) : null}
      </div>
      {!wide && row.primary ? (
        <span aria-hidden="true" className={`${PRIMARY} mt-3 h-11 w-full rounded-xl text-base`}>{action}</span>
      ) : null}
    </Option>
  );
}

function BookOption({ row, ...props }: OptionProps & { row: Extract<ModelRow, { type: 'book' }> }) {
  return (
    <Option row={row} {...props} className={`flex items-center gap-3 px-4 ${props.touch ? 'min-h-12' : 'min-h-11'}`}>
      <span className="min-w-0 flex-1 text-[15px] font-medium text-gray-900 dark:text-gray-100">{row.title}</span>
      <span className="text-[13px] text-gray-500 dark:text-gray-400">{row.sub}</span>
      <ChevronRightIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
    </Option>
  );
}

/**
 * The chosen verse's own buttons, for a mouse and a finger: they act, the row is not pressed under them. Copied, the
 * sign turns into a tick for a moment, as the links window's does (the owner, 2026-10-27). The keyboard has the same
 * two — Enter and ⌘C / Ctrl+C on the line — so the buttons are drawn, as «Открыть ↵» of a place is, not announced
 * inside the list's option (Codex review, 2026-10-27).
 */
function VerseActions({ row, wide, touch, onRun, onCopy, copiedKey, actionLabel }: OptionProps & { row: VerseRow }) {
  const { t } = useTranslation();
  const height = touch ? 'h-11' : 'h-8';
  const keep = (event: React.MouseEvent) => { if (wide || !touch) event.preventDefault(); };
  return (
    <span aria-hidden="true" className="mt-2.5 flex flex-wrap gap-2">
      <button type="button" tabIndex={-1} onMouseDown={keep} onClick={(event) => { event.stopPropagation(); onCopy(row); }} className={`${SECONDARY} ${height} gap-1.5`}>
        {copiedKey === row.key
          ? <CheckIcon data-copied="" className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
          : <DocumentDuplicateIcon className="h-4 w-4" aria-hidden="true" />}
        {t('bible.copy.copy')}
      </button>
      <button type="button" tabIndex={-1} onMouseDown={keep} onClick={(event) => { event.stopPropagation(); onRun(row.run); }} className={`${PRIMARY} ${height} ${wide ? 'pr-2' : ''}`}>
        {actionLabel ?? t('bible.search.openInBible')}
        {wide ? <EnterKey /> : null}
      </button>
    </span>
  );
}

/**
 * The chosen verse's Copy and Open for a screen reader and the Tab key — outside the list, whose options hold no
 * controls — out of sight until a key reaches them (Codex review, 2026-10-27: on a touch screen with VoiceOver the
 * drawn buttons were all there was).
 */
function ChosenVerseActions({ row, onRun, onCopy, actionLabel }: { row: VerseRow; onRun: (intent: Intent) => void; onCopy: (row: VerseRow) => void; actionLabel?: string }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('bible.copy.menu', { place: row.ref })} className="sr-only flex gap-2 border-b border-gray-100 px-4 py-2 focus-within:not-sr-only dark:border-gray-800">
      <button type="button" onClick={() => onCopy(row)} className={`${SECONDARY} h-9`}>{t('bible.copy.copy')}</button>
      <button type="button" onClick={() => onRun(row.run)} className={`${PRIMARY} h-9`}>{actionLabel ?? t('bible.search.openInBible')}</button>
    </div>
  );
}

function VerseOption({ row, ...props }: OptionProps & { row: VerseRow }) {
  const { t } = useTranslation();
  return (
    <Option row={row} {...props} className={`grid items-baseline gap-3 px-4 py-2.5 ${props.wide ? 'grid-cols-[5rem_minmax(0,1fr)]' : 'grid-cols-[4.25rem_minmax(0,1fr)]'}`}>
      <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">{row.ref}</span>
      {/* A measure for reading: on a wide page the verse does not run the whole width. */}
      <span className="max-w-[46rem]">
        <span lang={props.textLang} className="font-serif text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
          {row.pieces.map((piece, index) => (piece.lit
            ? <mark key={index} className="bg-transparent font-semibold text-gray-950 dark:text-white">{piece.text}</mark>
            : <span key={index}>{piece.text}</span>))}
        </span>
        {row.seen ? (
          <span className="mt-1.5 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('bible.search.seen')}
          </span>
        ) : null}
        {props.selected ? <VerseActions row={row} {...props} /> : null}
      </span>
    </Option>
  );
}

/** The last option while more verses were found than shown: the arrows reach it, Enter or a press adds the next ones. */
function ShowMoreOption({ row, ...props }: OptionProps & { row: Extract<ModelRow, { type: 'showMore' }> }) {
  return (
    <Option row={row} {...props} className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 text-center ${props.touch ? 'min-h-14 py-2' : 'min-h-12 py-2'}`}>
      <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-indigo-700 dark:text-indigo-300">
        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
        {row.title}
      </span>
      <span className="text-[13px] tabular-nums text-gray-500 dark:text-gray-400">{row.meta}</span>
    </Option>
  );
}

function FixRow({ row, touch, showHowTo, onRun, onHowTo }: { row: Extract<ModelRow, { type: 'fix' }>; touch: boolean; showHowTo: boolean; onRun: (intent: Intent) => void; onHowTo: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-4">
      <p className="text-[15px] font-semibold text-gray-900 dark:text-white">{row.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{row.text}</p>
      {row.actions.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {row.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => onRun(action.run)} className={`${action.primary ? PRIMARY : SECONDARY} ${touch ? 'h-11' : 'h-9'}`}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {row.chapters ? <ChapterTiles count={row.chapters.count} touch={touch} onPick={(chapter) => onRun(row.chapters!.pick(chapter))} /> : null}
      {showHowTo ? (
        <button type="button" onClick={onHowTo} className={`-ml-2 mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${touch ? 'h-11 px-3' : 'h-8'}`}>
          <QuestionMarkCircleIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
          {t('bible.search.help')}
        </button>
      ) : null}
    </div>
  );
}

/** What stands outside the list: headings, fixes, chapter tiles, notes. */
function OtherRow({ row, touch, showHowTo, onRun, onHowTo }: { row: Exclude<ModelRow, OptionRow>; touch: boolean; showHowTo: boolean; onRun: (intent: Intent) => void; onHowTo: () => void }) {
  switch (row.type) {
    case 'head':
      return <p className="px-4 pb-1.5 pt-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400">{row.title}</p>;
    case 'chapters':
      return <div className="px-4 pb-4"><ChapterTiles count={row.count} touch={touch} onPick={(chapter) => onRun(row.pick(chapter))} /></div>;
    case 'fix':
      return <FixRow row={row} touch={touch} showHowTo={showHowTo} onRun={onRun} onHowTo={onHowTo} />;
    default:
      return <p role="status" className="px-4 py-3 text-[13px] text-gray-500 dark:text-gray-400">{row.text}</p>;
  }
}

/** Where it looked, how many, the forms and the wider places; then, when many, the books to narrow to. */
function SearchHeadView({ head, chipHeight, onRun, onToggleBooks, allInBible }: { head: NonNullable<SearchModel['head']>; chipHeight: string; onRun: (intent: Intent) => void; onToggleBooks: () => void; allInBible?: Props['allInBible'] }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          {head.scope ? (
            <span className="inline-flex h-7 items-center rounded-lg bg-indigo-50 px-2.5 text-[13px] font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">{head.scope}</span>
          ) : null}
          <span className="text-[13px] text-gray-500 dark:text-gray-400">
            <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{head.count}</span>
            {head.where ? (head.scope ? ` · ${head.where}` : ` ${head.where}`) : ''}
          </span>
          {head.asWordsLink ? (
            <button type="button" onClick={() => onRun(head.asWordsLink!.run)} className={`ml-auto rounded-lg px-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${chipHeight}`}>
              {head.asWordsLink.label}
            </button>
          ) : null}
          {allInBible ? (
            <button type="button" onClick={allInBible.onPress} className={`${head.asWordsLink ? '' : 'ml-auto'} inline-flex items-center rounded-[10px] bg-amber-500 px-3 text-[13px] font-semibold text-white transition hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${chipHeight}`}>
              {allInBible.label}
            </button>
          ) : null}
        </div>
        {head.formsLabel && head.forms.length ? (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>{head.formsLabel}</span>
            {head.forms.map((form) => <span key={form} className="whitespace-nowrap text-gray-700 dark:text-gray-200">{form}</span>)}
          </p>
        ) : null}
        {head.wider.length ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="mr-0.5">{head.widerLabel}</span>
            {head.wider.map((step) => (
              <button key={step.label} type="button" onClick={() => onRun(step.run)} className={`${CHIP} ${chipHeight}`}>
                {step.label}
                <span className="tabular-nums text-gray-400">{step.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {head.books.length ? (
        <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
          <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('bible.search.narrow')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {head.books.map((book) => (
              <button key={book.label} type="button" onClick={() => onRun(book.run)} className={`${CHIP} ${chipHeight}`}>
                {book.label}
                <span className="tabular-nums text-gray-400">{book.count}</span>
              </button>
            ))}
            {head.booksToggle ? (
              <button type="button" onClick={onToggleBooks} className={`rounded-lg px-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${chipHeight}`}>
                {head.booksToggle}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Memoized: the line's letters do not draw the results again; a new model, choice or copy does. */
export const SearchResults = memo(function SearchResults({ model, selectedKey, wide, touch, showHowTo, keysHint, listId, textLang, optionId, onRun, onChoose, onCopy, copiedKey, onHowTo, onToggleBooks, actionLabel, allInBible }: Props) {
  const { t } = useTranslation();
  const { head } = model;
  const chipHeight = touch ? 'h-11' : 'h-7';
  // The rows in order: what comes before the first choice, the choices (with the headings between them
  // drawn but hidden from the list), and what comes after the last.
  const first = model.rows.findIndex(isOption);
  const last = model.rows.length - 1 - [...model.rows].reverse().findIndex(isOption);
  const before = first < 0 ? model.rows : model.rows.slice(0, first);
  const choices = first < 0 ? [] : model.rows.slice(first, last + 1);
  const after = first < 0 ? [] : model.rows.slice(last + 1);
  const other = (row: ModelRow) => (isOption(row) ? null : <OtherRow key={row.key} row={row} touch={touch} showHowTo={showHowTo} onRun={onRun} onHowTo={onHowTo} />);
  const chosenVerse = choices.find((row): row is VerseRow => row.type === 'verse' && row.key === selectedKey) ?? null;
  const optionProps = (row: OptionRow): OptionProps => ({ selected: row.key === selectedKey, wide, touch, textLang, id: optionId(row.key), onRun, onChoose, onCopy, copiedKey, actionLabel });
  return (
    <div>
      {model.offline ? (
        <p role="status" className="flex items-start gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-[13px] leading-snug text-gray-700 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-200">
          <SignalSlashIcon className="mt-px h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          {model.offline}
        </p>
      ) : null}
      {model.layout ? (
        <p className="border-b border-gray-100 px-4 py-2.5 text-[13px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {t('bible.search.layoutFixed')} <span className="font-semibold text-gray-900 dark:text-white">«{model.layout}»</span>
        </p>
      ) : null}
      {head ? <SearchHeadView head={head} chipHeight={chipHeight} onRun={onRun} onToggleBooks={onToggleBooks} allInBible={allInBible} /> : null}
      {before.map(other)}
      {choices.length ? (
        <ul id={listId} role="listbox" aria-label={t('bible.search.results')}>
          {choices.map((row) => {
            switch (row.type) {
              case 'place':
                return <PlaceOption key={row.key} row={row} {...optionProps(row)} />;
              case 'book':
                return <BookOption key={row.key} row={row} {...optionProps(row)} />;
              case 'verse':
                return <VerseOption key={row.key} row={row} {...optionProps(row)} />;
              case 'showMore':
                return <ShowMoreOption key={row.key} row={row} {...optionProps(row)} />;
              case 'head':
                return <li key={row.key} aria-hidden="true" className="px-4 pb-1.5 pt-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400">{row.title}</li>;
              default:
                return null;
            }
          })}
        </ul>
      ) : null}
      {chosenVerse ? <ChosenVerseActions row={chosenVerse} onRun={onRun} onCopy={onCopy} actionLabel={actionLabel} /> : null}
      {after.map(other)}
      {keysHint ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span className="inline-flex items-center gap-1"><kbd className={KEYCAP}>↑</kbd><kbd className={KEYCAP}>↓</kbd> {t('bible.search.keysPick')}</span>
          <span className="inline-flex items-center gap-1"><kbd className={KEYCAP}>↵</kbd> {t('bible.search.keysOpen')}</span>
          {keysHint.copy ? <span className="inline-flex items-center gap-1"><kbd className={KEYCAP}>{keysHint.copy}</kbd> {t('bible.search.keysCopy')}</span> : null}
          <span className="inline-flex items-center gap-1"><kbd className={KEYCAP}>Esc</kbd> {keysHint.esc}</span>
        </p>
      ) : null}
    </div>
  );
});
