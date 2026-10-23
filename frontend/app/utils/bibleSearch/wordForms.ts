/**
 * WORD FORMS: a word typed in one form finds its other forms — «вера» finds «веры», «верою»; «любовь»
 * finds «любви»; «love» finds «loveth». The rule is by endings: the word loses its ending (its base keeps
 * three letters at least), and a word of the text is a form of it when it is that base plus one of the
 * language's endings. It reads the Synodal, Ohienko and King James texts well, and it is not a
 * dictionary: «мир» also finds «миро». A word with a sign is taken as written — `*` any letters, `_` one
 * letter — and a word of two letters is taken as written too («то», «он»): its endings would be other words.
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
};

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
 * the base with it dropped or put back: «любовь», «любовью» and «любви» share «любов» and «любв»; «отца»
 * finds «отец». The same set whichever form was typed, so the forms found do not depend on it.
 */
function basesOf(term: string, language: SearchLanguage): string[] {
  let base = term;
  for (const ending of cutsByLanguage[language]) {
    if (term.endsWith(ending) && term.length - ending.length >= 3) {
      base = term.slice(0, -ending.length);
      break;
    }
  }
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

export function matcherOf(term: string, language: SearchLanguage): WordMatcher {
  if (PATTERN.test(term)) {
    const pattern = term.replace(/\*+/g, '*').slice(0, PATTERN_LIMIT);
    return { term, pattern: true, tooShort: pattern.replace(/[*_]/g, '').length < 2, key: `p:${pattern}`, test: (word) => fitsPattern(word, pattern) };
  }
  if (term.length < 3) return { term, pattern: false, tooShort: false, key: `w:${term}`, test: (word) => word === term };
  const bases = basesOf(term, language);
  const endings = endingSets[language];
  return {
    term,
    pattern: false,
    tooShort: false,
    // The predicate is the bases and the endings: two forms of one word are one search.
    key: `b:${language}:${bases.join('|')}`,
    test: (word) => bases.some((base) => word.startsWith(base) && endings.has(word.slice(base.length))),
  };
}
