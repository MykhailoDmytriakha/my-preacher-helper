import { getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { readSearch, type BookGroups, type LineReading, type SearchQuery, type SearchScope } from '@/utils/bibleSearch/query';
import { scopeBookIds, type SearchAnswer, type WiderStep } from '@/utils/bibleSearch/results';
import { piecesOfText } from '@/utils/bibleSearch/words';
import { chapterCount, verseCount } from '@/utils/versification';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { SearchIndexState } from '@/utils/bibleSearch/searchIndexStore';
import type { WordMatcher } from '@/utils/bibleSearch/wordForms';
import type { TFunction } from 'i18next';

/**
 * WHAT THE LINE SHOWS UNDER IT for what was typed — a pure description the view draws: the rows that
 * can be chosen (with the arrows and Enter on a computer), the head of a search (where it looked, how
 * many, the forms, wider places), and the notes. Kept apart from the drawing so every state of the
 * line is a function of its input and can be checked without a screen.
 */
export type OpenTarget = { bookId: string; chapter: number; verse: number; toVerse?: number };

export type ModelAction = { label: string; primary: boolean; run: Intent };

/** What a choice asks the line to do; the component carries it out. */
export type Intent =
  | { kind: 'open'; target: OpenTarget; fromSearch: boolean }
  | { kind: 'write'; line: string; asWords?: boolean }
  | { kind: 'asWords'; on: boolean }
  | { kind: 'showChapters' }
  /** Show the verses up to `limit`; the arrows go to `next`, the first of the new ones. */
  | { kind: 'more'; limit: number; next: string };

export type ModelRow =
  | { type: 'head'; key: string; title: string }
  | { type: 'place'; key: string; title: string; text: string | null; meta: string | null; note: string | null; run: Intent; primary: boolean }
  | { type: 'book'; key: string; title: string; sub: string; run: Intent }
  | { type: 'chapters'; key: string; bookId: string; count: number; pick: (chapter: number) => Intent }
  | { type: 'verse'; key: string; ref: string; pieces: Array<{ text: string; lit: boolean }>; seen: boolean; run: Intent }
  | { type: 'fix'; key: string; title: string; text: string; actions: ModelAction[]; chapters: { bookId: string; count: number; pick: (chapter: number) => Intent } | null }
  | { type: 'more'; key: string; text: string }
  /** The verses beyond those shown: pressed, the next ones join the list. */
  | { type: 'showMore'; key: string; title: string; meta: string; run: Intent };

export type SearchHead = {
  scope: string | null;
  count: string;
  where: string;
  formsLabel: string | null;
  forms: string[];
  widerLabel: string;
  wider: Array<{ label: string; count: number; run: Intent }>;
  asWordsLink: { label: string; run: Intent } | null;
  books: Array<{ label: string; count: number; run: Intent }>;
  booksToggle: string | null;
};

export type SearchModel = {
  rows: ModelRow[];
  head: SearchHead | null;
  offline: string | null;
  /** The line was typed with the English layout: what it was read as. */
  layout: string | null;
};

type ChoiceRow = Extract<ModelRow, { type: 'place' | 'book' | 'verse' | 'showMore' }>;

/**
 * What Enter opens among `rows`: the row the arrows are on when it is there — a verse the history put them
 * on (Codex review, 2026-10-23: a fast Enter opened the first verse instead) — else the first place, book
 * or verse.
 */
export function rowForEnter(rows: readonly ModelRow[], selectedKey: string | null): ChoiceRow | null {
  const choices = rows.filter((row): row is ChoiceRow => row.type === 'place' || row.type === 'book' || row.type === 'verse' || row.type === 'showMore');
  return choices.find((row) => row.key === selectedKey) ?? choices.find((row) => row.type !== 'showMore') ?? null;
}

/** Verses shown at first, and added by each «Показать ещё». */
export const SHOWN_VERSES = 40;
const PHONE_BOOK_CHIPS = 4;
const WIDE_BOOK_CHIPS = 6;

export type ModelInput = {
  reading: LineReading;
  /** The books of the Bible by group: to know whether a line written for a wider search would read as a book. */
  books: BookGroups;
  answer: SearchAnswer | null;
  index: SearchIndexState;
  bible: BibleId;
  locale: AppLocale;
  t: TFunction;
  wide: boolean;
  /** The words of the line were read as words, not as a book («искать как слова»). */
  asWords: boolean;
  /** The book the line would read without «asWords», to go back to it. */
  bookReadAs: string | null;
  allBooks: boolean;
  fixChapters: boolean;
  /** Verses opened from this search in this visit: «Открывали». */
  opened: ReadonlySet<string>;
  /** How many of the verses found are shown: `SHOWN_VERSES`, and more after «Показать ещё». */
  limit: number;
  offline: boolean;
  /** The line as read after turning the English layout, when it was typed so. */
  layoutFixed: string | null;
};

const placeKey = (bookId: string, chapter: number, verse: number) => `${bookId} ${chapter}:${verse}`;

export function verseRef(bookId: string, chapter: number, verse: number, locale: AppLocale): string {
  return `${getLocalizedAbbrev(bookId, locale)} ${chapter}:${verse}`;
}

export function scopeLabel(scope: SearchScope, locale: AppLocale, t: TFunction): string {
  if (scope.kind === 'part') return t(`bible.search.parts.${scope.part}`);
  const name = getLocalizedBookName(scope.bookId, locale);
  if (scope.chapter === null) return name;
  if (scope.fromVerse !== null) return `${name} ${scope.chapter}:${scope.fromVerse}${scope.toVerse !== null && scope.toVerse > scope.fromVerse ? `–${scope.toVerse}` : ''}`;
  return t(scope.bookId === 'Psalms' ? 'bible.search.scopePsalm' : 'bible.search.scopeChapter', { book: name, chapter: scope.chapter });
}

function widerLabel(step: WiderStep, coverage: Coverage, t: TFunction): string {
  if (step.kind === 'chapter') return t('bible.search.widerChapter', { chapter: step.chapter });
  if (step.kind === 'book') return t('bible.search.widerBook');
  if (step.kind === 'testament') return t(step.testament === 'new' ? 'bible.search.widerNew' : 'bible.search.widerOld');
  if (coverage === 'saved') return t('bible.search.widerSavedAll');
  return t(coverage === 'loaded' ? 'bible.search.widerLoadedAll' : 'bible.search.widerBible');
}

function notFoundTitle(scope: SearchScope, locale: AppLocale, t: TFunction): string {
  if (scope.kind === 'part') {
    if (scope.part === 'new') return t('bible.search.notInNew');
    if (scope.part === 'old') return t('bible.search.notInOld');
    return t('bible.search.notInPart', { part: t(`bible.search.parts.${scope.part}`) });
  }
  if (scope.chapter === null) return t('bible.search.notInBook', { book: getLocalizedBookName(scope.bookId, locale) });
  return t('bible.search.notInPlace', { place: scopeLabel(scope, locale, t) });
}

/** The verse cut into pieces, the words the search found marked. */
function litPieces(text: string, query: SearchQuery, matchers: readonly WordMatcher[]): Array<{ text: string; lit: boolean }> {
  const phraseWords = new Set(query.phrases.flat());
  return piecesOfText(text).map((piece) => ({
    text: piece.text,
    lit: piece.word !== null && (matchers.some((matcher) => matcher.test(piece.word as string)) || phraseWords.has(piece.word)),
  }));
}

type VerseTextOf = (bookId: string, chapter: number, verse: number) => string | null;

/** Words and steps every builder below shares. */
function vocabulary(input: ModelInput) {
  const { bible, locale, t } = input;
  return {
    name: (bookId: string) => getLocalizedBookName(bookId, locale),
    abbrev: (bookId: string) => getLocalizedAbbrev(bookId, locale),
    chapters: (bookId: string, count = chapterCount(bible, bookId)) => t(bookId === 'Psalms' ? 'bible.psalmCount' : 'bible.chapterCount', { count }),
    verses: (count: number) => t('bible.search.verses', { count }),
    write: (line: string): Intent => ({ kind: 'write', line }),
    // Written for the whole Bible, the words alone: «плач» stays a word, it does not become the book Lamentations.
    widen: (line: string): Intent => ({ kind: 'write', line, asWords: readSearch(line, { bible: input.bible, books: input.books }).scope !== null }),
    open: (bookId: string, chapter: number, verse: number, toVerse?: number): Intent => ({ kind: 'open', target: { bookId, chapter, verse, ...(toVerse ? { toVerse } : {}) }, fromSearch: false }),
  };
}

const fix = (title: string, text: string, actions: ModelAction[] = [], chapters: Extract<ModelRow, { type: 'fix' }>['chapters'] = null): ModelRow =>
  ({ type: 'fix', key: 'fix', title, text, actions, chapters });

/** «Ин 3:16», «Пс 22», «Рим 8:28-39»: the place, its first verse, what opens — a verse, a chapter, a passage. */
function placeRow(input: ModelInput, reading: Extract<LineReading, { kind: 'place' }>, verseTextOf: VerseTextOf): ModelRow {
  const { bible, t } = input;
  const words = vocabulary(input);
  const { bookId, chapter, verse, toVerse } = reading;
  const passage = verse !== null && toVerse !== null && toVerse > verse;
  const title = `${words.name(bookId)} ${chapter}${verse !== null ? `:${verse}${passage ? `–${toVerse}` : ''}` : ''}`;
  let meta: string | null = null;
  if (verse === null) meta = t('bible.search.wholeChapterMeta', { verses: words.verses(verseCount(bible, bookId, chapter)) });
  else if (passage) meta = t('bible.search.passageMeta', { verses: words.verses((toVerse as number) - verse + 1) });
  return {
    type: 'place', key: 'place', title, text: verseTextOf(bookId, chapter, verse ?? 1), meta,
    note: reading.relative ? t('bible.search.inCurrentBook') : null,
    run: words.open(bookId, chapter, verse ?? 1, verse !== null ? (toVerse ?? verse) : undefined),
    primary: true,
  };
}

function placeRows(input: ModelInput, verseTextOf: VerseTextOf): ModelRow[] {
  const { reading, bible, t, fixChapters } = input;
  const words = vocabulary(input);
  switch (reading.kind) {
    case 'place':
      return [placeRow(input, reading, verseTextOf)];
    case 'book': {
      const count = chapterCount(bible, reading.bookId);
      if (count === 1) {
        return [{ type: 'place', key: 'place', title: words.name(reading.bookId), text: verseTextOf(reading.bookId, 1, 1), meta: words.verses(verseCount(bible, reading.bookId, 1)), note: null, run: words.open(reading.bookId, 1, 1), primary: true }];
      }
      return [
        { type: 'head', key: 'head', title: `${words.name(reading.bookId)} · ${words.chapters(reading.bookId, count)}` },
        { type: 'chapters', key: 'chapters', bookId: reading.bookId, count, pick: (chapter) => words.open(reading.bookId, chapter, 1) },
      ];
    }
    case 'choices':
      return [
        { type: 'head', key: 'head', title: t(reading.choices.length === 1 ? 'bible.search.maybe' : 'bible.search.whichPlace') },
        ...reading.choices.map((choice, i): ModelRow => ({
          type: 'place', key: `choice-${i}`, title: `${words.name(reading.bookId)} ${choice.chapter}:${choice.verse}`,
          text: verseTextOf(reading.bookId, choice.chapter, choice.verse), meta: null, note: null, run: words.open(reading.bookId, choice.chapter, choice.verse, choice.verse), primary: i === 0,
        })),
      ];
    case 'badChapter': {
      const count = chapterCount(bible, reading.bookId);
      return [fix(
        t('bible.search.badChapterTitle', { book: words.name(reading.bookId), chapters: words.chapters(reading.bookId, count) }),
        t('bible.search.badChapterText', { chapter: reading.chapter, count }),
        [
          { label: t('bible.search.fixChapter'), primary: true, run: words.write(`${words.abbrev(reading.bookId)} `) },
          ...(fixChapters ? [] : [{ label: t('bible.search.showChapters'), primary: false, run: { kind: 'showChapters' } as Intent }]),
        ],
        fixChapters ? { bookId: reading.bookId, count, pick: (chapter) => words.open(reading.bookId, chapter, 1) } : null,
      )];
    }
    case 'badVerse':
      return [fix(
        t('bible.search.badVerseTitle', { chapter: reading.chapter, verses: words.verses(verseCount(bible, reading.bookId, reading.chapter)) }),
        t('bible.search.badVerseText', { verse: reading.verse }),
        [{ label: t('bible.search.openChapter', { chapter: reading.chapter }), primary: true, run: words.open(reading.bookId, reading.chapter, 1) }],
      )];
    case 'needBook':
      return [fix(t('bible.search.needBookTitle'), t('bible.search.needBookText', { example: t(`bible.search.examples.${bible}.needBook`) }))];
    default:
      return [];
  }
}

/** «Пророки», «НЗ» alone: the books of that part, each written into the line when chosen. */
function partRows(input: ModelInput, scope: Extract<SearchScope, { kind: 'part' }>): ModelRow[] {
  const { t } = input;
  const words = vocabulary(input);
  return [
    { type: 'head', key: 'head', title: `${t(`bible.search.parts.${scope.part}`)} · ${t('bible.search.books', { count: scope.bookIds.length })}` },
    ...scope.bookIds.map((bookId): ModelRow => ({ type: 'book', key: `book-${bookId}`, title: words.name(bookId), sub: words.chapters(bookId), run: words.write(`${words.abbrev(bookId)} `) })),
  ];
}

/** «Рим 40 вера»: the book's chapters, each keeping the words; or the whole book. */
function scopeBadChapterRows(input: ModelInput, reading: Extract<LineReading, { kind: 'scopeBadChapter' }>): ModelRow[] {
  const { bible, t, fixChapters } = input;
  const words = vocabulary(input);
  const count = chapterCount(bible, reading.bookId);
  const abbrev = words.abbrev(reading.bookId);
  return [fix(
    t('bible.search.badChapterTitle', { book: words.name(reading.bookId), chapters: words.chapters(reading.bookId, count) }),
    t('bible.search.scopeBadChapterText', { chapter: reading.chapter }),
    [
      ...(fixChapters ? [] : [{ label: t('bible.search.showChapters'), primary: true, run: { kind: 'showChapters' } as Intent }]),
      { label: t('bible.search.searchWholeBook'), primary: false, run: words.write(`${abbrev} ${reading.query.text}`) },
    ],
    fixChapters ? { bookId: reading.bookId, count, pick: (chapter) => words.write(`${abbrev} ${chapter} ${reading.query.text}`) } : null,
  )];
}

function formsLabelOf(input: ModelInput, query: SearchQuery, answer: SearchAnswer): string | null {
  const { t, asWords } = input;
  if (asWords) return t('bible.search.asWords');
  if (query.terms.some((term) => /[*_]/.test(term))) return t('bible.search.byPattern');
  if (answer.begun.length) return t('bible.search.begun', { words: answer.begun.map((word) => t('bible.search.quote', { text: word })).join(', ') });
  if (!query.terms.length) return t('bible.search.phrase');
  return answer.forms.length > query.terms.length ? t('bible.search.formsFound') : null;
}

/** How much of the Bible the search covered: all of it, or only the books this device has (offline, or a download failed). */
type Coverage = 'full' | 'loading' | 'saved' | 'loaded';

function coverageOf({ index, offline }: ModelInput): Coverage {
  if (index.indexed >= index.total) return 'full';
  if (index.loading) return 'loading';
  return offline ? 'saved' : 'loaded';
}

function whereOf(input: ModelInput, scope: SearchScope | null, coverage: Coverage): string {
  const { t, index } = input;
  if (coverage === 'loading') return t('bible.search.stillLoading', { done: index.indexed, total: index.total });
  if (scope) return coverage === 'full' ? '' : t(coverage === 'saved' ? 'bible.search.onlySaved' : 'bible.search.onlyLoaded');
  if (coverage === 'full') return t('bible.search.inBible');
  return t(coverage === 'saved' ? 'bible.search.inSaved' : 'bible.search.inLoaded');
}

function asWordsLinkOf(input: ModelInput, scope: SearchScope | null): SearchHead['asWordsLink'] {
  const { t, asWords, bookReadAs } = input;
  if (asWords && bookReadAs) return { label: t('bible.search.searchInBook', { book: vocabulary(input).name(bookReadAs) }), run: { kind: 'asWords', on: false } };
  if (scope?.kind === 'book' && scope.wordLike) return { label: t('bible.search.asWordLink', { word: scope.said }), run: { kind: 'asWords', on: true } };
  return null;
}

/** Where it looked, how many, the forms found, the wider places — the head of a search that found something. */
function searchHead(input: ModelInput, query: SearchQuery, answer: SearchAnswer, coverage: Coverage): SearchHead {
  const { t, wide, asWords, allBooks, locale } = input;
  const words = vocabulary(input);
  const head: SearchHead = {
    scope: query.scope ? scopeLabel(query.scope, locale, t) : null,
    count: words.verses(answer.hits.length),
    where: whereOf(input, query.scope, coverage),
    formsLabel: formsLabelOf(input, query, answer),
    forms: asWords ? query.terms : answer.forms.slice(0, wide ? 7 : 4),
    widerLabel: t(coverage === 'saved' ? 'bible.search.widerSaved' : coverage === 'loaded' ? 'bible.search.widerLoaded' : 'bible.search.wider'),
    // While books still arrive the wider counts would grow under the eye: they wait for the whole index.
    wider: coverage === 'loading' ? [] : answer.wider.map((step) => ({ label: widerLabel(step, coverage, t), count: step.count, run: step.kind === 'bible' ? words.widen(step.line) : words.write(step.line) })),
    asWordsLink: asWordsLinkOf(input, query.scope),
    books: [],
    booksToggle: null,
  };
  // Many: the books with the most, in the Bible's order; «Ещё» shows them all.
  if (answer.hits.length > SHOWN_VERSES && answer.byBook.size > 1) {
    const order = Array.from(answer.byBook.keys());
    const limit = wide ? WIDE_BOOK_CHIPS : PHONE_BOOK_CHIPS;
    const count = (bookId: string) => answer.byBook.get(bookId) ?? 0;
    const richest = new Set(order.slice().sort((a, b) => count(b) - count(a)).slice(0, limit));
    const shown = allBooks ? order : order.filter((bookId) => richest.has(bookId));
    head.books = shown.map((bookId) => ({ label: words.name(bookId), count: count(bookId), run: words.write(`${words.abbrev(bookId)} ${query.text}`) }));
    const more = order.length - shown.length;
    if (allBooks) head.booksToggle = t('bible.search.collapse');
    else if (more > 0) head.booksToggle = t('bible.search.moreBooks', { count: more });
  }
  return head;
}

/**
 * Nothing where it looked: the reason, how much there is wider, and the one step that helps. When not
 * every book was searched (offline, or a download failed) the counts say so and never claim «nowhere in
 * the Bible» — the steps and explanations stay.
 */
function nothingRow(input: ModelInput, query: SearchQuery, answer: SearchAnswer, coverage: Coverage): ModelRow {
  const { t, locale } = input;
  const words = vocabulary(input);
  const { scope } = query;
  const quoted = `«${query.text}»`;
  const partial = coverage === 'saved' || coverage === 'loaded';
  const wider = answer.everywhere
    ? t(partial ? (coverage === 'saved' ? 'bible.search.everywhereSaved' : 'bible.search.everywhereLoaded') : 'bible.search.everywhere', { words: quoted, verses: words.verses(answer.everywhere) })
    : '';
  const notThere = partial ? t(coverage === 'saved' ? 'bible.search.savedNothingText' : 'bible.search.loadedNothingText') : t('bible.search.nowhere');
  if (scope?.kind === 'book' && scope.wordLike) {
    const said = scope.said.charAt(0).toUpperCase() + scope.said.slice(1);
    return fix(
      notFoundTitle(scope, locale, t),
      [t('bible.search.wordLike', { word: said }), wider].filter(Boolean).join(' '),
      [
        { label: t('bible.search.searchAsWords', { words: query.all }), primary: true, run: { kind: 'asWords', on: true } },
        ...(answer.everywhere ? [{ label: t('bible.search.searchOnly', { words: quoted }), primary: false, run: words.widen(query.text) }] : []),
      ],
    );
  }
  if (scope) {
    return fix(notFoundTitle(scope, locale, t), wider || notThere, answer.everywhere ? [{ label: t('bible.search.searchBible'), primary: true, run: words.widen(query.text) }] : []);
  }
  if (partial) return fix(t(coverage === 'saved' ? 'bible.search.savedNothingTitle' : 'bible.search.loadedNothingTitle'), notThere);
  return fix(t('bible.search.nothingTitle'), t('bible.search.nothingText'));
}

/** Offline the search says where it looked: the saved books of the place searched, named when few. */
function offlineNote(input: ModelInput, scope: SearchScope | null, coverage: Coverage): string {
  const { t, index } = input;
  const ids = scope ? scopeBookIds(scope) : null;
  const kept = ids ? ids.filter((bookId) => index.index.has(bookId)) : null;
  const named = kept && kept.length > 0 && kept.length <= 3 ? `: ${kept.map(vocabulary(input).name).join(', ')}` : '';
  return t(coverage === 'saved' ? 'bible.search.offline' : 'bible.search.partial', { kept: kept ? kept.length : index.indexed, total: ids ? ids.length : index.total, named });
}

function searchModel(input: ModelInput, reading: Extract<LineReading, { kind: 'search' }>, empty: SearchModel): SearchModel {
  const { answer, index, opened, locale, t, limit } = input;
  const { query, prefixBooks } = reading;
  const words = vocabulary(input);
  const rows: ModelRow[] = [];
  if (prefixBooks.length && answer?.hits.length) rows.push({ type: 'head', key: 'books-head', title: t('bible.search.booksHead') });
  prefixBooks.forEach((bookId) => rows.push({ type: 'book', key: `book-${bookId}`, title: words.name(bookId), sub: words.chapters(bookId), run: words.write(`${words.abbrev(bookId)} `) }));
  // A word of two letters is still being typed: the books it begins are the answer for now.
  const hasWords = query.terms.length > 0 || query.phrases.length > 0;
  if (!hasWords || (!query.scope && query.all.replace(/\s/g, '').length < 3)) return { ...empty, rows };

  const coverage = coverageOf(input);
  if (!answer) {
    // No book to search yet: on its way, or none came.
    if (index.loading) rows.push({ type: 'more', key: 'loading', text: t('bible.search.loadingBooks') });
    else rows.push(fix(t('bible.search.unavailableTitle'), t('bible.search.unavailableText')));
    return { ...empty, rows };
  }
  answer.hits.slice(0, limit).forEach((hit) => {
    const key = placeKey(hit.book, hit.chapter, hit.verse);
    rows.push({
      type: 'verse', key, ref: verseRef(hit.book, hit.chapter, hit.verse, locale), pieces: litPieces(hit.text, query, answer.matchers), seen: opened.has(key),
      run: { kind: 'open', target: { bookId: hit.book, chapter: hit.chapter, verse: hit.verse, toVerse: hit.verse }, fromSearch: true },
    });
  });
  if (answer.hits.length > limit) {
    // The rest are a press away, a step at a time: «Господь» finds thousands, and the list stays quick.
    const next = answer.hits[limit];
    rows.push({
      type: 'showMore', key: 'show-more',
      title: t('bible.search.showMore', { count: Math.min(SHOWN_VERSES, answer.hits.length - limit) }),
      meta: t('bible.search.shownOf', { shown: limit, count: answer.hits.length }),
      run: { kind: 'more', limit: limit + SHOWN_VERSES, next: placeKey(next.book, next.chapter, next.verse) },
    });
  }
  if (!answer.hits.length && !prefixBooks.length) {
    // Books still arriving: nothing found yet is not «nothing».
    rows.push(coverage === 'loading' ? { type: 'more', key: 'loading', text: t('bible.search.stillLoadingTitle', { done: index.indexed, total: index.total }) } : nothingRow(input, query, answer, coverage));
  }
  return {
    rows,
    head: answer.hits.length ? searchHead(input, query, answer, coverage) : null,
    offline: coverage === 'saved' || coverage === 'loaded' ? offlineNote(input, query.scope, coverage) : null,
    layout: input.layoutFixed,
  };
}

export function buildSearchModel(input: ModelInput, verseTextOf: VerseTextOf): SearchModel {
  const { reading, bible, t, layoutFixed } = input;
  const empty: SearchModel = { rows: [], head: null, offline: null, layout: layoutFixed };
  switch (reading.kind) {
    case 'empty':
      return { ...empty, layout: null };
    case 'part':
      return { ...empty, rows: partRows(input, reading.scope) };
    case 'scopeBadChapter':
      return { ...empty, rows: scopeBadChapterRows(input, reading) };
    case 'tooShort':
      return { ...empty, rows: [fix(t('bible.search.tooShortTitle'), t('bible.search.tooShortText', { example: t(`bible.search.examples.${bible}.tooShort`) }))] };
    case 'search':
      return searchModel(input, reading, empty);
    default:
      return { ...empty, rows: placeRows(input, verseTextOf) };
  }
}
