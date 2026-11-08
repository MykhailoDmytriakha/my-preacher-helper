import { getLocalizedAbbrev } from '@/utils/bibleBooks';

import { matchingPhraseForms, type SearchPhrase } from './phrases';
import { matchersOf, partBooks, type BookGroups, type SearchQuery, type SearchScope } from './query';
import { familyMatcher } from './wordFamilies';
import { matcherOf, matchesSurface, withoutEnding, type SearchLanguage, type WordMatcher } from './wordForms';
import { piecesOfText, wordsOfText } from './words';


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
  /**
   * The words of the same lexical family, after the word's own forms: the first `own` hits hold the word itself, the rest only
   * its kin («свет» — «светильник», «светлый»); `forms` are those kin words, the commonest first. Null — none searched.
   */
  kin: { own: number; forms: string[] } | null;
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
  if (scope.kind !== 'book') return scope.bookIds.includes(hit.book);
  if (hit.book !== scope.bookId) return false;
  if (scope.chapter !== null && hit.chapter !== scope.chapter) return false;
  if (scope.fromVerse !== null && (hit.verse < scope.fromVerse || hit.verse > (scope.toVerse ?? scope.fromVerse))) return false;
  return true;
}

/** A word exactly as typed: whether the Bible has it so, not in some other form. */
const exactly = (term: string): WordMatcher => ({ term, pattern: false, tooShort: false, key: `x:${term}`, test: (word) => word === term });

/** Whether the Bible has this word as written: «иисус», «петр», «коринф» are words; «корин», «духо» are not. */
export const isBibleWord = (index: BibleSearchIndex, word: string): boolean => index.knows(exactly(word));

const eitherOf = (one: WordMatcher, other: WordMatcher): WordMatcher => ({
  ...one,
  key: `${one.key}|${other.key}`,
  test: (word) => one.test(word) || other.test(word),
  ...(one.testSurface || other.testSurface ? {
    testSurface: (word: string, surface: string) => matchesSurface(one, word, surface) || matchesSurface(other, word, surface),
  } : {}),
});

/**
 * The matchers a search runs with, and what each widens to with its kin. A word the Bible has as typed keeps to its
 * forms — «мир» is not «мирра» — and widens to its kin. Letters it has not as a word are the beginning of one, whether
 * the person is still typing them or went on to the next word: «духо» finds «духовные», and the forms its letters
 * would guess («дух», «духе») follow as its kin (the owner, 2026-10-27: «набирал пару букв, а потом уже следующее
 * слово идёт, а они в поиск не попадают»). A form the text lacks that begins no word keeps to the word's other forms.
 */
function matchersIn(index: BibleSearchIndex, query: SearchQuery): { matchers: WordMatcher[]; widened: WordMatcher[]; begun: string[] } {
  const begun: string[] = [];
  const matchers: WordMatcher[] = [];
  const widened: WordMatcher[] = [];
  for (const own of matchersOf(query)) {
    const beginning = own.pattern || own.lemma || index.knows(exactly(own.term))
      ? null
      : matcherOf(`${own.term}*`, query.language);
    let related = own;
    if (beginning && !index.knows(own)) {
      // An unfinished spelling is not an inflection. Its real endingless word can still be offered as kin.
      const base = withoutEnding(own.term, query.language);
      if (base !== own.term && index.knows(exactly(base))) related = matcherOf(base, query.language);
    }
    const known = beginning !== null && index.knows(related);
    if (beginning && (index.knows(beginning) || !known)) {
      begun.push(own.term);
      matchers.push(beginning);
      widened.push(known ? eitherOf(beginning, related) : beginning);
    } else {
      matchers.push(own);
      widened.push(withKin(own, query.language) ?? own);
    }
  }
  return { matchers, widened, begun };
}

function withKin(own: WordMatcher, language: SearchLanguage): WordMatcher | null {
  const kin = familyMatcher(own, language);
  return kin ? eitherOf(own, kin) : null;
}

/** The forms found, the commonest first — read from the first verses: enough to name them, and «Господь»
 * (thousands of verses) stays as quick to type as any other word. */
function formsIn(hits: readonly VerseHit[], matchers: readonly WordMatcher[], phrases: readonly SearchPhrase[]): string[] {
  const formCounts = new Map<string, number>();
  const count = (word: string) => formCounts.set(word, (formCounts.get(word) ?? 0) + 1);
  const usesSurface = matchers.some(matcher => matcher.testSurface);
  for (const hit of hits.slice(0, FORMS_SAMPLE)) {
    const words = wordsOfText(hit.text);
    const found = usesSurface
      ? piecesOfText(hit.text).flatMap(({ word, text }) =>
        word !== null && matchers.some(matcher => matchesSurface(matcher, word, text)) ? [word] : [])
      : words.filter(word => matchers.some(matcher => matcher.test(word)));
    found.forEach(count);
    for (const phrase of phrases) for (const form of matchingPhraseForms(words, phrase)) count(form);
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

const hitKey = (hit: VerseHit) => `${hit.book} ${hit.chapter}:${hit.verse}`;

/**
 * The words themselves first, then their kin: a word searched whole also brings the verses where only a word of its
 * stem stands («свет» → «светильник»), after its own — the verses of the word itself come first, as the person asked.
 */
export function answerSearch(index: BibleSearchIndex, query: SearchQuery, books: BookGroups): SearchAnswer {
  const { matchers, widened, begun } = matchersIn(index, query);
  const kinned = widened.some((matcher, k) => matcher !== matchers[k]);
  // One pass over the index: the widened words find every verse, and a verse is the word's own when each own word
  // stands in it — the line is read at every keystroke (Codex review, 2026-10-27: two searches per reading).
  const found = index.search(kinned ? widened : matchers, query.phrases);
  const usesSurface = matchers.some(matcher => matcher.testSurface);
  const isOwn = (hit: VerseHit) => {
    if (usesSurface) {
      const pieces = piecesOfText(hit.text);
      return matchers.every(matcher => pieces.some(({ word, text }) =>
        word !== null && matchesSurface(matcher, word, text)));
    }
    const words = wordsOfText(hit.text);
    return matchers.every((matcher) => words.some((word) => matcher.test(word)));
  };
  const ownAll = kinned ? found.filter(isOwn) : found;
  const ownKeys = new Set(ownAll.map(hitKey));
  const kinAll = kinned ? found.filter((hit) => !ownKeys.has(hitKey(hit))) : [];
  const all = [...ownAll, ...kinAll];
  const ownHits = ownAll.filter((hit) => inScope(hit, query.scope));
  const kinHits = kinAll.filter((hit) => inScope(hit, query.scope));
  const hits = [...ownHits, ...kinHits];
  const byBook = new Map<string, number>();
  hits.forEach((hit) => byBook.set(hit.book, (byBook.get(hit.book) ?? 0) + 1));
  const wider = widerSteps(all, query, books).filter((step) => step.count > hits.length);
  const ownForms = formsIn(ownHits, matchers, query.phrases);
  // The kin words: for each word, what its widened matcher takes in the kin verses and its own does not — «Прит свет
  // светильник» names «светлый» for «свет» though «светильник» is a word searched itself (Codex review, 2026-10-27).
  const kinForms = Array.from(new Set(widened.flatMap((matcher, k) => (matcher === matchers[k]
    ? []
    : formsIn(kinHits, [matcher], []).filter((form) => !matchers[k].test(form))))));
  return {
    hits, everywhere: all.length, byBook, forms: ownForms, wider, matchers: kinned ? widened : matchers, begun,
    kin: kinHits.length ? { own: ownHits.length, forms: kinForms } : null,
  };
}
