/** @jest-environment node */
import { createHash } from 'node:crypto';

import { adminDb } from '@/config/firebaseAdminConfig';
import { isCollectionServed } from '@/data-engine/activation';
import { DataEngineServerError, listDocuments, MAX_COMMAND_BYTES, processCommand, readCollectionChanges, readCommandBody, readDocument, serverErrorResponse } from '@/data-engine/server';
import { collectionHeadId, HEADS_COLLECTION, sequenceId } from '@/data-engine/serverFeed';
import { DataSession } from '@/data-engine/session';
import type { DataCommand, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: jest.fn(() => true) }));

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));

jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  Filter: {
    where: (field: string, operator: string, value: unknown) => ({ kind: 'field', field, operator, value }),
    or: (...filters: unknown[]) => ({ kind: 'or', filters }),
  },
}));

type Raw = Record<string, unknown>;
type QueryFilter = { kind: 'field'; field: string; operator: string; value: unknown }
  | { kind: 'or'; filters: QueryFilter[] };
function matchesFilter(data: Raw, filter: QueryFilter): boolean {
  if (filter.kind === 'or') return filter.filters.some(part => matchesFilter(data, part));
  return filter.operator === 'array-contains'
    ? Array.isArray(data[filter.field]) && (data[filter.field] as unknown[]).includes(filter.value)
    : data[filter.field] === filter.value;
}
const documents = new Map<string, Raw>();
let transactionTail: Promise<unknown>;
let failCommit = false;
const snapshot = (path: string) => ({ exists: documents.has(path), data: () => documents.get(path), id: path.split('/').at(-1)! });
function queryFor(collection: string) {
  let maximum = 50;
  let cursor = '';
  const conditions: QueryFilter[] = [];
  const query = {
    doc: (id: string) => ref(`${collection}/${id}`),
    where: jest.fn().mockImplementation((field: string | QueryFilter, operator: string, value: unknown) => { conditions.push(typeof field === 'string' ? { kind: 'field', field, operator, value } : field); return query; }),
    orderBy: jest.fn().mockImplementation(() => query),
    limit: jest.fn().mockImplementation((value: number) => { maximum = value; return query; }),
    startAfter: jest.fn().mockImplementation((value: string) => { cursor = value; return query; }),
    get: async () => ({ docs: [...documents.entries()].filter(([key, data]) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/') && conditions.every(condition => matchesFilter(data, condition)) && key.slice(collection.length + 1) > cursor).sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum).map(([key]) => snapshot(key)) }),
  };
  return query;
}
function ref(path: string): { path: string; get: () => Promise<ReturnType<typeof snapshot>>; collection: (name: string) => ReturnType<typeof queryFor> } {
  return { path, get: async () => snapshot(path), collection: name => queryFor(`${path}/${name}`) };
}
const resource = { collection: 'sermons', id: 'sermon-1' };
const create = (operationId = 'create-1'): DataCommand => ({ protocol: 1, operationId, owner: 'owner-1', resource, generation: null, dependsOn: [], kind: 'create', value: { userId: 'owner-1', title: 'First', verse: 'John 1:1', date: '2026-01-01', thoughts: [] } });
const update = (operationId = 'update-1', generation: string | null = 'create-1'): DataCommand => ({ protocol: 1, operationId, owner: 'owner-1', resource, generation, dependsOn: [], kind: 'update', changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Second' } }] });
const receiptPath = (owner: string, operationId: string) => `_dataEngineReceipts/${createHash('sha256').update(JSON.stringify([owner, operationId])).digest('hex')}`;
const receipts = () => [...documents.entries()].filter(([key]) => key.startsWith('_dataEngineReceipts/'));
const transactionReads: string[] = [];
const transactionWrites: string[] = [];
// Document operation model, not a cloud billing report: include empty-query minimums.
let documentReadUnits = 0;

beforeEach(() => {
  jest.mocked(isCollectionServed).mockReturnValue(true);
  documents.clear();
  transactionReads.length = 0;
  transactionWrites.length = 0;
  documentReadUnits = 0;
  failCommit = false;
  transactionTail = Promise.resolve();
  (adminDb.collection as jest.Mock).mockImplementation(queryFor);
  (adminDb.runTransaction as jest.Mock).mockImplementation((callback: (tx: unknown) => Promise<unknown>) => {
    const run = transactionTail.then(async () => {
      const writes = new Map<string, Raw>();
      const result = await callback({
        get: async (reference: { path?: string; get: () => Promise<unknown> }) => {
          if (writes.size) throw new Error('Firestore requires all reads before writes');
          if (reference.path) { transactionReads.push(reference.path); documentReadUnits += 1; return snapshot(reference.path); }
          const result = await reference.get() as { docs: unknown[] };
          documentReadUnits += Math.max(1, result.docs.length);
          return result;
        },
        set: (reference: { path: string }, value: Raw) => { transactionWrites.push(reference.path); writes.set(reference.path, value); },
      });
      if (failCommit) throw new Error('Commit failed');
      for (const [key, value] of writes) documents.set(key, value);
      return result;
    });
    transactionTail = run.catch(() => undefined);
    return run;
  });
});

describe('relation scope with unrelated owner documents', () => {
  const owner = 'owner-1';
  const member = (id: string, type = 'sermon') => ({ id: `item-${id}`, type, refId: id, position: 1 });
  const putSeries = (id: string, items: Raw[] = []) => documents.set(`series/${id}`, {
    userId: owner, title: 'Keep series', items, sermonIds: items.filter(item => item.type === 'sermon').map(item => item.refId),
  });
  const unrelated = (collection: string, count = 305) => {
    for (let index = 0; index < count; index++) {
      const id = `a-${String(index).padStart(4, '0')}`;
      if (collection === 'series') putSeries(id);
      else documents.set(`${collection}/${id}`, { userId: owner, title: 'Unrelated', noteIds: [], sections: [] });
    }
  };
  const remove = (collection: string, id: string, baseline: Raw): DataCommand => ({
    protocol: 1, owner, operationId: `remove-${collection}`, resource: { collection, id }, generation: null,
    dependsOn: [], kind: 'delete', baseline: baseline as never,
  });
  const attach = (): DataCommand => ({
    protocol: 1, owner, operationId: 'attach-after-unrelated', resource: { collection: 'series', id: 'z-target' },
    generation: null, dependsOn: [], kind: 'relation', relation: 'series-membership', edits: [
      { resource: { collection: 'series', id: 'z-target' }, generation: null, beforeItems: [], afterItems: [member('g', 'group') as never] },
    ],
  });

  it.each(['sermons', 'groups'])('deletes %s and cleans a late related series beyond three unrelated pages', async collection => {
    unrelated('series');
    const baseline = { userId: owner, title: 'Delete target' };
    documents.set(`${collection}/target`, baseline);
    putSeries('z-related', [member('target', collection === 'groups' ? 'group' : 'sermon'), { ...member('keep'), position: 2 }]);
    documents.set('series/z-foreign', { userId: 'victim', items: [member('target')] });
    const untouched = structuredClone(documents.get('series/a-0000'));
    expect(await processCommand(owner, remove(collection, 'target', baseline))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get(`${collection}/target`)?._dataEngine).toMatchObject({ deleted: true });
    expect(documents.get('series/z-related')).toMatchObject({ items: [{ refId: 'keep', position: 1 }], sermonIds: ['keep'] });
    expect(documents.get('series/a-0000')).toEqual(untouched);
    expect(documents.get('series/z-foreign')?.userId).toBe('victim');
  });

  it('deletes a note and a late legacy section-only link without rewriting unrelated materials', async () => {
    unrelated('studyMaterials');
    const baseline = { userId: owner, content: 'Delete target', materialIds: [] };
    documents.set('studyNotes/n', baseline);
    documents.set('studyMaterials/z-related', { userId: owner, title: 'Keep title', noteIds: [],
      sections: [{ id: 'section', title: 'Keep section', connector: 'Keep words', noteIds: ['n'] }] });
    const untouched = structuredClone(documents.get('studyMaterials/a-0000'));
    expect(await processCommand(owner, remove('studyNotes', 'n', baseline))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('studyMaterials/z-related')).toMatchObject({ title: 'Keep title', noteIds: [],
      sections: [{ title: 'Keep section', connector: 'Keep words', noteIds: [] }] });
    expect(documents.get('studyMaterials/a-0000')).toEqual(untouched);
  });

  it('attaches a group after unrelated series without weakening exclusive membership', async () => {
    unrelated('series'); documents.set('groups/g', { userId: owner, title: 'Group' }); putSeries('z-target');
    expect(await processCommand(owner, attach())).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('series/z-target')).toMatchObject({ items: [member('g', 'group')], sermonIds: [] });
  });

  it('finds a real duplicate beyond the unrelated prefix and refuses every proposed write', async () => {
    unrelated('series'); documents.set('groups/g', { userId: owner }); putSeries('z-target');
    putSeries('z-assigned', [member('g', 'group')]);
    expect(await processCommand(owner, attach())).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
    expect(documents.get('series/z-target')?.items).toEqual([]);
    expect(documents.get('series/z-assigned')?.items).toEqual([member('g', 'group')]);
  });

  it.each([99, 100])('enforces the exact participant boundary for %s related series', async count => {
    const baseline = { userId: owner, title: 'Target' };
    documents.set('groups/g', baseline);
    for (let index = 0; index < count; index++) putSeries(`related-${index}`, [member('g', 'group')]);
    const result = await processCommand(owner, remove('groups', 'g', baseline));
    expect(result.kind).toBe(count === 99 ? 'acknowledged' : 'refused');
    if (count === 100) expect(documents.get('groups/g')).toEqual(baseline);
    else expect(documents.get('series/related-98')?.items).toEqual([]);
  });

  it('keeps the atomic refusal for too many genuinely related records', async () => {
    const baseline = { userId: owner, title: 'Keep target' };
    documents.set('groups/g', baseline);
    for (let index = 0; index < 101; index++) putSeries(`related-${index}`, [member('g', 'group')]);
    expect(await processCommand(owner, remove('groups', 'g', baseline))).toMatchObject({ kind: 'refused', code: 'relation-scope-too-large' });
    expect(documents.get('groups/g')).toEqual(baseline);
    expect(documents.get('series/related-100')?.items).toEqual([member('g', 'group')]);
  });
});

describe('accepted resource recency', () => {
  const first = '2026-10-15T10:00:00.000Z';
  const later = '2026-10-15T11:00:00.000Z';
  beforeEach(() => { jest.useFakeTimers({ now: new Date(first) }); });
  afterEach(() => { jest.useRealTimers(); });

  it('stamps creates and field-only saves consistently in ACK, storage and collection reads', async () => {
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', snapshot: { value: { updatedAt: first } } });
    jest.setSystemTime(new Date(later));
    const accepted = await processCommand('owner-1', update());
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: later } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(later);
    expect(await readDocument('owner-1', resource)).toEqual(accepted.kind === 'acknowledged' ? accepted.snapshot : null);
    expect(await readCollectionChanges('owner-1', 'sermons', 0)).toMatchObject({ snapshots: [{ value: { updatedAt: later } }] });
  });

  it('preserves native timestamp storage on a no-op and stamps content changes consistently', async () => {
    const nativeTime = { toDate: () => new Date(first) };
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', updatedAt: nativeTime });
    jest.setSystemTime(new Date(later));
    const noChange = await processCommand('owner-1', { ...update('native-no-op', null), changes: [
      { path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'First' } },
    ] });
    expect(noChange).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'First', updatedAt: first } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(nativeTime);
    const edited = await processCommand('owner-1', update('native-edit', 'native-no-op'));
    expect(edited).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: later } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(later);
    if (edited.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    expect(await readDocument('owner-1', resource)).toEqual(edited.snapshot);
  });

  it('accepts a normal legacy edit that supplies missing required recency metadata', async () => {
    const note = { collection: 'studyNotes', id: 'legacy-note' };
    documents.set('studyNotes/legacy-note', { userId: 'owner-1', content: 'Before', tags: [], isDraft: false, createdAt: first });
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', { protocol: 1, operationId: 'legacy-edit', owner: 'owner-1', resource: note,
      generation: null, dependsOn: [], kind: 'update', changes: [
        { path: ['content'], before: { exists: true, value: 'Before' }, after: { exists: true, value: 'After' } },
        { path: ['updatedAt'], before: { exists: false }, after: { exists: true, value: '2026-10-15T10:30:00.000Z' } },
      ] })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { content: 'After', updatedAt: later } } });
  });

  it('uses one server time for every changed participant of a relation', async () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [], updatedAt: first });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [], updatedAt: first });
    jest.setSystemTime(new Date(later));
    const accepted = await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'attach',
      resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
      beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] });
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { updatedAt: later } }, relatedSnapshots: [{ value: { updatedAt: later } }] });
    expect(documents.get('studyMaterials/m')?.updatedAt).toBe(later);
    expect(documents.get('studyNotes/n')?.updatedAt).toBe(later);
    expect(documentReadUnits).toBe(5);
    expect(transactionWrites).toHaveLength(7);
  });

  it('acknowledges duplicate content and timestamp-only saves without moving recency', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update('title-edit'));
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: first } } });
    // Another device submits the same authored change with a stale ancestor.
    expect(await processCommand('owner-1', update('same-edit'))).toMatchObject({ kind: 'acknowledged', committed: { revision: 3 }, snapshot: { value: { title: 'Second', updatedAt: first } } });
    const revisionBeforeTimestamp = documents.get('sermons/sermon-1')?.rev;
    expect(await processCommand('owner-1', { ...update('timestamp-only'), changes: [{ path: ['updatedAt'], before: { exists: true, value: first }, after: { exists: true, value: '2099-01-01T00:00:00.000Z' } }] })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: first } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(first);
    expect(documents.get('sermons/sermon-1')?.rev).toEqual(revisionBeforeTimestamp);
  });

  it('retains the existing refusal of creation metadata changes', async () => {
    await processCommand('owner-1', create());
    jest.setSystemTime(new Date(later));
    const result = await processCommand('owner-1', { ...update('creation-metadata'), changes: [{ path: ['createdAt'], before: { exists: false }, after: { exists: true, value: '2026-10-01T00:00:00.000Z' } }] });
    expect(result).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(first);
    expect(documents.get('sermons/sermon-1')).not.toHaveProperty('createdAt');
  });

  it('does not move either participant for an already-satisfied relation', async () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
    const command: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'attach',
      resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
      beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] };
    await processCommand('owner-1', command);
    jest.setSystemTime(new Date(later));
    const result = await processCommand('owner-1', { ...command, operationId: 'already-attached', generation: 'attach', beforeNoteIds: ['n'], targets: [{ id: 'n', generation: 'attach' }] });
    expect(result).toMatchObject({ kind: 'acknowledged', committed: { revision: 2, operationId: 'already-attached' }, snapshot: { value: { updatedAt: first } } });
    expect(documents.get('studyMaterials/m')?.updatedAt).toBe(first);
    expect(documents.get('studyNotes/n')?.updatedAt).toBe(first);
  });

  it('does not let an old device timestamp refuse an independent content edit', async () => {
    await processCommand('owner-1', create());
    jest.setSystemTime(new Date(later));
    const command = update();
    if (command.kind !== 'update') throw new Error('Expected update');
    const accepted = await processCommand('owner-1', { ...command, changes: [...command.changes,
      { path: ['updatedAt'], before: { exists: true, value: '2026-10-01T00:00:00.000Z' }, after: { exists: true, value: '2026-10-02T00:00:00.000Z' } }] });
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: later } } });
  });

  it('keeps refusal, blocked delivery, conflict and failed commit from moving recency', async () => {
    await processCommand('owner-1', create());
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', update('wrong-generation', 'wrong'))).toMatchObject({ kind: 'refused' });
    expect(await processCommand('owner-1', { ...update('blocked'), dependsOn: ['missing'] })).toMatchObject({ kind: 'blocked' });
    expect(await processCommand('owner-1', { ...update('conflict'), changes: [{ path: ['title'], before: { exists: true, value: 'Unseen' }, after: { exists: true, value: 'Other' } }] })).toMatchObject({ kind: 'conflict' });
    failCommit = true;
    await expect(processCommand('owner-1', update('failed'))).rejects.toThrow('Commit failed');
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(first);
  });

  it('leaves tombstones without authored fields or a new recency time', async () => {
    const saved = await processCommand('owner-1', create());
    if (saved.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', { ...update('delete'), kind: 'delete', baseline: saved.snapshot.value! })).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    expect(documents.get('sermons/sermon-1')).not.toHaveProperty('updatedAt');
  });
});

