import { deleteRecordingDraft, getRecordingDraft, listRecordingDrafts, saveRecordingDraft } from '@/utils/recordingDraftStore';

const mockRows = new Map<string, Record<string, unknown>>();
const mockSet = jest.fn(async (key: string, value: Record<string, unknown>) => { mockRows.set(key, value); });
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  set: (...args: unknown[]) => mockSet(...args as [string, Record<string, unknown>]),
  get: jest.fn(async (key: string) => mockRows.get(key)),
  del: jest.fn(async (key: string) => { mockRows.delete(key); }),
  entries: jest.fn(async () => Array.from(mockRows.entries())),
  update: jest.fn(async (key: string, change: (old: unknown) => unknown) => {
    const next = change(mockRows.get(key));
    if (next === undefined) mockRows.delete(key); else mockRows.set(key, next as Record<string, unknown>);
  }),
}));

const blob = new Blob(['unfinished speech'], { type: 'audio/webm' });
const input = (ownerId: string, id: string, contextId = 'sermon-a:thought-a') => Object.assign({
  id, blob, mimeType: 'audio/webm', context: 'thought' as const, contextId,
}, { ownerId });
const listFor = (ownerId: string, contextId = 'sermon-a:thought-a') =>
  listRecordingDrafts(Object.assign({ context: 'thought' as const, contextId }, { ownerId }));
// Existing methods receive an owner argument: the broken baseline ignores it.
const getFor = (id: string, ownerId: string) =>
  (getRecordingDraft as (id: string, ownerId: string) => ReturnType<typeof getRecordingDraft>)(id, ownerId);
const deleteFor = (id: string, ownerId: string) =>
  (deleteRecordingDraft as (id: string, ownerId: string) => Promise<void>)(id, ownerId);

beforeEach(() => {
  mockRows.clear();
  mockSet.mockClear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('unfinished recordings belong to their owner and original destination', () => {
  it('keeps the owner with the persisted source', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    expect(mockRows.get('take-a')?.ownerId).toBe('alice');
    expect(mockRows.get('take-a')?.blob).toBe(blob);
  });

  it('does not offer another account its recording', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    expect((await listFor('bob')).map(draft => draft.id)).toEqual([]);
  });

  it('does not read another account recording by a known id', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    expect((await getFor('take-a', 'bob'))?.id).toBeUndefined();
  });

  it('does not let another account delete the source', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    await expect(deleteFor('take-a', 'bob')).rejects.toThrow();
    expect(mockRows.get('take-a')?.blob).toBe(blob);
  });

  it('refuses to overwrite an existing take owned by another account', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    await expect(saveRecordingDraft(input('bob', 'take-a'))).rejects.toThrow();
    expect(mockRows.get('take-a')?.blob).toBe(blob);
  });

  it('refuses to rebind the same take to another destination', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    await expect(saveRecordingDraft(input('alice', 'take-a', 'sermon-b:thought-b'))).rejects.toThrow();
    expect(mockRows.get('take-a')?.contextId).toBe('sermon-a:thought-a');
  });

  it('does not claim legacy unowned recordings for the next account', async () => {
    mockRows.set('old-take', { id: 'old-take', blob, mimeType: blob.type, createdAt: 1,
      context: 'thought', contextId: 'sermon-a:thought-a', sizeBytes: blob.size });
    expect((await listFor('alice')).map(draft => draft.id)).toEqual([]);
    expect(mockRows.has('old-take')).toBe(true);
  });

  it('refuses to report a durable save when IndexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    await expect(saveRecordingDraft(input('alice', 'take-a'))).rejects.toThrow();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('does not accept an empty owner identity', async () => {
    await expect(saveRecordingDraft(input('', 'take-a'))).rejects.toThrow();
    expect(mockRows.size).toBe(0);
  });

  it('keeps the original creation time when the same recording is parked again', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    await saveRecordingDraft(input('alice', 'take-a'));
    now.mockReturnValue(2000);
    await saveRecordingDraft(input('alice', 'take-a'));
    expect(mockRows.get('take-a')?.createdAt).toBe(1000);
  });

  it('keeps unrelated destinations out of the requested list', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    await saveRecordingDraft(input('alice', 'take-b', 'sermon-b:thought-b'));
    expect((await listFor('alice')).map(draft => draft.id)).toEqual(['take-a']);
  });

  it('lets its owner explicitly discard its own source', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    await deleteFor('take-a', 'alice');
    expect(await getFor('take-a', 'alice')).toBeUndefined();
    expect((await listFor('alice')).map(draft => draft.id)).toEqual([]);
  });
  it('does not resurrect a discarded take when an old failure parks it again', async () => {
    await saveRecordingDraft(input('alice', 'take-a'));
    await deleteFor('take-a', 'alice');
    await expect(saveRecordingDraft(input('alice', 'take-a'))).rejects.toThrow();
    expect((await listFor('alice')).map(draft => draft.id)).toEqual([]);
  });

  it('keeps an explicit discard ahead of a first delayed park operation', async () => {
    await deleteFor('take-a', 'alice');
    await expect(saveRecordingDraft(input('alice', 'take-a'))).rejects.toThrow();
    expect((await listFor('alice')).map(draft => draft.id)).toEqual([]);
  });

});


