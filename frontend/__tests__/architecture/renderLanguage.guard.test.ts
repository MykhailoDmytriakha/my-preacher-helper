/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Syntax guard, not a typechecker: track local import/hook aliases and literal fields.
// Arbitrary cross-module value flow, dynamic keys and shadowed bindings are outside this audit.
const root = process.cwd();
const fields = new Set(['language', 'resolvedLanguage', 'languages']);
const allowances: Record<string, Record<string, number>> = {
  'locales/useTranslation.ts': { language: 1, resolvedLanguage: 1 },
  'locales/getInitialLang.ts': { language: 1 },
  'app/components/navigation/LanguageInitializer.tsx': { language: 2 },
  'app/providers/UserSettingsProvider.tsx': { language: 1 },
  'app/components/bible/search/BibleSearch.tsx': { language: 1 },
};
type Read = { file: string; property: string; line: number };
const reads: Read[] = [];
function scanDirectory(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) scanDirectory(file);
    else if (/\.tsx?$/.test(file)) scanFile(file);
  }
}
function scanFile(file: string): void {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const aliases = new Set<string>();
  const hooks = new Set(['useTranslation', 'useLibraryTranslation']);
  const results = new Set<string>();
  const add = (node: ts.Node, property: string) => reads.push({
    file: path.relative(root, file).split(path.sep).join('/'), property,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  });
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const moduleName = node.moduleSpecifier.text;
      if (moduleName.endsWith('/i18n') && node.importClause.name) aliases.add(node.importClause.name.text);
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        const imported = (binding.propertyName ?? binding.name).text;
        if (moduleName.endsWith('/i18n') && imported === 'i18n') aliases.add(binding.name.text);
        if (imported === 'useTranslation') hooks.add(binding.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initial = node.initializer;
      const live = ts.isIdentifier(initial) && aliases.has(initial.text);
      const hook = (ts.isCallExpression(initial) && ts.isIdentifier(initial.expression) && hooks.has(initial.expression.text))
        || (ts.isIdentifier(initial) && results.has(initial.text));
      if (ts.isIdentifier(node.name)) {
        if (live) aliases.add(node.name.text);
        if (hook) results.add(node.name.text);
      }
      if (ts.isObjectBindingPattern(node.name)) for (const binding of node.name.elements) {
        const key = binding.propertyName ?? binding.name;
        if (!ts.isIdentifier(key)) continue;
        if ((live || hook) && key.text === 'i18n' && ts.isIdentifier(binding.name)) aliases.add(binding.name.text);
        if (live && fields.has(key.text)) add(binding, key.text);
      }
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
      && aliases.has(node.expression.text) && fields.has(node.name.text)) add(node, node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)
      && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
      && fields.has(node.argumentExpression.text)) add(node, node.argumentExpression.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
scanDirectory(path.join(root, 'app'));
scanDirectory(path.join(root, 'locales'));

it('keeps mutable language fields out of render consumers', () => {
  expect(reads.filter(read => !allowances[read.file]?.[read.property])).toEqual([]);
});

it('retains the exact canonical snapshot, initializer, writer and copy-action reads', () => {
  const actual: Record<string, Record<string, number>> = {};
  for (const read of reads) if (allowances[read.file]?.[read.property]) {
    actual[read.file] ??= {};
    actual[read.file][read.property] = (actual[read.file][read.property] ?? 0) + 1;
  }
  expect(actual).toEqual(allowances);
});
