/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const root = path.resolve(__dirname, '../..');
const configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const imports = new Map<string, string[]>();

/** Follow only synchronous runtime edges; a type or an explicit import() does not ship its payload here. */
function eagerDependencies(file: string): string[] {
  const cached = imports.get(file);
  if (cached) return cached;
  const found: string[] = [];
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const add = (specifier: string) => {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved?.startsWith(root + path.sep) && !resolved.includes(`${path.sep}node_modules${path.sep}`)
      && /\.(?:json|tsx?|jsx?|mjs)$/.test(resolved)) found.push(resolved);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (!clause?.name && named && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly));
      if (!onlyTypes) add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const onlyTypes = node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly);
      if (!onlyTypes) add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
      && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  imports.set(file, found);
  return found;
}

function eagerDictionaries(entry: string): string[] {
  const pending = [path.join(root, entry)], seen = new Set<string>(), dictionaries: string[] = [];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) {
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      if (value && value.schema === 1 && ['ru', 'uk'].includes(String(value.language))
        && Array.isArray(value.paradigms) && Array.isArray(value.entries)) dictionaries.push(path.relative(root, file));
    } else pending.push(...eagerDependencies(file));
  }
  return dictionaries.sort();
}

describe('ordinary reading does not synchronously import search dictionaries', () => {
  it.each([
    'app/components/bible/BibleBookList.tsx',
    'app/components/bible/BiblePicker.tsx',
    'app/components/bible/search/useFoundVerses.ts',
  ])('%s leaves language payloads outside its eager module graph', entry => {
    expect(eagerDictionaries(entry)).toEqual([]);
  });
});
