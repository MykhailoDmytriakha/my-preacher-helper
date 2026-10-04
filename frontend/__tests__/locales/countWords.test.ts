import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { createInstance } from 'i18next';

import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

jest.unmock('i18next');

/**
 * A WORD PRINTED RIGHT AFTER A NUMBER TAKES ITS FORM FROM THAT NUMBER.
 *
 * "1 мыслей", "3 заметок", "2 пунктов" (2026-10-04, BUG-20261004-point-thought-count-wrong-plural):
 * the screen wrote `{n} {t('word')}`, the word was stored in one form and never got the number, so
 * i18next could not choose. Each word below has `_one/_few/_many/_other` forms (en: `_one/_other`)
 * and every call that prints it after a number passes `count` (.howto/add-translation-key.md).
 */
type Lang = 'en' | 'ru' | 'uk';
const COUNT_WORDS: Record<string, Record<Lang, Array<[number, string]>>> = {
  'structure.thoughts': {
    ru: [[1, 'мысль'], [3, 'мысли'], [5, 'мыслей'], [21, 'мысль']],
    uk: [[1, 'думка'], [3, 'думки'], [5, 'думок']],
    en: [[1, 'thought'], [3, 'thoughts']],
  },
  'structure.entries': {
    ru: [[1, 'мысль'], [2, 'мысли'], [0, 'мыслей'], [21, 'мысль']],
    uk: [[1, 'думка'], [2, 'думки'], [5, 'думок']],
    en: [[1, 'entry'], [2, 'entries']],
  },
  'dashboard.thoughts': {
    ru: [[1, 'мысль'], [4, 'мысли'], [11, 'мыслей'], [22, 'мысли']],
    uk: [[1, 'думка'], [4, 'думки'], [11, 'думок']],
    en: [[1, 'thought'], [0, 'thoughts']],
  },
  'workspaces.groups.itemsLabel.flowSteps': {
    ru: [[1, 'шаг'], [3, 'шага'], [5, 'шагов']],
    uk: [[1, 'крок'], [3, 'кроки'], [5, 'кроків']],
    en: [[1, 'flow step'], [3, 'flow steps']],
  },
  'workspaces.groups.itemsLabel.templates': {
    ru: [[1, 'шаблон'], [2, 'шаблона'], [7, 'шаблонов']],
    uk: [[1, 'шаблон'], [2, 'шаблони'], [7, 'шаблонів']],
    en: [[1, 'template'], [2, 'templates']],
  },
  'studiesWorkspace.stats.notesLabel': {
    ru: [[1, 'заметка'], [3, 'заметки'], [12, 'заметок']],
    uk: [[1, 'нотатка'], [3, 'нотатки'], [12, 'нотаток']],
    en: [[1, 'note'], [12, 'notes']],
  },
  'studiesWorkspace.stats.booksLabel': {
    ru: [[1, 'книга'], [3, 'книги'], [5, 'книг']],
    uk: [[1, 'книга'], [3, 'книги'], [5, 'книг']],
    en: [[1, 'book'], [5, 'books']],
  },
  'studiesWorkspace.matchingNotes': {
    ru: [[1, 'совпадение'], [2, 'совпадения'], [5, 'совпадений']],
    uk: [[1, 'збіг'], [2, 'збіги'], [5, 'збігів']],
    en: [[1, 'match'], [5, 'matches']],
  },
  // Tags and Scripture references differ in gender, so "+1 new" needs a word of its own for each.
  // A fraction takes `_other`: "+1,5 нового".
  'studiesWorkspace.aiAnalyze.newTagsLabel': {
    ru: [[1, 'новый'], [2, 'новых'], [5, 'новых'], [1.5, 'нового']],
    uk: [[1, 'новий'], [2, 'нові'], [5, 'нових'], [1.5, 'нового']],
    en: [[1, 'new'], [2, 'new']],
  },
  'studiesWorkspace.aiAnalyze.newRefsLabel': {
    ru: [[1, 'новое'], [2, 'новых'], [5, 'новых'], [1.5, 'нового']],
    uk: [[1, 'нове'], [2, 'нові'], [5, 'нових'], [1.5, 'нового']],
    en: [[1, 'new'], [2, 'new']],
  },
  'planTemplates.pointsLabel': {
    ru: [[1, 'пункт'], [3, 'пункта'], [6, 'пунктов']],
    uk: [[1, 'пункт'], [3, 'пункти'], [6, 'пунктів']],
    en: [[1, 'point'], [3, 'points']],
  },
  'audioExport.sectionsCount': {
    ru: [[1, 'секция'], [3, 'секции'], [5, 'секций']],
    uk: [[1, 'секція'], [3, 'секції'], [5, 'секцій']],
    en: [[1, 'section'], [3, 'sections']],
  },
};

