import fs from 'fs';
import path from 'path';

import type * as Diagnostics from '@/utils/appDiagnostics';

let diagnostics: typeof Diagnostics;
const key = 'preacher:diagnostics:v1';
beforeEach(() => {
  jest.resetModules();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: false })) });
  localStorage.clear();
  diagnostics = require('@/utils/appDiagnostics');
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('stores only allowlisted fields and removes identifiers and query strings from routes', () => {
  diagnostics.recordDiagnostic('route', { route: '/sermons/private-id/plan?token=secret#private', code: 'raw error with private text', elapsedMs: 4.6, visible: true, secret: 'password' } as never);
  const data = diagnostics.diagnosticEvents()[0].data;
  expect(data).toEqual({ route: '/sermons/:id/plan', doc: expect.stringMatching(/^[0-9a-f]{8}$/), elapsedMs: 5, visible: true });
  expect(localStorage.getItem(key)).not.toMatch(/password|token|private/);
  expect(diagnostics.diagnosticErrorCode({ code: 'firestore/permission-denied' })).toBe('permission-denied');
  expect(diagnostics.diagnosticErrorCode({ code: 'secret message' })).toBeUndefined();
  expect(diagnostics.diagnosticErrorCode({ code: 42 })).toBeUndefined();
  expect(diagnostics.diagnosticErrorCode(null)).toBeUndefined();
});

it('bounds history, drops expired records and coalesces repeated snapshot metadata', () => {
  jest.useFakeTimers();
  for (let index = 0; index < 160; index++) diagnostics.recordDiagnostic('route', { route: '/dashboard' });
  expect(diagnostics.diagnosticEvents()).toHaveLength(150);
  diagnostics.recordDiagnostic('snapshot-cache', { collection: 'sermons' });
  diagnostics.recordDiagnostic('snapshot-cache', { collection: 'sermons' });
  expect(diagnostics.diagnosticEvents().filter(e => e.name === 'snapshot-cache')).toHaveLength(1);
  jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
  expect(diagnostics.diagnosticEvents()).toHaveLength(0);
});

it('restores sanitized recent history after a new application session', () => {
  localStorage.setItem(key, JSON.stringify([
    { name: 'invalid', at: Date.now(), session: 1 },
    null,
    { name: 'focus', at: 'invalid', session: 1 },
    { name: 'focus', at: 1, session: 1 },
    { name: 'route', at: Date.now(), session: 1, data: { route: '/groups/secret', secret: 'token' } },
    { name: 'focus', at: Date.now(), session: 1 },
  ]));
  const restored = diagnostics.diagnosticEvents();
  expect(restored).toHaveLength(2);
  expect(restored[0].data).toEqual({ route: '/groups/:id', doc: expect.stringMatching(/^[0-9a-f]{8}$/) });
  diagnostics.recordDiagnostic('boot');
  jest.resetModules();
  diagnostics = require('@/utils/appDiagnostics');
  expect(diagnostics.diagnosticEvents()).toHaveLength(3);
});

it('keeps in-memory history if storage is blocked or full', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  diagnostics.recordDiagnostic('boot');
  diagnostics.recordDiagnostic('online', { elapsedMs: NaN });
  expect(diagnostics.diagnosticEvents()).toHaveLength(2);
});

it.each(['not json', '{}'])('recovers from corrupted history: %s', raw => {
  localStorage.setItem(key, raw);
  diagnostics.recordDiagnostic('boot');
  expect(diagnostics.diagnosticEvents()).toHaveLength(1);
});

it('builds a copyable content-free environment report', () => {
  diagnostics.recordDiagnostic('freshness-timeout', { collection: 'sermons', source: 'manual' });
  const report = diagnostics.buildDiagnosticReport();
  expect(report.schema).toBe(2);
  expect(report.environment).toEqual(expect.objectContaining({ online: navigator.onLine, visibility: document.visibilityState }));
  expect(report.events[0].name).toBe('freshness-timeout');
  expect(JSON.parse(JSON.stringify(report)).runningVersion).toBeTruthy();
  expect(report.environment.maxTouchPoints).toBe(navigator.maxTouchPoints);
  expect(report.environment.viewportScale).toBe(window.visualViewport?.scale ?? 1);
});

it('retains gesture and reload outcomes without raw target or document data', () => {
  diagnostics.recordDiagnostic('gesture', { source: 'start', result: 'blocked', code: 'focused-editor', text: 'private words' } as never);
  diagnostics.recordDiagnostic('gesture', { source: 'reload', result: 'requested' });
  const report = diagnostics.buildDiagnosticReport();
  expect(report.events.map(event => event.name)).toEqual(['gesture', 'gesture']);
  expect(report.events[0].data).toEqual({ source: 'start', result: 'blocked', code: 'focused-editor' });
  expect(JSON.stringify(report)).not.toContain('private words');
});

it.each([
  [{ ok: true, json: async () => ({ version: 'abcd1234' }) }, 'answered', 'abcd1234'],
  [{ ok: true, json: async () => ({ version: 'private text or URL' }) }, 'invalid-response', null],
  [{ ok: true, json: async () => ({}) }, 'invalid-response', null],
  [{ ok: false, status: 503 }, 'http-503', null],
])('checks only the app health endpoint', async (response, status, version) => {
  global.fetch = jest.fn().mockResolvedValue(response);
  expect(await diagnostics.diagnosticServerVersion()).toEqual({ status, version });
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/health\?diagnostic=\d+$/), expect.objectContaining({ cache: 'no-store' }));
});

it('reports a failed health request without copying raw errors', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('private'));
  expect(await diagnostics.diagnosticServerVersion()).toEqual({ status: 'unavailable', version: null });
});

