import { BIBLE_BOOKS_DATA, getLocalizedAbbrev } from '@/utils/bibleBooks';
import { referenceFromText } from '@/utils/bibleLink';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { normalizeSpokenScriptureReferences } from '@/utils/scriptureReferenceNormalizer';
import { exactBook } from '@/utils/scriptureReferenceParser';
import { chapterCount, verseCount } from '@/utils/versification';

import { digitsForNumberWords, isNumberWord, ordinalOf } from './numberWords';
import { matcherOf, type SearchLanguage, type WordMatcher } from './wordForms';
import { normalizeWord } from './words';

/**
 * WHAT ONE LINE OF THE BIBLE MEANS — a place to open or words to find, and where to find them (the
 * owner, 2026-10-22: «где + что»). A place is read by the app's own reader of references
 * (`referenceFromText`): «Ин 3:16», «Рим 8:28-39», «Иуд 3». Around it the line understands what people
 * say and type in a hurry: numbers in words («Иоанна три шестнадцать»), «3 глава 16 стих», digits run
 * together («Иоанна 316» — 3:16 or 31:6?), a chapter and verse alone in the book being read («8:28»).
 * Everything else is a search: the first words say where — a book («Иоанна хлеб»), its chapter
 * («Рим 4 вера»), a passage («Ин 6:25-59 хлеб»), a Testament («НЗ благодать»), a part of the Bible
 * («Пророки утешение») — and the rest are the words, with their forms (`wordForms.ts`), signs
 * (`*`, `_`) and phrases in quotes.
 */

/** The books of a Bible by Testament and group, in its order (`components/bible/bookOrder.ts`). */
export type BookGroups = ReadonlyArray<{ key: 'old' | 'new'; groups: ReadonlyArray<{ key: string; ids: readonly string[] }> }>;

export type PartKey = 'old' | 'new' | 'law' | 'history' | 'wisdom' | 'prophets' | 'gospels' | 'epistles' | 'generalEpistles' | 'paulineEpistles';

export type SearchScope =
  | {
    kind: 'book';
    bookId: string;
    /** The chapter, when one was named («Рим 4 вера»). */
    chapter: number | null;
    /** A passage of that chapter («Ин 6:25-59 хлеб»). */
    fromVerse: number | null;
    toVerse: number | null;
    /** The words that named the book, as typed: the way to search them as a word. */
    said: string;
    /** The book's name is also an everyday word («Плач», «Лев», «Числа»). */
    wordLike: boolean;
  }
  | { kind: 'part'; part: PartKey; bookIds: readonly string[]; said: string };

export type SearchQuery = {
  scope: SearchScope | null;
  /** The words to find, as compared (`normalizeWord`), with their signs. */
  terms: string[];
  /** Words in quotes: found together, in this order, as written. */
  phrases: string[][];
  /** The words without the scope, as a line again: what a wider search is written with. */
  text: string;
  /** Every word of the line, the scope's too: the line searched as words. */
  all: string;
  language: SearchLanguage;
};

export type PlaceReading =
  | { kind: 'place'; bookId: string; chapter: number; verse: number | null; toVerse: number | null; relative: boolean }
  | { kind: 'book'; bookId: string }
  | { kind: 'choices'; bookId: string; choices: Array<{ chapter: number; verse: number }>; relative: boolean }
  | { kind: 'badChapter'; bookId: string; chapter: number; relative: boolean }
  | { kind: 'badVerse'; bookId: string; chapter: number; verse: number; relative: boolean }
  | { kind: 'needBook' };

export type LineReading =
  | { kind: 'empty' }
  | PlaceReading
  | { kind: 'part'; scope: Extract<SearchScope, { kind: 'part' }> }
  | { kind: 'scopeBadChapter'; bookId: string; chapter: number; query: SearchQuery }
  | { kind: 'tooShort'; query: SearchQuery }
  | { kind: 'search'; query: SearchQuery; prefixBooks: string[] };

