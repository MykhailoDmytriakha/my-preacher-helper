import type { WordMatcher } from './wordForms';

/** Normalized literal words in order; only the last word of an unclosed phrase is a beginning. */
export type SearchPhrase = { words: readonly string[]; complete: boolean };

/** Exact words can use the index's existing ID lookup; a prefix uses its bounded matcher flags. */
export type PhraseWordMatcher = WordMatcher & { literal: string | null };

/** One comparison rule for the index, actual found forms and whole-word highlighting. */
export function phraseWordMatchers(phrase: SearchPhrase): PhraseWordMatcher[] {
  return phrase.words.map((term, position) => {
    const prefix = !phrase.complete && position === phrase.words.length - 1;
    return {
      term, pattern: false, tooShort: false,
      literal: prefix ? null : term,
      key: 'phrase:' + (prefix ? 'prefix:' : 'exact:') + term,
      test: prefix ? (word: string) => term.length > 0 && word.startsWith(term) : (word: string) => word === term,
    };
  });
}

/** The first contiguous matching run from this position, for word IDs or normalized text words. */
export function findPhraseRun<T>(words: ArrayLike<T>, tests: readonly ((word: T) => boolean)[], from = 0): number {
  if (!tests.length) return -1;
  for (let start = from; start + tests.length <= words.length; start += 1) {
    let at = 0;
    while (at < tests.length && tests[at](words[start + at])) at += 1;
    if (at === tests.length) return start;
  }
  return -1;
}

/** Actual completed forms of a phrase within one verse, each counted once for that verse. */
export function matchingPhraseForms(words: readonly string[], phrase: SearchPhrase): string[] {
  const tests = phraseWordMatchers(phrase).map(matcher => matcher.test);
  const forms = new Set<string>();
  let at = findPhraseRun(words, tests);
  while (at >= 0) {
    forms.add(words.slice(at, at + tests.length).join(' '));
    at = findPhraseRun(words, tests, at + 1);
  }
  return [...forms];
}

/** Widening a search must retain whether the person finished the quoted phrase. */
export const phraseText = (phrase: SearchPhrase): string => '"' + phrase.words.join(' ') + (phrase.complete ? '"' : '');
