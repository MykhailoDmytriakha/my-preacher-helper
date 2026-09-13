import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const OPERATIONS = new Set(['getDoc', 'getDocFromCache', 'getDocFromServer', 'getDocs', 'getDocsFromCache', 'getDocsFromServer',
  'onSnapshot', 'setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction',
  'get', 'getAll', 'set', 'create', 'update', 'add', 'delete', 'batch', 'bulkWriter', 'commit']);
const sdk = (name: string) => /node_modules\/(?:@firebase\/firestore|firebase(?:-admin)?\/|@google-cloud\/firestore)/.test(name.replaceAll('\\', '/'));

export interface FirestoreCall { file: string; operation: string; line: number }
export interface BoundaryAccess { file: string; capability: string; line: number }

const PUBLIC_ENGINE = new Set(['data-engine/react.client.tsx', 'data-engine/browser.client.ts', 'data-engine/DataSyncStatus.tsx']);
const ENGINE_ROUTES = new Set(['api/data-engine/commands/route.ts', 'api/data-engine/documents/[collection]/[id]/route.ts',
  'api/data-engine/collections/[collection]/route.ts', 'api/data-engine/changes/[collection]/route.ts']);
const ADAPTERS = new Set(['data-engine/server.ts', 'data-engine/source.client.ts', 'data-engine/legacyBoundary.server.ts']);
// Staged migration bridge: reviewed existing server writers only, never a feature API.
const LEGACY_BOUNDARY_CALLERS = new Set(['api/repositories/councils.repository.ts', 'api/repositories/serviceOrders.repository.ts', 'api/councils/writeSupport.ts', 'api/service-orders/writeSupport.ts', 'api/service-orders/route.ts', 'api/service-orders/custom/route.ts', 'api/service-orders/[id]/route.ts', 'api/service-orders/placement/route.ts', "api/clients/firestore.client.ts", "api/insights/directions/route.ts", "api/insights/plan/route.ts", "api/insights/route.ts", "api/insights/topics/route.ts", "api/insights/verses/route.ts", "api/repositories/series.repository.ts", "api/repositories/sermons.repository.ts", "api/series/[id]/route.ts", "api/sermons/[id]/audio/chunks/[index]/route.ts", "api/sermons/[id]/audio/chunks/route.ts", "api/sermons/[id]/audio/generate/route.ts", "api/sermons/[id]/audio/optimize/route.ts", "api/sermons/[id]/plan/route.ts", "api/sermons/[id]/preach-dates/[dateId]/route.ts", "api/sermons/[id]/preach-dates/route.ts", "api/sermons/[id]/route.ts", "api/sermons/outline/route.ts", "api/sermons/route.ts", "api/tags/route.ts", "api/thoughts-by-section/route.ts", "api/thoughts/route.ts", "api/groups/[id]/route.ts", "api/prayer/route.ts", "api/repositories/groups.repository.ts", "api/repositories/prayerRequests.repository.ts", "api/repositories/studies.repository.ts", "api/studies/materials/[id]/route.ts", "api/studies/materials/route.ts", "api/studies/notes/[id]/route.ts"]);
const slash = (file: string) => file.replaceAll('\\', '/');
const relative = (root: string, file: string) => slash(path.relative(root, file));

function unalias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function initialized(node: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): ts.Expression {
  if (seen.has(node)) return node;
  seen.add(node);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return initialized(node.expression, checker, seen);
  if (!ts.isIdentifier(node)) return node;
  const symbol = checker.getSymbolAtLocation(node);
  const declaration = symbol && unalias(checker, symbol).valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    ? initialized(declaration.initializer, checker, seen) : node;
}

/** Unknown template portions stay explicit; no evaluation of application code. */
function staticText(node: ts.Expression, checker: ts.TypeChecker, depth = 0): string {
  if (depth > 20) return '*';
  const value = initialized(node, checker);
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isTemplateExpression(value)) return value.head.text + value.templateSpans.map(span => staticText(span.expression, checker, depth + 1) + span.literal.text).join('');
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) return staticText(value.left, checker, depth + 1) + staticText(value.right, checker, depth + 1);
  return '*';
}

function moduleSymbol(checker: ts.TypeChecker, specifier: ts.Expression): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(specifier);
  return symbol && unalias(checker, symbol);
}