export type LineContext = {
  bible: BibleId;
  books: BookGroups;
  /** The book being read: «8:28» opens there. */
  hereBook?: string | null;
  /** The first words are read as words, not as a book («плач скрежет» after «искать как слова»). */
  asWords?: boolean;
};

const PART_WORDS: ReadonlyArray<readonly [string, PartKey]> = [
  ['новый завет', 'new'], ['новом завете', 'new'], ['нового завета', 'new'], ['нз', 'new'],
  ['ветхий завет', 'old'], ['ветхом завете', 'old'], ['ветхого завета', 'old'], ['вз', 'old'],
  ['евангелия', 'gospels'], ['евангелиях', 'gospels'], ['евангелиям', 'gospels'],
  ['пророки', 'prophets'], ['пророках', 'prophets'], ['пророков', 'prophets'],
  ['послания павла', 'paulineEpistles'], ['посланиях павла', 'paulineEpistles'],
  ['соборные послания', 'generalEpistles'], ['соборных посланиях', 'generalEpistles'],
  ['послания', 'epistles'], ['посланиях', 'epistles'],
  ['пятикнижие', 'law'], ['пятикнижии', 'law'],
  ['исторические книги', 'history'], ['исторических книгах', 'history'], ['исторические', 'history'],
  ['учительные книги', 'wisdom'], ['учительных книгах', 'wisdom'], ['учительные', 'wisdom'],
  ['новий заповіт', 'new'], ['новому заповіті', 'new'], ['нового заповіту', 'new'],
  ['старий заповіт', 'old'], ['старому заповіті', 'old'], ['старого заповіту', 'old'], ['сз', 'old'],
  ['євангелія', 'gospels'], ['євангеліях', 'gospels'],
  ['послання павла', 'paulineEpistles'], ['посланнях павла', 'paulineEpistles'],
  ['соборні послання', 'generalEpistles'], ['соборних посланнях', 'generalEpistles'],
  ['послання', 'epistles'], ['посланнях', 'epistles'],
  ['пятикнижжя', 'law'], ['пятикнижжі', 'law'],
  ['історичні книги', 'history'], ['історичні', 'history'], ['учительні книги', 'wisdom'], ['учительні', 'wisdom'],
  ['new testament', 'new'], ['nt', 'new'], ['old testament', 'old'], ['ot', 'old'],
  ['gospels', 'gospels'], ['the gospels', 'gospels'], ['prophets', 'prophets'], ['the prophets', 'prophets'],
  ['pauline epistles', 'paulineEpistles'], ['epistles of paul', 'paulineEpistles'], ['letters of paul', 'paulineEpistles'],
  ['general epistles', 'generalEpistles'], ['epistles', 'epistles'], ['pentateuch', 'law'], ['torah', 'law'],
  ['history books', 'history'], ['wisdom books', 'wisdom'],
];
const PARTS_LONGEST_FIRST = PART_WORDS.map(([words, part]) => [words.split(' '), part] as const).sort((a, b) => b[0].length - a[0].length);

