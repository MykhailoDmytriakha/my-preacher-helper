import { claimRecordingDraftWork, isRecordingDraftInWork, listUnfinishedRecordingDrafts, saveRecordingDraft } from '@/utils/recordingDraftStore';

/*
 * BUG-20261117-recording-card-during-transcription: every microphone parks its take before the
 * provider works on it, and the «unfinished recording» card listed that take from the first second of
 * «Processing…» — as if the transcription had already failed. A take some tab is working on is not
 * unfinished; it becomes unfinished when the work ends without making it text.
 */

const mockRows = new Map<string, Record<string, unknown>>();
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (key: string) => mockRows.get(key)),
  entries: jest.fn(async () => Array.from(mockRows.entries())),
  update: jest.fn(async (key: string, change: (old: unknown) => unknown) => {
    const next = change(mockRows.get(key));
    if (next === undefined) mockRows.delete(key); else mockRows.set(key, next as Record<string, unknown>);
  }),
}));

const blob = new Blob(['a thought'], { type: 'audio/webm' });
const park = (id: string) => saveRecordingDraft({ id, ownerId: 'alice', blob, mimeType: 'audio/webm', context: 'sermon', contextId: 'sermon-a' });
const unfinished = async () => (await listUnfinishedRecordingDrafts({ ownerId: 'alice', context: 'sermon', contextId: 'sermon-a' })).map(draft => draft.id);

/** Web Locks shared by every tab of the browser: `held` is what all tabs hold together. */
function installLocks(heldElsewhere: string[] = []) {
  const held = new Map<string, number>();
  const locks = {
    request: jest.fn((name: string, callback: () => Promise<void>) => {
      held.set(name, (held.get(name) ?? 0) + 1);
      return callback().finally(() => {
        const count = (held.get(name) ?? 1) - 1;
        if (count) held.set(name, count); else held.delete(name);
      });
    }),
    query: jest.fn(async () => ({ held: [...heldElsewhere, ...held.keys()].map(name => ({ name })) })),
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  return locks;
}

beforeEach(() => {
  mockRows.clear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});
afterEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

it('does not offer a take as unfinished while this tab works on it, and offers it once the work ends without text', async () => {
  installLocks();
  const release = claimRecordingDraftWork('take-1');
  expect(release).not.toBeNull();
  await park('take-1');
  expect(isRecordingDraftInWork('take-1')).toBe(true);
  expect(await unfinished()).toEqual([]);
  release!();
  await Promise.resolve();
  expect(isRecordingDraftInWork('take-1')).toBe(false);
  expect(await unfinished()).toEqual(['take-1']);
});

it('refuses a second claim on the same take in this tab until the first work ends', () => {
  installLocks();
  const first = claimRecordingDraftWork('take-1');
  expect(claimRecordingDraftWork('take-1')).toBeNull();
  first!();
  first!();
  const again = claimRecordingDraftWork('take-1');
  expect(again).not.toBeNull();
  again!();
});

it('does not offer a take another tab of this browser is working on, so it is not sent twice', async () => {
  installLocks(['recording-draft-in-work:take-2']);
  await park('take-2');
  await park('take-3');
  expect(await unfinished()).toEqual(['take-3']);
});

it('still tells this tab its own work without the Web Locks API', async () => {
  const release = claimRecordingDraftWork('take-4');
  await park('take-4');
  expect(await unfinished()).toEqual([]);
  release!();
  expect(await unfinished()).toEqual(['take-4']);
});
