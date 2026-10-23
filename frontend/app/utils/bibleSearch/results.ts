import { getLocalizedAbbrev } from '@/utils/bibleBooks';

import { matchersOf, partBooks, type BookGroups, type SearchQuery, type SearchScope } from './query';
import { matcherOf, type SearchLanguage, type WordMatcher } from './wordForms';
import { wordsOfText } from './words';


import type { BibleSearchIndex, VerseHit } from './searchIndex';

/**
 * A SEARCH ANSWERED: the verses where it looked, how many there are wider — the book of a chapter, the
 * Testament, the whole Bible — and the forms of the words it found. Each wider step carries the line
 * that searches there, so a tap on it writes the place into the line and the person learns the way to
 * type it (the owner's canvas, 2026-10-22: «Шире: во всей книге 36 · в Новом Завете 240 · во всей Библии 248»).
 */
export type WiderStep = { kind: 'chapter' | 'book' | 'testament' | 'bible'; testament?: 'old' | 'new'; chapter?: number; count: number; line: string };

export type SearchAnswer = {
  hits: VerseHit[];
  /** Verses with the words in the whole index, whatever the scope said. */
  everywhere: number;
  /** Verses by book, in the scope. */
  byBook: Map<string, number>;
  /** The forms found, the commonest first. */
  forms: string[];
  /** Wider places to search, narrowest first, each with more verses than here. */
  wider: WiderStep[];
  /** What each word was searched by — the words found in a verse are marked by these. */
  matchers: WordMatcher[];
  /** The words searched as beginnings: the Bible has none of them whole («оде» while «одежда» is typed). */
  begun: string[];
};

const TESTAMENT_WORDS: Readonly<Record<SearchLanguage, Record<'old' | 'new', string>>> = {
  ru: { old: 'ВЗ', new: 'НЗ' },
  uk: { old: 'СЗ', new: 'НЗ' },
  en: { old: 'OT', new: 'NT' },
};

const FORMS_SAMPLE = 500;

const lineWith = (prefix: string, text: string) => [prefix, text].filter(Boolean).join(' ');

export function scopeBookIds(scope: SearchScope): readonly string[] {
  return scope.kind === 'book' ? [scope.bookId] : scope.bookIds;
}

function inScope(hit: VerseHit, scope: SearchScope | null): boolean {
  if (!scope) return true;
  if (scope.kind === 'part') return scope.bookIds.includes(hit.book);
  if (hit.book !== scope.bookId) return false;
  if (scope.chapter !== null && hit.chapter !== scope.chapter) return false;
  if (scope.fromVerse !== null && (hit.verse < scope.fromVerse || hit.verse > (scope.toVerse ?? scope.fromVerse))) return false;
  return true;
}

/**
 * The matchers a search runs with. A word the Bible has in no form is read as the beginning of one: the
 * line is read at every keystroke, so «НЗ оде» finds «одежда» before it is typed to the end, and a word
 * finished — «одежд» — is back to its own forms. A word the Bible has keeps to them: «мир» is not «мирра».
 */
function matchersIn(index: BibleSearchIndex, query: SearchQuery): { matchers: WordMatcher[]; begun: string[] } {
  const begun: string[] = [];
  const matchers = matchersOf(query).map((matcher) => {
    if (matcher.pattern || index.knows(matcher)) return matcher;
    begun.push(matcher.term);
    return matcherOf(`${matcher.term}*`, query.language);
  });
  return { matchers, begun };
}

/** The forms found, the commonest first — read from the first verses: enough to name them, and «Господь»
 * (thousands of verses) stays as quick to type as any other word. */
function formsIn(hits: readonly VerseHit[], matchers: readonly WordMatcher[], phrases: readonly (readonly string[])[]): string[] {
  const formCounts = new Map<string, number>();
  for (const hit of hits.slice(0, FORMS_SAMPLE)) {
    const words = wordsOfText(hit.text);
    for (const word of words) if (matchers.some((matcher) => matcher.test(word))) formCounts.set(word, (formCounts.get(word) ?? 0) + 1);
    for (const phrase of phrases) formCounts.set(phrase.join(' '), (formCounts.get(phrase.join(' ')) ?? 0) + 1);
  }
  return Array.from(formCounts.entries()).sort((a, b) => b[1] - a[1]).map(([form]) => form);
}

/** The wider places around the scope, narrowest first, with the verses each holds of `all`. */
function widerSteps(all: readonly VerseHit[], query: SearchQuery, books: BookGroups): WiderStep[] {
  const { scope } = query;
  if (!scope) return [];
  const wider: WiderStep[] = [];
  const testamentOf = (bookId: string): 'old' | 'new' => (partBooks('new', books).includes(bookId) ? 'new' : 'old');
  const ids = scopeBookIds(scope);
  const testament = testamentOf(ids[0]);
  const oneTestament = ids.every((id) => testamentOf(id) === testament);
  const abbrev = scope.kind === 'book' ? getLocalizedAbbrev(scope.bookId, query.language) : '';
  if (scope.kind === 'book' && scope.fromVerse !== null && scope.chapter !== null) {
    wider.push({ kind: 'chapter', chapter: scope.chapter, count: all.filter((hit) => hit.book === scope.bookId && hit.chapter === scope.chapter).length, line: lineWith(`${abbrev} ${scope.chapter}`, query.text) });
  }
  if (scope.kind === 'book' && scope.chapter !== null) {
    wider.push({ kind: 'book', count: all.filter((hit) => hit.book === scope.bookId).length, line: lineWith(abbrev, query.text) });
  }
  if (oneTestament && !(scope.kind === 'part' && scope.part === testament)) {
    wider.push({ kind: 'testament', testament, count: all.filter((hit) => testamentOf(hit.book) === testament).length, line: lineWith(TESTAMENT_WORDS[query.language][testament], query.text) });
  }
  wider.push({ kind: 'bible', count: all.length, line: query.text });
  return wider;
}

export function answerSearch(index: BibleSearchIndex, query: SearchQuery, books: BookGroups): SearchAnswer {
  const { matchers, begun } = matchersIn(index, query);
  const all = index.search(matchers, query.phrases);
  const hits = all.filter((hit) => inScope(hit, query.scope));
  const byBook = new Map<string, number>();
  hits.forEach((hit) => byBook.set(hit.book, (byBook.get(hit.book) ?? 0) + 1));
  const wider = widerSteps(all, query, books).filter((step) => step.count > hits.length);
  return { hits, everywhere: all.length, byBook, forms: formsIn(hits, matchers, query.phrases), wider, matchers, begun };
}