/** Words that may stand before a book's name: «в Евангелии от Иоанна», «послание к Римлянам», «the Gospel of John». */
const BEFORE_BOOK = new Set([
  'в', 'во', 'у', 'от', 'к', 'послание', 'послании', 'послания', 'книга', 'книге', 'книги', 'евангелие', 'евангелии', 'евангелия',
  'апостола', 'святого', 'пророка',
  'від', 'до', 'послання', 'книзі', 'євангеліє', 'євангелії',
  'in', 'the', 'book', 'of', 'gospel', 'epistle', 'letter', 'to', 'according', 'st', 'saint',
]);
/** Words that may open a line before its book: «открой Евангелие от Иоанна 3:16», «show me John 3:16». */
const INTRO = new Set([...BEFORE_BOOK, 'открой', 'открыть', 'покажи', 'найди', 'пожалуйста', 'відкрий', 'знайди', 'будь', 'ласка', 'open', 'show', 'me', 'find', 'please']);
const STOP = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'от', 'о', 'об', 'у', 'а', 'но', 'же', 'ли', 'бы',
  'і', 'й', 'та', 'з', 'із', 'до', 'від', 'але', 'б', 'би',
  'the', 'a', 'an', 'and', 'of', 'in', 'to',
]);
const WORD_LIKE_BOOKS = new Set([
  'лев', 'суд', 'плач', 'числа', 'исход', 'мал', 'бытие', 'песнь', 'судей', 'притчи',
  'вихід', 'буття', 'суддів', 'приповісті', 'пісня', 'дії',
  'mark', 'acts', 'job', 'numbers', 'judges', 'kings', 'lamentations', 'revelation', 'proverbs', 'exodus',
]);
const CHAPTER_WORDS = /^(глав|розділ|chapter)/;

const languageOf = (bible: BibleId): SearchLanguage => BIBLES[bible].language;
const isDigits = (word: string | undefined): boolean => word !== undefined && /^\d+$/.test(word);

/**
 * Book names as said without their little word: «Иоанна» for «От Иоанна», «Івана» for «Від Івана»,
 * «Римлянам» for «К Римлянам» — in every language, so a Ukrainian name works with any Bible open.
 */
const BARE_NAMES = new Map<string, string>(
  BIBLE_BOOKS_DATA.flatMap((book) => (['ru', 'uk', 'en'] as const).map((language) => {
    const bare = normalizeWord(book.names[language]).replace(/^(от|к|до|від)\s+/, '');
    return [bare, book.id] as const;
  }))
);

/** The book a run of words names exactly — a name, an abbreviation, a known alias; never a guess from first letters. */
function bookNamed(words: readonly string[], language: SearchLanguage): string | null {
  const name = words.join(' ');
  if (words.length === 1 && (STOP.has(name) || name.length < 2)) return null;
  return exactBook(name, language) ?? BARE_NAMES.get(name) ?? null;
}

/** A chapter named after a book: «4», «четыре», «двадцать третья», with «глава» before or after; then maybe «:25-59». */
function chapterAfter(words: readonly string[], start: number): { chapter: number | null; fromVerse: number | null; toVerse: number | null; used: number } {
  let at = start;
  if (words[at] && CHAPTER_WORDS.test(words[at])) at += 1;
  let chapter: number | null = null;
  if (isDigits(words[at])) {
    chapter = Number(words[at]);
    at += 1;
  } else {
    for (let size = 3; size >= 1 && chapter === null; size -= 1) {
      const said = words.slice(at, at + size);
      if (said.length !== size || !said.every(isNumberWord)) continue;
      const digits = digitsForNumberWords(said);
      if (digits.length === 1 && isDigits(digits[0])) {
        chapter = Number(digits[0]);
        at += size;
      }
    }
  }
  if (chapter === null) return { chapter: null, fromVerse: null, toVerse: null, used: start };
  if (words[at] && CHAPTER_WORDS.test(words[at])) at += 1;
  let fromVerse: number | null = null;
  let toVerse: number | null = null;
  if (words[at] === ':' && isDigits(words[at + 1])) {
    fromVerse = Number(words[at + 1]);
    at += 2;
    if (words[at] === '-' && isDigits(words[at + 1])) {
      toVerse = Number(words[at + 1]);
      at += 2;
    }
  }
  return { chapter, fromVerse, toVerse: fromVerse !== null ? Math.max(fromVerse, toVerse ?? fromVerse) : null, used: at };
}

export function partBooks(part: PartKey, books: BookGroups): string[] {
  if (part === 'old' || part === 'new') return books.find((testament) => testament.key === part)?.groups.flatMap((group) => group.ids) ?? [];
  const keys = part === 'epistles' ? ['generalEpistles', 'paulineEpistles'] : [part];
  return books.flatMap((testament) => testament.groups.filter((group) => keys.includes(group.key)).flatMap((group) => group.ids));
}

