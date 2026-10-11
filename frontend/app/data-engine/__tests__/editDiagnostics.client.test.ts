import { buildDiagnosticReport, recordDiagnostic } from '@/utils/appDiagnostics';

import { watchEditQueue } from '../editDiagnostics.client';

import type { JournalEntry } from '../types';

jest.mock('@/utils/appDiagnostics', () => ({
  ...jest.requireActual('@/utils/appDiagnostics'),
  recordDiagnostic: jest.fn(),
}));

function fakeEngine() {
  let pending: JournalEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    getPending: () => pending,
    subscribePending: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: JournalEntry[]) { pending = next; listeners.forEach(listener => listener()); },
  };
}
const entry = (operationId: string, state: JournalEntry['state'], collection = 'studyNotes', createdAt = Date.now() - 1500) =>
  ({ command: { operationId, resource: { collection, id: 'private-document-id' } }, state, createdAt, attempts: 0 }) as unknown as JournalEntry;

beforeEach(() => {
  jest.mocked(recordDiagnostic).mockClear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: false })) });
});

/**
 * WHAT THE PERSON DID, AS THE QUEUE SAW IT (owner, 2026-10-10: the report must let us reproduce a bug).
 * Each edit leaves a short trail — queued, then delivered or what stopped it — with the collection and
 * the time it took, never the document or its words.
 */
it('tells the path of each edit: queued, then delivered or what stopped it', () => {
  const engine = fakeEngine();
  const stop = watchEditQueue(engine);
  engine.set([entry('a', 'queued')]);
  engine.set([entry('a', 'sending')]);
  engine.set([entry('a', 'acknowledged')]);
  engine.set([]);
  engine.set([entry('b', 'queued', 'sermons')]);
  engine.set([entry('b', 'conflict', 'sermons')]);
  expect(jest.mocked(recordDiagnostic).mock.calls).toEqual([
    ['edit', { collection: 'studyNotes', result: 'queued' }],
    ['edit', { collection: 'studyNotes', result: 'delivered', elapsedMs: expect.any(Number) }],
    ['edit', { collection: 'sermons', result: 'queued' }],
    ['edit', { collection: 'sermons', result: 'conflict', elapsedMs: expect.any(Number) }],
  ]);
  expect(JSON.stringify(jest.mocked(recordDiagnostic).mock.calls)).not.toContain('private-document-id');

  stop();
  engine.set([]);
  expect(recordDiagnostic).toHaveBeenCalledTimes(4);
});

// The real engine shows queued → acknowledged → gone; only the acknowledgement proves delivery.
it('calls an edit delivered on the acknowledgement, and an edit that only vanished — cancelled in another tab — left', () => {
  const engine = fakeEngine();
  const stop = watchEditQueue(engine);
  engine.set([entry('a', 'queued')]);
  engine.set([entry('a', 'acknowledged')]);
  engine.set([]);
  engine.set([entry('b', 'queued')]);
  engine.set([]);
  expect(jest.mocked(recordDiagnostic).mock.calls).toEqual([
    ['edit', { collection: 'studyNotes', result: 'queued' }],
    ['edit', { collection: 'studyNotes', result: 'delivered', elapsedMs: expect.any(Number) }],
    ['edit', { collection: 'studyNotes', result: 'queued' }],
    ['edit', { collection: 'studyNotes', result: 'left', elapsedMs: expect.any(Number) }],
  ]);
  stop();
});

it('does not call an edit delivered when it only left the view with a change of account', () => {
  const engine = fakeEngine();
  let owner: string | null = 'owner-a';
  const stop = watchEditQueue(engine, () => owner);
  engine.set([entry('a', 'queued')]);
  owner = null;
  engine.set([]);
  expect(jest.mocked(recordDiagnostic).mock.calls).toEqual([['edit', { collection: 'studyNotes', result: 'queued' }]]);
  stop();
});

it('puts the queue as it stands into the report', () => {
  const engine = fakeEngine();
  const stop = watchEditQueue(engine);
  engine.set([entry('a', 'queued'), entry('b', 'unknown', 'sermons', Date.now() - 90_000)]);
  expect(buildDiagnosticReport().edits).toEqual({
    pending: 2,
    byState: { queued: 1, unknown: 1 },
    byCollection: { studyNotes: 1, sermons: 1 },
    oldestAgeMs: expect.any(Number),
  });
  stop();
  expect(buildDiagnosticReport().edits).toBeNull();
});