describe('document operation budgets', () => {
  const reset = () => { documentReadUnits = 0; transactionWrites.length = 0; };
  const measured = () => ({ reads: documentReadUnits, writes: transactionWrites.length });

  it('bounds an atomic two-document relation across two collections', async () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
    expect(await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'attach',
      resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
      beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] })).toMatchObject({ kind: 'acknowledged' });
    expect(measured()).toEqual({ reads: 5, writes: 7 });
  });

  it('bounds create/update and duplicate/refused delivery without multiplying effect writes', async () => {
    await processCommand('owner-1', create());
    expect(measured()).toEqual({ reads: 3, writes: 4 }); // Resource, receipt, head; resource, receipt, head, pointer.
    reset(); await processCommand('owner-1', update());
    expect(measured()).toEqual({ reads: 3, writes: 4 });
    reset(); await processCommand('owner-1', update());
    expect(measured()).toEqual({ reads: 2, writes: 0 });
    reset(); expect(await processCommand('owner-1', { ...update('conflict'), changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Competing' } }] })).toMatchObject({ kind: 'conflict' });
    expect(measured()).toEqual({ reads: 2, writes: 1 });
  });

  describe('cold owner-list read budgets', () => {
    it('checks an empty owner list without a second empty query', async () => {
      const page = await listDocuments('owner-1', 'sermons', { limit: 2 });
      expect(page.snapshots).toEqual([]);
      expect(page.nextCursor).toBeNull();
      expect(measured()).toEqual({ reads: 2, writes: 0 });
    });

    it.each(['live', 'mixed'] as const)('does not repeatedly fetch unreturned %s page tails', async mode => {
      const expected = Array.from({ length: 9 }, (_, index) => `row-${index}`);
      expected.forEach((id, index) => {
        const deleted = mode === 'mixed' && index % 2 === 1;
        documents.set(`sermons/${id}`, deleted
          ? { _dataEngineOwner: 'owner-1', _dataEngine: { protocol: 1, generation: id, revision: 1, deleted: true },
            ...(index === 3 ? { userId: 'owner-1' } : {}) }
          : { userId: 'owner-1', title: id });
        documents.set(`sermons/foreign-${index}`, { userId: 'attacker', title: 'Never this owner' });
      });
      const seen: ResourceSnapshot[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const page = await listDocuments('owner-1', 'sermons', { limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.snapshots);
        pages += 1;
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen.map(item => item.resource.id)).toEqual(expected);
      expect(seen.map(item => item.value === null)).toEqual(expected.map((_, index) => mode === 'mixed' && index % 2 === 1));
      expect(pages).toBe(5);
      // These small rows fit the byte budget: each page needs its head and at most one lookahead row.
      // This is the existing SDK document-operation model, not a cloud billing assertion.
      expect(measured().reads).toBeLessThanOrEqual(expected.length + pages + (pages - 1));
      expect(measured().writes).toBe(0);
    });
  });

  it('counts empty queries, live and tombstone lists, and deduplicated feed document reads', async () => {
    await listDocuments('owner-1', 'sermons');
    expect(measured()).toEqual({ reads: 2, writes: 0 }); // Head plus one empty ownership-union query.
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    reset(); await listDocuments('owner-1', 'sermons');
    expect(measured()).toEqual({ reads: 2, writes: 0 }); // One live row and head; no extra empty tombstone query.
    reset(); await readCollectionChanges('owner-1', 'sermons', 0);
    expect(measured()).toEqual({ reads: 4, writes: 0 }); // Two pointers, one distinct document, one head.
    reset(); await readCollectionChanges('owner-1', 'sermons', 2);
    expect(measured()).toEqual({ reads: 2, writes: 0 });
  });

  it('retains compact acknowledgement proofs across a thousand saves and replays an old operation', async () => {
    await processCommand('owner-1', create());
    reset();
    for (let index = 0; index < 1_000; index += 1) {
      await processCommand('owner-1', { ...update(`save-${index}`), changes: [{ path: ['title'], before: { exists: true, value: index === 0 ? 'First' : `Title ${index - 1}` }, after: { exists: true, value: `Title ${index}` } }] });
    }
    expect(measured()).toEqual({ reads: 3_000, writes: 4_000 });
    const savedReceipts = receipts();
    expect(savedReceipts).toHaveLength(1_001);
    expect(Math.max(...savedReceipts.map(([, value]) => Buffer.byteLength(JSON.stringify(value))))).toBeLessThan(1_000);
    expect([...documents.keys()].filter(key => key.includes('/changes/'))).toHaveLength(1_001);
    reset(); expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', committed: { revision: 1 }, snapshot: { value: { title: 'Title 999' } } });
    expect(measured()).toEqual({ reads: 2, writes: 0 });
  });

  it('does not reapply an old saved operation when later edits return to its original ancestor', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    await processCommand('owner-1', { ...update('back-to-first'), changes: [{ path: ['title'], before: { exists: true, value: 'Second' }, after: { exists: true, value: 'First' } }] });
    reset();
    expect(await processCommand('owner-1', update())).toMatchObject({ kind: 'acknowledged', committed: { revision: 2 }, snapshot: { value: { title: 'First' } } });
    expect(measured()).toEqual({ reads: 2, writes: 0 });
  });
});

describe('atomic acknowledgement participants', () => {
  const attach: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'attach',
    resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
    beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] };
  const seed = () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
  };

  it('returns secondary accepted content without storing it in compact history or adding initial reads', async () => {
    seed();
    const result = await processCommand('owner-1', attach);
    expect(result).toMatchObject({ kind: 'acknowledged', relatedSnapshots: [{ resource: { collection: 'studyNotes', id: 'n' },
      value: { content: 'Keep text', materialIds: ['m'] }, metadata: { generation: 'attach', revision: 1 } }] });
    expect(documentReadUnits).toBe(5);
    const stored = JSON.parse(documents.get(receiptPath('owner-1', 'attach'))!.resultJson as string);
    expect(stored.relatedSnapshots).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('Keep text');
    expect(stored.affected).toHaveLength(1);
  });
  it('acknowledges a new already-satisfied relation with its own replayable proof', async () => {
    seed(); await processCommand('owner-1', attach);
    const noChange: DataCommand = { ...attach, operationId: 'already-satisfied', generation: 'attach', beforeNoteIds: ['n'], targets: [{ id: 'n', generation: 'attach' }] };
    const accepted = await processCommand('owner-1', noChange);
    expect(accepted).toMatchObject({ kind: 'acknowledged', committed: { operationId: 'already-satisfied', revision: 2 },
      snapshot: { value: { noteIds: ['n'] }, metadata: { operationId: 'already-satisfied' } } });
    const writes = [...transactionWrites];
    expect(await processCommand('owner-1', noChange)).toEqual(accepted);
    expect(transactionWrites).toEqual(writes);
    expect((await readDocument('owner-1', { collection: 'studyNotes', id: 'n' })).metadata?.revision).toBe(1);
  });

  it('replays current related content with proof of the earlier effect and zero new writes', async () => {
    seed(); await processCommand('owner-1', attach);
    await processCommand('owner-1', { ...update('edit-note', 'attach'), resource: { collection: 'studyNotes', id: 'n' },
      changes: [{ path: ['content'], before: { exists: true, value: 'Keep text' }, after: { exists: true, value: 'Later remote text' } }] });
    const writes = [...transactionWrites]; documentReadUnits = 0;
    expect(await processCommand('owner-1', attach)).toMatchObject({ kind: 'acknowledged',
      affected: [{ metadata: { revision: 1 } }], relatedSnapshots: [{ value: { content: 'Later remote text' }, metadata: { revision: 2 } }] });
    expect(transactionWrites).toEqual(writes);
    expect(documentReadUnits).toBe(3);
  });

  it.each(['missing', 'owner', 'generation', 'revision', 'corrupt'])('keeps related %s evidence retryable without replaying writes or exposing data', async reason => {
    seed(); await processCommand('owner-1', attach);
    const stored = documents.get('studyNotes/n')!;
    if (reason === 'missing') documents.delete('studyNotes/n');
    else if (reason === 'owner') documents.set('studyNotes/n', { ...stored, userId: 'other' });
    else documents.set('studyNotes/n', { ...stored, _dataEngine: { ...(stored._dataEngine as Raw),
      ...(reason === 'generation' ? { generation: 'replacement' } : reason === 'revision' ? { revision: 0 } : { protocol: 2 }) } });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', attach)).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
  });
  it('replays a later related deletion without resurrecting it', async () => {
    seed(); await processCommand('owner-1', attach);
    const note = await readDocument('owner-1', { collection: 'studyNotes', id: 'n' });
    await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'delete-related', resource: note.resource,
      generation: note.metadata!.generation, dependsOn: [], kind: 'delete', baseline: note.value! });
    expect(await processCommand('owner-1', attach)).toMatchObject({ kind: 'acknowledged',
      affected: [{ metadata: { deleted: false } }], relatedSnapshots: [{ value: null, metadata: { deleted: true } }] });
  });
  it('keeps compact ACK proof available when later related content exceeds the response budget', async () => {
    seed(); await processCommand('owner-1', attach);
    // Synthetic oversized storage probes the response bound without a cloud write.
    const stored = documents.get('studyNotes/n')!;
    documents.set('studyNotes/n', { ...stored, content: 'x'.repeat(8 * 1024 * 1024) });
    const result = await processCommand('owner-1', attach);
    expect(result).toMatchObject({ kind: 'acknowledged', affected: [{ resource: { collection: 'studyNotes', id: 'n' } }] });
    expect(result).not.toHaveProperty('relatedSnapshots');
  });
});