/** A book's own number said before its name: «1», «первое», «second». */
function bookNumber(word: string | undefined, spoken: boolean): string | null {
  if (word === undefined) return null;
  if (/^[123]$/.test(word)) return word;
  const said = spoken ? ordinalOf(word) : null;
  return said !== null && said <= 3 ? String(said) : null;
}

/**
 * The book a line begins with, and where its name ends. Words that only lead in («в», «Евангелие от»,
 * «открой», «the Gospel of») are passed over, but never the words of a name itself — «Song of Solomon»
 * keeps its «of». A book's number may stand apart from its name: «первое послание к Коринфянам».
 */
function bookAtStart(words: readonly string[], language: SearchLanguage, spoken: boolean): { bookId: string; start: number; end: number } | null {
  for (let start = 0; start < words.length && start <= 4; start += 1) {
    if (start > 0 && !INTRO.has(words[start - 1])) break;
    for (let size = Math.min(5, words.length - start); size >= 1; size -= 1) {
      const name = words.slice(start, start + size);
      if (name.some((word, k) => word === ':' || word === '-' || (k > 0 && isDigits(word)))) continue;
      const number = size > 1 ? bookNumber(name[0], spoken) : null;
      const bookId = bookNamed(number ? [number, ...name.slice(1)] : name, language);
      if (bookId) return { bookId, start, end: start + size };
    }
    const number = bookNumber(words[start], spoken);
    if (number) {
      let at = start + 1;
      while (at < words.length && INTRO.has(words[at])) at += 1;
      for (let size = 1; size <= 3 && at + size <= words.length; size += 1) {
        const bookId = bookNamed([number, ...words.slice(at, at + size)], language);
        if (bookId) return { bookId, start, end: at + size };
      }
    }
  }
  return null;
}

function scopeAt(words: readonly string[], language: SearchLanguage, books: BookGroups): (SearchScope & { used: number }) | null {
  const book = bookAtStart(words, language, true);
  if (book) {
    const { chapter, fromVerse, toVerse, used } = chapterAfter(words, book.end);
    const said = words.slice(book.start, book.end).join(' ');
    return { kind: 'book', bookId: book.bookId, chapter, fromVerse, toVerse, said, wordLike: book.end - book.start === 1 && WORD_LIKE_BOOKS.has(said), used };
  }
  // A part of the Bible, perhaps after «в»/«in».
  const start = words[0] === 'в' || words[0] === 'во' || words[0] === 'у' || words[0] === 'in' ? 1 : 0;
  for (const [parts, part] of PARTS_LONGEST_FIRST) {
    if (parts.every((word, k) => words[start + k] === word)) {
      return { kind: 'part', part, bookIds: partBooks(part, books), said: words.slice(start, start + parts.length).join(' '), used: start + parts.length };
    }
  }
  return null;
}

const withoutUsed = ({ used, ...scope }: SearchScope & { used: number }): SearchScope => (void used, scope as SearchScope);

