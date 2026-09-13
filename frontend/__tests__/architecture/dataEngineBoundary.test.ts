/** @jest-environment node */
import path from 'path';
import ts from 'typescript';

import { applicationFiles, applicationProgram, firestoreCalls, legacyHttpAccesses, runtimeAccesses } from './firestoreBoundary';
import legacy from './legacyFirestoreAccess.json';

const frontend = path.resolve(__dirname, '../..');
const root = path.join(frontend, 'app');
const adapters = new Set(['data-engine/server.ts', 'data-engine/source.client.ts', 'data-engine/legacyBoundary.server.ts']);
const guidance = 'See __tests__/architecture/README.md. New owned-data features use DataEngineProvider/useDataDocument/useDataCollection through react.client. Do not import internals or call legacy document-write endpoints. Lower frozen debt when migrating; do not add a new exception.';

function differences(actual: Record<string, number>, expected: Record<string, number>) {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(key => actual[key] !== expected[key])
    .map(key => ({ access: key, allowed: expected[key] ?? 0, found: actual[key] ?? 0 }));
}

function counts(values: Array<{ file: string; capability: string }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) { const key = `${value.file}#${value.capability}`; result[key] = (result[key] ?? 0) + 1; }
  return result;
}

function virtualProgram(sources: Record<string, string>, options: ts.CompilerOptions): ts.Program {
  const host = ts.createCompilerHost(options), originalRead = host.readFile, originalExists = host.fileExists;
  host.readFile = file => sources[file] ?? originalRead(file);
  host.fileExists = file => file in sources || originalExists(file);
  host.getSourceFile = (file, languageVersion) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
  };
  return ts.createProgram(Object.keys(sources), options, host);
}

