import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import ts from 'typescript';

/**
 * WORDS ON SCREEN COME FROM THE LOCALES, NOT FROM RUSSIAN WRITTEN INTO THE CODE.
 *
 * A person with an English or Ukrainian interface saw the whole first preparation step in Russian —
 * headings, the prayer checkbox and the reading from Jeremiah were written straight into the JSX
 * (BUG-20261011-spiritual-step-hardcoded-russian). `labelsGoThroughLocales` catches English literals
 * in attributes and toasts; text between tags and words returned by helpers slipped past it.
 *
 * So no source file carries Cyrillic in its text — JSX text, string and template literals — outside
 * `t(…)` calls (a `t()` default is never seen while its key exists in every locale). The check reads
 * the syntax tree, so comments are never text and a `//` inside JSX text or a URL is never a comment.
 * Regular expressions are patterns, not text. Files whose Cyrillic is multilingual data on purpose
 * are named below with their reason.
 */
const APP = join(__dirname, '..', '..', 'app');
const CYRILLIC = /[А-Яа-яЁёІіЇїЄєҐґ]/;
const ALLOWED: Record<string, string> = {
  [join('utils', 'bibleBooks.ts')]: 'Bible book names in every language',
  [join('utils', 'scriptureReferenceParser.ts')]: 'reference spellings people type, to read them',
  [join('utils', 'scriptureReferenceNormalizer.ts')]: 'reference spellings people type, to read them',
  [join('utils', 'russianOrdinals.ts')]: 'Russian ordinal words, to read references such as «первое послание»',
  [join('components', 'calendar', 'calendarAnalytics.ts')]: 'reference spellings people type, to read them',
  [join('utils', 'structureTags.ts')]: 'section names people type, to recognise them',
  [join('utils', 'council.ts')]: "example councils for the first opening, in the owner's words",
  [join('config', 'prompts')]: 'instructions for the AI model, not shown to the person',
  [join('config', 'schemas')]: 'field descriptions for the AI model, not shown to the person',
  [join('components', 'navigation', 'LanguageSwitcher.tsx')]: 'each language is named in itself',
  ['layout.tsx']: 'page metadata for search engines and link previews, not the interface',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'api' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

/** `t('key', …)` / `i18n.t('key', …)`: its default and options are not text on screen. */
const isTranslateCall = (node: ts.Node) => ts.isCallExpression(node)
  && (ts.isIdentifier(node.expression) ? node.expression.text === 't'
    : ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't')
  && node.arguments.length > 0
  && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]));

const isText = (node: ts.Node): node is ts.JsxText | ts.StringLiteralLike | ts.TemplateLiteralLikeNode =>
  ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
  || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

/** Lines (1-based) where Cyrillic stands in text outside `t()` calls. */
function russianTextLines(fileName: string, code: string): number[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (isTranslateCall(node)) return;
    if (isText(node) && CYRILLIC.test(node.text)) {
      lines.add(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...lines];
}

describe('interface text goes through the locales', () => {
  it('writes no Russian text into the code outside t() calls', () => {
    const offenders = sourceFiles(APP)
      .filter(path => !Object.keys(ALLOWED).some(allowed => relative(APP, path).startsWith(allowed)))
      .flatMap(path => russianTextLines(path, readFileSync(path, 'utf8'))
        .map(line => `${relative(APP, path)}:${line}`));
    expect(offenders).toEqual([]);
  });

  describe('the check itself', () => {
    it('finds Russian in JSX text, attributes, templates and helper returns', () => {
      expect(russianTextLines('a.tsx', 'const A = () => <p>Сохранить</p>;')).toEqual([1]);
      expect(russianTextLines('a.tsx', 'const A = () => <p>See https://example.com <button title="Сохранить" /></p>;')).toEqual([1]);
      expect(russianTextLines('a.tsx', 'const label = `Раздел ${name}`;')).toEqual([1]);
      expect(russianTextLines('a.ts', 'export const buttonLabel = () => "Сохранить";')).toEqual([1]);
    });

    it('leaves comments, t() defaults and patterns alone', () => {
      expect(russianTextLines('a.tsx', 'const x = `Hello ${/* комментарий */ name}`; // тоже комментарий')).toEqual([]);
      expect(russianTextLines('a.tsx', "const A = () => <p>{t('filters.clear', 'Очистить все')}</p>;")).toEqual([]);
      expect(russianTextLines('a.tsx', "const s = i18n.t('k', { defaultValue: 'Шаг {{n}} из 3', n: 1 });")).toEqual([]);
      expect(russianTextLines('a.ts', 'const name = file.replace(/[^a-zа-я0-9]/g, "-");')).toEqual([]);
    });
  });
});