const QUOTED = /["«»„“”]([^"«»„“”]*)["«»„“”]?/g;

/** The words of a search line: a passage's «:» and «-» kept between digits, other signs as spaces. */
function searchWordsOf(text: string): string[] {
  return normalizeWord(text)
    .replace(/(\d)\s*:\s*(\d)/g, '$1 : $2')
    .replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 - $2')
    .replace(/[^\p{L}\p{N}*_:\- ]+/gu, ' ')
    .replace(/(^|[^\d ]) *[:-] *(?=[^\d ]|$)/g, '$1 ')
    .replace(/(\p{L})-(\p{L})/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

/** The line as a search: where (when its first words say it) and what. */
export function readSearch(raw: string, { bible, books, asWords = false }: Pick<LineContext, 'bible' | 'books' | 'asWords'>): SearchQuery {
  const language = languageOf(bible);
  const phrases: string[][] = [];
  const outside = raw.replace(QUOTED, (_, inside: string) => {
    const words = normalizeWord(inside).match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length) phrases.push(words);
    return ' ';
  });
  const words = searchWordsOf(outside);
  const found = asWords ? null : scopeAt(words, language, books);
  const rest = words.slice(found ? found.used : 0);
  const terms = rest.filter((word) => !STOP.has(word) && !isDigits(word) && word !== ':' && word !== '-' && (word.length > 1 || /[*_]/.test(word)));
  const asLine = (list: string[]) => [list.filter((word) => word !== ':' && word !== '-').join(' '), ...phrases.map((phrase) => `"${phrase.join(' ')}"`)].filter(Boolean).join(' ');
  return { scope: found ? withoutUsed(found) : null, terms, phrases, text: asLine(rest), all: asLine(words), language };
}

/** The matchers of a query's words. */
export const matchersOf = (query: SearchQuery): WordMatcher[] => query.terms.map((term) => matcherOf(term, query.language));

/** Books whose name or abbreviation begins with what is typed («Ио» — От Иоанна, 1 Иоанна…), for a line that names none yet. */
export function booksBeginningWith(raw: string, languages: readonly SearchLanguage[]): string[] {
  const key = normalizeWord(raw).trim();
  if (!key || /\d/.test(key) || key.includes(' ')) return [];
  const bare = (name: string) => normalizeWord(name).replace(/^(от|к|до|від)\s+/, '');
  return BIBLE_BOOKS_DATA.filter((book) => languages.some((language) => {
    const name = bare(book.names[language]);
    return name.startsWith(key) || normalizeWord(book.abbrev[language]).startsWith(key) || (key.length >= 2 && name.split(' ').some((word) => word.startsWith(key)));
  })).map((book) => book.id).slice(0, 12);
}

/**
 * How a place's numbers stand in its book: there, or a chapter or verse it does not have, or digits run
 * together. A passage ends at the chapter's last verse at most: «Ин 3:16-1000» is 3:16–36.
 */
function placeIn(bible: BibleId, bookId: string, chapter: number | null, verse: number | null, toVerse: number | null, relative: boolean): PlaceReading {
  if (chapter === null) return { kind: 'book', bookId };
  const chapters = chapterCount(bible, bookId);
  if (chapter < 1) return { kind: 'badChapter', bookId, chapter, relative };
  if (chapter > chapters) {
    // Dictation writes «316» for «три шестнадцать»: every way the digits split into a real place.
    if (verse === null && chapter >= 100 && chapter < 100000) {
      const digits = String(chapter);
      const choices: Array<{ chapter: number; verse: number }> = [];
      for (let cut = 1; cut < digits.length; cut += 1) {
        if (digits[cut] === '0') continue;
        const c = Number(digits.slice(0, cut));
        const v = Number(digits.slice(cut));
        if (c >= 1 && c <= chapters && v >= 1 && v <= verseCount(bible, bookId, c)) choices.push({ chapter: c, verse: v });
      }
      if (choices.length) return { kind: 'choices', bookId, choices, relative };
    }
    return { kind: 'badChapter', bookId, chapter, relative };
  }
  const verses = verseCount(bible, bookId, chapter);
  if (verse !== null && (verse < 1 || verse > verses)) return { kind: 'badVerse', bookId, chapter, verse, relative };
  const end = verse !== null && toVerse !== null ? Math.min(Math.max(toVerse, verse), verses) : null;
  return { kind: 'place', bookId, chapter, verse, toVerse: end, relative };
}

/** The line as a place, or null when it names none. */
export function readPlace(raw: string, { bible, hereBook }: Pick<LineContext, 'bible' | 'hereBook'>): PlaceReading | null {
  const language = languageOf(bible);
  const tokens = digitsForNumberWords(normalizeWord(raw).replace(/[,;!?«»"()]/g, ' ').split(/\s+/).filter(Boolean));
  if (!tokens.length) return null;

  // Numbers alone, perhaps after «открой»: a place in the book being read («8:28», «3 16»).
  const numbers = tokens.filter((word) => !INTRO.has(word)).join(' ');
  const bare = numbers.match(/^(\d+)(?:\s*[:.\s]\s*(\d+))?(?:\s*-\s*(\d+))?$/);
  if (bare) {
    if (!hereBook) return { kind: 'needBook' };
    const chapter = Number(bare[1]);
    const verse = bare[2] ? Number(bare[2]) : null;
    if (chapterCount(bible, hereBook) === 1 && verse === null) return placeIn(bible, hereBook, 1, chapter, null, true);
    return placeIn(bible, hereBook, chapter, verse, bare[3] ? Number(bare[3]) : null, true);
  }

  // «двадцать третий псалом», «23 псалом»: the number before the book's name.
  const words = tokens.length === 2 && isDigits(tokens[0]) && bookNamed([tokens[1]], language) ? [tokens[1], tokens[0]] : tokens;
  // A book named exactly at the start — «Ио» is not John, it only begins its name. Its words are then
  // written as the book's abbreviation, which the reader of references knows in every language, and
  // «3 глава 16 стих» as «3:16» (`normalizeSpokenScriptureReferences`).
  const lead = bookAtStart(words, language, false);
  if (!lead) return null;
  const text = normalizeSpokenScriptureReferences([getLocalizedAbbrev(lead.bookId, language), ...words.slice(lead.end)].join(' '));
  const ref = referenceFromText(text, bible);
  if (!ref || ref.book !== lead.bookId) return null;
  return placeIn(bible, ref.book, ref.chapter ?? null, ref.fromVerse ?? null, ref.toVerse ?? null, false);
}

/** What the line means, in the order a person means it: a place first, then a search. */
export function readLine(raw: string, context: LineContext): LineReading {
  if (!raw.trim()) return { kind: 'empty' };
  // Words in quotes are search, whatever they spell: «"плач"» is the word, not the book.
  if (!context.asWords && !/["«»„“”]/.test(raw)) {
    const place = readPlace(raw, context);
    if (place) return place;
  }
  const query = readSearch(raw, context);
  const hasWords = query.terms.length > 0 || query.phrases.length > 0;
  if (query.scope?.kind === 'book' && query.scope.chapter !== null) {
    const { bookId, chapter, fromVerse, toVerse } = query.scope;
    if (chapter < 1 || chapter > chapterCount(context.bible, bookId)) return { kind: 'scopeBadChapter', bookId, chapter, query };
    // A searched passage is kept within its chapter: «Ин 6:25-1000 хлеб» searches 6:25 to the chapter's end.
    // A passage with no words is a place, checked as written: «Ин 3:0» has no verse 0.
    if (fromVerse !== null && hasWords) {
      const verses = verseCount(context.bible, bookId, chapter);
      const from = Math.min(Math.max(fromVerse, 1), verses);
      query.scope = { ...query.scope, fromVerse: from, toVerse: Math.min(Math.max(toVerse ?? from, from), verses) };
    }
  }
  const { scope } = query;
  if (scope?.kind === 'part' && !hasWords) return { kind: 'part', scope };
  if (scope?.kind === 'book' && !hasWords) {
    return placeIn(context.bible, scope.bookId, scope.chapter, scope.fromVerse, scope.toVerse, false);
  }
  if (matchersOf(query).some((matcher) => matcher.tooShort)) return { kind: 'tooShort', query };
  const languages: SearchLanguage[] = Array.from(new Set([languageOf(context.bible), 'ru', 'uk', 'en'] as SearchLanguage[]));
  // Words searched as words offer no book their first letters begin («плач» is not «Плач Иеремии» then).
  return { kind: 'search', query, prefixBooks: scope || context.asWords ? [] : booksBeginningWith(raw, languages) };
}