describe('DataEngine SDK boundary', () => {
  it('freezes every existing client and server access while allowing only the canonical adapters', () => {
    const files = applicationFiles(root);
    const program = applicationProgram(frontend, files);
    const calls = firestoreCalls(program, files, root);
    const actual: Record<string, number> = {};
    for (const call of calls) {
      if (adapters.has(call.file)) continue;
      const key = `${call.file}#${call.operation}`;
      actual[key] = (actual[key] ?? 0) + 1;
    }
    const access = runtimeAccesses(program, files, root);
    const forbidden = access.filter(item => item.capability.startsWith('engine-internal:') || item.capability.startsWith('test-runtime:'));
    expect({ forbidden, guidance }).toEqual({ forbidden: [], guidance: expect.any(String) });
    expect({ sdk: differences(actual, legacy.sdkCalls), imports: differences(counts(access), legacy.runtimeImports),
      http: differences(counts(legacyHttpAccesses(program, files, root)), legacy.legacyHttp), guidance })
      .toEqual({ sdk: [], imports: [], http: [], guidance: expect.any(String) });
    expect(calls.filter(call => call.file === 'data-engine/source.client.ts' && call.operation !== 'onSnapshot')).toEqual([]);
  }, 30_000);

  it('detects renamed imports, local aliases, namespace calls, re-exports and Admin methods without flagging Map.set', () => {
    const sources: Record<string, string> = {
      [path.join(frontend, '__boundary-bridge.ts')]: `export { updateDoc as publish } from 'firebase/firestore';`,
      [path.join(frontend, '__boundary-negative.ts')]: `
        import { setDoc as renamed, doc, getFirestore } from 'firebase/firestore';
        import * as sdk from 'firebase/firestore';
        import { getFirestore as admin } from 'firebase-admin/firestore';
        import { publish } from './__boundary-bridge';
        const reference = doc(getFirestore(), 'sermons', 'id');
        const localAlias = renamed;
        void localAlias(reference, {});
        void publish(reference, {});
        void sdk.getDoc(reference);
        const stop = sdk.onSnapshot(reference, () => undefined);
        const database = admin();
        void database.collection('sermons').doc('id').delete();
        void database.collection('sermons').doc('new').create({});
        void database.runTransaction(async tx => { tx.set(database.doc('sermons/id'), {}); tx.create(database.doc('sermons/new'), {}); });
        new Map().set('key', 'value'); stop();
      `,
    };
    const options: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, target: ts.ScriptTarget.ES2022, skipLibCheck: true };
    const host = ts.createCompilerHost(options), originalRead = host.readFile, originalExists = host.fileExists;
    host.readFile = file => sources[file] ?? originalRead(file);
    host.fileExists = file => file in sources || originalExists(file);
    host.getSourceFile = (file, languageVersion) => {
      const text = host.readFile(file);
      return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
    };
    const program = ts.createProgram(Object.keys(sources), options, host);
    const calls = firestoreCalls(program, Object.keys(sources), frontend);
    expect(calls.map(call => call.operation).sort()).toEqual(['setDoc', 'updateDoc', 'getDoc', 'onSnapshot', 'delete', 'runTransaction', 'set', 'create', 'create'].sort());
    expect(calls.every(call => call.file === '__boundary-negative.ts')).toBe(true);
  }, 30_000);

  it('blocks internal capabilities behind aliases, reexports and dynamic imports while permitting the public API and type-only imports', () => {
    const sources = {
      [path.join(root, '__boundary-bridge.ts')]: `export { createIndexedDbCheckpoints as persist } from '@/data-engine/checkpoint.client';`,
      [path.join(frontend, 'test-utils/__boundary-fixture.ts')]: `export const fixture = () => undefined;`,
      [path.join(root, 'api/data-engine/new/route.ts')]: `export { processCommand } from '@/data-engine/server';`,
      [path.join(root, 'api/data-engine/commands/route.ts')]: `export { processCommand } from '@/data-engine/server';`,
      [path.join(root, '__boundary-feature.ts')]: `
        import { updateLegacyDocument } from '@/data-engine/legacyBoundary.server';
        import { processCommand as unsafe } from '@/data-engine/server';
        import { persist } from './__boundary-bridge';
        import { DataEngineProvider } from '@/data-engine/react.client';
        import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
        import type { EditorRecord } from '@/data-engine/controller';
        import { type ResourceSnapshot } from '@/data-engine/types';
        import { getClientDb as database } from '@/config/firebaseClientDb';
        import { adminAuth } from '@/config/firebaseAdminConfig';
        import { updateDoc as callback } from 'firebase/firestore';
        [callback].forEach(fn => void fn);
        const transport = import('@/data-engine/transport.client');
        const journal = require('@/data-engine/journal.client');
        import directStore = require('@/data-engine/snapshots.client');
        const adminModule = require('@/config/firebaseAdminConfig');
        const { adminAuth: onlyAuth } = await import('@/config/firebaseAdminConfig');
        export { fixture } from '../test-utils/__boundary-fixture';
        void DataEngineProvider; void unsafe; void persist; void database; void adminAuth;
      `,
    };
    const options: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve, skipLibCheck: true, baseUrl: frontend, paths: { '@/*': ['app/*'] } };
    const accesses = runtimeAccesses(virtualProgram(sources, options), Object.keys(sources), root);
    const capabilities = accesses.map(item => item.capability);
    expect(capabilities).toEqual(expect.arrayContaining([
      'engine-internal:data-engine/server.ts', 'engine-internal:data-engine/legacyBoundary.server.ts', 'engine-internal:data-engine/checkpoint.client.ts',
      'engine-internal:data-engine/transport.client.ts', 'engine-internal:data-engine/journal.client.ts',
      'engine-internal:data-engine/snapshots.client.ts',
      'database-runtime:config/firebaseClientDb.ts#getClientDb', 'sdk-runtime:updateDoc',
      'database-runtime:config/firebaseAdminConfig.ts#adminDb',
    ]));
    expect(accesses.filter(item => item.capability.includes('controller') || item.capability.includes('types.ts')
      || item.capability.includes('adminAuth') || item.capability.includes('react.client') || item.capability.includes('DataSyncStatus'))).toEqual([]);
    expect(accesses.filter(item => item.capability.includes('checkpoint.client'))).toHaveLength(2);
    expect(capabilities).toContain('test-runtime:../test-utils/__boundary-fixture.ts');
    expect(accesses.some(item => item.file === 'api/data-engine/new/route.ts')).toBe(true);
    expect(accesses.some(item => item.file === 'api/data-engine/commands/route.ts')).toBe(false);
  }, 30_000);

  it('detects old write endpoints through HTTP aliases, constant options, templates and Request objects without banning reads or AI proposals', () => {
    const sources = {
      [path.join(root, '__boundary-http.ts')]: `
        import { apiClient as authenticated } from '@/utils/apiClient';
        import { requestOwnerJson as ownerRequest } from '@/services/ownerHttpTransport.client';
        declare const id: string;
        const remove = fetch;
        const options = { method: 'DELETE' };
        void remove('/api/studies/notes/' + id, options);
        void authenticated(\`https://example.test/api/sermons/\${id}\`, { method: 'PUT' });
        void ownerRequest('/api/councils', { method: 'POST', payload: {} });
        const request = new Request('/api/series/' + id, { method: 'DELETE' });
        void fetch(request);
        void fetch('/api/data-engine/commands', { method: 'POST', body: '{}' });
        void fetch('/api/sermons/' + id);
        void fetch('/api/sermons/' + id + '/plan?section=main');
        const planUrl = new URL('/api/sermons/' + id + '/plan', 'http://local');
        planUrl.searchParams.set('section', 'main');
        void fetch(planUrl.toString());
        void fetch('/api/sermons/' + id + '/plan?outlinePointId=one');
        void fetch('/api/sermons/' + id + '/plan?section=main&outlinePointId=one');
        void fetch('/api/studies/notes/' + id, { method: 'HEAD' });
        void fetch('/api/feedback', { method: 'POST' });
        void fetch('/api/sermons/' + id + '/brainstorm', { method: 'POST' });
        void fetch('/api/studies/notes/' + id + '/cut', { method: 'POST' });
        void fetch('/api/sermons-other', { method: 'POST' });
        function postRoute(label: string, route: string) { return authenticated(route, { method: 'POST' }); }
        void postRoute('insights', '/api/insights/topics');
        new Map().set('/api/sermons', { method: 'POST' });
      `,
    };
    const options: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve, skipLibCheck: true, baseUrl: frontend, paths: { '@/*': ['app/*'] } };
    const accesses = legacyHttpAccesses(virtualProgram(sources, options), Object.keys(sources), root);
    expect(accesses.map(item => item.capability).sort()).toEqual(['DELETE /api/studies/notes/*', 'PUT /api/sermons/*', 'POST /api/councils', 'DELETE /api/series/*', 'POST /api/data-engine/commands', 'POST /api/insights/topics', 'GET /api/sermons/*/plan?section=*', 'GET /api/sermons/*/plan?section=*'].sort());
  }, 30_000);
});