it('carries a recording to the created note without changing its source or action time', async () => {
  const store = await import('@/utils/recordingDraftStore');
  await saveRecordingDraft(input('alice', 'new-note-voice', 'new'));
  await store.saveRecordingDraftText('new-note-voice', 'alice', 'Recognized words');
  const before = await getFor('new-note-voice', 'alice');
  await store.moveRecordingDraft('new-note-voice', 'alice', { context: 'thought', contextId: 'new' }, 'real-note');
  const after = await getFor('new-note-voice', 'alice');
  expect(after?.contextId).toBe('real-note');
  expect(after?.createdAt).toBe(before?.createdAt);
  expect(after?.blob).toBe(before?.blob);
  expect(after?.transcript).toBe('Recognized words');
  await expect(store.moveRecordingDraft('new-note-voice', 'bob', { context: 'thought', contextId: 'real-note' }, 'elsewhere')).rejects.toThrow();
  expect((await getFor('new-note-voice', 'alice'))?.contextId).toBe('real-note');
  await deleteRecordingDraft('new-note-voice', 'alice');
  await store.moveRecordingDraft('new-note-voice', 'alice', { context: 'thought', contextId: 'real-note' }, 'elsewhere');
  expect(await getFor('new-note-voice', 'alice')).toBeUndefined();
});

it('adopts a legacy take only when its original document is verified as this account own data', async () => {
  mockRows.set('legacy-sermon', { id: 'legacy-sermon', blob, mimeType: 'audio/webm', createdAt: 12,
    sizeBytes: blob.size, context: 'sermon', contextId: 'sermon-old' });
  const store = await import('@/utils/recordingDraftStore') as typeof import('@/utils/recordingDraftStore') & {
    adoptLegacyRecordingDrafts?: (proof: { ownerId: string; sourceOwnerId: string; context: 'sermon'; contextId: string }) => Promise<number>;
  };
  expect(typeof store.adoptLegacyRecordingDrafts).toBe('function');
  expect(await store.adoptLegacyRecordingDrafts!({ ownerId: 'bob', sourceOwnerId: 'alice', context: 'sermon', contextId: 'sermon-old' })).toBe(0);
  expect(await store.listRecordingDrafts({ ownerId: 'bob', context: 'sermon', contextId: 'sermon-old' })).toEqual([]);
  expect(await store.adoptLegacyRecordingDrafts!({ ownerId: 'alice', sourceOwnerId: 'alice', context: 'sermon', contextId: 'sermon-old' })).toBe(1);
  const recovered = await store.getRecordingDraft('legacy-sermon', 'alice');
  expect(recovered?.createdAt).toBe(12);
  expect(recovered?.blob).toBe(blob);
  expect(await store.getRecordingDraft('legacy-sermon', 'bob')).toBeUndefined();
});

it('keeps a failed new-study carry visible only through that note exact source receipts', async () => {
  const store = await import('@/utils/recordingDraftStore');
  for (const [ownerId,id] of [['alice','linked-study'],['alice','unrelated-study'],['bob','other-owner']]) {
    await saveRecordingDraft({ id, ownerId, context: 'study', contextId: 'new', blob, mimeType: blob.type });
  }
  const idb = await import('idb-keyval');
  jest.mocked(idb.update).mockRejectedValueOnce(new Error('Move refused'));
  await expect(store.moveRecordingDraft('linked-study', 'alice', { context: 'study', contextId: 'new' }, 'created-note')).rejects.toThrow('Move refused');
  const filter = Object.assign({ ownerId: 'alice', context: 'study' as const, contextId: 'created-note' }, { linkedSourceIds: ['linked-study','other-owner'] });
  expect((await store.listRecordingDrafts(filter)).map(row => row.id)).toEqual(['linked-study']);
  expect(await store.listRecordingDrafts({ ownerId:'alice',context:'study',contextId:'another-note' })).toEqual([]);
  expect((await store.getRecordingDraft('linked-study','alice'))?.contextId).toBe('new');
});