describe('transactional relation execution', () => {
  const relation = (operationId = 'attach'): DataCommand => ({ protocol: 1, owner: 'owner-1', operationId,
    resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
    beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] });
  const seed = () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
  };

  it('commits both directions with one receipt and replays concurrent duplicates without another revision', async () => {
    seed();
    const [first, replay] = await Promise.all([processCommand('owner-1', relation()), processCommand('owner-1', relation())]);
    expect(first).toMatchObject({ kind: 'acknowledged', affected: [{ resource: { collection: 'studyNotes', id: 'n' }, metadata: { revision: 1, operationId: 'attach' } }] });
    expect(replay).toEqual(first);
    expect(documents.get('studyMaterials/m')).toMatchObject({ noteIds: ['n'], _dataEngine: { revision: 1, operationId: 'attach' } });
    expect(documents.get('studyNotes/n')).toMatchObject({ content: 'Keep text', materialIds: ['m'], _dataEngine: { revision: 1 } });
    expect(receipts()).toHaveLength(1);
    expect(transactionReads).toContain('studyNotes/n');
    expect(await readDocument('owner-1', { collection: 'studyNotes', id: 'n' })).toMatchObject({ metadata: { operationId: 'attach' } });
  });

  it('rolls back all relation participants and receipt together after commit failure', async () => {
    seed();
    failCommit = true;
    await expect(processCommand('owner-1', relation())).rejects.toThrow('Commit failed');
    expect(documents.get('studyMaterials/m')?.noteIds).toEqual([]);
    expect(documents.get('studyNotes/n')?.materialIds).toEqual([]);
    expect(receipts()).toHaveLength(0);
  });

  it('refuses a foreign related document without leaking its value or applying the primary patch', async () => {
    seed();
    documents.set('studyNotes/n', { userId: 'victim', content: 'Private text', materialIds: [] });
    const result = await processCommand('owner-1', relation());
    expect(result).toEqual({ kind: 'refused', operationId: 'attach', code: 'permission-denied' });
    expect(documents.get('studyMaterials/m')?.noteIds).toEqual([]);
    expect(JSON.stringify(receipts())).not.toContain('Private text');
  });

  it.each([true, false])('serializes series attachment against target deletion (delete first: %s)', async deleteFirst => {
    documents.set('sermons/s', { userId: 'owner-1', title: 'Delete target' });
    documents.set('series/a', { userId: 'owner-1', items: [], sermonIds: [] });
    const attach: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'attach-series',
      resource: { collection: 'series', id: 'a' }, generation: null, dependsOn: [], kind: 'relation', relation: 'series-membership',
      edits: [{ resource: { id: 'a', collection: 'series' }, generation: null, beforeItems: [], afterItems: [{ id: 'item', type: 'sermon', refId: 's', position: 1 }] }] };
    const remove: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'delete-sermon', resource: { collection: 'sermons', id: 's' },
      generation: null, dependsOn: [], kind: 'delete', baseline: { userId: 'owner-1', title: 'Delete target' } };
    const ordered = deleteFirst ? [remove, attach] : [attach, remove];
    const result = await Promise.all(ordered.map(command => processCommand('owner-1', command)));
    expect(result[0].kind).toBe('acknowledged');
    expect(result[1].kind).toBe(deleteFirst ? 'refused' : 'acknowledged');
    expect(documents.get('sermons/s')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    expect(documents.get('series/a')?.items).toEqual([]);
    expect(transactionReads).toContain('sermons/s');
    expect(receipts()).toHaveLength(2);
  });

  it('deletes a note and legacy section-only references atomically, preserving unrelated material', async () => {
    seed();
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [], sections: [{ id: 'section', title: 'Keep title', noteIds: ['n'] }] });
    documents.set('studyMaterials/other', { userId: 'owner-1', title: 'Unrelated' });
    const command: DataCommand = { ...relation('delete-note'), resource: { collection: 'studyNotes', id: 'n' }, kind: 'delete', baseline: { userId: 'owner-1', content: 'Keep text', materialIds: [] } };
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('studyMaterials/m')).toMatchObject({ sections: [{ id: 'section', title: 'Keep title', noteIds: [] }], _dataEngine: { operationId: 'delete-note' } });
    expect(documents.get('studyMaterials/other')).toEqual({ userId: 'owner-1', title: 'Unrelated' });
  });

  it('retires a note and all owned public links atomically with a separate ownerId-scoped feed', async () => {
    seed();
    documents.set('studyNoteShareLinks/link', { ownerId: 'owner-1', noteId: 'n', token: 'secret-token', viewCount: 5 });
    documents.set('studyNoteShareLinks/foreign', { ownerId: 'victim', noteId: 'n', token: 'foreign-token' });
    const command: DataCommand = { ...relation('retire'), resource: { collection: 'studyNotes', id: 'n' }, kind: 'delete', baseline: { userId: 'owner-1', content: 'Keep text', materialIds: [] } };
    failCommit = true;
    await expect(processCommand('owner-1', command)).rejects.toThrow('Commit failed');
    expect(documents.get('studyNoteShareLinks/link')?.token).toBe('secret-token');
    failCommit = false;
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('studyNoteShareLinks/link')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true, operationId: 'retire' }) });
    expect(documents.get('studyNoteShareLinks/foreign')?.token).toBe('foreign-token');
    expect(await readCollectionChanges('owner-1', 'studyNoteShareLinks', 0)).toMatchObject({ version: 1, snapshots: [{ value: null, metadata: { deleted: true } }] });
    expect((await listDocuments('owner-1', 'studyNoteShareLinks')).snapshots).toHaveLength(1);
  });

  it('retires a shared note on a deployment whose switches add nothing to the engine-owned collections', async () => {
    seed();
    documents.set('studyNoteShareLinks/link', { ownerId: 'owner-1', noteId: 'n', token: 'secret-token', viewCount: 5 });
    const switches = ['DATA_ENGINE_ENABLED', 'DATA_ENGINE_COLLECTIONS', 'DATA_ENGINE_CLOSED_COLLECTIONS'] as const;
    const saved = switches.map(name => process.env[name]);
    switches.forEach(name => { delete process.env[name]; });
    jest.mocked(isCollectionServed).mockImplementation(jest.requireActual('@/data-engine/activation').isCollectionServed);
    try {
      const command: DataCommand = { ...relation('retire-shared'), resource: { collection: 'studyNotes', id: 'n' }, kind: 'delete', baseline: { userId: 'owner-1', content: 'Keep text', materialIds: [] } };
      expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('studyNoteShareLinks/link')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    } finally {
      switches.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
    }
  });

  it('refuses a multi-document payload beyond its byte budget before any effect is written', async () => {
    seed();
    const command = relation('large') as Extract<DataCommand, { relation: 'material-notes' }>;
    command.afterNoteIds = Array.from({ length: 9 }, (_, index) => `large-${index}`);
    command.targets = command.afterNoteIds.map(id => ({ id, generation: null }));
    for (const id of command.afterNoteIds) documents.set(`studyNotes/${id}`, { userId: 'owner-1', content: 'x'.repeat(950_000), materialIds: [] });
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'refused', code: 'relation-effects-too-large' });
    expect(documents.get('studyMaterials/m')?.noteIds).toEqual([]);
    expect(documents.get('studyNotes/large-0')?.materialIds).toEqual([]);
  });
});

