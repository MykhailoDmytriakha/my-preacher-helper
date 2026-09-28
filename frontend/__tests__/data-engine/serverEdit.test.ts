/** @jest-environment node */
import { adminDb } from '@/config/firebaseAdminConfig';
import { isClosedToLegacyWriters, isCollectionServed } from '@/data-engine/activation';
import { updateLegacyDocument } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, editOwnedDocument, readOwnSettings, writeOwnedDocument, writeOwnSettings } from '@/data-engine/serverEdit.server';

import type { DocumentData } from '@/data-engine/types';
import type { DocumentReference } from 'firebase-admin/firestore';

jest.mock('@/data-engine/activation', () => ({
  ...jest.requireActual('@/data-engine/activation'),
  isCollectionServed: jest.fn(() => true),
  isClosedToLegacyWriters: jest.fn(() => false),
}));
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));

type Raw = Record<string, unknown>;
const documents = new Map<string, Raw>();
/** Runs once before the next transaction body: a competing writer landing between read and commit. */
let interleave: (() => void) | undefined;
const snapshot = (path: string) => ({ ref: { path }, exists: documents.has(path), data: () => documents.get(path), id: path.split('/').at(-1)! });
function collection(name: string) {
  const conditions: Array<[string, unknown]> = [];
  const query = {
    doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`), collection: (child: string) => collection(`${name}/${id}/${child}`) }),
    where: (field: string, _operator: string, value: unknown) => { conditions.push([field, value]); return query; },
    orderBy: () => query, limit: () => query, startAfter: () => query,
    get: async () => ({ docs: [...documents.keys()].filter(key => key.startsWith(`${name}/`) && !key.slice(name.length + 1).includes('/')
      && conditions.every(([field, value]) => documents.get(key)![field] === value)).map(snapshot) }),
  };
  return query;
}

const sermon = { collection: 'sermons', id: 's1' };
const path = 'sermons/s1';
const marker = { protocol: 1, generation: 'g1', revision: 4, deleted: false };
const base = { userId: 'owner-1', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [] as DocumentData[] };
const thought = (id: string, text: string) => ({ id, text, tags: [], date: '2026-09-22T00:00:00.000Z' });
const append = (entry: DocumentData) => (current: DocumentData) => ({ ...current, thoughts: [...(current.thoughts as DocumentData[]), entry] });
const legacyTitle = (title: string) => () => updateLegacyDocument({ path } as unknown as DocumentReference, { title });

beforeEach(() => {
  documents.clear();
  interleave = undefined;
  jest.mocked(isCollectionServed).mockReturnValue(true);
  jest.mocked(isClosedToLegacyWriters).mockReturnValue(false);
  jest.mocked(adminDb.collection).mockImplementation(collection as never);
  (adminDb.runTransaction as jest.Mock).mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => {
    interleave?.();
    interleave = undefined;
    const writes = new Map<string, Raw>();
    const result = await callback({
      get: async (reference: { path?: string; get: () => Promise<unknown> }) => reference.path ? snapshot(reference.path) : reference.get(),
      set: (reference: { path: string }, value: Raw) => { writes.set(reference.path, value); },
      update: (reference: { path: string }, patch: Raw) => { writes.set(reference.path, { ...documents.get(reference.path), ...patch }); },
    });
    for (const [key, value] of writes) documents.set(key, value);
    return result;
  });
});

describe('server writes on documents the engine owns', () => {
  it('keeps the legacy write on a legacy document and never marks it', async () => {
    documents.set(path, { ...base });
    const engine = jest.fn(append(thought('t1', 'Voice')));
    await writeOwnedDocument({ owner: 'owner-1', resource: sermon, legacy: legacyTitle('Legacy title'), engine });
    expect(engine).not.toHaveBeenCalled();
    expect(documents.get(path)).toMatchObject({ title: 'Legacy title' });
    expect(documents.get(path)).not.toHaveProperty('_dataEngine');
  });

  it('lands a voice thought on an engine document through the command door instead of a 426', async () => {
    documents.set(path, { ...base, thoughts: [thought('t0', 'Earlier')], _dataEngine: marker });
    await writeOwnedDocument({ owner: 'owner-1', resource: sermon, legacy: legacyTitle('ignored'), engine: append(thought('t1', 'Voice')) });
    const stored = documents.get(path)!;
    expect((stored.thoughts as DocumentData[]).map(entry => entry.id)).toEqual(['t0', 't1']);
    expect(stored.title).toBe('Grace');
    expect(stored._dataEngine).toMatchObject({ generation: 'g1', revision: 5, deleted: false });
    // The same change feed and receipt a browser save leaves behind.
    expect([...documents.keys()].some(key => key.startsWith('_dataEngineReceipts/'))).toBe(true);
    expect([...documents.keys()].some(key => key.startsWith('_dataEngineHeads/') || key.includes('/changes/'))).toBe(true);
  });

  it('keeps the refusal when this deployment does not serve the collection', async () => {
    jest.mocked(isCollectionServed).mockReturnValue(false);
    documents.set(path, { ...base, _dataEngine: marker });
    await expect(writeOwnedDocument({ owner: 'owner-1', resource: sermon, legacy: legacyTitle('x'), engine: append(thought('t1', 'Voice')) }))
      .rejects.toMatchObject({ code: 'data-engine-required' });
    expect(documents.get(path)!.thoughts).toEqual([]);
  });

  it('merges with a competing thought that landed between the read and the commit', async () => {
    documents.set(path, { ...base, _dataEngine: marker });
    let raced = false;
    const engine = (current: DocumentData) => {
      if (!raced) {
        raced = true;
        interleave = () => documents.set(path, { ...documents.get(path)!, thoughts: [thought('other', 'From a tab')] });
      }
      return append(thought('t1', 'Voice'))(current);
    };
    await editOwnedDocument('owner-1', sermon, engine);
    expect((documents.get(path)!.thoughts as DocumentData[]).map(entry => entry.id).sort()).toEqual(['other', 't1']);
  });

  it('re-applies the change to a newer copy when the same field was changed meanwhile', async () => {
    const insights = (introduction: string) => ({ topics: [], relatedVerses: [], possibleDirections: [], sectionHints: { introduction, main: '', conclusion: '' } });
    documents.set(path, { ...base, insights: insights('old'), _dataEngine: marker });
    let calls = 0;
    const engine = (current: DocumentData) => {
      calls += 1;
      if (calls === 1) interleave = () => documents.set(path, { ...documents.get(path)!, insights: insights('tab') });
      const hints = (current.insights as { sectionHints: { introduction: string } }).sectionHints;
      return { ...current, insights: insights(`${hints.introduction} + server`) };
    };
    await editOwnedDocument('owner-1', sermon, engine);
    // The first attempt conflicts on the same leaf; the second is computed from the winner.
    expect(calls).toBe(2);
    expect((documents.get(path)!.insights as { sectionHints: { introduction: string } }).sectionHints.introduction).toBe('tab + server');
  });

  it('adopts an unmarked document through the engine once its collection is closed to legacy writers', async () => {
    jest.mocked(isClosedToLegacyWriters).mockReturnValue(true);
    documents.set(path, { ...base });
    const legacy = jest.fn(legacyTitle('never'));
    await writeOwnedDocument({ owner: 'owner-1', resource: sermon, legacy, engine: append(thought('t1', 'Voice')) });
    expect(legacy).not.toHaveBeenCalled();
    expect(documents.get(path)!._dataEngine).toMatchObject({ revision: 1, deleted: false });
  });

  it('refuses another owner through the engine exactly as through the legacy road', async () => {
    documents.set(path, { ...base, userId: 'someone-else', _dataEngine: marker });
    await expect(editOwnedDocument('owner-1', sermon, append(thought('t1', 'Voice')))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('lets the early route check pass an engine document only where it is served', () => {
    expect(() => assertServerWritable({ ...base, _dataEngine: marker }, 'sermons')).not.toThrow();
    jest.mocked(isCollectionServed).mockReturnValue(false);
    expect(() => assertServerWritable({ ...base, _dataEngine: marker }, 'sermons')).toThrow('data-engine-required');
    expect(() => assertServerWritable({ ...base }, 'sermons')).not.toThrow();
  });
});

describe('a legacy flat patch laid over the current document', () => {
  const { applyLegacyPatch } = jest.requireActual('@/data-engine/serverEdit.server') as typeof import('@/data-engine/serverEdit.server');

  it('writes nested paths without touching sibling fields, and leaves the counters to the engine', () => {
    const current = { audioMetadata: { provider: 'openai', voice: 'alloy' }, rev: { thoughts: 3 }, title: 'Grace' };
    const next = applyLegacyPatch(current, { 'audioMetadata.chunksCount': 4, 'audioMetadata.mode': 'ai', 'rev.thoughts': 99, audioChunks: [] });
    expect(next).toEqual({ audioMetadata: { provider: 'openai', voice: 'alloy', chunksCount: 4, mode: 'ai' }, rev: { thoughts: 3 }, title: 'Grace', audioChunks: [] });
    expect(current.audioMetadata).toEqual({ provider: 'openai', voice: 'alloy' });
  });

  it('refuses a Firestore sentinel instead of storing its internals', () => {
    class Sentinel { constructor(public readonly operand: number) {} }
    expect(() => applyLegacyPatch({}, { count: new Sentinel(1) })).toThrow('unsupported-server-patch');
  });
});

describe('a tag deleted through the engine', () => {
  const tagMarker = { protocol: 1, generation: 'gt', revision: 1, deleted: false };
  const tagValue = { userId: 'owner-1', name: 'Topic', color: '#111111', required: false };
  const tagged = (id: string, tags: string[]) => ({ id, text: 'Words', date: '2026-09-22T00:00:00.000Z', tags });

  it('leaves every thought after its own commit, on each sermon\'s road, with no ceiling', async () => {
    const { processCommand } = await import('@/data-engine/server');
    documents.set('tags/t1', { ...tagValue, _dataEngine: tagMarker });
    documents.set('sermons/legacy', { ...base, thoughts: [tagged('a', ['Topic', 'Other'])] });
    documents.set('sermons/engine', { ...base, thoughts: [tagged('b', ['Topic'])], _dataEngine: marker });
    for (let index = 0; index < 120; index++) documents.set(`sermons/plain-${index}`, { ...base, thoughts: [tagged(`p${index}`, ['Other'])] });
    documents.set('sermons/foreign', { ...base, userId: 'someone-else', thoughts: [tagged('f', ['Topic'])] });
    const result = await processCommand('owner-1', { protocol: 1, operationId: 'delete-tag-1', owner: 'owner-1',
      resource: { collection: 'tags', id: 't1' }, generation: 'gt', dependsOn: [], kind: 'delete', baseline: tagValue });
    expect(result.kind).toBe('acknowledged');
    expect(documents.get('tags/t1')).toMatchObject({ _dataEngine: { deleted: true } });
    expect((documents.get('sermons/legacy')!.thoughts as DocumentData[])[0].tags).toEqual(['Other']);
    expect(documents.get('sermons/legacy')).not.toHaveProperty('_dataEngine');
    expect((documents.get('sermons/engine')!.thoughts as DocumentData[])[0].tags).toEqual([]);
    expect(documents.get('sermons/engine')!._dataEngine).toMatchObject({ revision: 5 });
    expect((documents.get('sermons/foreign')!.thoughts as DocumentData[])[0].tags).toEqual(['Topic']);
    expect((documents.get('sermons/plain-7')!.thoughts as DocumentData[])[0].tags).toEqual(['Other']);
  });

  it('skips a sermon that refuses and still cleans the ones after it', async () => {
    const { processCommand } = await import('@/data-engine/server');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    documents.set('tags/t1', { ...tagValue, _dataEngine: tagMarker });
    // An old thought without a date: the engine refuses any rewrite of this sermon's thoughts.
    documents.set('sermons/broken', { ...base, thoughts: [{ id: 'old', text: 'Old', tags: ['Topic'] }], _dataEngine: marker });
    documents.set('sermons/later', { ...base, thoughts: [tagged('c', ['Topic'])] });
    const result = await processCommand('owner-1', { protocol: 1, operationId: 'delete-tag-2', owner: 'owner-1',
      resource: { collection: 'tags', id: 't1' }, generation: 'gt', dependsOn: [], kind: 'delete', baseline: tagValue });
    expect(result.kind).toBe('acknowledged');
    expect((documents.get('sermons/later')!.thoughts as DocumentData[])[0].tags).toEqual([]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('sermon broken'), expect.anything());
    errors.mockRestore();
  });
});


describe('settings bootstrap through the shared server protocol', () => {
  const userPath = 'users/owner-1';

  it('creates a missing profile with a revision, receipt and change head', async () => {
    await writeOwnSettings('owner-1', 'bootstrap', { language: 'ru', displayName: 'Name' });
    expect(documents.get(userPath)).toMatchObject({ language: 'ru', displayName: 'Name', _dataEngine: { revision: 1 } });
    expect([...documents.keys()].some(key => key.startsWith('_dataEngineReceipts/'))).toBe(true);
    expect([...documents.keys()].some(key => key.startsWith('_dataEngineHeads/'))).toBe(true);
    await expect(readOwnSettings('owner-1')).resolves.toEqual({ language: 'ru', displayName: 'Name' });
  });

  it('preserves entitlements and the saved language when bootstrap adopts an existing profile', async () => {
    documents.set(userPath, { language: 'en', paidTier: 'tier2', usage: { ai: 7 }, role: 'admin' });
    await writeOwnSettings('owner-1', 'bootstrap', { language: 'ru', email: 'name@example.com' });
    expect(documents.get(userPath)).toMatchObject({ language: 'en', paidTier: 'tier2', usage: { ai: 7 }, role: 'admin', email: 'name@example.com', _dataEngine: { revision: 1 } });
  });

  it('handles a simultaneous first sign-in without replacing the winning profile', async () => {
    interleave = () => documents.set(userPath, { language: 'en', paidTier: 'tier2', _dataEngine: marker });
    await writeOwnSettings('owner-1', 'bootstrap', { language: 'ru', displayName: 'Name' });
    expect(documents.get(userPath)).toMatchObject({ language: 'en', paidTier: 'tier2', displayName: 'Name', _dataEngine: { generation: 'g1', revision: 5 } });
  });

  it('changes public language through the command protocol', async () => {
    documents.set(userPath, { language: 'en', _dataEngine: marker });
    await writeOwnSettings('owner-1', 'language', { language: 'uk' });
    expect(documents.get(userPath)).toMatchObject({ language: 'uk', _dataEngine: { revision: 5 } });
  });

  it.each(['paidTier', 'promotion', 'usage', 'role', 'referredBy', 'id', 'userId', '_dataEngine'])(
    'rejects protected %s fields on bootstrap', async field => {
      await expect(writeOwnSettings('owner-1', 'bootstrap', { [field]: 'forbidden' })).rejects.toMatchObject({ status: 400 });
      expect(documents.size).toBe(0);
    });

  it('refuses old mutations on served users before any write', async () => {
    await expect(writeOwnSettings('owner-1', 'legacy', { enablePrepMode: true })).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    expect(documents.size).toBe(0);
  });

  it.each([{ operation: ['legacy'] }, { operation: ['bootstrap'] }, { operation: 'unknown' }, { operation: null }])('rejects an invalid runtime operation before changing settings (%j)', async ({ operation }) => {
    documents.set(userPath, { language: 'en', enablePrepMode: false, _dataEngine: marker });
    await expect(writeOwnSettings('owner-1', operation as never, { language: 'ru' })).rejects.toMatchObject({ status: 400 });
    expect(documents.get(userPath)).toEqual({ language: 'en', enablePrepMode: false, _dataEngine: marker });
    expect(documents.size).toBe(1);
  });

  it('keeps unserved bootstrap compatible and refuses a marked document on an unserved deployment', async () => {
    jest.mocked(isCollectionServed).mockReturnValue(false);
    await writeOwnSettings('owner-1', 'bootstrap', { language: 'en' });
    expect(documents.get(userPath)).toEqual({ language: 'en' });
    documents.set(userPath, { language: 'en', _dataEngine: marker });
    await expect(writeOwnSettings('owner-1', 'language', { language: 'ru' })).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(documents.get(userPath)?.language).toBe('en');
  });
});


it('records server heartbeat through the engine without disturbing entitlement fields', async () => {
  documents.set('users/owner-1', { paidTier: 'tier2', usage: { ai: 7 }, _dataEngine: marker });
  const before = Date.now();
  await writeOwnSettings('owner-1', 'heartbeat', {});
  const stored = documents.get('users/owner-1')!;
  expect(stored).toMatchObject({ paidTier: 'tier2', usage: { ai: 7 }, _dataEngine: { revision: 5 } });
  expect(Date.parse(stored.lastSeenAt as string)).toBeGreaterThanOrEqual(before);
  await expect(writeOwnSettings('owner-1', 'heartbeat', { lastSeenAt: 'spoof' })).rejects.toMatchObject({ status: 400 });
});