it('ends a hung health request after five seconds even when fetch ignores abort', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
  const pending = diagnostics.diagnosticServerVersion();
  await jest.advanceTimersByTimeAsync(5000);
  expect(await pending).toEqual({ status: 'timeout', version: null });
  expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
});


it('merges newly persisted events from another tab before appending, retaining server answer times', () => {
  diagnostics.recordDiagnostic('boot');
  const first = diagnostics.diagnosticEvents();
  localStorage.setItem(key, JSON.stringify([...first, {
    id: 'other-tab', at: Date.now(), session: 2, name: 'freshness-timeout', data: { source: 'manual' },
  }]));
  diagnostics.recordDiagnostic('focus');
  expect(diagnostics.diagnosticEvents().map(e => e.name)).toEqual(['boot', 'freshness-timeout', 'focus']);
  diagnostics.recordDiagnostic('snapshot-server', { result: 'matching' });
  diagnostics.recordDiagnostic('snapshot-server', { result: 'matching' });
  expect(diagnostics.diagnosticEvents().filter(e => e.name === 'snapshot-server')).toHaveLength(2);
});

/**
 * THE REPORT EXISTS TO REPRODUCE A BUG (owner, 2026-10-10): where the person went, what they did,
 * what waited to be sent. In twelve real reports 98 of 187 page visits read '/:id/:id' — whole
 * sections were missing from the known segments — and swipe gestures filled up to 49 of 80 places.
 */
it('keeps every section of the app readable in the path', () => {
  const pages = path.join(__dirname, '../../app/(pages)');
  const segments = new Set<string>();
  const walk = (dir: string): boolean => {
    let routed = false;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) { if (/^(page|layout|route)\.tsx?$/.test(entry.name)) routed = true; continue; }
      if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
      const child = walk(path.join(dir, entry.name));
      if (child && !/^[[(]/.test(entry.name)) segments.add(entry.name);
      routed = routed || child;
    }
    return routed;
  };
  walk(pages);
  expect(segments.size).toBeGreaterThan(15);
  expect([...segments].filter(segment => diagnostics.diagnosticRoute(`/${segment}`) !== `/${segment}`)).toEqual([]);
});

it('tells the same document from another without naming it', () => {
  diagnostics.recordDiagnostic('route', { route: '/studies/note-alpha' });
  diagnostics.recordDiagnostic('route', { route: '/studies/note-alpha' });
  diagnostics.recordDiagnostic('route', { route: '/studies/note-beta' });
  diagnostics.recordDiagnostic('route', { route: '/studies' });
  const [first, again, other, list] = diagnostics.diagnosticEvents().map(event => event.data);
  expect(first.doc).toMatch(/^[0-9a-f]{8}$/);
  expect(again.doc).toBe(first.doc);
  expect(other.doc).not.toBe(first.doc);
  expect(list.doc).toBeUndefined();
  expect(localStorage.getItem(key)).not.toMatch(/note-alpha|note-beta/);
});

it('keeps the path when routine events pile up', () => {
  diagnostics.recordDiagnostic('route', { route: '/studies/note-alpha' });
  for (let index = 0; index < 200; index++) diagnostics.recordDiagnostic('gesture', { source: 'start', result: 'cancelled' });
  for (let index = 0; index < 60; index++) diagnostics.recordDiagnostic('focus');
  diagnostics.recordDiagnostic('route', { route: '/dashboard' });
  const events = diagnostics.diagnosticEvents();
  expect(events.filter(event => event.name === 'route')).toHaveLength(2);
  expect(events.filter(event => event.name === 'gesture').length).toBeLessThanOrEqual(12);
  expect(events.filter(event => event.name === 'focus').length).toBeLessThanOrEqual(12);
});

it('says what waited to be sent when the report was taken, without the edits themselves', () => {
  const now = Date.now();
  diagnostics.setEditQueueReader(() => [
    { collection: 'studyNotes', state: 'queued', createdAt: now - 5000 },
    { collection: 'studyNotes', state: 'unknown', createdAt: now - 60_000 },
    { collection: 'sermons', state: 'conflict', createdAt: now - 1000 },
  ]);
  const report = diagnostics.buildDiagnosticReport();
  expect(report.edits).toEqual({
    pending: 3,
    byState: { queued: 1, unknown: 1, conflict: 1 },
    byCollection: { studyNotes: 2, sermons: 1 },
    oldestAgeMs: expect.any(Number),
  });
  expect(report.edits?.oldestAgeMs).toBeGreaterThanOrEqual(60_000);
});

it('records what the person did — an edit, dictation, a trouble shown — as plain words only', () => {
  diagnostics.recordDiagnostic('edit', { collection: 'studyNotes', result: 'delivered', elapsedMs: 1500 });
  diagnostics.recordDiagnostic('dictation', { source: 'note', result: 'text', elapsedMs: 4200 });
  diagnostics.recordDiagnostic('sync-trouble', { code: 'conflict', collection: 'sermons' });
  // A report is often sent after a reload: the record must survive it, not only live in memory.
  jest.resetModules();
  diagnostics = require('@/utils/appDiagnostics');
  expect(diagnostics.diagnosticEvents().map(event => event.name)).toEqual(['edit', 'dictation', 'sync-trouble']);
});

it('does not count an edit the server already took as waiting to be sent', () => {
  const now = Date.now();
  diagnostics.setEditQueueReader(() => [
    { collection: 'studyNotes', state: 'acknowledged', createdAt: now - 1000 },
    { collection: 'studyNotes', state: 'queued', createdAt: now - 2000 },
  ]);
  const report = diagnostics.buildDiagnosticReport();
  expect(report.edits?.pending).toBe(1);
  expect(report.edits?.byState).toEqual({ acknowledged: 1, queued: 1 });
});