describe('transactional DataEngine server', () => {
  it('commits one effect and returns the same durable receipt to concurrent duplicate senders', async () => {
    const [first, second] = await Promise.all([processCommand('owner-1', create()), processCommand('owner-1', create())]);
    expect(first.kind).toBe('acknowledged');
    expect(second).toEqual(first);
    expect(receipts()).toHaveLength(1);
    expect(documents.get('sermons/sermon-1')?._dataEngine).toMatchObject({ revision: 1, generation: 'create-1' });
  });

  it('replays original committed evidence with the current snapshot after later edits and a lost acknowledgement', async () => {
    const original = await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    if (original.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    const writes = [...transactionWrites];
    const before = [...documents];
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', operationId: original.operationId,
      committed: original.snapshot.metadata, snapshot: { value: { title: 'Second' }, metadata: { revision: 2, operationId: 'update-1' } } });
    expect(transactionWrites).toEqual(writes);
    expect([...documents]).toEqual(before);
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('stores snapshots as JSON so receipt nesting cannot exceed the document depth', async () => {
    let legacy: Raw = { text: 'Leaf' };
    for (let depth = 0; depth < 19; depth++) legacy = { nested: legacy };
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', legacy });
    const result = await processCommand('owner-1', update('deep', null));
    expect(result.kind).toBe('acknowledged');
    const stored = documents.get(receiptPath('owner-1', 'deep'))!;
    expect(stored.result).toBeUndefined();
    expect(JSON.parse(stored.resultJson as string)).toMatchObject({ receiptVersion: 2, kind: 'acknowledged', resource });
    expect(stored.resultJson).not.toContain('Leaf');
    expect(await processCommand('owner-1', update('deep', null))).toEqual(result);
  });

  it('can still replay receipts written using the previous embedded result format', async () => {
    const result = await processCommand('owner-1', create());
    const path = receiptPath('owner-1', 'create-1');
    const stored = documents.get(path)!;
    documents.set(path, { owner: stored.owner, operationId: stored.operationId, commandHash: stored.commandHash, result });
    expect(await processCommand('owner-1', create())).toEqual(result);
  });

  it('retains exact legacy JSON acknowledgements even when the current document is newer', async () => {
    const result = await processCommand('owner-1', create());
    const path = receiptPath('owner-1', 'create-1');
    documents.set(path, { ...documents.get(path), resultJson: JSON.stringify(result) });
    await processCommand('owner-1', update());
    expect(await processCommand('owner-1', create())).toEqual(result);
  });

  it.each(['missing', 'legacy', 'generation', 'revision', 'corrupt'])('keeps compact replay retryable when current snapshot is %s', async reason => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const stored = documents.get('sermons/sermon-1')!;
    if (reason === 'missing') documents.delete('sermons/sermon-1');
    else if (reason === 'legacy') documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First' });
    else documents.set('sermons/sermon-1', { ...stored, _dataEngine: { ...(stored._dataEngine as Raw),
      ...(reason === 'generation' ? { generation: 'replacement' } : reason === 'revision' ? { revision: 1 } : { protocol: 2 }) } });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', update())).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
    expect(receipts()).toHaveLength(2);
  });

  it('does not replay an acknowledged delete as a live document even after an out-of-protocol resurrection', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    const remove: DataCommand = { ...create('delete'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! };
    await processCommand('owner-1', remove);
    expect(await processCommand('owner-1', remove)).toMatchObject({ committed: { deleted: true }, snapshot: { value: null } });
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'Unexpected live value',
      _dataEngine: { ...created.snapshot.metadata, revision: 3, deleted: false } });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', remove)).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
  });

  it.each([{ receiptVersion: 3 }, { resource: { collection: 'sermons', id: '/' } }, { committed: undefined },
    { affected: 'invalid' }, { affected: [{}] }, { affected: Array.from({ length: 100 }, () => ({})) }])
  ('refuses damaged compact receipt evidence without executing the command again: %j', async invalid => {
    await processCommand('owner-1', create());
    const path = receiptPath('owner-1', 'create-1');
    const stored = documents.get(path)!;
    documents.set(path, { ...stored, resultJson: JSON.stringify({ ...JSON.parse(stored.resultJson as string), ...invalid }) });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', create())).rejects.toMatchObject({ code: 'invalid-stored-receipt' });
    expect(transactionWrites).toEqual(writes);
  });

  it.each([false, true])('rebases later local typing onto a compact replay after another device changes the same field: %s', async sameField => {
    await processCommand('owner-1', create());
    const session = new DataSession(await readDocument('owner-1', resource));
    session.edit({ ...session.getState().draft, title: 'Second' });
    const command = session.prepare('lost-ack', 'owner-1')!;
    await processCommand('owner-1', command); // Its HTTP answer is lost.
    session.edit({ ...session.getState().draft, title: 'Newer local typing' });
    const field = sameField ? 'title' : 'verse';
    const before = sameField ? 'Second' : 'John 1:1';
    await processCommand('owner-1', { ...update('another-device'), changes: [{ path: [field],
      before: { exists: true, value: before }, after: { exists: true, value: sameField ? 'Remote title' : 'John 2:1' } }] });
    const replay = await processCommand('owner-1', command);
    session.accept(replay);
    const state = session.getState();
    expect(state).toMatchObject({ draft: { title: 'Newer local typing', verse: sameField ? 'John 1:1' : 'John 2:1' }, dirty: true, pending: {} });
    expect(state.conflicts).toHaveLength(sameField ? 1 : 0);
    expect(replay).toMatchObject({ committed: { revision: 2, operationId: 'lost-ack' }, snapshot: { metadata: { revision: 3 } } });
  });

  it.each([false, true])('replays a deleted current snapshot while preserving subsequent local typing: %s', async newerDraft => {
    await processCommand('owner-1', create());
    const session = new DataSession(await readDocument('owner-1', resource));
    session.edit({ ...session.getState().draft, title: 'Second' });
    const command = session.prepare('lost-ack', 'owner-1')!;
    const accepted = await processCommand('owner-1', command);
    if (accepted.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    if (newerDraft) session.edit({ ...session.getState().draft, title: 'Preserve local draft' });
    await processCommand('owner-1', { ...create('later-delete'), kind: 'delete', generation: 'create-1', baseline: accepted.snapshot.value! });
    const writes = [...transactionWrites];
    const replay = await processCommand('owner-1', command);
    expect(transactionWrites).toEqual(writes);
    expect(replay).toMatchObject({ kind: 'acknowledged', committed: { revision: 2, deleted: false }, snapshot: { value: null, metadata: { revision: 3, deleted: true } } });
    session.accept(replay);
    expect(session.getState().pending).toEqual({});
    expect(session.getState().confirmed.value).toBeNull();
    if (newerDraft) {
      expect(session.getState().draft?.title).toBe('Preserve local draft');
      expect(session.getState().conflicts.length).toBeGreaterThan(0);
    } else expect(session.getState()).toMatchObject({ draft: null, dirty: false, conflicts: [] });
  });

  it('retains exact conflict results after later writes instead of recalculating a terminal outcome', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const conflictCommand = { ...update('conflicted'), changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Mine' } }] };
    const conflict = await processCommand('owner-1', conflictCommand);
    await processCommand('owner-1', { ...update('later'), changes: [{ path: ['title'], before: { exists: true, value: 'Second' }, after: { exists: true, value: 'Later' } }] });
    expect(conflict.kind).toBe('conflict');
    expect(await processCommand('owner-1', conflictCommand)).toEqual(conflict);
    expect(JSON.parse(documents.get(receiptPath('owner-1', 'conflicted'))!.resultJson as string)).toEqual(conflict);
  });

  it('does not apply a command when its persisted receipt is corrupt', async () => {
    documents.set(receiptPath('owner-1', 'create-1'), { owner: 'owner-1', operationId: 'create-1', resultJson: '{invalid' });
    await expect(processCommand('owner-1', create())).rejects.toMatchObject({ code: 'invalid-stored-receipt' });
    expect(documents.has('sermons/sermon-1')).toBe(false);
  });

  it('rejects malformed envelopes whose operation identity cannot safely be echoed', async () => {
    await expect(processCommand('owner-1', { ...create(), operationId: '/' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('refuses changed payloads and does not replace the original receipt', async () => {
    const original = await processCommand('owner-1', create());
    const modified = { ...create(), value: { userId: 'owner-1', title: 'Changed' } };
    expect(await processCommand('owner-1', modified)).toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    expect(await processCommand('owner-1', create())).toEqual(original);
  });

  it('rolls back both receipt and document when transaction commit fails', async () => {
    failCommit = true;
    await expect(processCommand('owner-1', create())).rejects.toThrow('Commit failed');
    expect(documents.size).toBe(0);
    failCommit = false;
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged' });
  });

  it('scopes identity to the authenticated owner and refuses foreign documents without leaking data', async () => {
    await expect(processCommand('attacker', create())).rejects.toMatchObject({ code: 'permission-denied' });
    documents.set('sermons/sermon-1', { userId: 'victim', title: 'Private text' });
    const result = await processCommand('owner-1', update('update-1', null));
    expect(result).toEqual({ kind: 'refused', code: 'permission-denied', operationId: 'update-1' });
    expect(JSON.stringify(result)).not.toContain('Private text');
    expect(receipts()).toHaveLength(0);
  });

  it('keeps acknowledged delivery retryable without exposing a new owner after ownership is revoked', async () => {
    await processCommand('owner-1', create());
    documents.set('sermons/sermon-1', { userId: 'new-owner', title: 'Private' });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', create())).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
  });

  it('refuses caller-selected collection and document paths before reading Firestore', async () => {
    await expect(readDocument('owner-1', { collection: 'ai_prompt_telemetry', id: 'one' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(readDocument('owner-1', { collection: 'sermons', id: '../private' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(adminDb.collection).not.toHaveBeenCalled();
  });

  it('rejects ownership forgery and protected field updates', async () => {
    const forged = { ...create(), value: { userId: 'victim', title: 'First' } };
    expect(await processCommand('owner-1', forged)).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    expect(await processCommand('owner-1', { ...update(), changes: [{ path: ['userId'], before: { exists: true, value: 'owner-1' }, after: { exists: true, value: 'attacker' } }] })).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    expect(documents.has('sermons/sermon-1')).toBe(false);
  });

  it('records a blocked identity and resumes only after its same-owner dependency acknowledges', async () => {
    const dependent = { ...update(), dependsOn: ['create-1'] };
    expect(await processCommand('owner-1', dependent)).toMatchObject({ kind: 'blocked', dependencies: ['create-1'] });
    expect(await processCommand('owner-1', { ...dependent, dependsOn: [] })).toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    await processCommand('owner-1', create());
    expect(await processCommand('owner-1', dependent)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('never treats another owner receipt or a failed dependency as an acknowledgement', async () => {
    documents.set(receiptPath('owner-1', 'dependency'), { owner: 'attacker', operationId: 'dependency', result: { kind: 'acknowledged' } });
    expect(await processCommand('owner-1', { ...create(), dependsOn: ['dependency'] })).toMatchObject({ kind: 'blocked' });
    documents.set(receiptPath('owner-1', 'dependency'), { owner: 'owner-1', operationId: 'dependency', result: { kind: 'refused' } });
    expect(await processCommand('owner-1', { ...create(), dependsOn: ['dependency'] })).toMatchObject({ kind: 'blocked' });
  });

  it('retains only owner metadata after deletion and refuses stale resurrection', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Expected initial acknowledgement');
    const deleted = await processCommand('owner-1', { ...create('delete-1'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! });
    expect(deleted).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });
    expect(documents.get('sermons/sermon-1')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    expect(await readDocument('owner-1', resource)).toMatchObject({ value: null, metadata: { deleted: true } });
    await expect(readDocument('attacker', resource)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await processCommand('owner-1', update())).kind).not.toBe('acknowledged');
    expect((await processCommand('owner-1', create('recreate'))).kind).not.toBe('acknowledged');
    expect(documents.get('sermons/sermon-1')?.title).toBeUndefined();
  });

  it('preserves independent writes and returns stable conflicts for the same field', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const other = { ...update('other'), changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Other' } }] };
    const result = await processCommand('owner-1', other);
    expect(result.kind).toBe('conflict');
    expect(await processCommand('owner-1', other)).toEqual(result);
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('normalizes timestamps on reads but preserves unchanged Firestore field types on legacy updates', async () => {
    const createdAt = { toDate: () => new Date('2026-01-01T00:00:00.000Z') };
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', createdAt, nested: { values: [1, true, null] } });
    expect(await readDocument('owner-1', resource)).toMatchObject({ metadata: null, value: { createdAt: '2026-01-01T00:00:00.000Z' } });
    expect(await processCommand('owner-1', update('legacy', null))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.createdAt).toBe(createdAt);
  });

  it('fails closed on corrupt metadata instead of treating it as a legacy document', async () => {
    documents.set('sermons/sermon-1', { userId: 'owner-1', _dataEngine: { protocol: 2 } });
    await expect(readDocument('owner-1', resource)).rejects.toMatchObject({ code: 'unsupported-protocol' });
    await expect(processCommand('owner-1', update('legacy', null))).rejects.toMatchObject({ code: 'unsupported-protocol' });
    expect(receipts()).toHaveLength(0);
  });

  it('stores a compact ACK whose size is independent of unchanged large document content', async () => {
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', description: 'short' });
    expect(await processCommand('owner-1', update('small', null))).toMatchObject({ kind: 'acknowledged' });
    const small = JSON.stringify(documents.get(receiptPath('owner-1', 'small')));
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', description: 'x'.repeat(1_000_000) });
    expect(await processCommand('owner-1', update('large', null))).toMatchObject({ kind: 'acknowledged' });
    const large = JSON.stringify(documents.get(receiptPath('owner-1', 'large')));
    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThan(1_000);
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('still refuses an oversized exact conflict receipt without modifying the document', async () => {
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'Other', description: 'x'.repeat(1_000_000) });
    expect(await processCommand('owner-1', update('large-conflict', null))).toMatchObject({ kind: 'refused', code: 'receipt-too-large' });
    expect(documents.get('sermons/sermon-1')?.title).toBe('Other');
  });

  it('lists only owned documents, includes tombstones, and paginates by document identity', async () => {
    documents.set('sermons/a', { userId: 'owner-1', title: 'A' });
    documents.set('sermons/b', { userId: 'owner-1', _dataEngine: { protocol: 1, generation: 'b', revision: 2, deleted: true } });
    documents.set('sermons/c', { userId: 'attacker', title: 'Private' });
    const first = await listDocuments('owner-1', 'sermons', { limit: 1 });
    expect(first.snapshots.map(item => item.resource.id)).toEqual(['a']);
    expect(first.nextCursor).toBe('a');
    expect(await listDocuments('owner-1', 'sermons', { limit: 1, cursor: 'a' })).toEqual({ snapshots: [expect.objectContaining({ resource: { collection: 'sermons', id: 'b' }, value: null })], nextCursor: null, version: 0 });
  });

  it('writes a tombstone no legacy owner query can match, and still owns, replays and lists it', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    const remove: DataCommand = { ...create('delete-1'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! };
    expect(await processCommand('owner-1', remove)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });

    // Every legacy reader — the repository, /api/owner-list, the SDK query in an old bundle —
    // asks `where(userId == uid)`. A tombstone carrying userId answers that query and is drawn
    // as a blank, editable council: data on screen that is not in the database.
    const stored = documents.get('sermons/sermon-1')!;
    expect(stored).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    const legacy = await adminDb.collection('sermons').where('userId', '==', 'owner-1').get();
    expect(legacy.docs).toEqual([]);

    // The engine itself keeps full sight of it: ownership, replay and the listing.
    expect(await readDocument('owner-1', resource)).toMatchObject({ value: null, metadata: { deleted: true } });
    await expect(readDocument('attacker', resource)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await processCommand('owner-1', remove)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    expect(await processCommand('attacker', { ...update('steal', 'create-1'), owner: 'attacker' })).toMatchObject({ kind: 'refused', code: 'permission-denied' });
    expect((await listDocuments('owner-1', 'sermons')).snapshots).toEqual([expect.objectContaining({ resource, value: null })]);
    expect((await listDocuments('attacker', 'sermons')).snapshots).toEqual([]);
  });

  it('pages live documents and both generations of tombstones as one list in document order', async () => {
    documents.set('sermons/a', { userId: 'owner-1', title: 'A' });
    documents.set('sermons/b', { _dataEngineOwner: 'owner-1', _dataEngine: { protocol: 1, generation: 'b', revision: 2, deleted: true } });
    documents.set('sermons/c', { userId: 'owner-1', title: 'C' });
    // Written before 2026-09-18, when a tombstone still carried the legacy owner field.
    documents.set('sermons/d', { userId: 'owner-1', _dataEngine: { protocol: 1, generation: 'd', revision: 2, deleted: true } });
    documents.set('sermons/e', { _dataEngineOwner: 'attacker', _dataEngine: { protocol: 1, generation: 'e', revision: 2, deleted: true } });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listDocuments('owner-1', 'sermons', { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.snapshots.map(item => item.resource.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });

  describe('legacy writers beside the engine', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });
    it('tells a reader whether legacy writers may still change the collection unseen', async () => {
      // `users` is still switched by the environment (the owned collections are always closed).
      documents.set('users/owner-1', { displayName: 'Mine' });
      // Served by the engine, legacy still open: a legacy write raises no feed event, so the
      // reader must be told the feed alone is not the whole truth.
      process.env.DATA_ENGINE_COLLECTIONS = 'users';
      expect(await listDocuments('owner-1', 'users')).toMatchObject({ legacyOpen: true });
      expect(await readCollectionChanges('owner-1', 'users', 0)).toMatchObject({ legacyOpen: true });
      // Closed — the LAST switch of a rollout: from here on the feed is the whole truth.
      process.env.DATA_ENGINE_CLOSED_COLLECTIONS = 'users';
      expect(await listDocuments('owner-1', 'users')).not.toHaveProperty('legacyOpen');
      expect(await readCollectionChanges('owner-1', 'users', 0)).not.toHaveProperty('legacyOpen');
    });
  });

  it('uses document identity for private user profiles instead of caller-selected ownership fields', async () => {
    documents.set('users/owner-1', { displayName: 'Mine', premium: true });
    documents.set('users/victim', { displayName: 'Private' });
    const page = await listDocuments('owner-1', 'users');
    expect(page.snapshots).toEqual([expect.objectContaining({ resource: { collection: 'users', id: 'owner-1' }, value: { displayName: 'Mine', premium: true } })]);
    expect(await listDocuments('owner-1', 'users', { cursor: 'owner-1' })).toEqual({ snapshots: [], nextCursor: null, version: 0 });
    expect(await listDocuments('missing-owner', 'users')).toEqual({ snapshots: [], nextCursor: null, version: 0 });
    await expect(readDocument('owner-1', { collection: 'users', id: 'victim' })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('requires a real owner and bounded command bytes before starting a transaction', async () => {
    await expect(processCommand('', create())).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await processCommand('owner-1', { ...create(), value: { userId: 'owner-1', title: 'x'.repeat(MAX_COMMAND_BYTES) } })).toMatchObject({ kind: 'refused', code: 'resource-exhausted' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('injects the verified owner into creates when callers omit the redundant userId', async () => {
    expect(await processCommand('owner-1', { ...create(), value: { title: 'Missing owner', verse: 'John 1:1', date: '2026-01-01', thoughts: [] } })).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.userId).toBe('owner-1');
  });

  it.each([0, 101, 1.5, NaN])('rejects an unbounded list limit %s', async limit => {
    await expect(listDocuments('owner-1', 'sermons', { limit })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('limits a page byte size without skipping the first excluded document', async () => {
    for (let index = 0; index < 6; index++) documents.set(`sermons/${index}`, { userId: 'owner-1', title: 'x'.repeat(900_000) });
    const first = await listDocuments('owner-1', 'sermons');
    expect(first.snapshots).toHaveLength(4);
    const second = await listDocuments('owner-1', 'sermons', { cursor: first.nextCursor! });
    expect(second.snapshots.map((item: ResourceSnapshot) => item.resource.id)).toEqual(['4', '5']);
  });
});

describe('transactional collection feed', () => {
  const headPath = (collection = 'sermons') => `${HEADS_COLLECTION}/${collectionHeadId('owner-1', collection)}`;
  const changePath = (version: number) => `${headPath()}/changes/${sequenceId(version)}`;

  it('increments head and pointer with each committed effect while duplicate receipts preserve the counter', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', create());
    expect(documents.get(headPath())).toMatchObject({ version: 1, _dataEngine: { revision: 2, operationId: 'create-1' } });
    expect(documents.get(changePath(1))).toEqual({ resource, version: 1 });
    await processCommand('owner-1', update());
    await processCommand('owner-1', create());
    expect(documents.get(headPath())?.version).toBe(2);
    expect(await readDocument('owner-1', { collection: HEADS_COLLECTION, id: collectionHeadId('owner-1', 'sermons') })).toMatchObject({ value: { version: 2 }, metadata: { revision: 3 } });
    await expect(readDocument('attacker', { collection: HEADS_COLLECTION, id: collectionHeadId('owner-1', 'sermons') })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('anchors hydration at the same transactional version and pages current changed snapshots by sequence', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const page = await listDocuments('owner-1', 'sermons');
    expect(page).toMatchObject({ version: 2, nextCursor: null, snapshots: [{ value: { title: 'Second' } }] });
    const first = await readCollectionChanges('owner-1', 'sermons', 0, { limit: 1 });
    expect(first).toMatchObject({ version: 2, cursor: 1, hasMore: true, snapshots: [{ value: { title: 'Second' } }] });
    expect(await readCollectionChanges('owner-1', 'sermons', first.cursor)).toMatchObject({ version: 2, cursor: 2, hasMore: false });
    expect(await readCollectionChanges('owner-1', 'sermons', 2)).toEqual({ version: 2, cursor: 2, hasMore: false, snapshots: [] });
  });

  it('advances every affected collection head in a relation and rolls back them all after commit failure', async () => {
    documents.set('studyNotes/n', { userId: 'owner-1', materialIds: [] });
    const command: DataCommand = { ...create('material'), resource: { collection: 'studyMaterials', id: 'm' }, kind: 'create', value: { title: 'Material', type: 'study', noteIds: ['n'], createdAt: 'now', updatedAt: 'now' } };
    failCommit = true;
    await expect(processCommand('owner-1', command)).rejects.toThrow('Commit failed');
    expect(documents.has(headPath('studyNotes'))).toBe(false);
    expect(documents.has(headPath('studyMaterials'))).toBe(false);
    failCommit = false;
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get(headPath('studyNotes'))?.version).toBe(1);
    expect(documents.get(headPath('studyMaterials'))?.version).toBe(1);
  });

  it('includes the tombstone event and never requires copying deleted private content into history', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Missing create');
    await processCommand('owner-1', { ...create('delete'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! });
    expect(await readCollectionChanges('owner-1', 'sermons', 1)).toMatchObject({ cursor: 2, snapshots: [{ value: null, metadata: { deleted: true } }] });
    expect(JSON.stringify(documents.get(changePath(2)))).not.toContain('First');
  });

  it('fails the whole command on a corrupt head and requests reset on missing pointer history', async () => {
    await processCommand('owner-1', create());
    const stored = documents.get(headPath())!;
    documents.set(headPath(), { ...stored, version: -1 });
    await expect(processCommand('owner-1', update())).rejects.toMatchObject({ code: 'invalid-change-feed' });
    expect(documents.get('sermons/sermon-1')?.title).toBe('First');
    expect(receipts()).toHaveLength(1);
    documents.set(headPath(), stored);
    await processCommand('owner-1', update());
    documents.delete(changePath(2));
    expect(await readCollectionChanges('owner-1', 'sermons', 0)).toMatchObject({ version: 2, cursor: 1, resetRequired: true });
    documents.delete(changePath(1));
    expect(await readCollectionChanges('owner-1', 'sermons', 0)).toMatchObject({ cursor: 0, resetRequired: true });
  });

  it('refuses foreign current values even if a corrupted pointer names them', async () => {
    await processCommand('owner-1', create());
    documents.set(changePath(1), { resource: { collection: 'sermons', id: 'victim' }, version: 1 });
    documents.set('sermons/victim', { userId: 'victim', title: 'Private' });
    await expect(readCollectionChanges('owner-1', 'sermons', 0)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it.each([[-1, 100], [1.5, 100], [Number.MAX_SAFE_INTEGER + 1, 100], [0, 0], [0, 101]])('rejects unbounded cursor/limit values %s/%s', async (after, limit) => {
    await expect(readCollectionChanges('owner-1', 'sermons', after, { limit })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects recursive head feeds and isolates an empty owner feed', async () => {
    await expect(readCollectionChanges('owner-1', HEADS_COLLECTION, 0)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(await readCollectionChanges('another-owner', 'sermons', 0)).toEqual({ version: 0, cursor: 0, snapshots: [], hasMore: false });
  });
});

describe('command request bounds', () => {
  const request = (body: string, announced?: string): Request => ({
    headers: new Headers(announced ? { 'content-length': announced } : {}),
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }),
  } as Request);

  it('reads JSON with no Content-Length', async () => {
    expect(await readCommandBody(request('{"protocol":1}'))).toEqual({ protocol: 1 });
  });
  it('assembles tiny and empty chunks without losing split UTF-8 characters', async () => {
    const payload = { text: '🙂'.repeat(1000) };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    let position = 0;
    let empty = true;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position === encoded.length) { controller.close(); return; }
        if (empty) controller.enqueue(new Uint8Array());
        else controller.enqueue(encoded.subarray(position, ++position));
        empty = !empty;
      },
    });
    expect(await readCommandBody({ headers: new Headers(), body } as Request)).toEqual(payload);
  });
  it('rejects oversized actual bytes even with a dishonest Content-Length', async () => {
    await expect(readCommandBody(request('x'.repeat(MAX_COMMAND_BYTES + 1), '1'))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects oversized announcements, missing bodies and malformed JSON', async () => {
    await expect(readCommandBody(request('{}', String(MAX_COMMAND_BYTES + 1)))).rejects.toMatchObject({ status: 413 });
    await expect(readCommandBody({ headers: new Headers(), body: null } as Request)).rejects.toMatchObject({ status: 400 });
    await expect(readCommandBody(request('{'))).rejects.toMatchObject({ status: 400 });
  });
  it('returns typed safe errors without publishing internal exceptions', async () => {
    const { Response: ActualResponse } = jest.requireActual('undici');
    const previous = global.Response;
    global.Response = ActualResponse;
    try {
      const error = serverErrorResponse(new DataEngineServerError('permission-denied', 403));
      expect(error.status).toBe(403);
      expect(await error.json()).toEqual({ code: 'permission-denied' });
      const unavailable = serverErrorResponse(new Error('Secret backend details'));
      expect(unavailable.status).toBe(503);
      expect(await unavailable.text()).not.toContain('Secret');
      expect(serverErrorResponse(Object.assign(new Error('Invalid'), { code: 'invalid-argument' })).status).toBe(400);
    } finally { global.Response = previous; }
  });
});


describe('complete write-set activation boundary', () => {
  const deleting = (collection: string, id: string, value: Raw, operationId = 'delete-cohort'): DataCommand => ({
    protocol: 1, owner: 'owner-1', operationId, resource: { collection, id }, generation: null, dependsOn: [], kind: 'delete', baseline: value as never,
  });
  it.each([
    { primary: 'groups', id: 'g', value: { userId: 'owner-1', title: 'Group', templates: [], flow: [] }, related: 'series/s',
      linked: { userId: 'owner-1', items: [{ id: 'group-g', type: 'group', refId: 'g', position: 1 }], sermonIds: [] } },
    { primary: 'series', id: 's', value: { userId: 'owner-1', title: 'Series', items: [], sermonIds: [] }, related: 'sermons/n',
      linked: { userId: 'owner-1', title: 'Legacy sermon', thoughts: [], seriesId: 's', seriesPosition: 1 } },
  ])('refuses $primary cascade into an unserved collection without touching either document', async ({ primary, id, value, related, linked }) => {
    documents.set(`${primary}/${id}`, value); documents.set(related, linked);
    jest.mocked(isCollectionServed).mockImplementation(collection => collection === primary);
    const command = deleting(primary, id, value);
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'refused', code: 'related-collection-not-enabled' });
    expect(documents.get(`${primary}/${id}`)).toEqual(value); expect(documents.get(related)).toEqual(linked);
    expect(transactionWrites.every(path => path.startsWith('_dataEngineReceipts/'))).toBe(true);
    jest.mocked(isCollectionServed).mockReturnValue(true);
    // A refusal is immutable. Enabling another collection cannot silently replay old refused intent.
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'refused' });
    expect(await processCommand('owner-1', { ...command, operationId: 'explicit-retry' })).toMatchObject({ kind: 'acknowledged' });
    jest.mocked(isCollectionServed).mockImplementation(collection => collection === primary);
    transactionWrites.length = 0;
    // Already accepted work keeps its ACK proof despite a later rollout switch.
    expect(await processCommand('owner-1', { ...command, operationId: 'explicit-retry' })).toMatchObject({ kind: 'acknowledged' });
    expect(transactionWrites).toEqual([]);
  });
  it('allows read-only references to unserved domains while guarding all actual writes', async () => {
    documents.set('series/s', { userId: 'owner-1', items: [], sermonIds: [] });
    documents.set('groups/g', { userId: 'owner-1', title: 'Referenced group', templates: [], flow: [] });
    jest.mocked(isCollectionServed).mockImplementation(collection => collection === 'series');
    expect(await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'read-only-target',
      resource: { collection: 'series', id: 's' }, generation: null, dependsOn: [], kind: 'relation', relation: 'series-membership', edits: [
        { resource: { collection: 'series', id: 's' }, generation: null, beforeItems: [], afterItems: [{ id: 'group-g', type: 'group', refId: 'g', position: 1 }] },
      ] })).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('groups/g')).not.toHaveProperty('_dataEngine');
  });
});
