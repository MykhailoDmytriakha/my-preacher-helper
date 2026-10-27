import { getLocalizedAbbrev } from '@/utils/bibleBooks';

import { matchersOf, partBooks, type BookGroups, type SearchQuery, type SearchScope } from './query';
import { matcherOf, withoutEnding, type SearchLanguage, type WordMatcher } from './wordForms';
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
  /**
   * The words of the same stem, after the word's own forms: the first `own` hits hold the word itself, the rest only
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

const eitherOf = (one: WordMatcher, other: WordMatcher): WordMatcher => ({ ...one, key: `${one.key}|${other.key}`, test: (word) => one.test(word) || other.test(word) });

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
    const kin = withKin(own, query.language) ?? own;
    const beginning = own.pattern || index.knows(exactly(own.term)) ? null : matcherOf(`${own.term}*`, query.language);
    const known = beginning !== null && index.knows(own);
    if (beginning && (index.knows(beginning) || !known)) {
      begun.push(own.term);
      matchers.push(beginning);
      widened.push(known ? eitherOf(beginning, kin) : beginning);
    } else {
      matchers.push(own);
      widened.push(kin);
    }
  }
  return { matchers, widened, begun };
}

/**
 * The stems whose kin are searched with a word. From four letters, any word the stem begins: «свет» finds «светильник»
 * and «светлый». Three letters begin other words too often — «гор» begins «город» (479 verses), «вер» «верблюд» and
 * «верх», «бог» «богатство», «мол» «молоко» — so their kin are only the words a word-forming suffix makes of them:
 * a verb's or its noun's «-и-», «-у-», «-ь-» («суд» — «судить», «судилище», «судья»; «род» — «родила»; «вера» —
 * «верующий»), «-ост-» («милость», «радости»), «-ен-» («верен»), «-ов-», «-евн-» («духовный», «душевный»), «-ес-»
 * («небо» — «небесный»), «-н-», «-ьн-», «-ск-», «-ств-» («мирный», «сильный», «царство»). Chosen on the Synodal text, 2026-10-27, after the owner's
 * «дух», «душ» and «суд»: a vowel «-о-», «-а-», «-е-» brings mostly other words, «-ев-» alone «верёвки»; the few the
 * chosen ones let in — «левиты» for «лев», «весьма» for «весь», «делить» for «дело» — come after the word's own verses.
 * English keeps to four letters.
 */
const KIN_STEM_LETTERS = 4;
const SHORT_STEM_LETTERS = 3;
const SHORT_STEM_SUFFIXES: Readonly<Record<SearchLanguage, readonly string[]>> = {
  ru: ['и', 'у', 'ь', 'ост', 'ен', 'ов', 'евн', 'ес', 'н', 'ск', 'ств'],
  uk: ['и', 'і', 'у', 'ь', 'іст', 'ен', 'ов', 'евн', 'ес', 'н', 'ськ', 'ств'],
  en: [],
};

/**
 * The stem a word's kin begin with: the word without its ending and a last vowel or soft sign — «слава» → «слав»,
 * «светом» → «свет» like «свет» (Codex review, 2026-10-27: «Прит светом» lost the kin «Прит свет» finds); null — too short.
 */
export function stemOf(term: string, language: SearchLanguage): string | null {
  const stem = withoutEnding(term, language).replace(/[аеёиоуыэюяьйіїєъaeiouy]$/u, '');
  return stem.length >= SHORT_STEM_LETTERS && /^\p{L}+$/u.test(stem) ? stem : null;
}

/** The words of a stem: any it begins, or for a short one those a word-forming suffix makes; null — none searched. */
function kinOf(stem: string, language: SearchLanguage): WordMatcher | null {
  if (stem.length >= KIN_STEM_LETTERS) return matcherOf(`${stem}*`, language);
  const suffixes = SHORT_STEM_SUFFIXES[language];
  if (!suffixes.length) return null;
  return {
    term: stem, pattern: false, tooShort: false, key: `s:${language}:${stem}`,
    test: (word) => word.startsWith(stem) && suffixes.some((suffix) => word.startsWith(suffix, stem.length)),
  };
}

/** The word in its forms or any word of its stem (the owner, 2026-10-27: «Прит свет» did not find «светильник»). */
function withKin(own: WordMatcher, language: SearchLanguage): WordMatcher | null {
  const stem = own.pattern ? null : stemOf(own.term, language);
  const kin = stem ? kinOf(stem, language) : null;
  return kin ? { ...eitherOf(own, kin), key: `k:${own.key}|${kin.key}` } : null;
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
  const isOwn = (hit: VerseHit) => {
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
