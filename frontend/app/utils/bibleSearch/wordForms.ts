import { shortNounFormsOf } from './shortNounForms';
import { isLexicalWord, lexicalFormsOf } from './wordFormLexicon';

/**
 * Candidate inflections come from the existing endings and spelling rules. Known Russian/Ukrainian
 * words also need a shared verified lexical reading; letters alone must not turn one word into another.
 * Unknown names keep ordinary same-base endings, with no invented internal vowel. Explicit patterns,
 * unverified short words and English retain their existing contracts.
 */
export type SearchLanguage = 'ru' | 'uk' | 'en';

const ENDINGS: Readonly<Record<SearchLanguage, readonly string[]>> = {
  ru: ['', 'а', 'я', 'о', 'е', 'ь', 'ы', 'и', 'у', 'ю', 'й', 'ой', 'ей', 'ою', 'ею', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ами', 'ями', 'ов', 'ев',
    'ий', 'ия', 'ие', 'ье', 'ья', 'ью', 'ии', 'ию', 'ием', 'иям', 'иях', 'иями', 'ьи', 'ьям', 'ьях', 'ьями', 'ьев',
    'ый', 'ая', 'ое', 'ые', 'ого', 'его', 'ому', 'ему', 'ым', 'им', 'ую', 'юю', 'ых', 'их', 'ыми', 'ими', 'яя', 'ее'],
  uk: ['', 'а', 'я', 'о', 'е', 'є', 'і', 'ї', 'и', 'у', 'ю', 'й', 'ь', 'ою', 'ею', 'єю', 'ом', 'ем', 'єм', 'ам', 'ям', 'ах', 'ях', 'ами', 'ями',
    'ів', 'їв', 'ей', 'ий', 'ій', 'ої', 'ого', 'ому', 'ім', 'им', 'их', 'іх', 'ими', 'іми', 'ую', 'юю', 'ая', 'яя', 'ії', 'ію', 'ією', 'ові', 'еві', 'єві'],
  en: ['', 'e', 's', 'es', 'ed', 'd', 'ing', 'eth', 'est', 'er', 'ers'],
};
/** What a typed English word loses first: «loved» → «lov», which «loveth» and «love» share. */
const ENGLISH_CUTS = ['eth', 'est', 'ing', 'ers', 'ed', 'es', 'er', 's', 'e'];
const VOWELS = 'аеиоуыэюяєіїё';

const endingSets = Object.fromEntries(Object.entries(ENDINGS).map(([language, list]) => [language, new Set(list)])) as Record<SearchLanguage, Set<string>>;
const cutsOf = (language: SearchLanguage): readonly string[] =>
  language === 'en' ? ENGLISH_CUTS : ENDINGS[language].filter(Boolean).slice().sort((a, b) => b.length - a.length);
const cutsByLanguage = { ru: cutsOf('ru'), uk: cutsOf('uk'), en: cutsOf('en') } as const;

export type WordMatcher = {
  /** The word as typed (compared spelling). */
  term: string;
  /** A word with `*` or `_`: taken as written. */
  pattern: boolean;
  /** A pattern with fewer than two letters: it would find nearly every word. */
  tooShort: boolean;
  /** One key per set of forms: «вера» and «веры» search the same. */
  key: string;
  test: (word: string) => boolean;
  /** A verified compact noun stays complete and keeps its identity through every form. */
  lemma?: string;
  /** Extra evidence from the printed token when a verified form has another reading. */
  testSurface?: (word: string, surface: string) => boolean;
};

export const matchesSurface = (matcher: WordMatcher, word: string, surface: string): boolean =>
  matcher.testSurface ? matcher.testSurface(word, surface) : matcher.test(word);

const PATTERN = /[*_]/;
/** A pattern longer than a word of the Bible, or with more stars than help, is cut to this. */
const PATTERN_LIMIT = 32;