function runtimeBindings(node: ts.ImportDeclaration | ts.ExportDeclaration, checker: ts.TypeChecker): ts.Symbol[] {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return [];
    const names: ts.Node[] = clause?.name ? [clause.name] : [];
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      names.push(...clause.namedBindings.elements.filter(item => !item.isTypeOnly).map(item => item.name));
    } else {
      const resolved = moduleSymbol(checker, node.moduleSpecifier);
      if (resolved) return checker.getExportsOfModule(resolved).map(symbol => unalias(checker, symbol)).filter(symbol => Boolean(symbol.flags & ts.SymbolFlags.Value));
    }
    return names.flatMap(name => { const symbol = checker.getSymbolAtLocation(name); return symbol ? [unalias(checker, symbol)] : []; });
  }
  if (node.isTypeOnly) return [];
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.filter(item => !item.isTypeOnly).flatMap(item => {
      const symbol = checker.getSymbolAtLocation(item.name);
      return symbol ? [unalias(checker, symbol)] : [];
    });
  }
  const resolved = node.moduleSpecifier && moduleSymbol(checker, node.moduleSpecifier);
  return resolved ? checker.getExportsOfModule(resolved).map(symbol => unalias(checker, symbol)).filter(symbol => Boolean(symbol.flags & ts.SymbolFlags.Value)) : [];
}

function moduleCapability(source: string, target: string, name: string, root: string): string | undefined {
  const destination = relative(root, target);
  if (destination.startsWith('../test-utils/')) return `test-runtime:${destination}`;
  if (destination.startsWith('data-engine/') && !source.startsWith('data-engine/') && !PUBLIC_ENGINE.has(destination)) {
    if (source === 'components/OutboxConflictBanner.tsx' && destination === 'data-engine/legacyRecovery.client.ts') return undefined;
    if (destination === 'data-engine/server.ts' && ENGINE_ROUTES.has(source)) return undefined;
    if (destination === 'data-engine/legacyBoundary.server.ts' && LEGACY_BOUNDARY_CALLERS.has(source)) return undefined;
    return `engine-internal:${destination}`;
  }
  if (ADAPTERS.has(source)) return undefined;
  if (sdk(target)) return `sdk-runtime:${name}`;
  if ((destination === 'config/firebaseAdminConfig.ts' && name === 'adminDb')
    || (destination === 'config/firebaseClientDb.ts' && name === 'getClientDb')) return `database-runtime:${destination}#${name}`;
  return undefined;
}

/** Value imports are capabilities, even when passed as callbacks instead of called locally. */
function importCapabilities(node: ts.ImportDeclaration | ts.ExportDeclaration, checker: ts.TypeChecker, source: string, root: string): Set<string> {
  const capabilities = new Set<string>();
  const bindings = runtimeBindings(node, checker);
  const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
  if (node.moduleSpecifier && !typeOnly) {
    const target = moduleSymbol(checker, node.moduleSpecifier)?.declarations?.[0]?.getSourceFile().fileName;
    const hasRuntime = bindings.length > 0 || (ts.isImportDeclaration(node) && !node.importClause);
    const capability = hasRuntime && target && moduleCapability(source, target, '*', root);
    if (capability) capabilities.add(capability);
  }
  for (const binding of bindings) {
    for (const declaration of binding.declarations ?? []) {
      const capability = moduleCapability(source, declaration.getSourceFile().fileName, binding.name, root);
      if (capability) capabilities.add(capability);
    }
  }
  return capabilities;
}

function dynamicCapability(node: ts.CallExpression, program: ts.Program, file: string, root: string): string | undefined {
  if (!node.arguments.length || (node.expression.kind !== ts.SyntaxKind.ImportKeyword && node.expression.getText() !== 'require')) return undefined;
  const specifier = staticText(node.arguments[0], program.getTypeChecker());
  if (specifier.includes('*')) return undefined;
  const resolved = ts.resolveModuleName(specifier, file, program.getCompilerOptions(), ts.sys).resolvedModule;
  const parent = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent;
  if (resolved && ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)
    && parent.name.elements.every(element => !element.dotDotDotToken)) {
    return parent.name.elements.map(element => moduleCapability(relative(root, file), resolved.resolvedFileName,
      (element.propertyName ?? element.name).getText(), root)).find(Boolean);
  }
  return resolved && wholeModuleCapability(relative(root, file), resolved.resolvedFileName, root);
}