const resources = { en, ru, uk } as const;

describe('a word after a number agrees with it', () => {
  const cases = Object.entries(COUNT_WORDS).flatMap(([key, byLang]) =>
    (Object.keys(byLang) as Lang[]).flatMap((lng) => byLang[lng].map(([count, word]) => [key, lng, count, word] as const))
  );

  it.each(cases)('%s in %s: %d → "%s"', async (key, lng, count, word) => {
    const i18n = createInstance();
    await i18n.init({ lng, resources: { [lng]: { translation: resources[lng] } }, interpolation: { escapeValue: false } });
    expect(i18n.t(key, { count })).toBe(word);
  });
});

/**
 * A call that prints a count word right after a number: `{n} {t(…)}`, `{n}{' '}` + newline + `{t(…)}`,
 * `<b>{n}</b> {t(…)}`, `${n} ${t(…)}`. The same word standing alone ("Совпадений: <b>5</b>") is a heading
 * and keeps its base form, so only these neighbours are checked.
 */
const NUMBER_BEFORE = /(?:\}\s*(?:<\/\w+>\s*)?(?:\{\s*['"] ['"]\s*\}\s*)?\{|\}\s+\$\{)\s*$/;
const KEY_ALIAS = /const\s+(\w+)\s*=\s*(['"`])([\w.]+)\2/g;
const STRING_KEY = /^(['"`])([\w.]+)\1$/;

/** The text between the call's parentheses, quotes and nesting respected. */
function argumentsOf(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return source.slice(open + 1);
}

/** Splits the arguments at their top-level commas. */
function topLevelParts(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('({['.includes(char)) depth += 1;
    else if (')}]'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(args.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(args.slice(from));
  return parts.map((part) => part.trim());
}

/** An options object that really has a `count` property (`{ count }`, `{ count: n }`), comments ignored. */
const passesCount = (options: string | undefined) =>
  Boolean(options && /^\{/.test(options) && /(^|[{,\s])count\s*(:|,|\})/.test(options.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));

function countWordCallsWithoutCount(source: string): Array<{ line: number; key: string }> {
  const aliases = new Map(Array.from(source.matchAll(KEY_ALIAS), (match) => [match[1], match[3]]));
  const misses: Array<{ line: number; key: string }> = [];
  for (const match of source.matchAll(/\bt\(/g)) {
    const open = (match.index ?? 0) + 1;
    const [first, options] = topLevelParts(argumentsOf(source, open));
    const key = STRING_KEY.exec(first)?.[2] ?? aliases.get(first);
    if (!key || !(key in COUNT_WORDS)) continue;
    if (!NUMBER_BEFORE.test(source.slice(Math.max(0, (match.index ?? 0) - 200), match.index))) continue;
    if (!passesCount(options)) misses.push({ line: source.slice(0, match.index).split('\n').length, key });
  }
  return misses;
}

describe('every screen that prints one of these words after a number passes the number', () => {
  it.each([
    ["{n} {t('structure.entries', { interpolation: { escapeValue: false } })}", 1],
    ["{n} {t('structure.entries', options)}", 1],
    ['{n} {t(`structure.entries`)}', 1],
    ["{n} {t('structure.entries', { defaultValue: 'count' })}", 1],
    ["{n} {t('structure.entries', { /* count */ defaultValue: 'entries' })}", 1],
    ["<b>{n}</b> {t('audioExport.sectionsCount')}", 1],
    ["const KEY = 'structure.entries'; `${n} ${t(KEY)}`", 1],
    ["{n}{' '}\n  {t('structure.entries')}", 1],
    ["{n} {t('structure.entries', { count: n })}", 0],
    ["{n} {t('structure.entries', { count, defaultValue: 'entries' })}", 0],
    ["{t('studiesWorkspace.matchingNotes')}: <strong>{n}</strong>", 0],
    ["<h2>{t('dashboard.thoughts')}</h2>", 0],
  ])('the guard reads %j as %i miss(es)', (snippet, expected) => {
    expect(countWordCallsWithoutCount(snippet)).toHaveLength(expected);
  });

  it('finds no count word printed after a number without its count in app/', () => {
    const APP = join(__dirname, '..', '..', 'app');
    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
      });
    const misses = sourceFiles(APP).flatMap((file) =>
      countWordCallsWithoutCount(readFileSync(file, 'utf8')).map(({ line, key }) => `${relative(APP, file)}:${line} ${key}`)
    );
    expect(misses).toEqual([]);
  });
});
