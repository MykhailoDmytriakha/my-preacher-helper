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
  expect(data).toEqual({ route: '/sermons/:id/plan', elapsedMs: 5, visible: true });
  expect(localStorage.getItem(key)).not.toMatch(/password|token|private/);
  expect(diagnostics.diagnosticErrorCode({ code: 'firestore/permission-denied' })).toBe('permission-denied');
  expect(diagnostics.diagnosticErrorCode({ code: 'secret message' })).toBeUndefined();
  expect(diagnostics.diagnosticErrorCode({ code: 42 })).toBeUndefined();
  expect(diagnostics.diagnosticErrorCode(null)).toBeUndefined();
});

it('bounds history, drops expired records and coalesces repeated snapshot metadata', () => {
  jest.useFakeTimers();
  for (let index = 0; index < 90; index++) diagnostics.recordDiagnostic('focus');
  expect(diagnostics.diagnosticEvents()).toHaveLength(80);
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
  expect(restored[0].data).toEqual({ route: '/groups/:id' });
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
  expect(report.schema).toBe(1);
  expect(report.environment).toEqual(expect.objectContaining({ online: navigator.onLine, visibility: document.visibilityState }));
  expect(report.events[0].name).toBe('freshness-timeout');
  expect(JSON.parse(JSON.stringify(report)).runningVersion).toBeTruthy();
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