function wholeModuleCapability(source: string, target: string, root: string): string | undefined {
  const destination = relative(root, target);
  const name = destination === 'config/firebaseAdminConfig.ts' ? 'adminDb'
    : destination === 'config/firebaseClientDb.ts' ? 'getClientDb' : '*';
  return moduleCapability(source, target, name, root);
}

function requireCapability(node: ts.ImportEqualsDeclaration, program: ts.Program, file: string, root: string): string | undefined {
  if (node.isTypeOnly || !ts.isExternalModuleReference(node.moduleReference) || !node.moduleReference.expression) return undefined;
  const specifier = staticText(node.moduleReference.expression, program.getTypeChecker());
  const resolved = ts.resolveModuleName(specifier, file, program.getCompilerOptions(), ts.sys).resolvedModule;
  return resolved && wholeModuleCapability(relative(root, file), resolved.resolvedFileName, root);
}

export function runtimeAccesses(program: ts.Program, files: readonly string[], root: string): BoundaryAccess[] {
  const checker = program.getTypeChecker(), found: BoundaryAccess[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file)!;
    const sourceName = relative(root, file);
    const visit = (node: ts.Node) => {
      const capabilities = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? importCapabilities(node, checker, sourceName, root) : new Set<string>();
      const dynamic = ts.isCallExpression(node) && dynamicCapability(node, program, file, root);
      if (dynamic) capabilities.add(dynamic);
      const required = ts.isImportEqualsDeclaration(node) && requireCapability(node, program, file, root);
      if (required) capabilities.add(required);
      for (const capability of capabilities) found.push({ file: sourceName, capability, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

function propertyValue(node: ts.Expression | undefined, name: string, checker: ts.TypeChecker): ts.Expression | undefined {
  if (!node) return undefined;
  const value = initialized(node, checker);
  if (!ts.isObjectLiteralExpression(value)) return undefined;
  for (const item of [...value.properties].reverse()) {
    if (ts.isSpreadAssignment(item)) { const found = propertyValue(item.expression, name, checker); if (found) return found; }
    if ((ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && item.name.getText().replaceAll(/['"]/g, '') === name) {
      return ts.isPropertyAssignment(item) ? item.initializer : item.name;
    }
  }
  return undefined;
}

/** This explicit table excludes AI-only proposals (brainstorm, cutter, outline suggestions). */
function legacyWritePath(value: string): string | undefined {
  const match = value.match(/\/api\/(?:data-engine\/commands|sermons|series|groups|studies|prayer|councils|service-orders|tags|thoughts-by-section|thoughts|structure|insights)(?=\/|[?#]|$)(?:\/[^?#]*)?/);
  if (!match) return undefined;
  const endpoint = match[0].replace(/\/$/, '');
  if (/\/(?:brainstorm|generate-outline-points|compose-plan-from-scratch|cut|analyze|transcribe)$/.test(endpoint)) return undefined;
  return endpoint;
}

function requestUrlText(node: ts.Expression, checker: ts.TypeChecker): string {
  const value = initialized(node, checker);
  if (ts.isNewExpression(value) && value.expression.getText() === 'URL' && value.arguments?.[0]) return staticText(value.arguments[0], checker);
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'toString') return requestUrlText(value.expression.expression, checker);
  return staticText(value, checker);
}

function hasPlanSection(node: ts.Expression, checker: ts.TypeChecker): boolean {
  const text = requestUrlText(node, checker);
  if (/[?&]outlinePointId=[^&]+/.test(text)) return false;
  if (/[?&]section=/.test(text)) return true;
  let value = initialized(node, checker);
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'toString') value = initialized(value.expression.expression, checker);
  let found = false;
  const inspect = (child: ts.Node) => {
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)
      && ['set', 'append'].includes(child.expression.name.text) && child.arguments[0] && staticText(child.arguments[0], checker) === 'section') {
      const params = child.expression.expression;
      if (ts.isPropertyAccessExpression(params) && params.name.text === 'searchParams' && initialized(params.expression, checker) === value) found = true;
    }
    ts.forEachChild(child, inspect);
  };
  inspect(node.getSourceFile());
  return found;
}

function httpCapability(node: ts.CallExpression, checker: ts.TypeChecker): string | undefined {
  if (!node.arguments.length) return undefined;
  const declaration = checker.getResolvedSignature(node)?.declaration;
  const name = declaration && 'name' in declaration ? declaration.name?.getText() : undefined;
  if (!name || !['fetch', 'apiClient', 'requestOwnerJson'].includes(name)) return undefined;
  let url = initialized(node.arguments[0], checker);
  let options = node.arguments[1];
  if (ts.isNewExpression(url) && url.expression.getText() === 'Request' && url.arguments?.[0]) { options ??= url.arguments[1]; url = url.arguments[0]; }
  const endpoint = legacyWritePath(requestUrlText(url, checker));
  const methodValue = propertyValue(options, 'method', checker);
  const method = methodValue ? staticText(methodValue, checker).toUpperCase() : options && !ts.isObjectLiteralExpression(initialized(options, checker)) ? '*' : 'GET';
  if (endpoint && method === 'GET' && /^\/api\/sermons\/[^/]+\/plan$/.test(endpoint) && hasPlanSection(url, checker)) return `GET ${endpoint}?section=*`;
  return endpoint && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? `${method} ${endpoint}` : undefined;
}

/** A bounded wrapper seam: literal route arguments passed to a function containing HTTP I/O. */
function wrapperCapabilities(node: ts.CallExpression, checker: ts.TypeChecker): string[] {
  const declaration = checker.getResolvedSignature(node)?.declaration;
  const name = declaration && 'name' in declaration ? declaration.name?.getText() : undefined;
  if (!declaration || !('body' in declaration) || !declaration.body || ['fetch', 'apiClient', 'requestOwnerJson'].includes(name ?? '')) return [];
  const endpoints = node.arguments.map(argument => legacyWritePath(staticText(argument, checker))).filter((value): value is string => Boolean(value));
  if (!endpoints.length) return [];
  const methods = new Set<string>();
  const inspect = (child: ts.Node) => {
    if (ts.isCallExpression(child)) {
      const signature = checker.getResolvedSignature(child)?.declaration;
      const target = signature && 'name' in signature ? signature.name?.getText() : undefined;
      if (target && ['fetch', 'apiClient', 'requestOwnerJson'].includes(target)) {
        const value = propertyValue(child.arguments[1], 'method', checker);
        const method = value ? staticText(value, checker).toUpperCase() : '*';
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) methods.add(method);
      }
    }
    ts.forEachChild(child, inspect);
  };
  inspect(declaration.body as ts.Node);
  return endpoints.flatMap(endpoint => [...methods].map(method => `${method} ${endpoint}`));
}

export function legacyHttpAccesses(program: ts.Program, files: readonly string[], root: string): BoundaryAccess[] {
  const checker = program.getTypeChecker(), found: BoundaryAccess[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file)!;
    const sourceName = relative(root, file);
    if (sourceName === 'data-engine/transport.client.ts') continue;
    const visit = (node: ts.Node) => {
      const capability = ts.isCallExpression(node) && httpCapability(node, checker);
      if (capability) found.push({ file: sourceName, capability, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      if (ts.isCallExpression(node)) {
        for (const wrapped of wrapperCapabilities(node, checker)) found.push({ file: sourceName, capability: wrapped, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** Resolve SDK signatures rather than spelling: aliases and namespace calls have the same boundary. */
export function firestoreCalls(program: ts.Program, files: readonly string[], root: string): FirestoreCall[] {
  const checker = program.getTypeChecker(), calls: FirestoreCall[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Missing architecture source: ${file}`);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        if (declaration && sdk(declaration.getSourceFile().fileName)) {
          const name = 'name' in declaration ? declaration.name?.getText() : undefined;
          if (name && OPERATIONS.has(name)) calls.push({ file: path.relative(root, file), operation: name, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

export function applicationFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return ['__tests__', 'node_modules'].includes(entry.name) ? [] : applicationFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|d)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

export function applicationProgram(frontend: string, files: string[]): ts.Program {
  const configPath = path.join(frontend, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error('Cannot read TypeScript configuration');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, frontend);
  return ts.createProgram(files, { ...parsed.options, noEmit: true, incremental: false });
}