/**
 * Whether a word fits a pattern: `*` any letters (none too), `_` exactly one. Matched by walking the two
 * side by side, going back only to the last star — linear for one star, never the regular expression's
 * explosion when a pasted line holds thirty stars in a row.
 */
export function fitsPattern(word: string, pattern: string): boolean {
  let w = 0;
  let p = 0;
  let star = -1;
  let resume = 0;
  while (w < word.length) {
    if (p < pattern.length && (pattern[p] === '_' || pattern[p] === word[w])) {
      w += 1;
      p += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      resume = w;
      p += 1;
    } else if (star >= 0) {
      p = star + 1;
      resume += 1;
      w = resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/**
 * The bases a word's forms are built on: the word without its ending, and — where a vowel comes and goes —
 * the base with it dropped or put back. These are candidate spellings, not proof of word identity;
 * the shared lexical admission below must confirm them. Unknown words do not use this expansion.
 */
/** The word without its ending, as its forms are built on it: «светом» → «свет», «духо» → «дух». */
export function withoutEnding(term: string, language: SearchLanguage): string {
  const ending = cutsByLanguage[language].find((cut) => term.endsWith(cut) && term.length - cut.length >= 3);
  return ending ? term.slice(0, -ending.length) : term;
}

function basesOf(term: string, language: SearchLanguage): string[] {
  const base = withoutEnding(term, language);
  const bases = new Set([base]);
  if (language !== 'en' && base.length >= 3) {
    const last = base[base.length - 1];
    const before = base[base.length - 2];
    const head = base.slice(0, -2);
    const consonant = (letter: string) => !VOWELS.includes(letter) && letter !== 'й' && letter !== 'ь';
    if ('ео'.includes(before) && consonant(last) && head.length >= 1 && consonant(head[head.length - 1])) bases.add(head + last);
    if (consonant(before) && consonant(last)) {
      bases.add(`${head}${before}е${last}`);
      bases.add(`${head}${before}о${last}`);
    }
  }
  return Array.from(bases).sort();
}

const patternOf = (term: string): string => term.replace(/\*+/g, '*').slice(0, PATTERN_LIMIT);
const patternTooShort = (pattern: string): boolean => pattern.replace(/[*_]/g, '').length < 2;

/** Query validation is available before lexical data; ordinary short words remain exact words. */
export const isTooShortPattern = (term: string): boolean => PATTERN.test(term) && patternTooShort(patternOf(term));

export function matcherOf(term: string, language: SearchLanguage): WordMatcher {
  if (PATTERN.test(term)) {
    const pattern = patternOf(term);
    return { term, pattern: true, tooShort: patternTooShort(pattern), key: `p:${pattern}`, test: (word) => fitsPattern(word, pattern) };
  }
  const short = language === 'en' ? undefined : shortNounFormsOf(term, language);
  if (short) {
    const { key, lemma, forms, excluded } = short;
    return {
      term, pattern: false, tooShort: false, lemma, key, test: word => forms.has(word),
      ...(excluded.size ? { testSurface: (word: string, surface: string) =>
        forms.has(word) && (word === term || !excluded.has(surface)) } : {}),
    };
  }
  if (term.length < 3) return { term, pattern: false, tooShort: false, key: `w:${term}`, test: (word) => word === term };
  const lexical = language === 'en' ? null : lexicalFormsOf(term, language);
  const bases = language === 'en' || lexical ? basesOf(term, language) : [withoutEnding(term, language)];
  const endings = endingSets[language];
  return {
    term,
    pattern: false,
    tooShort: false,
    key: lexical ? `${lexical.key}:b:${bases.join('|')}` : `b:${language}:${bases.join('|')}`,
    test: (word) => {
      if (!bases.some((base) => word.startsWith(base) && endings.has(word.slice(base.length)))) return false;
      if (language === 'en') return true;
      if (lexical) return lexical.words.has(word);
      return word === term || !isLexicalWord(word, language);
    },
  };
}
