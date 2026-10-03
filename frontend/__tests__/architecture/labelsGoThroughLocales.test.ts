import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * A LABEL OR MESSAGE THE PERSON HEARS OR SEES SPEAKS THE INTERFACE LANGUAGE.
 *
 * An `aria-label`, `title`, `placeholder` or `alt` written as an English literal, or a toast with an
 * English literal, bypasses the locales: a screen reader on a Russian interface announced "Change
 * language", "Breadcrumb", "Close editor", "outdent" (2026-10-03, found verifying
 * BUG-20260902-ssr-renders-english-labels-then-swaps). Such text comes from `t()` / `i18n.t()`.
 * Quoted, `{"…"}` and template literals all count; a template's `${…}` parts are not text.
 */
const APP = join(__dirname, '..', '..', 'app');
const ATTRIBUTE = /\b(aria-label|title|placeholder|alt)=(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`]*)`\s*\})/g;
const TOAST = /\btoast(?:\.(?:error|success|info|warning|message|loading))?\(\s*(['"`])([^'"`]*[A-Za-z]{3,}[^'"`]*)\1/g;
/** A label written as an expression: `aria-label={open ? "Collapse" : "Expand"}`. */
const ATTRIBUTE_EXPRESSION = /\b(aria-label|title|placeholder|alt)=\{([^{}]*)\}/g;
/** An error's own message put on screen: a sentence for developers (.howto/show-an-error-once.md). */
const TOAST_OF_MESSAGE = /\btoast\.(?:error|success|info|warning|message)\([^;]*?\.message\b/g;
const TRANSLATION_KEY = /^[\w-]+(\.[\w-]+)+$/;
/** `t(…)` / `i18n.t(…)` — its key and default value are not text on screen. */
const TRANSLATE_CALL = /\b(?:i18n\.)?t\(\s*[^()]*\)/g;
/** Inside an expression a lowercase single word is an id or a mode (`mode === 'edit'`), not a label. */
const looksLikeText = (literal: string) => !TRANSLATION_KEY.test(literal) && /[A-Z\s]/.test(literal) && englishIn(literal);
/** A key the person presses, named next to a translated label: "(Esc)", "(⌘+Enter)". */
const KEY_HINT = /\((?:⌘\+|Shift\+|Ctrl\+)?(?:Esc|Enter)\)/g;
/** Not interface text: the owner's notification e-mail (server) and the developer-only quick nav. */
const NOT_INTERFACE = [join('api', ''), join('components', 'navigation', 'DevQuickNav.tsx')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

function englishIn(value: string): boolean {
  return /[A-Za-z]{2,}/.test(value.replace(/\$\{[^}]*\}/g, '').replace(KEY_HINT, ''));
}

describe('labels and messages go through the locales', () => {
  it('writes no English literal into a label attribute or a toast', () => {
    const offenders = sourceFiles(APP)
      .filter(path => !NOT_INTERFACE.some(part => relative(APP, path).startsWith(part)))
      .flatMap(path => {
        const source = readFileSync(path, 'utf8');
        const line = (index: number) => source.slice(0, index).split('\n').length;
        const labels = [...source.matchAll(ATTRIBUTE)]
          .filter(match => englishIn(match.slice(2).find(group => group !== undefined) ?? ''))
          .map(match => `${relative(APP, path)}:${line(match.index ?? 0)} ${match[0]}`);
        const expressions = [...source.matchAll(ATTRIBUTE_EXPRESSION)]
          .filter(match => [...match[2].replace(TRANSLATE_CALL, '').matchAll(/(["'])([^"']*)\1/g)]
            .some(([, , literal]) => looksLikeText(literal)))
          .map(match => `${relative(APP, path)}:${line(match.index ?? 0)} ${match[0]}`);
        const toasts = [...source.matchAll(TOAST), ...source.matchAll(TOAST_OF_MESSAGE)]
          .map(match => `${relative(APP, path)}:${line(match.index ?? 0)} ${match[0]}`);
        return [...labels, ...expressions, ...toasts];
      });
    expect(offenders).toEqual([]);
  });
});
