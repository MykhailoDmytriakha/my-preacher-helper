/** @jest-environment node */
import { createHash } from 'node:crypto';

import { adminDb } from '@/config/firebaseAdminConfig';
import { isCollectionServed } from '@/data-engine/activation';
import { DataEngineServerError, listBibleMarkHistory, listCommentKindHistory, listExegeticalPointHistory, listCouncilMetadataHistory, listDocumentTagHistory, listDocuments, listGroupMeetingFieldHistory, listGroupStatusHistory, listGroupTitleHistory, listMeetingDateHistory, listPlanTemplateNameHistory, listPreachDateFieldHistory, listPreachDateHistory, listPreachStatusHistory, listPrayerStatusHistory, listPrayerTitleHistory, listSermonChurchHistory, listSermonGoalTypeHistory, listSermonPreparationConfirmationHistory, listSermonTitleHistory, listSermonVerseHistory, listSeriesMembershipHistory, listSeriesMetadataHistory, listServiceOrderFlagHistory, listServiceOrderStepTitleHistory, listServiceOrderTitleHistory, listStudyNoteTitleHistory, listTagColorHistory, listThoughtLockHistory, listThoughtPlacementHistory, listThoughtTagHistory, MAX_COMMAND_BYTES, processCommand, readCollectionChanges, readCommandBody, readDocument, recordSharedNoteView, serverErrorResponse } from '@/data-engine/server';
import { collectionHeadId, HEADS_COLLECTION, sequenceId } from '@/data-engine/serverFeed';
import { DataSession } from '@/data-engine/session';
import type { DataCommand, FieldValue, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: jest.fn(() => true) }));

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn(), runTransaction: jest.fn() },
  FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) },
}));

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
const snapshot = (path: string) => ({ readTime: { toMillis: () => 1_800_000_000_123 }, exists: documents.has(path), data: () => documents.get(path), id: path.split('/').at(-1)! });
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
    get: async () => ({ readTime: { toMillis: () => 1_800_000_000_123.456 }, docs: [...documents.entries()].filter(([key, data]) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/') && conditions.every(condition => matchesFilter(data, condition)) && key.slice(collection.length + 1) > cursor).sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum).map(([key]) => snapshot(key)) }),
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
        set: (reference: { path: string }, value: Raw, options?: { merge?: boolean }) => {
          transactionWrites.push(reference.path);
          if (!options?.merge) { writes.set(reference.path, value); return; }
          const merged = { ...(writes.get(reference.path) ?? documents.get(reference.path) ?? {}) };
          for (const [field, incoming] of Object.entries(value)) {
            const amount = incoming && typeof incoming === 'object' && '__testIncrement' in incoming
              ? Number((incoming as { __testIncrement: unknown }).__testIncrement) : null;
            merged[field] = amount === null ? incoming : Number(merged[field] ?? 0) + amount;
          }
          writes.set(reference.path, merged);
        },
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

  describe('same-owner series assignment chronology', () => {
    const sermon = member('g');
    const unrelated = member('keep');
    const seriesA = { collection: 'series', id: 'alpha' };
    const seriesB = { collection: 'series', id: 'beta' };
    const earlier = { earliestMs: 1_799_999_995_000, latestMs: 1_799_999_995_005 };
    const later = { earliestMs: 1_799_999_998_000, latestMs: 1_799_999_998_005 };
    const membership = (time: typeof earlier) => ({ time, observedRevision: 0, added: [{ type: 'sermon', refId: 'g' }], removed: [] });
    const alpha = (time: typeof earlier) => ({
      ...attach(), operationId: 'phone-save-alpha', resource: seriesA,
      edits: [{ resource: seriesA, generation: null, beforeItems: [], afterItems: [sermon], membership: membership(time) }],
    });
    const beta = (time: typeof earlier) => ({
      ...attach(), operationId: 'desktop-save-beta', resource: seriesB,
      edits: [{ resource: seriesB, generation: null, beforeItems: [unrelated],
        afterItems: [unrelated, { ...sermon, position: 2 }], membership: membership(time) }],
    });

    beforeEach(() => {
      documents.set('sermons/g', { userId: owner, title: 'Keep sermon words' });
      documents.set('sermons/keep', { userId: owner, title: 'Keep the other sermon' });
      putSeries(seriesA.id);
      putSeries(seriesB.id, [unrelated]);
    });

    it.each([
      { phone: later, desktop: earlier, expectedAlpha: true },
      { phone: earlier, desktop: later, expectedAlpha: false },
    ])('keeps the later choice through a delayed phone save and receipt replay ($expectedAlpha)', async ({ phone, desktop, expectedAlpha }) => {
      expect(await processCommand(owner, beta(desktop))).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(owner, alpha(phone));
      expect(result).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual(expectedAlpha ? [sermon] : []);
      expect(documents.get('series/beta')).toMatchObject({
        title: 'Keep series', items: expectedAlpha ? [unrelated] : [unrelated, { ...sermon, position: 2 }],
      });
      expect(documents.get('sermons/g')?.title).toBe('Keep sermon words');
      const history = [...documents.entries()].filter(([path]) => path.startsWith('sermons/g/_seriesMembershipHistory/'));
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({
        owner, generation: null,
        former: { id: expectedAlpha ? 'beta' : 'alpha', label: 'Keep series' },
        current: { id: expectedAlpha ? 'alpha' : 'beta', label: 'Keep series' },
        actionTime: earlier, winnerTime: later,
      });
      expect(await listSeriesMembershipHistory(owner, 'sermons', 'g', null)).toMatchObject({
        collection: 'sermons', memberId: 'g', generation: null, entries: [{ former: { label: 'Keep series' } }],
      });
      await expect(listSeriesMembershipHistory('other-owner', 'sermons', 'g')).rejects.toMatchObject({ status: 403 });
      const accepted = structuredClone([...documents.entries()]);
      expect(await processCommand(owner, alpha(phone))).toMatchObject({ kind: 'acknowledged' });
      expect([...documents.entries()]).toEqual(accepted);
    });

    it('keeps legacy history through the first member metadata write and rejects a stale generation', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, alpha(later))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { protocol: 1, owner, resource: { collection: 'sermons', id: 'g' }, generation: null,
        operationId: 'member-first-marker', kind: 'update', dependsOn: [],
        changes: [{ path: ['title'], before: { exists: true, value: 'Keep sermon words' }, after: { exists: true, value: 'New title' } }],
      })).toMatchObject({ kind: 'acknowledged' });
      await expect(listSeriesMembershipHistory(owner, 'sermons', 'g', null)).rejects.toMatchObject({ status: 404 });
      expect(await listSeriesMembershipHistory(owner, 'sermons', 'g', 'member-first-marker')).toMatchObject({
        generation: 'member-first-marker', entries: [{ former: { id: 'beta' }, current: { id: 'alpha' } }],
      });
    });

    it('applies a later removal to the actual current series and keeps an older assignment from restoring it', async () => {
      const initial = await processCommand(owner, alpha(earlier));
      expect(initial.kind).toBe('acknowledged');
      const sourceGeneration = 'phone-save-alpha';
      const remove = (time: typeof earlier) => ({ resource: seriesA, generation: sourceGeneration, beforeItems: [sermon], afterItems: [],
        membership: { time, observedRevision: 1, removed: membership(time).added, added: [] } });
      const move = beta(later);
      expect(await processCommand(owner, { ...move, edits: [move.edits[0], remove(later)] })).toMatchObject({ kind: 'acknowledged' });
      const latest = { earliestMs: 1_799_999_999_000, latestMs: 1_799_999_999_005 };
      expect(await processCommand(owner, { ...alpha(latest), operationId: 'later-unassign', generation: sourceGeneration,
        edits: [remove(latest)] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
      const gamma = { collection: 'series', id: 'gamma' };
      putSeries('gamma');
      expect(await processCommand(owner, { ...alpha(earlier), operationId: 'earlier-gamma', resource: gamma,
        edits: [{ ...alpha(earlier).edits[0], resource: gamma }] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/gamma')?.items).toEqual([]);
    });

    it('does not retain a prior timed destination across an untimed move away and back', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      const untimedBeta = { resource: seriesB, generation: 'desktop-save-beta', beforeItems: [unrelated, { ...sermon, position: 2 }], afterItems: [unrelated] };
      const untimedAlpha = { resource: seriesA, generation: null, beforeItems: [], afterItems: [sermon] };
      expect(await processCommand(owner, { ...alpha(later), operationId: 'legacy-to-alpha',
        edits: [untimedAlpha, untimedBeta] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...beta(later), operationId: 'legacy-to-beta', generation: 'desktop-save-beta',
        edits: [{ ...untimedBeta, beforeItems: untimedBeta.afterItems, afterItems: untimedBeta.beforeItems },
          { ...untimedAlpha, generation: 'legacy-to-alpha', beforeItems: [sermon], afterItems: [] }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...alpha(later), operationId: 'delayed-after-legacy', generation: 'legacy-to-alpha',
        edits: [{ ...alpha(later).edits[0], generation: 'legacy-to-alpha' }] })).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
      expect(documents.get('series/beta')?.items).toEqual([unrelated, { ...sermon, position: 2 }]);
    });

    it('accepts an assignment causally following its exact unclocked Clear on another series', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      const betaItems = [unrelated, { ...sermon, position: 2 }];
      const betaGeneration = 'desktop-save-beta';
      const clear = { ...beta(later), operationId: 'clear-beta', generation: betaGeneration,
        edits: [{ resource: seriesB, generation: betaGeneration, beforeItems: betaItems, afterItems: [unrelated],
          membership: { time: null, observedRevision: 1, added: [], removed: membership(later).added } }] };
      expect(await processCommand(owner, clear)).toMatchObject({ kind: 'acknowledged' });
      const next = alpha(later);
      expect(await processCommand(owner, { ...next, edits: [
        { ...next.edits[0], membership: { ...next.edits[0].membership, time: null } },
        { resource: seriesB, generation: betaGeneration, beforeItems: [unrelated], afterItems: [unrelated],
          membership: { time: null, observedRevision: 1, added: [], removed: [], predecessorOperationId: clear.operationId } },
      ] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([sermon]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
    });

    it('holds a delayed assignment after an unclocked assign and clear', async () => {
      const betaOpening = { resource: seriesB, generation: null, beforeItems: [unrelated], afterItems: [unrelated, { ...sermon, position: 2 }] };
      expect(await processCommand(owner, { ...beta(earlier), edits: [betaOpening] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...beta(later), operationId: 'legacy-clear', generation: 'desktop-save-beta',
        edits: [{ ...betaOpening, generation: 'desktop-save-beta', beforeItems: betaOpening.afterItems, afterItems: [unrelated] }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, alpha(earlier))).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
      const command = alpha(later);
      const version = documents.get(`${HEADS_COLLECTION}/${collectionHeadId(owner, 'series')}`)!.version;
      expect(await processCommand(owner, { ...command, operationId: 'fresh-alpha',
        edits: [{ ...command.edits[0], membership: { ...command.edits[0].membership, observedCatalogVersion: version } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([sermon]);
    });

    it('keeps a stale assignment from reviving membership after a whole series is deleted', async () => {
      const assigned = await processCommand(owner, beta(earlier));
      if (assigned.kind !== 'acknowledged') throw new Error('Fixture series assignment failed');
      const snapshot = assigned.snapshot;
      expect(await processCommand(owner, { protocol: 1, owner, operationId: 'delete-beta', kind: 'delete',
        resource: seriesB, generation: snapshot.metadata!.generation, dependsOn: [], baseline: snapshot.value!,
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
      expect(await processCommand(owner, alpha(earlier))).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      const command = alpha(later);
      const version = documents.get(`${HEADS_COLLECTION}/${collectionHeadId(owner, 'series')}`)!.version;
      expect(await processCommand(owner, { ...command, operationId: 'alpha-after-delete',
        edits: [{ ...command.edits[0], membership: { ...command.edits[0].membership, observedCatalogVersion: version } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([sermon]);
    });

    it('repairs a historical double assignment when the selected series already holds the sermon', async () => {
      putSeries('alpha', [sermon]);
      const alreadyInBeta = [unrelated, { ...sermon, position: 2 }];
      putSeries('beta', alreadyInBeta);
      expect(await processCommand(owner, { ...beta(later), edits: [
        { resource: seriesB, generation: null, beforeItems: alreadyInBeta, afterItems: alreadyInBeta,
          membership: { ...membership(later), added: [] } },
        { resource: seriesA, generation: null, beforeItems: [sermon], afterItems: [],
          membership: { ...membership(later), added: [], removed: membership(later).added } },
      ] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual(alreadyInBeta);
    });

    it('retains the old guard when the actions have no provable order', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      const refusal = await processCommand(owner, alpha(earlier));
      expect(refusal).toMatchObject({ kind: 'refused', code: 'membership-already-assigned',
        seriesMembershipComparisons: [{ ref: { type: 'sermon', refId: 'g' }, label: 'Keep sermon words',
          proposed: { id: 'alpha', label: 'Keep series' }, stored: { id: 'beta', label: 'Keep series' } }],
      });
      expect(await processCommand(owner, alpha(earlier))).toEqual(refusal);
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated, { ...sermon, position: 2 }]);
    });
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

  it.each([
    { scenario: 'earlier date', offset: 20, phone: '2026-12-20', winner: '2026-12-27', archived: '2026-12-20', kind: 'acknowledged' },
    { scenario: 'legacy starting date', offset: 60, phone: '2026-12-20', winner: '2026-12-20', archived: '2026-12-27', kind: 'acknowledged' },
    { scenario: 'later removal of the date', offset: 60, phone: '', winner: '', archived: '2026-12-27', kind: 'acknowledged' },
    { scenario: 'overlapping times', offset: 43, phone: '', winner: '2026-12-27', archived: null, kind: 'conflict' },
    { scenario: 'another field in the same meeting', offset: 20, phone: '', winner: '', archived: null, kind: 'acknowledged' },
  ])('applies group meeting chronology only to the existing date: $scenario', async ({ scenario, offset, phone, winner, archived, kind }) => {
    const resource = { collection: 'groups', id: 'group-chronology' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first-meeting', date: scenario === 'legacy starting date' ? '2026-12-13T00:00:00.000Z' : '2026-12-13', location: 'Main room', audience: 'Leaders', createdAt: now };
    const second = { id: 'follow-up', date: '2027-01-03', location: 'Annex', createdAt: now };
    const meetings = [first, second];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'group-seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: meetings, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const update = (operationId: string, patch: Partial<typeof first>) => ({
      ...base, kind: 'update', operationId, generation: 'group-seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: meetings }, after: { exists: true, value: [{ ...first, ...patch }, second] } }],
    });
    const date = (operationId: string, value: string, offsetMs: number) => ({
      ...update(operationId, { date: value }),
      meetingDateAction: { rowId: first.id, before: first.date, after: value, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offsetMs, latestMs: 1_800_000_000_010 + offsetMs } },
    });
    const differentField = scenario === 'another field in the same meeting';
    expect((await processCommand(base.owner, differentField ? update('computer', { location: 'Side room' }) : date('computer', '2026-12-27', 40))).kind).toBe('acknowledged');
    const answer = await processCommand(base.owner, date('phone', phone, offset));
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Group',
      meetingDates: [{ ...first, date: winner, location: differentField ? 'Side room' : first.location }, second],
    } } });
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-chronology/_meetingDateHistory/'));
    expect(history).toHaveLength(archived === null ? 0 : 1);
    if (archived !== null) {
      expect(history[0][1]).toMatchObject({ rowId: first.id, date: archived, winnerDate: winner, generation: 'group-seed' });
      expect(await listMeetingDateHistory(base.owner, resource.id, 'group-seed')).toMatchObject({
        owner: base.owner, groupId: resource.id, generation: 'group-seed',
        entries: [{ rowId: first.id, date: archived, winnerDate: winner }],
      });
      await expect(listMeetingDateHistory('another-owner', resource.id, 'group-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listMeetingDateHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    }
    if (kind === 'conflict') expect(answer).toMatchObject({ conflicts: [{ path: ['meetingDates', 'id:first-meeting', 'date'] }] });
  });

  it.each([
    { field: 'location', offset: 20, initial: 'Main room', desk: 'Side room', phone: '', winner: 'Side room', kind: 'acknowledged' },
    { field: 'location', offset: 60, initial: 'Main room', desk: 'Side room', phone: '', winner: '', kind: 'acknowledged' },
    { field: 'audience', offset: 20, initial: undefined, desk: 'Leaders', phone: 'All', winner: 'Leaders', kind: 'acknowledged' },
    { field: 'audience', offset: 60, initial: undefined, desk: 'Leaders', phone: 'All', winner: 'All', kind: 'acknowledged' },
    { field: 'location', offset: 45, initial: 'Main room', desk: 'Side room', phone: '', winner: 'Side room', kind: 'conflict' },
  ] as const)('orders the exact meeting $field at offset $offset', async ({ field, offset, initial, desk, phone, winner, kind }) => {
    const resource = { collection: 'groups', id: 'group-meeting-field' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first-meeting', date: '2026-12-13', createdAt: now,
      ...(field === 'location' ? { location: initial, audience: 'Leaders' } : { location: 'Main room' }) };
    const second = { id: 'second-meeting', date: '2027-01-03', location: 'Annex', createdAt: now };
    const value = { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first, second], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, after: string, at: number, changeSecond: boolean) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: value.meetingDates }, after: {
        exists: true, value: [{ ...first, [field]: after }, changeSecond ? { ...second, location: 'Library' } : second],
      } }],
      groupMeetingFieldActions: { [field]: { rowId: first.id, rowCreatedAt: first.createdAt, before: initial ?? null, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } } },
    });
    expect((await processCommand(base.owner, change('computer', desk, 40, true))).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, change('phone', phone, offset, false));
    expect(result).toMatchObject({ kind, snapshot: { value: {
      title: 'Group', meetingDates: [{ ...first, [field]: winner }, { ...second, location: 'Library' }],
    } } });
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['meetingDates', 'id:first-meeting', field] }] });
  });

  it('orders both meeting fields independently in the same update and archives each displaced value once', async () => {
    const resource = { collection: 'groups', id: 'group-meeting-fields' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first-meeting', date: '2026-12-13', location: 'Main room', audience: 'Leaders', createdAt: now };
    const value = { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, location: string, audience: string, locationAt: number, audienceAt: number) => {
      const stamp = (before: string, after: string, at: number) => ({ rowId: first.id, rowCreatedAt: first.createdAt, before, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at } });
      return { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['meetingDates'], before: { exists: true, value: [first] }, after: { exists: true, value: [{ ...first, location, audience }] } }],
        groupMeetingFieldActions: { location: stamp(first.location, location, locationAt), audience: stamp(first.audience, audience, audienceAt) } };
    };
    expect((await processCommand(base.owner, change('desk', 'Side room', 'Youth', 40, 45))).kind).toBe('acknowledged');
    const phone = change('phone', '', 'All', 65, 20);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { meetingDates: [{ ...first, location: '', audience: 'Youth' }] } } });
    expect(await processCommand(base.owner, phone)).toEqual(result);
    expect(await listGroupMeetingFieldHistory(base.owner, resource.id, 'seed')).toMatchObject({ entries: [{ fields: [
      { field: 'location', value: 'Side room', winnerValue: '', rowId: first.id },
      { field: 'audience', value: 'All', winnerValue: 'Youth', rowId: first.id },
    ] }] });
    await expect(listGroupMeetingFieldHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
    await expect(listGroupMeetingFieldHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
  });

  it.each(['known predecessor', 'unrelated overlapping action', 'same-value predecessor without order', 'replacement meeting'])('protects meeting text ancestry: %s', async (scenario) => {
    const resource = { collection: 'groups', id: 'group-meeting-ancestry' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'meeting', date: '', location: 'Hall', createdAt: now };
    const value = { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof first[], after: typeof first[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const action = (before: typeof first, after: string, at: number, observedRevision: number, predecessorOperationId?: string) => ({
      rowId: first.id, rowCreatedAt: before.createdAt, before: before.location, after, observedRevision,
      time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      ...(predecessorOperationId && { predecessorOperationId }),
    });
    const replace = scenario === 'replacement meeting';
    const previous = replace ? { ...first, createdAt: '2026-11-08T00:00:30.000Z' } : first;
    if (replace) {
      expect((await processCommand(base.owner, update('remove', [first], []))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, update('recreate', [], [previous]))).kind).toBe('acknowledged');
    }
    const accepted = { ...previous, location: 'Side room' };
    if (scenario === 'same-value predecessor without order') {
      expect((await processCommand(base.owner, { ...update('competing-edit', [first], [accepted]),
        groupMeetingFieldActions: { location: action(first, accepted.location, 31, 1) },
      })).kind).toBe('acknowledged');
    }
    expect((await processCommand(base.owner, { ...update('first-edit', [previous], [accepted]),
      groupMeetingFieldActions: { location: action(previous, accepted.location, 30, replace ? 3 : 1) },
    })).kind).toBe('acknowledged');
    const observed = replace ? first : { ...first, location: accepted.location };
    const next = await processCommand(base.owner, { ...update('later-edit', [observed], [{ ...observed, location: 'Library' }]),
      groupMeetingFieldActions: { location: action(observed, 'Library', replace ? 60 : 35, 1,
        ['known predecessor', 'same-value predecessor without order'].includes(scenario) ? 'first-edit' : undefined) },
    });
    if (scenario === 'known predecessor') {
      expect(next).toMatchObject({ kind: 'acknowledged', snapshot: { value: { meetingDates: [{ ...first, location: 'Library' }] } } });
      expect((await listGroupMeetingFieldHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
    } else {
      expect(next).toMatchObject({ kind: 'conflict', snapshot: { value: { meetingDates: [accepted] } } });
    }
  });

  it.each([
    { field: 'audience', offset: 20, kind: 'acknowledged' },
    { field: 'audience', offset: 60, kind: 'acknowledged' },
    { field: 'churchCity', offset: 20, kind: 'acknowledged' },
    { field: 'churchCity', offset: 60, kind: 'acknowledged' },
    { field: 'churchIdentity', offset: 20, kind: 'acknowledged' },
    { field: 'churchIdentity', offset: 60, kind: 'acknowledged' },
    { field: 'churchSelection', offset: 20, kind: 'acknowledged' },
    { field: 'churchSelection', offset: 60, kind: 'acknowledged' },
    { field: 'audience', offset: 45, kind: 'conflict' },
    { field: 'notes', offset: 60, kind: 'conflict' },
  ] as const)('orders the exact preaching detail $field at offset $offset', async ({ field, offset, kind }) => {
    const resource = { collection: 'sermons', id: 'sermon-preaching-detail' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const meeting = { id: 'event', date: '2026-12-13', status: 'planned', createdAt: now,
      church: { id: 'original-church', name: 'Original chapel', city: 'Original city' }, notes: 'Original note' };
    const other = { ...meeting, id: 'follow-up', date: '2027-01-03' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: false, preachDates: [meeting, other] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');

    const change = (operationId: string, who: 'phone' | 'desktop', at: number) => {
      const next = { ...meeting, church: { ...meeting.church } } as typeof meeting & { audience?: string };
      type DetailValue = string | null | { id: string; name: string; city?: string };
      let before: DetailValue = null;
      let after: DetailValue;
      if (field === 'audience') after = next.audience = who === 'phone' ? '' : 'Leaders';
      else if (field === 'churchCity') {
        before = meeting.church.city;
        after = next.church.city = who + ' city';
      } else if (field === 'churchIdentity') {
        before = meeting.church;
        after = next.church = { ...meeting.church, id: who + '-church', name: who + ' chapel' };
      } else if (field === 'churchSelection') {
        before = meeting.church;
        after = next.church = { id: who + '-church', name: who + ' chapel', city: who + ' city' };
      } else after = next.notes = who + ' note';
      return { next, command: { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['preachDates'], before: { exists: true, value: value.preachDates },
          after: { exists: true, value: [next, other] } }],
        ...(field === 'notes' ? {} : { preachDateFieldActions: { [field === 'churchIdentity' || field === 'churchSelection' ? 'church' : field]: {
          rowId: meeting.id, rowCreatedAt: meeting.createdAt, before, after, observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
        } } }),
      } };
    };
    const desktop = change('desktop', 'desktop', 40);
    const phone = change('phone', 'phone', offset);
    expect((await processCommand(base.owner, desktop.command)).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, phone.command);
    const winner = kind === 'acknowledged' && offset > 40 ? phone.next : desktop.next;
    expect(result).toMatchObject({ kind, snapshot: { value: { isPreached: false, preachDates: [winner, other] } } });
    if (kind === 'conflict') {
      expect(result).toMatchObject({ conflicts: [{ path: ['preachDates', 'id:event', field] }] });
    } else {
      const history = await listPreachDateFieldHistory(base.owner, resource.id, 'seed');
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].fields).toHaveLength(1);
      expect(history.entries[0].fields[0]).toMatchObject({
        rowId: meeting.id, rowCreatedAt: now, field: field === 'churchIdentity' || field === 'churchSelection' ? 'church' : field,
        ...(field === 'churchCity' && { scope: { id: meeting.church.id, name: meeting.church.name } }),
      });
      await expect(listPreachDateFieldHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listPreachDateFieldHistory(base.owner, resource.id, 'other')).rejects.toMatchObject({ status: 404 });
    }
  });

  it.each([true, false])('keeps competing church identities together with clock evidence: %s', async timed => {
    const resource = { collection: 'sermons', id: 'sermon-church-choice' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const church = { id: '', name: 'Chapel', city: 'Town' };
    const date = { id: 'date', date: '2026-12-13', createdAt: now, status: 'planned', church };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now, updatedAt: now, thoughts: [], preachDates: [date] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, after: typeof church, offset: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['preachDates'], before: { exists: true, value: [date] }, after: { exists: true, value: [{ ...date, church: after }] } }],
      ...(timed && { preachDateFieldActions: { church: { rowId: date.id, rowCreatedAt: now, before: church, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } } } }),
    });
    const selected = { ...church, id: 'history-church' };
    const typed = { ...church, name: 'Different chapel' };
    expect((await processCommand(base.owner, update('desktop', selected, 40))).kind).toBe('acknowledged');
    const conflict = await processCommand(base.owner, update('phone', typed, 45));
    expect(conflict).toMatchObject({ kind: 'conflict', snapshot: { value: { preachDates: [{ ...date, church: selected }] } },
      conflicts: expect.arrayContaining([expect.objectContaining({ path: ['preachDates', 'id:date', 'church'] })]) });
    expect((await listPreachDateFieldHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each(['changed church', 'reused row'] as const)('does not move unclocked details across a %s', async scenario => {
    const resource = { collection: 'sermons', id: 'sermon-preaching-identity' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const date = { id: 'date', date: '2026-12-13', createdAt: now, status: 'planned', audience: 'Leaders',
      church: { id: 'original', name: 'Original chapel', city: 'Town' } };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], preachDates: [date] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof date[], after: typeof date[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const church = { id: 'new', name: 'New chapel', city: date.church.city };
    const replacement = scenario === 'changed church' ? { ...date, church } : { ...date, createdAt: '2026-11-08T00:05:00.000Z' };
    if (scenario === 'reused row') {
      expect((await processCommand(base.owner, update('delete', [date], []))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, update('replace', [], [replacement]))).kind).toBe('acknowledged');
    } else expect((await processCommand(base.owner, update('church', [date], [replacement]))).kind).toBe('acknowledged');
    const stale = scenario === 'changed church' ? { ...date, church: { ...date.church, city: 'Different town' } } : { ...date, audience: 'Guests' };
    const path = scenario === 'changed church' ? ['preachDates', 'id:date', 'church'] : ['preachDates', 'id:date'];
    expect(await processCommand(base.owner, update('late', [date], [stale]))).toMatchObject({
      kind: 'conflict', conflicts: [{ path }], snapshot: { value: { preachDates: [replacement] } },
    });
    expect((await listPreachDateFieldHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([
    { start: 'planned', offset: 20, expected: 'planned', kind: 'acknowledged' },
    { start: 'planned', offset: 85, expected: 'preached', kind: 'acknowledged' },
    { start: 'preached', offset: 20, expected: 'preached', kind: 'acknowledged' },
    { start: 'preached', offset: 85, expected: 'planned', kind: 'acknowledged' },
    { start: 'preached', offset: 65, expected: 'preached', kind: 'conflict' },
    { start: 'preached', offset: null, expected: 'preached', kind: 'conflict' },
  ] as const)('keeps the intended preaching status after a round trip from $start at $offset', async ({ start, offset, expected, kind }) => {
    const resource = { collection: 'sermons', id: 'sermon-preach-status' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const row = { id: 'date', date: '2026-12-13', status: start, createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: 'First date notes' };
    const other = { ...row, id: 'second', date: '2027-01-03', status: 'planned', notes: 'Second date notes' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: start === 'preached', preachDates: [row, other] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const opposite = start === 'planned' ? 'preached' : 'planned';
    const change = (operationId: string, before: string, after: string, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [
        { path: ['preachDates'], before: { exists: true, value: [{ ...row, status: before }, other] },
          after: { exists: true, value: [{ ...row, status: after }, other] } },
        { path: ['isPreached'], before: { exists: true, value: before === 'preached' }, after: { exists: true, value: after === 'preached' } },
      ],
      preachStatusActions: [{ rowId: row.id, rowCreatedAt: now, before, after, observedRevision,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } }],
    });
    expect((await processCommand(base.owner, change('desk-first', start, opposite, 40, 1))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, change('desk-return', opposite, start, 60, 2))).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, change('phone', start, opposite, offset, 1));
    expect(result).toMatchObject({ kind, snapshot: { value: { isPreached: expected === 'preached', preachDates: [{ ...row, status: expected }, other] } } });
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['preachDates', 'id:date', 'status'] }] });
  });

  it.each(['changed', 'created', 'same-value'] as const)('orders an unclocked reversal only after its exact %s predecessor', async origin => {
    const resource = { collection: 'sermons', id: 'sermon-preach-unchronometric' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const planned = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: now, church: { id: 'c', name: 'Church' } };
    const preached = { ...planned, status: 'preached' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: false, preachDates: origin === 'created' ? [] : [planned] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof planned[], after: typeof planned[], prior?: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed', dependsOn: prior ? [prior] : [],
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      preachStatusActions: before.length ? [{ rowId: planned.id, rowCreatedAt: now, before: before[0].status, after: after[0].status,
        observedRevision: 1, time: null, ...(prior && { predecessorOperationId: prior }) }] : [],
    });
    if (origin === 'same-value') {
      expect((await processCommand(base.owner, update('other-writer', [planned], [preached]))).kind).toBe('acknowledged');
    }
    const added = origin === 'created' ? planned : preached;
    const first = update('first', origin === 'created' ? [] : [planned], [added]);
    expect((await processCommand(base.owner, first)).kind).toBe('acknowledged');
    const after = origin === 'created' ? preached : planned;
    const second = update('second', [added], [after], 'first');
    const conflicts = origin === 'same-value';
    expect(await processCommand(base.owner, second)).toMatchObject({
      kind: conflicts ? 'conflict' : 'acknowledged', snapshot: { value: { preachDates: [conflicts ? preached : after] } },
    });
  });

  it.each(['changed', 'untouched'] as const)('preserves a %s legacy sibling while marking another date', async sibling => {
    const resource = { collection: 'sermons', id: 'sermon-preach-legacy-sibling' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first', date: '2026-12-13', createdAt: now, church: { id: 'c', name: 'Church' }, status: 'planned' };
    const legacy = { id: 'second', date: '2027-01-03', createdAt: now, church: { id: 'c', name: 'Church' } };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: false, preachDates: [first, legacy] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, after: object[], rowId: string, before: string | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: [first, legacy] }, after: { exists: true, value: after } }],
      preachStatusActions: [{ rowId, rowCreatedAt: now, before, after: 'preached', observedRevision: 1, time: null }],
    });
    const accepted = { ...legacy, status: 'preached', notes: 'New notes on another device' };
    if (sibling === 'changed') {
      expect((await processCommand(base.owner, update('second', [first, accepted], legacy.id, null))).kind).toBe('acknowledged');
    }
    const marked = { ...first, status: 'preached' };
    const materialized = { ...legacy, status: 'planned' };
    expect(await processCommand(base.owner, update('first', [marked, materialized], first.id, 'planned'))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { isPreached: true, preachDates: [marked, sibling === 'changed' ? accepted : materialized] } },
    });
  });

  it('keeps the sermon marked when an unmark touches only the opening dates and a newly added date is preached', async () => {
    const resource = { collection: 'sermons', id: 'sermon-new-preached-date' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const row = { id: 'opening', date: '2026-12-13', status: 'preached', createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: 'Opening date' };
    const later = { ...row, id: 'new', date: '2027-01-03', notes: 'New date' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: true, preachDates: [row] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, rows: typeof row[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: rows } }],
    });
    expect((await processCommand(base.owner, change('add', [row, later]))).kind).toBe('acknowledged');
    const unmark = change('unmark', [{ ...row, status: 'planned' }]);
    expect(await processCommand(base.owner, { ...unmark, changes: [...unmark.changes,
      { path: ['isPreached'], before: { exists: true, value: true }, after: { exists: true, value: false } }],
    })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { isPreached: true, preachDates: [{ ...row, status: 'planned' }, later] } } });
  });

  it('keeps and archives exact statuses for each date in one delayed unmark', async () => {
    const resource = { collection: 'sermons', id: 'sermon-bulk-unmark' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const rows = ['first', 'second'].map(id => ({ id, date: '2026-12-13', status: 'preached', createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: id }));
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: true, preachDates: rows };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const planned = rows.map(row => ({ ...row, status: 'planned' }));
    const change = (operationId: string, before: typeof rows, after: typeof rows, at: number, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      preachStatusActions: after.flatMap((row, index) => {
        const old = before[index];
        return old && old.status !== row.status ? [{ rowId: row.id, rowCreatedAt: now, before: old.status, after: row.status, observedRevision,
          time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } }] : [];
      }),
    });
    expect((await processCommand(base.owner, change('desktop-unmark', rows, planned, 35, 1))).kind).toBe('acknowledged');
    const newRow = { ...rows[0], id: 'remote', date: '2027-01-03', notes: 'Remote date' };
    expect((await processCommand(base.owner, change('desktop-restored', planned, [...rows, newRow], 60, 2))).kind).toBe('acknowledged');
    const phone = change('offline-unmark', rows, planned, 15, 1);
    const accepted = await processCommand(base.owner, phone);
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { isPreached: true, preachDates: [...rows, newRow] } } });
    expect(await processCommand(base.owner, phone)).toEqual(accepted);
    const history = await listPreachStatusHistory(base.owner, resource.id, 'seed');
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].fields).toMatchObject(rows.map(row => ({ rowId: row.id, rowCreatedAt: now, field: 'status', value: 'planned', winnerValue: 'preached' })));
    await expect(listPreachStatusHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
    await expect(listPreachStatusHistory(base.owner, resource.id, 'old')).rejects.toMatchObject({ status: 404 });
  });

  it.each([20, 85])('orders an unchanged planned date within a bulk unmark at %s', async offset => {
    const resource = { collection: 'sermons', id: 'sermon-unmark-planned-scope' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first', date: '2026-12-13', status: 'preached', createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: 'First' };
    const second = { ...first, id: 'second', date: '2027-01-03', status: 'planned', notes: 'Second' };
    const initial = [first, second];
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: true, preachDates: initial };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, before: typeof initial, after: typeof initial, at: number, revision: number, bulk = false) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      preachStatusActions: after.flatMap((row, index) => bulk || before[index].status !== row.status ? [{
        rowId: row.id, rowCreatedAt: now, before: before[index].status, after: row.status, observedRevision: revision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      }] : []),
    });
    const allPlanned = [{ ...first, status: 'planned' }, second];
    expect((await processCommand(base.owner, change('clear', initial, allPlanned, 35, 1, true))).kind).toBe('acknowledged');
    const marked = [allPlanned[0], { ...second, status: 'preached' }];
    expect((await processCommand(base.owner, change('mark', allPlanned, marked, 60, 2))).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, change('late-delivery', initial, allPlanned, offset, 1, true));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
      isPreached: offset < 60, preachDates: offset < 60 ? marked : allPlanned,
    } } });
  });

  it('keeps a choice when unstamped meeting edits return to the old date', async () => {
    const resource = { collection: 'groups', id: 'group-date-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const meeting = { id: 'meeting', date: '2026-12-13', location: 'Main room', createdAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: [meeting], createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: string, after: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: [{ ...meeting, date: before }] },
        after: { exists: true, value: [{ ...meeting, date: after }] } }],
    });
    expect((await processCommand(base.owner, edit('unset', meeting.date, ''))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('return', '', meeting.date))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, { ...edit('offline', meeting.date, '2026-12-20'),
      meetingDateAction: { rowId: meeting.id, before: meeting.date, after: '2026-12-20', observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } },
    })).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['meetingDates', 'id:meeting', 'date'] }],
      snapshot: { value: { meetingDates: [meeting] } } });
    expect((await listMeetingDateHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([true, false])('recognizes an explicit outcome clear before the queued type choice (clock: %s)', async clocked => {
    const resource = { collection: 'councils', id: 'topic-clear-and-convert' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const open = { id: 'opening', title: 'Opening', kind: 'decision', questions: [], options: [] };
    const recorded = { ...open, decision: 'Recorded decision', discussed: true };
    const selected = { ...open, kind: 'info' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [recorded] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof open, after: typeof open) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
    });
    expect((await processCommand(base.owner, edit('clear', recorded, open))).kind).toBe('acknowledged');
    const command = { ...edit('choose-type', open, selected), dependsOn: ['clear'],
      councilTopicKindActions: { kind: { rowId: open.id, rowCreatedAt: open.id, before: 'decision', after: 'info', observedRevision: 1,
        predecessorOperationId: 'clear', time: clocked ? { earliestMs: 1_800_000_000_040, latestMs: 1_800_000_000_044 } : null } },
    };
    expect(await processCommand(base.owner, command)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: [selected] } } });
  });

  it.each([
    { label: 'phone first', mobileAt: 15, winner: 'decision', kind: 'acknowledged', legacy: false },
    { label: 'phone last', mobileAt: 100, winner: 'info', kind: 'acknowledged', legacy: false },
    { label: 'no clock', mobileAt: null, winner: 'decision', kind: 'conflict', legacy: false },
    { label: 'legacy default', mobileAt: 15, winner: 'decision', kind: 'acknowledged', legacy: true },
  ])('orders the exact council topic type while it has no outcome: $label', async ({ mobileAt, winner, kind, legacy }) => {
    const resource = { collection: 'councils', id: 'topic-kind-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const topic = { id: 'opening', title: 'Opening', ...(!legacy && { kind: 'decision' }), summary: 'Original words', questions: [], options: [] };
    const other = { ...topic, id: 'other', title: 'Other section' };
    const topics = [topic, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof topics, after: typeof topics, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      councilTopicKindActions: { kind: { rowId: topic.id, rowCreatedAt: topic.id, before: before[0].kind ?? 'decision',
        after: after[0].kind ?? 'decision', observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const info = [{ ...topic, kind: 'info' }, other];
    const decision = [{ ...topic, kind: 'decision', summary: 'Later explanation' }, other];
    expect((await processCommand(base.owner, edit('desktop-info', topics, info, 45, 1))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('desktop-decision', info, decision, 65, 2))).kind).toBe('acknowledged');
    const phone = edit('phone', topics, info, mobileAt, 1);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { topics: [{ ...decision[0], kind: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/topic-kind-order/_topicKindHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['topics', 'id:opening', 'kind'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: topic.id, field: 'kind',
        value: winner === 'decision' ? 'info' : 'decision', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'earlier phone', phoneAt: 15, winner: false, legacy: false, moved: false },
    { label: 'later phone', phoneAt: 90, winner: true, legacy: false, moved: false },
    { label: 'unknown order', phoneAt: null, winner: false, legacy: false, moved: false },
    { label: 'legacy comment', phoneAt: 15, winner: false, legacy: true, moved: false },
    { label: 'changed passage', phoneAt: 90, winner: false, legacy: false, moved: true },
    { label: 'older move checked for a different kind', phoneAt: 15, winner: false, legacy: false, moved: false, phoneMoves: true },
  ])('orders the explicit comment kind only at its reviewed place: $label', async ({ phoneAt, winner, legacy, moved, phoneMoves }) => {
    const resource = { collection: 'studyNotes', id: 'comment-kind-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const place = { id: 'place', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const refs = [place], relocated = [{ ...place, fromVerse: 17 }];
    const comment = { userId: base.owner, title: '', content: 'Original words', type: 'comment',
      scriptureRefs: refs, tags: [], isDraft: false, createdAt: now, updatedAt: now };
    const ordinary = { exists: true, value: false }, paragraph = { exists: true, value: true };
    const opening = legacy ? { exists: false } : ordinary;
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed',
      value: { ...comment, ...(!legacy && { paragraph: false }) } })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof opening, after: typeof ordinary, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId, changes: [{ path: ['paragraph'], before, after }],
      commentKindAction: { observedRevision, reference: { exists: true, value: refs },
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } },
    });
    expect((await processCommand(base.owner, edit('computer-paragraph', opening, paragraph, 40, 1))).kind).toBe('acknowledged');
    const back = edit('computer-comment', paragraph, ordinary, 60, 2);
    expect((await processCommand(base.owner, { ...back, changes: [...back.changes,
      { path: ['content'], before: { exists: true, value: comment.content }, after: { exists: true, value: 'Independent words' } },
    ] })).kind).toBe('acknowledged');
    if (moved) expect((await processCommand(base.owner, { ...base, kind: 'update', generation: 'seed', operationId: 'relocate',
      changes: [{ path: ['scriptureRefs'], before: { exists: true, value: refs }, after: { exists: true, value: relocated } }],
    })).kind).toBe('acknowledged');
    const selection = edit('phone', opening, paragraph, phoneAt, 1);
    const phone = phoneMoves ? { ...selection, changes: [...selection.changes,
      { path: ['scriptureRefs'], before: { exists: true, value: refs }, after: { exists: true, value: relocated } },
    ] } : selection;
    const result = await processCommand(base.owner, phone);
    expect(result.kind).toBe(moved ? 'refused' : phoneAt === null || phoneMoves ? 'conflict' : 'acknowledged');
    if (moved) expect(result).toMatchObject({ code: 'comment-kind-place-changed' });
    expect((await readDocument(base.owner, resource)).value).toMatchObject({ type: 'comment', paragraph: winner,
      content: 'Independent words', scriptureRefs: moved ? relocated : refs });
    expect(await processCommand(base.owner, phone)).toEqual(result);
    const history = await listCommentKindHistory(base.owner, resource.id, 'seed');
    expect(history.entries).toEqual(result.kind === 'acknowledged'
      ? [expect.objectContaining({ paragraph: !winner, winnerParagraph: winner })] : []);
  });

  it.each([
    { label: 'earlier phone', phoneAt: 15, winner: 'note', legacy: false },
    { label: 'later phone', phoneAt: 90, winner: 'question', legacy: false },
    { label: 'unknown order', phoneAt: null, winner: 'note', legacy: false },
    { label: 'ordinary legacy note', phoneAt: 15, winner: 'note', legacy: true },
  ])('orders ordinary note type without changing its words: $label', async ({ phoneAt, winner, legacy }) => {
    const resource = { collection: 'studyNotes', id: 'type-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const note = { userId: base.owner, title: 'Note title', content: 'Original words', tags: ['Keep'], scriptureRefs: [], isDraft: true, createdAt: now, updatedAt: now };
    const absent = { exists: false }, plain = { exists: true, value: 'note' }, question = { exists: true, value: 'question' };
    const opening = legacy ? absent : plain;
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed',
      value: { ...note, ...(!legacy && { type: 'note' }) } })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof opening, after: typeof plain, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId, changes: [{ path: ['type'], before, after }],
      studyNoteTypeAction: { observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } },
    });
    expect((await processCommand(base.owner, edit('computer-question', opening, question, 40, 1))).kind).toBe('acknowledged');
    const returnToNote = edit('computer-note', question, plain, 60, 2);
    expect((await processCommand(base.owner, { ...returnToNote, changes: [...returnToNote.changes,
      { path: ['content'], before: { exists: true, value: note.content }, after: { exists: true, value: 'Independent words' } },
    ] })).kind).toBe('acknowledged');
    const phone = edit('phone', opening, question, phoneAt, 1);
    const result = await processCommand(base.owner, phone);
    expect(result.kind).toBe(phoneAt === null ? 'conflict' : 'acknowledged');
    expect((await readDocument(base.owner, resource)).value).toMatchObject({ title: note.title, type: winner, content: 'Independent words', tags: note.tags });
    expect(await processCommand(base.owner, phone)).toEqual(result);
  });

  it.each([
    { label: 'earlier phone', phoneAt: 15, winner: 'postponed', held: false },
    { label: 'later phone', phoneAt: 90, winner: 'plan', held: false },
    { label: 'earlier phone in held council', phoneAt: 15, winner: 'postponed', held: true },
    { label: 'later phone in held council', phoneAt: 90, winner: 'plan', held: true },
    { label: 'no clock', phoneAt: null, winner: 'postponed', held: false },
  ])('orders the complete topic outcome: $label', async ({ phoneAt, winner, held }) => {
    const resource = { collection: 'councils', id: 'timed-topic-outcome' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const other = { ...opening, id: 'neighbor', title: 'Keep the neighbor' };
    const topics = [opening, other];
    const deferred = { ...opening, resolution: 'postponed', ...(held && { changes: [{ at: now, from: '', to: 'postponed' }] }) };
    const decided = { ...opening, discussed: true, acceptedOptionId: 'plan',
      ...(held && { changes: [{ at: now, from: '', to: 'Care plan' }] }) };
    const laterTitle = { ...other, title: 'Independent edit' };
    const empty = { discussed: false, decision: null, acceptedOptionId: null, resolution: null };
    const draftOutcome = { ...empty, discussed: true, acceptedOptionId: 'plan' };
    const storedOutcome = { ...empty, resolution: 'postponed' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: held ? 'held' : 'preparing', ...(held && { heldAt: now }), createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof topics, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: topics }, after: { exists: true, value: after } }],
      councilOutcomeActions: [{ rowId: opening.id, rowCreatedAt: opening.id, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    expect((await processCommand(base.owner, edit('desktop', [deferred, laterTitle], 50))).kind).toBe('acknowledged');
    const phone = edit('phone', [decided, other], phoneAt);
    const result = await processCommand(base.owner, phone);
    expect(result.kind).toBe(phoneAt === null ? 'conflict' : 'acknowledged');
    const stored = (await readDocument(base.owner, resource)).value?.topics as Array<Record<string, unknown>>;
    expect(stored[1]).toEqual(laterTitle);
    expect(stored[0].acceptedOptionId).toBe(winner === 'plan' ? 'plan' : undefined);
    expect(stored[0].resolution).toBe(winner === 'postponed' ? 'postponed' : undefined);
    expect(stored[0].discussed).toBe(winner === 'plan' ? true : undefined);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/timed-topic-outcome/_topicOutcomeHistory/'));
    expect(history).toHaveLength(phoneAt === null ? 0 : 1);
    if (history.length) expect(history[0][1]).toMatchObject({ fields: [{ rowId: opening.id,
      value: winner === 'plan' ? storedOutcome : draftOutcome, winnerValue: winner === 'plan' ? draftOutcome : storedOutcome,
    }] });
    if (held) expect(stored[0].changes).toEqual(winner === 'plan'
      ? [...deferred.changes!, { ...decided.changes![0], from: 'postponed' }]
      : deferred.changes);
    expect(await processCommand(base.owner, phone)).toEqual(result);
  });

  it('keeps the decision handled when one device removes the option and another writes independent words', async () => {
    const resource = { collection: 'councils', id: 'independent-outcome-clear' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const section = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const opening = { ...section, discussed: true, acceptedOptionId: 'plan' };
    const text = 'The decision was written independently';
    const written = { ...opening, decision: text };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [opening] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof section, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [opening] }, after: { exists: true, value: [after] } }],
      councilOutcomeActions: [{ rowId: section.id, rowCreatedAt: section.id, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    expect((await processCommand(base.owner, edit('write', written, 80))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('clear-option', section, 40))).kind).toBe('acknowledged');
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([{ ...section, decision: text, discussed: true }]);
  });

  it.each(['removed-option', 'compatible-proof', 'distinct-words'])('preserves the complete council outcome contract: %s', async scenario => {
    const resource = { collection: 'councils', id: 'outcome-contract' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const topic = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const words = { ...topic, discussed: true, decision: 'Keep these independently written words' };
    const option = { ...topic, discussed: true, acceptedOptionId: 'plan' };
    const deferred = { ...topic, resolution: 'postponed' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [topic] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof topic, at?: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [topic] }, after: { exists: true, value: [after] } }],
      ...(at !== undefined && { councilOutcomeActions: [{ rowId: topic.id, rowCreatedAt: topic.id, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }] }),
    });
    if (scenario === 'removed-option') {
      expect((await processCommand(base.owner, edit('remove', { ...topic, options: [] }))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('select', option, 90))).toMatchObject({ kind: 'refused', code: 'council-option-gone' });
      expect((await readDocument(base.owner, resource)).value?.topics).toEqual([{ ...topic, options: [] }]);
      return;
    }
    expect((await processCommand(base.owner, edit('words', words, 80))).kind).toBe('acknowledged');
    if (scenario === 'distinct-words') {
      const other = { ...words, decision: 'Different written words from the phone' };
      expect(await processCommand(base.owner, edit('other-words', other, 100))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['topics', 'id:section', 'outcome'],
          mine: { value: expect.objectContaining({ decision: other.decision }) },
          theirs: { value: expect.objectContaining({ decision: words.decision }) },
        }],
      });
      return;
    }
    expect((await processCommand(base.owner, edit('select', option, 40))).kind).toBe('acknowledged');
    const combined = { ...words, acceptedOptionId: 'plan' };
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([combined]);
    expect((await processCommand(base.owner, edit('early-deferral', deferred, 20))).kind).toBe('acknowledged');
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([combined]);
    expect((await processCommand(base.owner, edit('late-deferral', deferred, 100))).kind).toBe('acknowledged');
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([deferred]);
  });

  it.each(['decision', 'info'])('keeps incompatible %s outcomes distinct when order is unknown', async kind => {
    const resource = { collection: 'councils', id: 'topic-outcome-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind, questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const other = { ...opening, id: 'neighbor', title: 'Neighbor' };
    const initial = [opening, other];
    const deferred = { ...opening, resolution: 'postponed' };
    const handled = { ...opening, discussed: true, ...(kind === 'decision' && { acceptedOptionId: 'plan' }) };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: initial },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof initial) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: initial }, after: { exists: true, value: after } }],
    });
    expect((await processCommand(base.owner, edit('desktop', [deferred, other]))).kind).toBe('acknowledged');
    const phone = edit('phone', [handled, other]);
    expect(await processCommand(base.owner, phone)).toMatchObject({ kind: 'conflict', conflicts: [{
      path: ['topics', 'id:section', 'outcome'], mine: { value: expect.objectContaining({ discussed: true }) },
      theirs: { value: expect.objectContaining({ resolution: 'postponed' }) },
    }] });
    expect(await readDocument(base.owner, resource)).toMatchObject({ value: { topics: [deferred, other] } });
  });

  it.each([
    { label: 'direct type conversion would clear a recorded result', recorded: true, deviceSeesOutcome: true, typeSwitch: true, code: 'council-topic-outcome-first' },
    { label: 'late type conversion missed a newly recorded result', recorded: true, deviceSeesOutcome: false, typeSwitch: true, code: 'council-topic-outcome-first' },
    { label: 'late outcome was recorded under the older type', recorded: false, deviceSeesOutcome: false, typeSwitch: false, code: 'council-topic-kind-changed' },
  ])('protects a council topic outcome: $label', async ({ recorded, deviceSeesOutcome, typeSwitch, code }) => {
    const resource = { collection: 'councils', id: 'topic-outcome-fence' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind: 'decision', summary: 'Keep this note',
      questions: [], options: [{ id: 'first', text: 'First option' }] };
    const decided = { ...opening, discussed: true, decision: 'Keep this recorded decision', acceptedOptionId: 'first' };
    const info = { ...opening, kind: 'info' };
    const stored = recorded ? decided : info;
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [stored] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof opening, after: typeof opening) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
    });
    const command = edit('late', deviceSeesOutcome ? decided : opening, typeSwitch ? info : decided);
    expect(await processCommand(base.owner, command)).toMatchObject({ kind: 'refused', code });
    expect(await readDocument(base.owner, resource)).toMatchObject({ value: { topics: [stored] } });
    if (!recorded) {
      const manualRebase = edit('retry-on-info', info, { ...decided, kind: 'info' });
      expect(await processCommand(base.owner, manualRebase)).toMatchObject({ kind: 'refused', code: 'council-topic-kind-changed' });
      expect(await readDocument(base.owner, resource)).toMatchObject({ value: { topics: [info] } });
    }
    if (recorded) {
      expect((await processCommand(base.owner, edit('explicit-clear', decided, opening))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('new-type', opening, info))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { topics: [info] } },
      });
    }
  });

  it.each([
    { label: 'phone first', mobileAt: 15, winner: false, kind: 'acknowledged' },
    { label: 'phone last', mobileAt: 100, winner: true, kind: 'acknowledged' },
    { label: 'no clock', mobileAt: null, winner: false, kind: 'conflict' },
  ])('orders the exact assembly flag after the computer clears it: $label', async ({ mobileAt, winner, kind }) => {
    const resource = { collection: 'councils', id: 'assembly-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const topic = { id: 'opening', title: 'Opening', summary: 'Original words', forAssembly: false, questions: [], options: [] };
    const other = { ...topic, id: 'other', title: 'Other section', forAssembly: true };
    const topics = [topic, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof topics, after: typeof topics, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      councilAssemblyActions: { forAssembly: { rowId: topic.id, rowCreatedAt: topic.id, before: before[0].forAssembly,
        after: after[0].forAssembly, observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const marked = [{ ...topic, forAssembly: true }, other];
    const cleared = [{ ...topic, summary: 'Later explanation' }, other];
    expect((await processCommand(base.owner, edit('desktop-mark', topics, marked, 45, 1))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('desktop-clear', marked, cleared, 65, 2))).kind).toBe('acknowledged');
    const phone = edit('phone', topics, marked, mobileAt, 1);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { topics: [{ ...cleared[0], forAssembly: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/assembly-order/_assemblyHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['topics', 'id:opening', 'forAssembly'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: topic.id, field: 'forAssembly', value: !winner, winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'phone first', mobileAt: 15, winner: 'Computer section', kind: 'acknowledged' },
    { label: 'phone last', mobileAt: 100, winner: 'Phone section', kind: 'acknowledged' },
    { label: 'no clock', mobileAt: null, winner: 'Computer section', kind: 'conflict' },
  ])('orders one council section title without replacing its explanation: $label', async ({ mobileAt, winner, kind }) => {
    const resource = { collection: 'councils', id: 'topic-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const topic = { id: 'opening', title: 'Opening', summary: 'Original words', questions: [], options: [] };
    const other = { ...topic, id: 'other', title: 'Other section' };
    const topics = [topic, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof topics, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: topics }, after: { exists: true, value: after } }],
      councilTopicTitleActions: [{ rowId: topic.id, rowCreatedAt: topic.id, before: topic.title,
        after: after[0].title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    const desktop = [{ ...topic, title: 'Computer section', summary: 'Later explanation' }, other];
    expect((await processCommand(base.owner, edit('desktop', desktop, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', [{ ...topic, title: 'Phone section' }, other], mobileAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Council', topics: [{ ...desktop[0], title: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/topic-title-order/_topicTitleHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['topics', 'id:opening', 'title'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: topic.id, field: 'title',
        value: winner === 'Computer section' ? 'Phone section' : 'Computer section', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'phone first', at: 15, winner: 'filled', kind: 'acknowledged' },
    { label: 'phone last', at: 100, winner: 'empty', kind: 'acknowledged' },
    { label: 'unknown order', at: null, winner: 'filled', kind: 'conflict' },
    { label: 'later explicit return', at: 100, winner: 'draft', kind: 'acknowledged', phoneStatus: 'draft' },
  ])('orders one group block status without replacing its separate text: $label', async ({ at, winner, kind, phoneStatus = 'empty' }) => {
    const resource = { collection: 'groups', id: 'block-status-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'opening', type: 'custom', title: 'Opening', content: 'Original words', status: 'draft', createdAt: now, updatedAt: now };
    const other = { ...block, id: 'other', title: 'Other block' };
    const templates = [block, other];
    const flow = [{ id: 'step', templateId: block.id, order: 1 }, { id: 'other-step', templateId: other.id, order: 2 }];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates, flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, next: typeof block, time: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['templates'], before: { exists: true, value: templates }, after: { exists: true, value: [next, other] } }],
      groupBlockStatusActions: [{ rowId: block.id, rowCreatedAt: block.createdAt, before: block.status,
        after: next.status, observedRevision: 1,
        time: time === null ? null : { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_004 + time } }],
    });
    const computer = { ...block, status: 'filled', content: 'Keep these later words' };
    expect((await processCommand(base.owner, edit('computer', computer, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', { ...block, status: phoneStatus }, at);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Group', flow, templates: [{ ...computer, status: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/block-status-order/_blockStatusHistory/'));
    if (at === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['templates', 'id:opening', 'status'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: block.id, field: 'status',
        value: winner === 'filled' ? phoneStatus : 'filled', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'phone first', phoneAt: 15, winner: 'Computer block', kind: 'acknowledged' },
    { label: 'phone last', phoneAt: 100, winner: 'Phone block', kind: 'acknowledged' },
    { label: 'unknown order', phoneAt: null, winner: 'Computer block', kind: 'conflict' },
    { label: 'legacy empty creation date', phoneAt: 100, winner: 'Phone block', kind: 'acknowledged', birth: '' },
  ])('orders one group block title and preserves its separate text: $label', async ({ phoneAt, winner, kind, birth }) => {
    const resource = { collection: 'groups', id: 'block-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'opening', type: 'custom', title: 'Opening', content: 'Original words', status: 'draft', createdAt: birth ?? now, updatedAt: now };
    const other = { ...block, id: 'other', title: 'Other block' };
    const templates = [block, other];
    const flow = [{ id: 'step', templateId: block.id, order: 1 }, { id: 'other-step', templateId: other.id, order: 2 }];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates, flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof templates, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['templates'], before: { exists: true, value: templates }, after: { exists: true, value: after } }],
      groupBlockTitleActions: [{ rowId: block.id, rowCreatedAt: block.createdAt, before: block.title,
        after: after[0].title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    const computer = [{ ...block, title: 'Computer block', content: 'Keep these later words' }, other];
    expect((await processCommand(base.owner, edit('computer', computer, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', [{ ...block, title: 'Phone block' }, other], phoneAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Group', flow, templates: [{ ...computer[0], title: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/block-title-order/_blockTitleHistory/'));
    if (phoneAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['templates', 'id:opening', 'title'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: block.id, field: 'title',
        value: winner === 'Computer block' ? 'Phone block' : 'Computer block', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'earlier name', phoneAt: 15, phoneTitle: 'Phone step', expected: 'Computer step', kind: 'acknowledged' },
    { label: 'later name', phoneAt: 100, phoneTitle: 'Phone step', expected: 'Phone step', kind: 'acknowledged' },
    { label: 'later clear', phoneAt: 100, phoneTitle: null, expected: undefined, kind: 'acknowledged' },
    { label: 'unknown clear', phoneAt: null, phoneTitle: null, expected: 'Computer step', kind: 'conflict' },
  ])('orders a group step title separately from the block title: $label', async ({ phoneAt, phoneTitle, expected, kind }) => {
    const resource = { collection: 'groups', id: 'step-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'block', type: 'custom', title: 'Block name', content: 'Keep words', status: 'draft', createdAt: now, updatedAt: now };
    const step = { id: 'step', templateId: block.id, order: 1 };
    const other = { ...step, id: 'other', order: 2 };
    const opening = { ...step, instanceTitle: 'Original step' };
    const flow = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates: [block], flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof step & { instanceTitle?: string; durationMin?: number }, title: string | null, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['flow'], before: { exists: true, value: flow }, after: { exists: true, value: [after, other] } }],
      groupStepTitleActions: [{ rowId: step.id, rowCreatedAt: step.templateId, before: opening.instanceTitle,
        after: title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    const computer = { ...step, instanceTitle: 'Computer step', durationMin: 15 };
    expect((await processCommand(base.owner, edit('computer', computer, computer.instanceTitle, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', phoneTitle === null ? step : { ...step, instanceTitle: phoneTitle }, phoneTitle, phoneAt);
    const answer = await processCommand(base.owner, phone);
    const final = { ...step, durationMin: 15, ...(expected !== undefined && { instanceTitle: expected }) };
    expect(answer).toMatchObject({ kind, snapshot: { value: { templates: [block], flow: [final, other] } } });
    if ('snapshot' in answer) expect((answer.snapshot.value?.flow as Array<Record<string, unknown>>)[0]).toEqual(final);
    if (phoneAt === null) expect(answer).toMatchObject({ conflicts: [{ path: ['flow', 'id:step', 'instanceTitle'] }] });
  });

  it.each([
    { label: 'earlier number', at: 15, phoneMinutes: 24, expected: 40, kind: 'acknowledged' },
    { label: 'later number', at: 100, phoneMinutes: 24, expected: 24, kind: 'acknowledged' },
    { label: 'later clear', at: 100, phoneMinutes: null, expected: null, kind: 'acknowledged' },
    { label: 'explicit return to the opening duration', at: 100, phoneMinutes: 15, expected: 15, kind: 'acknowledged' },
    { label: 'unknown clear', at: null, phoneMinutes: null, expected: 40, kind: 'conflict' },
    { label: 'later zero over a missing legacy duration', at: 100, phoneMinutes: 0, expected: 0, kind: 'acknowledged', legacyMissing: true },
  ])('orders one group step duration while keeping adjacent work: $label', async ({ at, phoneMinutes, expected, kind, legacyMissing }) => {
    const resource = { collection: 'groups', id: 'step-duration-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'block', type: 'custom', title: 'Block name', content: 'Keep words', status: 'draft', createdAt: now, updatedAt: now };
    const step = { id: 'step', templateId: block.id, order: 1, durationMin: 15 };
    const other = { ...step, id: 'other', order: 2, durationMin: 7 };
    const flow = [step, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates: [block], flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: Omit<typeof step, 'durationMin'> & { durationMin?: number | null; instanceTitle?: string }, time: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['flow'], before: { exists: true, value: flow }, after: { exists: true, value: [after, other] } }],
      groupStepDurationActions: [{ rowId: step.id, rowCreatedAt: step.templateId, before: step.durationMin,
        after: after.durationMin ?? null, observedRevision: 1,
        time: time === null ? null : { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_004 + time } }],
    });
    const { durationMin: _duration, ...stepWithoutDuration } = step;
    const computer = { ...stepWithoutDuration, ...(!legacyMissing && { durationMin: 40 }), instanceTitle: 'Keep this label' };
    expect((await processCommand(base.owner, edit('computer', computer, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', { ...step, durationMin: phoneMinutes }, at);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { templates: [block], flow: [{ ...computer, durationMin: expected }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/step-duration-order/_stepDurationHistory/'));
    if (at === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['flow', 'id:step', 'durationMin'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: step.id, field: 'durationMin',
        value: expected === 40 ? phoneMinutes : computer.durationMin ?? null, winnerValue: expected }] });
    }
  });

  it.each([
    { label: 'earlier', mobileAt: 15, title: 'Computer opening', kind: 'acknowledged' },
    { label: 'later', mobileAt: 100, title: 'Phone opening', kind: 'acknowledged' },
    { label: 'unclocked', mobileAt: null, title: 'Computer opening', kind: 'conflict' },
    { label: 'earlier before clear', mobileAt: 15, title: '', kind: 'acknowledged', computerTitle: '' },
    { label: 'later with a legacy long title', mobileAt: 100, title: 'Phone opening', kind: 'acknowledged', openingTitle: 'X'.repeat(501) },
  ])('orders the exact service step title and keeps the body: $label', async ({
    mobileAt, title, kind, computerTitle = 'Computer opening', openingTitle = 'Opening',
  }) => {
    const resource = { collection: 'serviceOrders', id: 'step-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: openingTitle, body: 'Original words', scriptureRefs: [], flagged: false };
    const other = { ...opening, id: 'other', title: 'Prayer', flagged: true };
    const initial = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof initial, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: initial }, after: { exists: true, value: after } }],
      serviceOrderStepTitleActions: { title: { rowId: opening.id, rowCreatedAt: opening.id, before: opening.title,
        after: after[0].title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const desktop = [{ ...opening, title: computerTitle, body: 'Later words on desktop' }, other];
    expect((await processCommand(base.owner, edit('desktop', desktop, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', [{ ...opening, title: 'Phone opening' }, other], mobileAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Sunday', steps: [{ ...desktop[0], title }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/step-title-order/_stepTitleHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['steps', 'id:opening', 'title'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      const displaced = { rowId: opening.id, field: 'title', value: title === computerTitle ? 'Phone opening' : computerTitle, winnerValue: title };
      expect(history[0][1]).toMatchObject({ fields: [displaced] });
      await expect(listServiceOrderStepTitleHistory(base.owner, resource.id, 'seed')).resolves.toMatchObject({
        owner: base.owner, orderId: resource.id, generation: 'seed', entries: [{ fields: [displaced] }],
      });
      await expect(listServiceOrderStepTitleHistory('other-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderStepTitleHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    }
  });

  it('accepts the first explicit flag on an older step that omitted the optional flag', async () => {
    const resource = { collection: 'serviceOrders', id: 'missing-flag' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const opening = { id: 'opening', title: 'Opening' };
    const now = '2026-11-08T00:00:00.000Z';
    await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: [opening] },
    });
    const answer = await processCommand(base.owner, { ...base, kind: 'update', operationId: 'mark', generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: [{ ...opening, flagged: false }] },
        after: { exists: true, value: [{ ...opening, flagged: true }] } }],
      serviceOrderFlagActions: { flagged: { rowId: opening.id, rowCreatedAt: opening.id, before: false, after: true, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_024 } } },
    });
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [{ ...opening, flagged: true }] } } });
  });

  it.each([
    { label: 'earlier', phoneAt: 15, flag: false, kind: 'acknowledged' },
    { label: 'later', phoneAt: 100, flag: true, kind: 'acknowledged' },
    { label: 'unclocked', phoneAt: null, flag: false, kind: 'conflict' },
  ])('orders a service step flag after the other device returns to the opening value: $label', async ({ phoneAt, flag, kind }) => {
    const resource = { collection: 'serviceOrders', id: 'flag-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: 'Opening', body: 'Original words', scriptureRefs: [], flagged: false };
    const other = { ...opening, id: 'other', title: 'Prayer', flagged: true };
    const initial = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    })).kind).toBe('acknowledged');
    const change = (operationId: string, before: typeof initial, after: typeof initial, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      serviceOrderFlagActions: { flagged: { rowId: opening.id, rowCreatedAt: opening.id, before: before[0].flagged,
        after: after[0].flagged, observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const marked = [{ ...opening, flagged: true }, other];
    expect((await processCommand(base.owner, change('desktop-on', initial, marked, 40, 1))).kind).toBe('acknowledged');
    const unmarked = [{ ...opening, body: 'Later words on desktop' }, other];
    expect((await processCommand(base.owner, change('desktop-off', marked, unmarked, 65, 2))).kind).toBe('acknowledged');
    const phone = change('phone-on', initial, marked, phoneAt, 1);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { steps: [{ ...unmarked[0], flagged: flag }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/flag-round-trip/_stepFlagHistory/'));
    if (phoneAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['steps', 'id:opening', 'flagged'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: opening.id, field: 'flagged', value: !flag, winnerValue: flag }] });
      await expect(listServiceOrderFlagHistory(base.owner, resource.id, 'seed')).resolves.toMatchObject({
        owner: base.owner, orderId: resource.id, generation: 'seed', entries: [{ fields: [{ rowId: opening.id, value: !flag, winnerValue: flag }] }],
      });
      await expect(listServiceOrderFlagHistory('other-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderFlagHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    }
  });

  it('does not guess when a meeting date proof was evicted after a return to the same date', async () => {
    const resource = { collection: 'groups', id: 'evicted-meeting-proof' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const rows = Array.from({ length: 34 }, (_, index) => ({ id: 'meeting-' + index, date: '2026-12-13', createdAt: now }));
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: rows, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof rows, after: typeof rows) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const unset = [{ ...rows[0], date: '' }, ...rows.slice(1)];
    expect((await processCommand(base.owner, edit('unset', rows, unset))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('return', unset, rows))).kind).toBe('acknowledged');
    const changed = [rows[0], ...rows.slice(1).map(row => ({ ...row, date: '2026-12-27' }))];
    expect((await processCommand(base.owner, edit('other-rows', rows, changed))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, { ...edit('offline', rows, [{ ...rows[0], date: '2026-12-20' }, ...rows.slice(1)]),
      meetingDateAction: { rowId: rows[0].id, before: rows[0].date, after: '2026-12-20', observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } },
    })).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['meetingDates', 'id:meeting-0', 'date'] }],
      snapshot: { value: { meetingDates: changed } } });
  });

  it.each([
    { offset: 20, expected: 'completed', lost: 'active', kind: 'acknowledged' },
    { offset: 60, expected: 'active', lost: 'completed', kind: 'acknowledged' },
    { offset: 45, expected: 'completed', lost: null, kind: 'conflict' },
  ])('orders only the exact group status at offset $offset', async ({ offset, expected, lost, kind }) => {
    const resource = { collection: 'groups', id: 'group-status' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original title', description: 'Original notes', status: 'draft',
      templates: [], flow: [], meetingDates: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, after: string, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['status'], before: { exists: true, value: 'draft' }, after: { exists: true, value: after } }],
      groupStatusAction: { before: 'draft', after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
    });
    const desk = change('desk', 'completed', 40);
    expect((await processCommand(base.owner, { ...desk, changes: [...desk.changes,
      { path: ['description'], before: { exists: true, value: value.description }, after: { exists: true, value: 'Independent notes' } }],
    })).kind).toBe('acknowledged');
    const phone = change('phone', 'active', offset);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind, snapshot: { value: { status: expected, title: value.title, description: 'Independent notes', meetingDates: [] } } });
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-status/_statusHistory/'));
    expect(history).toHaveLength(lost === null ? 0 : 1);
    if (lost !== null) {
      expect(history[0][1]).toMatchObject({ status: lost, winnerStatus: expected, generation: 'seed' });
      expect(await listGroupStatusHistory(base.owner, resource.id, 'seed')).toMatchObject({
        owner: base.owner, groupId: resource.id, generation: 'seed', entries: [{ status: lost, winnerStatus: expected }],
      });
      await expect(listGroupStatusHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listGroupStatusHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, phone)).toEqual(result);
      expect([...documents.keys()].filter(path => path.startsWith('groups/group-status/_statusHistory/'))).toHaveLength(1);
    }
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['status'] }] });
  });

  it('orders the status and title in one group command by their different action times', async () => {
    const resource = { collection: 'groups', id: 'group-fields' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original title', status: 'draft', templates: [], flow: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const stamp = (before: string, after: string, at: number) => ({
      before, after, observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at },
    });
    const change = (operationId: string, title: string, status: string, titleAt: number, statusAt: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [
        { path: ['title'], before: { exists: true, value: value.title }, after: { exists: true, value: title } },
        { path: ['status'], before: { exists: true, value: value.status }, after: { exists: true, value: status } },
      ],
      groupTitleAction: stamp(value.title, title, titleAt),
      groupStatusAction: stamp(value.status, status, statusAt),
    });
    expect((await processCommand(base.owner, change('desk', 'Desk title', 'completed', 40, 45))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, change('phone', 'Phone title', 'active', 70, 20))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { title: 'Phone title', status: 'completed' } },
    });
    expect(await listGroupStatusHistory(base.owner, resource.id, 'seed')).toMatchObject({ entries: [{ status: 'active', winnerStatus: 'completed' }] });
    expect(await listGroupTitleHistory(base.owner, resource.id, 'seed')).toMatchObject({ entries: [{ title: 'Desk title', winnerTitle: 'Phone title' }] });
  });

  it.each([
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: 20, expected: 'Ephesians 2:8', archived: 'Romans 8:1' },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: 80, expected: 'Romans 8:1', archived: 'Ephesians 2:8' },
    { desk: 'Еф 2:8', phone: 'Рим 8:1–4', offset: 80, expected: 'Рим 8:1–4', archived: 'Еф 2:8' },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: 45, expected: 'Ephesians 2:8', archived: null },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: null, expected: 'Ephesians 2:8', archived: null },
    { desk: 'Ephesians 2:8 — Keep this note', phone: 'Romans 8:1', offset: 80, expected: 'Ephesians 2:8 — Keep this note', archived: null },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1; John 3:16', offset: 80, expected: 'Ephesians 2:8', archived: null },
    { desk: 'Ephesians 2:8', phone: 'John 3-2', offset: 80, expected: 'Ephesians 2:8', archived: null },
  ] as const)('orders a sermon passage only when the exact alternatives are standalone references ($desk / $phone / $offset)',
    async ({ desk, phone, offset, expected, archived }) => {
      const seed = create('sermon-verse-seed') as Extract<DataCommand, { kind: 'create' }>;
      const original = { ...seed.value, title: 'Opening title', verse: 'John 3:16' };
      expect((await processCommand('owner-1', { ...seed, value: original })).kind).toBe('acknowledged');
      const edit = (id: string, verse: string, at: number | null) => ({
        ...update(id, 'sermon-verse-seed'),
        changes: [{ path: ['verse'], before: { exists: true, value: original.verse }, after: { exists: true, value: verse } }],
        sermonVerseAction: { observedRevision: 1, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
      });
      expect((await processCommand('owner-1', edit('desk', desk, 40))).kind).toBe('acknowledged');
      const request = edit('phone', phone, offset);
      const answer = await processCommand('owner-1', request);
      expect(answer).toMatchObject({ kind: archived ? 'acknowledged' : 'conflict',
        snapshot: { value: { verse: expected, title: original.title } } });
      if (!archived) expect(answer).toMatchObject({ conflicts: [{ path: ['verse'] }] });
      const history = () => [...documents.entries()].filter(([path]) => path.startsWith('sermons/sermon-1/_verseHistory/'));
      expect(history()).toHaveLength(archived ? 1 : 0);
      if (archived) {
        expect(history()[0][1]).toMatchObject({ verse: archived, winnerVerse: expected, generation: 'sermon-verse-seed' });
        expect(await listSermonVerseHistory('owner-1', resource.id, 'sermon-verse-seed')).toMatchObject({
          owner: 'owner-1', sermonId: resource.id, entries: [{ verse: archived, winnerVerse: expected }],
        });
        await expect(listSermonVerseHistory('other-owner', resource.id, 'sermon-verse-seed')).rejects.toMatchObject({ status: 403 });
        await expect(listSermonVerseHistory('owner-1', resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
        expect(await processCommand('owner-1', request)).toEqual(answer);
        expect(history()).toHaveLength(1);
      }
    });

  describe('council metadata chronology', () => {
    const resource = { collection: 'councils', id: 'timed-council' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const date = '2099-04-10T00:00:00.000Z';
    const title = 'Opening council';
    const topics = [{ id: 'section', title: 'Keep the section', kind: 'info', questions: [], options: [], discussed: true }];
    const seed = () => processCommand(base.owner, { ...base, operationId: 'council-seed', kind: 'create', generation: null,
      value: { userId: base.owner, title, date, status: 'preparing', topics,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const day = (value: string | null) => value === null ? { exists: false } : { exists: true, value };
    const change = (operationId: string, nextTitle: string, nextDate: string | null, offset: number) => {
      const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return { ...base, operationId, kind: 'update', generation: 'council-seed',
        changes: [{ path: ['title'], before: day(title), after: day(nextTitle) },
          { path: ['date'], before: day(date), after: day(nextDate) }],
        councilTitleAction: { before: title, after: nextTitle, observedRevision: 1, time },
        councilDateAction: { observedRevision: 1, time } };
    };

    it.each([
      { offset: 20, nextDate: '2099-04-27', expectedTitle: 'Desk council', expectedDate: '2099-04-20' },
      { offset: 80, nextDate: '2099-04-27', expectedTitle: 'Phone council', expectedDate: '2099-04-27' },
      { offset: 80, nextDate: null, expectedTitle: 'Phone council', expectedDate: undefined },
    ])('orders name and date from separate autosave observations ($offset / $nextDate)', async scenario => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, change('council-desk', 'Desk council', '2099-04-20', 40))).kind).toBe('acknowledged');
      const request = change('council-phone', 'Phone council', scenario.nextDate, scenario.offset);
      const result = await processCommand(base.owner, request);
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: scenario.expectedTitle, status: 'preparing', topics } } });
      expect(documents.get('councils/timed-council')?.date).toBe(scenario.expectedDate);
      const losingTitle = scenario.offset < 40 ? 'Phone council' : 'Desk council';
      const losingDate = scenario.offset < 40 ? scenario.nextDate : '2099-04-20';
      const list = () => listCouncilMetadataHistory(base.owner, resource.id, 'council-seed');
      expect(await list()).toMatchObject({ entries: [{ fields: [
        { field: 'title', value: losingTitle, winner: scenario.expectedTitle },
        { field: 'date', value: losingDate, winner: scenario.expectedDate ?? null },
      ] }] });
      await expect(listCouncilMetadataHistory('another-owner', resource.id, 'council-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listCouncilMetadataHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, request)).toEqual(result);
      expect((await list()).entries).toHaveLength(1);
    });

    it('can restore an earlier cleared date without changing the council title or sections', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = change('council-desk', title, null, 40);
      const phone = change('council-phone', title, '2099-04-27', 80);
      expect((await processCommand(base.owner, { ...desk, changes: [desk.changes[1]] })).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, { ...phone, changes: [phone.changes[1]] })).kind).toBe('acknowledged');
      const history = await listCouncilMetadataHistory(base.owner, resource.id, 'council-seed');
      expect(history.entries).toMatchObject([{ fields: [{ field: 'date', value: null, winner: '2099-04-27' }] }]);
      expect(await processCommand(base.owner, { ...change('restore-clear', title, null, 120),
        changes: [{ path: ['date'], before: day('2099-04-27'), after: day(null) }],
        councilDateAction: { observedRevision: 3, time: { earliestMs: 1_800_000_000_120, latestMs: 1_800_000_000_125 } },
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title, topics } } });
      expect(documents.get('councils/timed-council')).not.toHaveProperty('date');
    });

    it('asks before replacing a restored name or date when the offline action had no clock', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const deskTitle = 'Desk council', deskDate = '2099-04-20';
      expect((await processCommand(base.owner, change('council-desk', deskTitle, deskDate, 40))).kind).toBe('acknowledged');
      const restore = change('council-desk-restore', title, date, 80);
      expect((await processCommand(base.owner, { ...restore,
        changes: [{ path: ['title'], before: day(deskTitle), after: day(title) },
          { path: ['date'], before: day(deskDate), after: day(date) }],
        councilTitleAction: { ...restore.councilTitleAction, before: deskTitle, observedRevision: 2 },
        councilDateAction: { ...restore.councilDateAction, observedRevision: 2 },
      })).kind).toBe('acknowledged');
      const phone = change('council-phone', 'Offline council', null, 20);
      expect(await processCommand(base.owner, { ...phone,
        councilTitleAction: { ...phone.councilTitleAction, time: null },
        councilDateAction: { ...phone.councilDateAction, time: null },
      })).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'] }, { path: ['date'] }],
        snapshot: { value: { title, date, topics } },
      });
      expect((await listCouncilMetadataHistory(base.owner, resource.id, 'council-seed')).entries).toHaveLength(0);
    });

    it('preserves ordinary choices if the two council action intervals overlap', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, change('council-desk', 'Desk council', '2099-04-20', 40))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, change('council-phone', 'Phone council', '2099-04-27', 43))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'] }, { path: ['date'] }],
        snapshot: { value: { title: 'Desk council', date: '2099-04-20', topics } },
      });
    });
  });

  describe('council lifecycle chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'councils', id: 'lifecycle-council' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Council with sections', date = '2099-04-13';
    const topics = [{ id: 'section', title: 'Keep the section', kind: 'info', questions: [], options: [], discussed: true }];
    const seed = () => processCommand(owner, { ...base, operationId: 'council-create', kind: 'create', generation: null,
      value: { userId: owner, title, date, status: 'preparing', topics,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const value = (text: string | null) => text === null ? { exists: false } : { exists: true, value: text };
    const change = (operationId: string, before: string | null, after: string | null, observedRevision: number, offset: number) => ({
      ...base, operationId, kind: 'update', generation: 'council-create',
      changes: [
        { path: ['status'], before: value(before === null ? 'preparing' : 'held'), after: value(after === null ? 'preparing' : 'held') },
        { path: ['heldAt'], before: value(before), after: value(after) },
      ],
      councilLifecycleAction: { observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });
    const desktopHeld = '2026-11-08T00:00:01.000Z', phoneHeld = '2026-11-08T00:00:02.000Z';

    it.each([20, 80])('orders two finishes by action time and preserves the complete held state (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-finish', null, desktopHeld, 1, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, change('phone-finish', null, phoneHeld, 1, offset))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { status: 'held', heldAt: offset < 40 ? desktopHeld : phoneHeld, title, date, topics } },
      });
    });

    it('keeps a later Undo when an old offline Finish is delivered afterwards', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-finish', null, desktopHeld, 1, 40))).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-undo', desktopHeld, null, 2, 80))).kind).toBe('acknowledged');
      expect(await processCommand(owner, change('phone-finish', null, phoneHeld, 1, 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { status: 'preparing', title, date, topics } },
      });
      expect(documents.get('councils/lifecycle-council')).not.toHaveProperty('heldAt');
      expect(await listCouncilMetadataHistory(owner, resource.id, 'council-create')).toMatchObject({
        entries: [{ fields: [{ field: 'heldAt', value: phoneHeld, winner: null }] }],
      });
      const restored = await processCommand(owner, change('restore-old-finish', null, phoneHeld, 3, 120));
      expect(restored).toMatchObject({ kind: 'acknowledged', snapshot: { value: { status: 'held', heldAt: phoneHeld, title, date, topics } } });
    });

    it('preserves a manual choice when a delayed Finish has no reliable clock', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-finish', null, desktopHeld, 1, 40))).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-undo', desktopHeld, null, 2, 80))).kind).toBe('acknowledged');
      const phone = change('phone-finish', null, phoneHeld, 1, 20);
      expect(await processCommand(owner, { ...phone, councilLifecycleAction: { observedRevision: 1, time: null } })).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['heldAt'] }], snapshot: { value: { status: 'preparing', title, date, topics } },
      });
      expect(documents.get('councils/lifecycle-council')).not.toHaveProperty('heldAt');
      expect((await listCouncilMetadataHistory(owner, resource.id, 'council-create')).entries).toHaveLength(0);
    });
  });

  describe('tag color chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'tags', id: 'timed-tag' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const name = 'Keep the tag name';
    const color = '#808E9B';
    const desk = '#54A0FF';
    const phone = '#FF6B6B';
    const field = (value: string) => ({ exists: true, value });
    const seed = () => processCommand(owner, { ...base, operationId: 'tag-create', kind: 'create', generation: null,
      value: { userId: owner, name, color, required: false, createdAt: '2026-11-08' } });
    const recolor = (operationId: string, nextColor: string, offset: number | null) => ({
      ...base, operationId, kind: 'update', generation: 'tag-create',
      changes: [{ path: ['color'], before: field(color), after: field(nextColor) }],
      tagColorAction: { observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([[20, desk], [80, phone]] as const)('orders a delayed recolor and preserves tag identity (%s)', async (offset, winner) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, recolor('desk-color', desk, 40))).kind).toBe('acknowledged');
      const delayed = recolor('phone-color', phone, offset);
      const reply = await processCommand(owner, delayed);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { name, color: winner, required: false } } });
      expect(await processCommand(owner, delayed)).toEqual(reply);
      expect(await listTagColorHistory(owner, resource.id, 'tag-create')).toMatchObject({
        tagId: resource.id, entries: [{ fields: [{ field: 'color', value: winner === desk ? phone : desk, winner }] }],
      });
      await expect(listTagColorHistory('other-owner', resource.id, 'tag-create')).rejects.toMatchObject({ status: 403 });
      await expect(listTagColorHistory(owner, resource.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it.each([null, 43])('keeps the saved color when ordering cannot be proven (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, recolor('desk-color', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, recolor('phone-color', phone, offset))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['color'] }], snapshot: { value: { name, color: desk } },
      });
    });

    it('keeps a deleted tag deleted when a recolor later arrives', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...base, operationId: 'tag-delete', kind: 'delete', generation: 'tag-create',
        baseline: { userId: owner, name, color, required: false, createdAt: '2026-11-08' } })).kind).toBe('acknowledged');
      const reply = await processCommand(owner, recolor('phone-color', phone, 80));
      expect(reply).toMatchObject({ kind: 'deleted', snapshot: { value: null, metadata: { deleted: true } } });
    });
  });

  describe('plan template name chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'planTemplates', id: 'timed-plan-template' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const name = 'Opening template name';
    const desk = 'Computer template name';
    const phone = 'Phone template name';
    const structure = { introduction: [{ id: 'first', text: 'Keep the first point' }], main: [], conclusion: [] };
    const field = <T,>(value: T) => ({ exists: true, value });
    const seed = () => processCommand(owner, { ...base, operationId: 'template-create', kind: 'create', generation: null,
      value: { userId: owner, name, structure, createdAt: '2026-11-08', updatedAt: '2026-11-08' } });
    const rename = (operationId: string, nextName: string, offset: number | null) => ({
      ...base, operationId, kind: 'update', generation: 'template-create',
      changes: [{ path: ['name'], before: field(name), after: field(nextName) }],
      planTemplateNameAction: { observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([[20, desk], [80, phone]] as const)('orders a delayed rename and keeps the outline (%s)', async (offset, winner) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-name', desk, 40))).kind).toBe('acknowledged');
      const delayed = rename('phone-name', phone, offset);
      const reply = await processCommand(owner, delayed);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { name: winner, structure } } });
      expect(await processCommand(owner, delayed)).toEqual(reply);
      expect(await listPlanTemplateNameHistory(owner, resource.id, 'template-create')).toMatchObject({
        templateId: resource.id, entries: [{ title: winner === desk ? phone : desk, winnerTitle: winner }],
      });
      await expect(listPlanTemplateNameHistory('other-owner', resource.id, 'template-create')).rejects.toMatchObject({ status: 403 });
      await expect(listPlanTemplateNameHistory(owner, resource.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it.each([null, 43])('keeps a comparison when rename timing is uncertain (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-name', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-name', phone, offset))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['name'] }], snapshot: { value: { name: desk, structure } },
      });
    });

    it('saves an offline rename alongside a separately edited outline', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const next = { ...structure, main: [{ id: 'second', text: 'Keep the new point' }] };
      expect((await processCommand(owner, { ...base, operationId: 'outline-edit', kind: 'update', generation: 'template-create',
        changes: [{ path: ['structure'], before: field(structure), after: field(next) }],
      })).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-name', phone, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { name: phone, structure: next } },
      });
    });
  });

  describe('study note tag membership chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'studyNotes', id: 'timed-note-tag' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const tag = 'Alpha tag', independent = 'Independent tag';
    const words = 'The original note words';
    const value = (tags: string[]) => ({ exists: true, value: tags });
    const seed = (tags: string[]) => processCommand(owner, { ...base, operationId: 'tag-note-generation', kind: 'create', generation: null,
      value: { userId: owner, title: 'Note with tags', content: words, type: 'note', tags, scriptureRefs: [], materialIds: [], isDraft: true,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const tagEdit = (operationId: string, name: string, before: boolean, after: boolean, offset: number | null, predecessorOperationId?: string) => ({
      ...base, operationId, kind: 'update', generation: 'tag-note-generation', dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
      changes: [{ path: ['tags'], before: value(before ? [name] : []), after: value(after ? [name] : []) }],
      tagMembershipActions: [{ tag: name, before, after, observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        ...(predecessorOperationId && { predecessorOperationId }) }],
    });

    it.each([
      { opening: false, deskAt: 80, winner: true },
      { opening: true, deskAt: 80, winner: false },
      { opening: false, deskAt: 30, winner: false },
      { opening: true, deskAt: 30, winner: true },
    ])('uses action time for tag membership $opening with the connected edit at $deskAt', async ({ opening, deskAt, winner }) => {
      expect((await seed(opening ? [tag] : [])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', tag, opening, !opening, deskAt))).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, opening, !opening, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, !opening, opening, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: winner ? [tag] : [], content: words } },
      });
    });

    it('orders exact long note tags without duplicating their names in proof metadata', async () => {
      const prefix = 'Shared prefix ' + 'x'.repeat(4096);
      const first = prefix + ' A', second = prefix + ' B';
      expect((await seed([])).kind).toBe('acknowledged');
      const desk = tagEdit('desk-long', first, false, true, 80);
      await expect(processCommand(owner, { ...desk, changes: [{ path: ['tags'], before: value([]), after: value([first, second]) }],
        tagMembershipActions: [...desk.tagMembershipActions, { ...desk.tagMembershipActions[0], tag: second }],
      })).resolves.toMatchObject({ kind: 'acknowledged' });
      await processCommand(owner, tagEdit('phone-first', first, false, true, 15));
      await expect(processCommand(owner, tagEdit('phone-second', first, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [first, second], content: words } },
      });
      expect(JSON.stringify(documents.get('studyNotes/timed-note-tag')?._dataEngine)).not.toContain(prefix);
      await expect(listDocumentTagHistory(owner, resource.collection, resource.id, 'tag-note-generation')).resolves.toMatchObject({
        entries: [{ tags: [{ tag: first, value: false, winnerValue: true }] }],
      });
    });

    it('orders the indexed name of a long document tag without growing the command', async () => {
      const name = 'x'.repeat(550 * 1024);
      const indexedEdit = (...args: Parameters<typeof tagEdit>) => {
        const command = tagEdit(...args);
        const [{ tag: _name, ...action }] = command.tagMembershipActions;
        return { ...command, tagMembershipActions: [{ ...action, tagIndex: 0 }] };
      };
      expect((await seed([])).kind).toBe('acknowledged');
      const desk = indexedEdit('desk-indexed', name, false, true, 80);
      expect(Buffer.byteLength(JSON.stringify(desk))).toBeLessThan(MAX_COMMAND_BYTES);
      await expect(processCommand(owner, desk)).resolves.toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, indexedEdit('phone-indexed-add', name, false, true, 15))).resolves.toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(owner, indexedEdit('phone-indexed-remove', name, true, false, 50, 'phone-indexed-add'));
      expect(result.kind).toBe('acknowledged');
      expect(result.kind === 'acknowledged' && result.snapshot.value?.tags instanceof Array && result.snapshot.value.tags[0] === name).toBe(true);
    });

    it.each([64, 65, 512])('keeps the later note-tag choice and all siblings in a %s-change batch with the contested tag last', async count => {
      const tags = [...Array.from({ length: count - 1 }, (_, index) => 'QA Batch ' + index), tag];
      const desk = tagEdit('desk', tag, false, true, 80);
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...desk, changes: [{ path: ['tags'], before: value([]), after: value(tags) }],
        tagMembershipActions: tags.map(name => ({ ...desk.tagMembershipActions[0], tag: name })) })).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags, content: words } },
      });
    });

    it('replays every exact comparison in a large tag conflict receipt', async () => {
      const names = Array.from({ length: 1500 }, (_, index) => 'Tag ' + index + ' ' + 'x'.repeat(350));
      expect((await seed(names)).kind).toBe('acknowledged');
      const updateTags = (operationId: string, before: string[], after: string[]) => ({
        ...base, operationId, kind: 'update', generation: 'tag-note-generation',
        changes: [{ path: ['tags'], before: value(before), after: value(after) }],
      });
      expect((await processCommand(owner, updateTags('desk-clears', names, []))).kind).toBe('acknowledged');
      expect((await processCommand(owner, updateTags('desk-restores', [], names))).kind).toBe('acknowledged');
      const older = { ...updateTags('phone-removes-batch', names, []), tagMembershipActions: names.map((_name, tagIndex) => ({
        tagIndex, before: true, after: false, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_050, latestMs: 1_800_000_000_055 },
      })) };
      expect(Buffer.byteLength(JSON.stringify(older))).toBeLessThan(MAX_COMMAND_BYTES);
      const result = await processCommand(owner, older);
      expect(result.kind).toBe('conflict');
      if (result.kind !== 'conflict') return;
      expect(result.conflicts).toHaveLength(names.length);
      expect(result.conflicts.at(-1)?.path).toEqual(['tags', 'string:' + names.at(-1)]);
      expect(result.snapshot.value?.tags).toEqual(names);
      await expect(processCommand(owner, older)).resolves.toEqual(result);
    });

    it('replays a tag comparison when the full snapshot and compact choices need separate storage', async () => {
      const names = Array.from({ length: 6000 }, (_, index) => 'N' + index);
      const body = 'x'.repeat(930_000);
      const opened = await processCommand(owner, { ...base, operationId: 'tag-note-generation', kind: 'create', generation: null,
        value: { userId: owner, title: 'A nearly full note', content: body, type: 'note', tags: names, scriptureRefs: [],
          materialIds: [], isDraft: true, createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' },
      });
      expect(opened.kind).toBe('acknowledged');
      const edit = (operationId: string, before: string[], after: string[]) => ({ ...base, operationId, kind: 'update', generation: 'tag-note-generation',
        changes: [{ path: ['tags'], before: value(before), after: value(after) }] });
      expect((await processCommand(owner, edit('desk-clears-nearly-full-note', names, []))).kind).toBe('acknowledged');
      expect((await processCommand(owner, edit('desk-restores-nearly-full-note', [], names))).kind).toBe('acknowledged');
      const older = { ...edit('phone-clears-nearly-full-note', names, []), tagMembershipActions: names.map((_name, tagIndex) => ({
        tagIndex, before: true, after: false, observedRevision: 1, time: { earliestMs: 1_800_000_000_050, latestMs: 1_800_000_000_055 },
      })) };
      expect(Buffer.byteLength(JSON.stringify(older))).toBeLessThan(MAX_COMMAND_BYTES);
      const result = await processCommand(owner, older);
      expect(result.kind).toBe('conflict');
      if (result.kind !== 'conflict') return;
      expect(result.conflicts).toHaveLength(names.length);
      expect(result.snapshot.value?.content === body).toBe(true);
      await expect(processCommand(owner, older)).resolves.toEqual(result);
      const storedParts = [...documents.keys()].filter(key => key.includes('/_tagParts/')).sort();
      expect(storedParts.length).toBeGreaterThan(1);
      storedParts.forEach((key, index) => documents.set(key, { json: index ? '' : JSON.stringify({
        kind: 'conflict', operationId: older.operationId, tagPathRefs: true, conflicts: [],
      }) }));
      await expect(processCommand(owner, older)).rejects.toMatchObject({ code: 'invalid-stored-receipt', status: 409 });
    });

    it('retains all displaced names in a large tag history across bounded entries', async () => {
      const names = ['A', 'B', 'C'].map(prefix => prefix + 'x'.repeat(270_000));
      expect((await seed([])).kind).toBe('acknowledged');
      const updateTags = (operationId: string, before: string[], after: string[], adding: boolean, offset: number) => ({
        ...base, operationId, kind: 'update', generation: 'tag-note-generation',
        changes: [{ path: ['tags'], before: value(before), after: value(after) }],
        tagMembershipActions: names.map((_name, tagIndex) => ({ tagIndex, before: !adding, after: adding, observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        })),
      });
      expect((await processCommand(owner, updateTags('desk-adds-long-tags', [], names, true, 80))).kind).toBe('acknowledged');
      expect((await processCommand(owner, updateTags('phone-removes-long-tags', names, [], false, 50))).kind).toBe('acknowledged');
      const history = await listDocumentTagHistory(owner, resource.collection, resource.id, 'tag-note-generation');
      expect(history.entries.length).toBeGreaterThan(1);
      expect(history.entries.flatMap(entry => entry.tags.map(action => action.tag)).sort()).toEqual(names);
    });

    it('keeps displaced tag decisions visible only to the current document owner and generation', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      await processCommand(owner, tagEdit('desk', tag, false, true, 80));
      await processCommand(owner, tagEdit('phone-first', tag, false, true, 15));
      await processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'));
      await expect(listDocumentTagHistory(owner, resource.collection, resource.id, 'tag-note-generation')).resolves.toMatchObject({
        documentId: resource.id, entries: [{ tags: [{ tag, value: false, winnerValue: true }] }],
      });
      await expect(listDocumentTagHistory('other-owner', resource.collection, resource.id, 'tag-note-generation')).rejects.toMatchObject({ status: 403 });
      await expect(listDocumentTagHistory(owner, resource.collection, resource.id, 'replaced')).rejects.toMatchObject({ status: 404 });
    });

    it('keeps an exact tag choice when the connected decision is unclocked', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', tag, false, true, null))).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['tags', 'string:' + tag] }], snapshot: { value: { tags: [tag], content: words } },
      });
    });

    it('merges independent additions to a legacy note without a stored tag list', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      const key = 'studyNotes/timed-note-tag';
      const { tags: _tags, ...legacy } = documents.get(key)!;
      documents.set(key, legacy);
      const add = (id: string, name: string, offset: number) => ({
        ...tagEdit(id, name, false, true, offset),
        changes: [{ path: ['tags'], before: { exists: false }, after: value([name]) }],
      });
      expect((await processCommand(owner, add('desk', independent, 80))).kind).toBe('acknowledged');
      await expect(processCommand(owner, add('phone-first', tag, 15))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [independent, tag], content: words } },
      });
    });

    it('merges two different ordinary tags', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', independent, false, true, 80))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [independent, tag], content: words } },
      });
    });
  });

  describe('study note title chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'studyNotes', id: 'timed-study-note' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Opening note title';
    const content = 'Retain the original paragraph.';
    const desk = 'Computer title';
    const phone = 'Phone title';
    const field = (value: string) => ({ exists: true, value });
    const seed = () => processCommand(owner, { ...base, operationId: 'note-create', kind: 'create', generation: null,
      value: { userId: owner, title, content, type: 'note', tags: [], scriptureRefs: [], materialIds: [], isDraft: true,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const rename = (operationId: string, nextTitle: string, offset: number | null) => ({
      ...base, operationId, kind: 'update', generation: 'note-create',
      changes: [{ path: ['title'], before: field(title), after: field(nextTitle) }],
      studyNoteTitleAction: { before: field(title), after: field(nextTitle), observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([[20, desk], [80, phone]] as const)('orders a delayed title while retaining note prose (%s)', async (offset, winner) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-title', desk, 40))).kind).toBe('acknowledged');
      const command = rename('phone-title', phone, offset);
      const reply = await processCommand(owner, command);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: winner, content } } });
      expect(await processCommand(owner, command)).toEqual(reply);
      expect(await listStudyNoteTitleHistory(owner, resource.id, 'note-create')).toMatchObject({
        entries: [{ title: winner === desk ? phone : desk, winnerTitle: winner }],
      });
      await expect(listStudyNoteTitleHistory('other-owner', resource.id, 'note-create')).rejects.toMatchObject({ status: 403 });
      await expect(listStudyNoteTitleHistory(owner, resource.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('orders clearing a long title without changing the existing input contract', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const longTitle = 'A'.repeat(2048);
      expect((await processCommand(owner, rename('desk-long', longTitle, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-clear', '', 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: '', content } },
      });
      expect(await listStudyNoteTitleHistory(owner, resource.id, 'note-create')).toMatchObject({
        entries: [{ title: longTitle, winnerTitle: '' }],
      });
    });

    it('orders the title of a legacy note whose original title field was absent', async () => {
      expect((await processCommand(owner, { ...base, operationId: 'note-create', kind: 'create', generation: null,
        value: { userId: owner, content, type: 'note', tags: [], scriptureRefs: [], materialIds: [], isDraft: true,
          createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' },
      })).kind).toBe('acknowledged');
      const firstTitle = (operationId: string, next: string, at: number) => ({
        ...rename(operationId, next, at), changes: [{ path: ['title'], before: { exists: false }, after: field(next) }],
      });
      expect((await processCommand(owner, firstTitle('desk-title', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, firstTitle('phone-title', phone, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: phone, content } },
      });
    });

    it.each([null, 43])('keeps a title choice when the order is unknown (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-title', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-title', phone, offset))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'] }], snapshot: { value: { title: desk, content } },
      });
    });

    it('combines a title with independent new prose without dropping either', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const nextContent = 'Retain the new paragraph.';
      expect((await processCommand(owner, { ...base, operationId: 'desk-prose', kind: 'update', generation: 'note-create',
        changes: [{ path: ['content'], before: field(content), after: field(nextContent) }],
      })).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-title', phone, 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: phone, content: nextContent } },
      });
    });
  });

  describe('prayer tag membership chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'timed-prayer-tag' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const tag = 'Alpha tag', independent = 'Independent tag', description = 'The prayer description remains';
    const update = { id: 'one', text: 'Keep the prayer update', createdAt: '2026-11-08T00:00:00.000Z' };
    const value = (tags: string[]) => ({ exists: true, value: tags });
    const seed = (tags: string[]) => processCommand(owner, { ...base, operationId: 'prayer-tag-generation', kind: 'create', generation: null,
      value: { userId: owner, title: 'Prayer with tags', description, tags, status: 'active', updates: [update],
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const tagEdit = (operationId: string, name: string, before: boolean, after: boolean, offset: number | null, predecessorOperationId?: string) => ({
      ...base, operationId, kind: 'update', generation: 'prayer-tag-generation', dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
      changes: [{ path: ['tags'], before: before ? value([name]) : value([]), after: after ? value([name]) : { exists: false } }],
      tagMembershipActions: [{ tag: name, before, after, observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        ...(predecessorOperationId && { predecessorOperationId }) }],
    });

    it.each([
      { startsPresent: false, deskAt: 80, winner: true },
      { startsPresent: true, deskAt: 80, winner: false },
      { startsPresent: false, deskAt: 30, winner: false },
      { startsPresent: true, deskAt: 30, winner: true },
    ])('uses the later known tag choice when the starting membership is $startsPresent and the computer acts at $deskAt',
      async ({ startsPresent, deskAt, winner }) => {
        expect((await seed(startsPresent ? [tag] : [])).kind).toBe('acknowledged');
        expect((await processCommand(owner, tagEdit('desk', tag, startsPresent, !startsPresent, deskAt))).kind).toBe('acknowledged');
        expect((await processCommand(owner, tagEdit('phone-first', tag, startsPresent, !startsPresent, 15))).kind).toBe('acknowledged');
        const reply = await processCommand(owner, tagEdit('phone-second', tag, !startsPresent, startsPresent, 50, 'phone-first'));
        expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { description, updates: [update], status: 'active' } } });
        expect(reply.kind === 'acknowledged' && (reply.snapshot.value?.tags ?? [])).toEqual(winner ? [tag] : []);
      });

    it('keeps an exact prayer tag choice when the clock cannot establish order', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      await processCommand(owner, tagEdit('desk', tag, false, true, null));
      await processCommand(owner, tagEdit('phone-first', tag, false, true, 15));
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['tags', 'string:' + tag] }], snapshot: { value: { tags: [tag], description } },
      });
    });

    it.each([256, 257])('keeps the later prayer-tag choice when the tag name has %s characters', async length => {
      const name = 'QA ' + 'x'.repeat(length - 3);
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', name, false, true, 80))).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', name, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', name, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [name], description, updates: [update] } },
      });
    });

    it.each([64, 65, 512])('keeps the later prayer-tag choice and all siblings in a %s-change batch with the contested tag last', async count => {
      const tags = [...Array.from({ length: count - 1 }, (_, index) => 'QA Batch ' + index), tag];
      const desk = tagEdit('desk', tag, false, true, 80);
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...desk, changes: [{ path: ['tags'], before: value([]), after: value(tags) }],
        tagMembershipActions: tags.map(name => ({ ...desk.tagMembershipActions[0], tag: name })) })).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags, description, updates: [update] } },
      });
    });

    it('still merges independent prayer tags', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      await processCommand(owner, tagEdit('desk', independent, false, true, 80));
      await expect(processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [independent, tag], description } },
      });
    });
  });

  describe('prayer title chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'timed-prayer' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Opening prayer';
    const description = 'Keep the description';
    const updates = [{ id: 'update-1', text: 'Keep the update', createdAt: '2026-11-08T00:00:00.000Z' }];
    const seed = () => processCommand(owner, { ...base, operationId: 'prayer-create', kind: 'create', generation: null,
      value: { userId: owner, title, description, status: 'active', updates,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const change = (operationId: string, nextTitle: string, offset: number) => ({
      ...base, operationId, kind: 'update', generation: 'prayer-create',
      changes: [{ path: ['title'], before: { exists: true, value: title }, after: { exists: true, value: nextTitle } }],
      prayerTitleAction: { before: title, after: nextTitle, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([20, 80])('orders a delayed prayer rename without touching its other fields (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = 'Computer prayer', phone = 'Phone prayer';
      expect((await processCommand(owner, change('desktop-rename', desk, 40))).kind).toBe('acknowledged');
      const command = change('phone-rename', phone, offset);
      const result = await processCommand(owner, command);
      expect(result).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: offset < 40 ? desk : phone, description, updates, status: 'active' } },
      });
      const list = () => listPrayerTitleHistory(owner, resource.id, 'prayer-create');
      expect(await list()).toMatchObject({
        entries: [{ title: offset < 40 ? phone : desk, winnerTitle: offset < 40 ? desk : phone }],
      });
      expect(await processCommand(owner, command)).toEqual(result);
      expect((await list()).entries).toHaveLength(1);
      await expect(listPrayerTitleHistory('another-owner', resource.id, 'prayer-create')).rejects.toMatchObject({ status: 403 });
      await expect(listPrayerTitleHistory(owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('offers a choice for an unseen title after the opening text was restored elsewhere', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = 'Computer prayer';
      expect((await processCommand(owner, change('desktop-rename', desk, 40))).kind).toBe('acknowledged');
      const restore = change('desktop-restore', title, 70);
      expect((await processCommand(owner, { ...restore,
        changes: [{ path: ['title'], before: { exists: true, value: desk }, after: { exists: true, value: title } }],
        prayerTitleAction: { ...restore.prayerTitleAction, before: desk, observedRevision: 2 },
      })).kind).toBe('acknowledged');
      const phone = change('phone-rename', 'Phone prayer', 20);
      expect(await processCommand(owner, { ...phone, prayerTitleAction: { ...phone.prayerTitleAction, time: null } }))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['title'] }], snapshot: { value: { title, description, updates } } });
    });
  });

  describe('prayer status chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'prayer-status' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Prayer with an earlier answer';
    const answerText = 'Keep this earlier answer exactly.';
    const historicalAt = '2026-10-03T09:00:00.000Z', deskAt = '2026-11-08T08:00:00.000Z', phoneAt = '2026-11-08T10:00:00.000Z';
    const seed = () => processCommand(owner, { ...base, operationId: 'status-seed', kind: 'create', generation: null,
      value: { userId: owner, title, answerText, answeredAt: historicalAt, status: 'active', updates: [],
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const field = (value: string) => ({ exists: true, value });
    const change = (operationId: string, status: 'answered' | 'not_answered', offset: number, answeredAt?: string) => {
      const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return { ...base, operationId, kind: 'update', generation: 'status-seed',
        changes: [{ path: ['status'], before: field('active'), after: field(status) },
          ...(answeredAt ? [{ path: ['answeredAt'], before: field(historicalAt), after: field(answeredAt) }] : [])],
        prayerStatusAction: { before: 'active', after: status, observedRevision: 1, time },
        ...(answeredAt && { prayerAnsweredAtAction: { observedRevision: 1, time } }) };
    };

    it.each([20, 80])('orders opposing marks while keeping written words and answer history (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desk-mark', 'not_answered', 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, change('phone-mark', 'answered', offset, phoneAt))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title, answerText, answeredAt: phoneAt,
          status: offset < 40 ? 'not_answered' : 'answered' } },
      });
      const winner = offset < 40 ? 'not_answered' : 'answered';
      const earlier = offset < 40 ? 'answered' : 'not_answered';
      expect(await listPrayerStatusHistory(owner, resource.id, 'status-seed')).toMatchObject({
        entries: [{ fields: [{ field: 'status', value: earlier, winner }] }],
      });
      await expect(listPrayerStatusHistory('another-owner', resource.id, 'status-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listPrayerStatusHistory(owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
      const restore = change('restore-status', earlier, 120);
      expect(await processCommand(owner, { ...restore,
        changes: [{ path: ['status'], before: field(winner), after: field(earlier) }],
        prayerStatusAction: { ...restore.prayerStatusAction, before: winner, observedRevision: 3 },
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title, answerText, answeredAt: phoneAt, status: earlier } } });
    });

    it.each([20, 80])('orders the answer date when two marks choose the same status (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desk-answer', 'answered', 40, deskAt))).kind).toBe('acknowledged');
      const command = change('phone-answer', 'answered', offset, phoneAt);
      const result = await processCommand(owner, command);
      expect(result).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title, answerText, status: 'answered', answeredAt: offset < 40 ? deskAt : phoneAt } },
      });
      expect(await processCommand(owner, command)).toEqual(result);
      expect(await listPrayerStatusHistory(owner, resource.id, 'status-seed')).toMatchObject({
        entries: [{ fields: [{ field: 'answeredAt', value: offset < 40 ? phoneAt : deskAt, winner: offset < 40 ? deskAt : phoneAt }] }],
      });
    });

    it('retains the manual choice for distinct words even when the status and date can be ordered', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const answer = (id: string, text: string, offset: number, date: string) => {
        const mark = change(id, 'answered', offset, date);
        return { ...mark, changes: [...mark.changes, { path: ['answerText'], before: field(answerText), after: field(text) }] };
      };
      expect((await processCommand(owner, answer('desk-words', 'Computer answer', 40, deskAt))).kind).toBe('acknowledged');
      expect(await processCommand(owner, answer('phone-words', 'Phone answer', 80, phoneAt))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['answerText'] }],
        snapshot: { value: { title, status: 'answered', answerText: 'Computer answer', answeredAt: deskAt } },
      });
      expect((await listPrayerStatusHistory(owner, resource.id, 'status-seed')).entries).toHaveLength(0);
    });
  });

  describe('series metadata chronology', () => {
    const resource = { collection: 'series', id: 'timed-series' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const original = { userId: base.owner, title: 'Opening title', theme: 'Legacy theme', bookOrTopic: 'Opening book',
      status: 'draft', color: '#3B82F6', description: 'Keep the full description', sermonIds: [], items: [], seriesKind: 'sermon',
      createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' };
    const desk = { title: 'Desk title', theme: 'Desk title', bookOrTopic: 'Desk book', status: 'active', color: '#10B981' };
    const phone = { title: 'Phone title', theme: 'Phone title', bookOrTopic: 'Phone book', status: 'completed', color: '#F59E0B' };
    const edit = (id: string, value: Partial<typeof desk>, offset: number | null) => ({
      ...base, kind: 'update', operationId: id, generation: 'series-seed',
      changes: Object.entries(value).map(([key, next]) => ({
        path: [key], before: { exists: true, value: original[key as keyof typeof desk] }, after: { exists: true, value: next },
      })),
      seriesFieldActions: Object.fromEntries(Object.keys(value).filter(field => field !== 'theme').map(field => [field, {
        observedRevision: 1, time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
      }])),
    });
    const seed = () => processCommand(base.owner, { ...base, operationId: 'series-seed', kind: 'create', generation: null, value: original });

    it.each([
      { offset: 20, winning: desk },
      { offset: 80, winning: phone },
    ])('keeps short fields and the title mirror from the last action when delivery is delayed ($offset)', async ({ offset, winning }) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', desk, 40))).kind).toBe('acknowledged');
      const command = edit('series-phone', phone, offset);
      const result = await processCommand(base.owner, command);
      expect(result).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { ...winning, description: original.description, items: [], sermonIds: [] } },
      });
      const lost = winning === desk ? phone : desk;
      const expected = (['title', 'bookOrTopic', 'status', 'color'] as const).map(field => ({ field, value: lost[field], winner: winning[field] }));
      const history = () => listSeriesMetadataHistory(base.owner, resource.id, 'series-seed');
      expect(await history()).toMatchObject({ entries: [{ fields: expected }] });
      await expect(listSeriesMetadataHistory('other-owner', resource.id, 'series-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSeriesMetadataHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, command)).toEqual(result);
      expect((await history()).entries).toHaveLength(1);
    });

    it('orders a later custom CSS color and retains a displaced absence for restoration', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const deskColor = edit('series-desk', { color: desk.color }, 40);
      expect((await processCommand(base.owner, { ...deskColor, changes: [{
        path: ['color'], before: { exists: true, value: original.color }, after: { exists: false },
      }] })).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { color: 'rebeccapurple' }, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { color: 'rebeccapurple' } },
      });
      expect(await listSeriesMetadataHistory(base.owner, resource.id, 'series-seed')).toMatchObject({
        entries: [{ fields: [{ field: 'color', value: null, winner: 'rebeccapurple' }] }],
      });
    });

    it('preserves the title mirror when the later rename originally matched the legacy theme', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      const rename = edit('series-phone', { title: original.theme }, 80);
      const time = { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_085 };
      expect(await processCommand(base.owner, { ...rename, seriesFieldActions: {
        title: { observedRevision: 1, time, openingTheme: original.theme },
      } })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: original.theme, theme: original.theme } } });
    });

    it('does not order a separate legacy theme edit by the time of a title rename', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, { ...edit('series-old-theme', { theme: 'Independent legacy theme' }, null),
        changes: [{ path: ['theme'], before: { exists: true, value: desk.theme }, after: { exists: true, value: 'Independent legacy theme' } }],
      })).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { title: phone.title, theme: phone.theme }, 80))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['theme'] }],
        snapshot: { value: { title: desk.title, theme: 'Independent legacy theme' } },
      });
      expect((await listSeriesMetadataHistory(base.owner, resource.id, 'series-seed')).entries).toEqual([]);
    });

    it.each([45, null])('keeps the original status conflict when the action order is uncertain (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const earlier = edit('series-desk', { status: desk.status }, 40);
      expect((await processCommand(base.owner, earlier)).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { status: phone.status }, offset))).toMatchObject({
        kind: 'conflict', snapshot: { value: { status: desk.status, theme: original.theme } }, conflicts: [{ path: ['status'] }],
      });
    });

    it('keeps independent metadata edits from different devices', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { status: phone.status }, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: desk.title, theme: desk.theme, status: phone.status } },
      });
    });
  });

  describe('sermon preparation goal type chronology', () => {
    const opening = { preachingGoal: { type: 'informative', statement: 'Keep this goal sentence' } };
    const preparation = (type: string, statement = opening.preachingGoal.statement) => ({
      ...opening, preachingGoal: { type, statement },
    });
    function savePreparation(operationId: string, after: typeof opening, offset?: number) {
      return {
        ...update(operationId, 'prep-goal-seed'),
        changes: [{ path: ['preparation'], before: { exists: true, value: opening }, after: { exists: true, value: after } }],
        ...(offset === undefined ? {} : {
          sermonGoalTypeAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
        }),
      };
    }
    async function seed() {
      const command = create('prep-goal-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: opening } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    it.each([
      { phoneAt: 20, winner: 'exhortative' },
      { phoneAt: 80, winner: 'didactic' },
    ])('keeps the known later choice when the offline choice was saved at $phoneAt', async ({ phoneAt, winner }) => {
      const owner = await seed();
      expect(await processCommand(owner, savePreparation('desk', preparation('exhortative'), 40)))
        .toMatchObject({ kind: 'acknowledged' });
      const phone = savePreparation('phone', preparation('didactic'), phoneAt);
      const result = await processCommand(owner, phone);
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation(winner) } } });
      const history = () => listSermonGoalTypeHistory(owner, resource.id, 'prep-goal-seed');
      const previous = winner === 'didactic' ? 'exhortative' : 'didactic';
      expect(await history()).toMatchObject({ entries: [{ type: previous, winnerType: winner }], nextCursor: null });
      expect(await processCommand(owner, phone)).toEqual(result);
      expect((await history()).entries).toHaveLength(1);
    });

    it('retains the clock across a separate sentence save and keeps that sentence', async () => {
      const owner = await seed();
      const first = preparation('exhortative');
      const words = 'A later independently edited goal sentence';
      expect(await processCommand(owner, savePreparation('desk', first, 40))).toMatchObject({ kind: 'acknowledged' });
      const sentence = savePreparation('sentence', preparation('exhortative', words));
      sentence.changes[0].before.value = first;
      expect(await processCommand(owner, sentence)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePreparation('phone', preparation('didactic'), 80)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation('didactic', words) } } });
      await expect(listSermonGoalTypeHistory('another-owner', resource.id, 'prep-goal-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSermonGoalTypeHistory(owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('keeps the ordinary conflict when the order cannot be proven', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePreparation('desk', preparation('exhortative'), 40)))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePreparation('phone', preparation('didactic')))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'preachingGoal', 'type'] }],
      });
    });

    it('merges the separate goal sentence with the selected type', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePreparation('desk', preparation('informative', 'A separately edited sentence'))))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePreparation('phone', preparation('didactic'), 20)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation('didactic', 'A separately edited sentence') } } });
    });
  });

  describe('exegetical plan point removal and title chronology', () => {
    const point = { id: 'point', title: 'Original point' };
    const edited = { ...point, title: 'Revised point' };
    const neighbor = { id: 'neighbor', title: 'Independent point' };
    const revisedNeighbor = { ...neighbor, title: 'Revised independent point' };
    const preparation = (exegeticalPlan: typeof point[]) => ({ exegeticalPlan, authorIntent: 'Keep the author’s intent' });
    const opening = preparation([point, neighbor]);

    async function seed() {
      const command = create('exegetical-chronology-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: opening } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    function savePoint(kind: 'remove' | 'title' | 'sibling', offset: number | null) {
      const time = offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      const nodes = kind === 'remove' ? [neighbor] : kind === 'sibling' ? [point, revisedNeighbor] : [edited, neighbor];
      return {
        ...update('exegetical-' + kind, 'exegetical-chronology-seed'),
        changes: [{
          path: ['preparation'], before: { exists: true, value: opening },
          after: { exists: true, value: preparation(nodes) },
        }],
        exegeticalPlanActions: [{ nodeId: kind === 'sibling' ? neighbor.id : point.id,
          kind: kind === 'remove' ? 'remove' : 'title', observedRevision: 1, time }],
      };
    }

    it.each([
      { first: 'remove', second: 'title', firstAt: 25, secondAt: 80, expected: [edited, neighbor] },
      { first: 'title', second: 'remove', firstAt: 80, secondAt: 25, expected: [edited, neighbor] },
      { first: 'title', second: 'remove', firstAt: 25, secondAt: 80, expected: [neighbor] },
      { first: 'remove', second: 'title', firstAt: 80, secondAt: 25, expected: [neighbor] },
    ] as const)('keeps the later point intent when $first at $firstAt is delivered before $second at $secondAt',
      async ({ first, second, firstAt, secondAt, expected }) => {
        const owner = await seed();
        expect(await processCommand(owner, savePoint(first, firstAt))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, savePoint(second, secondAt))).toMatchObject({
          kind: 'acknowledged', snapshot: { value: { preparation: preparation([...expected]) } },
        });
      });

    it('keeps a later explicit return to the opening title over an older delayed removal', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('title', 40))).toMatchObject({ kind: 'acknowledged' });
      const returnToOpening = savePoint('title', 80);
      expect(await processCommand(owner, {
        ...returnToOpening, operationId: 'exegetical-title-return',
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: opening } }],
        exegeticalPlanActions: [{ ...returnToOpening.exegeticalPlanActions[0], observedRevision: 2 }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePoint('remove', 25))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: opening } },
      });
    });

    it('accepts removal of the exact point title saved by its own preceding request without a clock', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('title', null))).toMatchObject({ kind: 'acknowledged' });
      const remove = savePoint('remove', null);
      expect(await processCommand(owner, {
        ...remove, dependsOn: ['exegetical-title'],
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: preparation([neighbor]) } }],
        exegeticalPlanActions: [{ ...remove.exegeticalPlanActions[0], predecessorOperationId: 'exegetical-title' }],
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation([neighbor]) } } });
    });

    it('stores the displaced words for the same owner and generation when an older edit arrives after removal', async () => {
      const owner = await seed();
      await processCommand(owner, savePoint('remove', 80));
      await processCommand(owner, savePoint('title', 25));
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        owner, generation: 'exegetical-chronology-seed',
        entries: [{ nodeId: point.id, value: { point: edited, ancestors: [] }, winner: null }],
      });
      await expect(listExegeticalPointHistory('other-owner', resource.id, 'exegetical-chronology-seed')).rejects.toThrow();
      await expect(listExegeticalPointHistory(owner, resource.id, 'previous-generation')).rejects.toThrow();
    });

    it('compares only the affected point when the order of an edit and a removal is unknown', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('title', 80))).toMatchObject({ kind: 'acknowledged' });
      const remove = savePoint('remove', null);
      expect(await processCommand(owner, remove)).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'exegeticalPlan', 'id:point'] }],
      });
      const reviewedRemoval = { ...update('exegetical-reviewed-removal', 'exegetical-chronology-seed'),
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: preparation([neighbor]) } }] };
      expect(await processCommand(owner, reviewedRemoval)).toMatchObject({ kind: 'acknowledged' });
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        entries: [{ nodeId: point.id, value: { point: edited }, origin: 'comparison' }],
      });
    });

    it('preserves the point text even when the same command has another conflicting field', async () => {
      const owner = await seed();
      const withSermonTitle = (kind: 'title' | 'remove', title: string) => {
        const command = savePoint(kind, null);
        return { ...command, changes: [...command.changes, { path: ['title'], before: { exists: true, value: 'First' },
          after: { exists: true, value: title } }] };
      };
      expect(await processCommand(owner, withSermonTitle('title', 'Desk sermon title'))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, withSermonTitle('remove', 'Phone sermon title'))).toMatchObject({
        kind: 'conflict', conflicts: expect.arrayContaining([
          expect.objectContaining({ path: ['preparation', 'exegeticalPlan', 'id:point'] }),
          expect.objectContaining({ path: ['title'] }),
        ]),
      });
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        entries: [{ nodeId: point.id, value: { point: edited }, origin: 'comparison' }],
      });
    });

    it('merges a point removal and an independent sibling title edit', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('sibling', 80))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePoint('remove', 25))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: preparation([revisedNeighbor]) } },
      });
    });
  });

  describe('ordinary thought tag membership chronology', () => {
    const date = '2026-11-08T00:00:00.000Z';
    const alpha = 'Alpha tag', beta = 'Beta tag';
    const words = 'The original thought stays';
    const thought = (tags: string[]) => ({ id: 'tagged', date, text: words, tags: ['main', ...tags] });
    const neighbor = { id: 'neighbor', date, text: 'The independent thought stays', tags: ['main'] };

    async function seed(present = false) {
      const command = create('thought-tag-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, thoughts: [thought(present ? [alpha] : []), neighbor] } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    function saveTag(operationId: string, tag: string, before: boolean, after: boolean, offset: number | null,
      predecessorOperationId?: string) {
      const time = offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return {
        ...update(operationId, 'thought-tag-seed'),
        dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['thoughts'], before: { exists: true, value: [thought(before ? [tag] : []), neighbor] },
          after: { exists: true, value: [thought(after ? [tag] : []), neighbor] } }],
        thoughtTagActions: [{ rowId: 'tagged', rowCreatedAt: date, tag, before, after, observedRevision: 1, time,
          ...(predecessorOperationId && { predecessorOperationId }) }],
      };
    }

    it.each([
      { startsPresent: false, deskAt: 80, winner: true },
      { startsPresent: true, deskAt: 80, winner: false },
      { startsPresent: false, deskAt: 30, winner: false },
      { startsPresent: true, deskAt: 30, winner: true },
    ])('uses the later same-tag choice when the starting membership is $startsPresent and the desk acts at $deskAt',
      async ({ startsPresent, deskAt, winner }) => {
        const owner = await seed(startsPresent);
        expect(await processCommand(owner, saveTag('desk', alpha, startsPresent, !startsPresent, deskAt))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveTag('phone-first', alpha, startsPresent, !startsPresent, 15))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveTag('phone-second', alpha, !startsPresent, startsPresent, 50, 'phone-first')))
          .toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: [thought(winner ? [alpha] : []), neighbor] } } });
      });

    it.each([256, 257])('keeps the latest ordinary thought tag and its history for a %s-character name', async length => {
      const tag = 'QA ' + 'x'.repeat(length - 3);
      const owner = await seed();
      expect(await processCommand(owner, saveTag('desk', tag, false, true, 80))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', tag, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, saveTag('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought([tag]), neighbor] } },
      });
      await expect(listThoughtTagHistory(owner, 'sermon-1', 'thought-tag-seed')).resolves.toMatchObject({
        entries: [{ fields: [{ rowId: 'tagged', field: tag, value: false, winnerValue: true }] }],
      });
    });

    it('orders the indexed name of a long thought tag on the exact thought row', async () => {
      const name = 'x'.repeat(2048);
      const owner = await seed();
      const indexedSave = (...args: Parameters<typeof saveTag>) => {
        const command = saveTag(...args);
        const [{ tag: _name, ...action }] = command.thoughtTagActions;
        return { ...command, thoughtTagActions: [{ ...action, tagIndex: 1 }] };
      };
      await expect(processCommand(owner, indexedSave('desk-indexed', name, false, true, 80))).resolves.toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, indexedSave('phone-indexed-add', name, false, true, 15))).resolves.toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, indexedSave('phone-indexed-remove', name, true, false, 50, 'phone-indexed-add'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought([name]), neighbor] } },
      });
    });

    it.each([64, 65, 512])('keeps the latest ordinary thought tag and its siblings after a %s-change batch with the contested tag last', async count => {
      const tags = [...Array.from({ length: count - 1 }, (_, index) => 'QA Batch ' + index), alpha];
      const owner = await seed();
      const desk = saveTag('desk', alpha, false, true, 80);
      expect(await processCommand(owner, { ...desk, changes: [{ path: ['thoughts'],
        before: { exists: true, value: [thought([]), neighbor] }, after: { exists: true, value: [thought(tags), neighbor] } }],
        thoughtTagActions: tags.map(tag => ({ ...desk.thoughtTagActions[0], tag })) })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', alpha, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, saveTag('phone-second', alpha, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought(tags), neighbor] } },
      });
    });

    it('stores the displaced membership under its thought and tag for the owner only', async () => {
      const owner = await seed();
      await processCommand(owner, saveTag('desk', alpha, false, true, 80));
      await processCommand(owner, saveTag('phone-first', alpha, false, true, 15));
      await processCommand(owner, saveTag('phone-second', alpha, true, false, 50, 'phone-first'));
      await expect(listThoughtTagHistory(owner, 'sermon-1', 'thought-tag-seed')).resolves.toMatchObject({
        owner, generation: 'thought-tag-seed', entries: [{ fields: [{ rowId: 'tagged', rowCreatedAt: date,
          field: alpha, value: false, winnerValue: true }] }],
      });
      await expect(listThoughtTagHistory('another-owner', 'sermon-1', 'thought-tag-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listThoughtTagHistory(owner, 'sermon-1', 'other-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('does not let a replaced thought inherit the old tag action', async () => {
      const owner = await seed();
      const base = update('replacement', 'thought-tag-seed');
      const replaced = { ...thought([]), date: '2026-11-09T00:00:00.000Z' };
      expect(await processCommand(owner, { ...base, changes: [{ path: ['thoughts'],
        before: { exists: true, value: [thought([]), neighbor] }, after: { exists: true, value: [replaced, neighbor] },
      }] })).toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, saveTag('phone-old', alpha, false, true, 50))).resolves.toMatchObject({
        kind: 'conflict', snapshot: { value: { thoughts: [replaced, neighbor] } },
      });
    });

    it('keeps the exact tag choice available when its competing saved action has no reliable time', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveTag('desk', alpha, false, true, null))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', alpha, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-second', alpha, true, false, 50, 'phone-first'))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['thoughts', 'id:tagged', 'tags', 'string:' + alpha] }],
      });
    });

    it('merges different ordinary tags and keeps the same thought text and section', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveTag('desk', beta, false, true, 80))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', alpha, false, true, 15))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought([beta, alpha]), neighbor] } },
      });
    });
  });

  describe('sermon preparation confirmation chronology', () => {
    const fields = {
      prayer: { section: 'spiritual', key: 'readAndPrayedConfirmed' },
      book: { section: 'textContext', key: 'readWholeBookOnceConfirmed' },
    } as const;
    const opening = { spiritual: { readAndPrayedConfirmed: false }, textContext: { readWholeBookOnceConfirmed: false },
      preachingGoal: { type: 'informative', statement: 'Keep these preparation words' } };
    const preparation = (field: keyof typeof fields, checked: boolean) => {
      const { section, key } = fields[field];
      return { ...opening, [section]: { [key]: checked } };
    };
    function saveConfirmation(operationId: string, field: keyof typeof fields, before: boolean, after: boolean,
      offset: number | null, predecessorOperationId?: string) {
      const time = offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return {
        ...update(operationId, 'prep-check-seed'),
        dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation(field, before) },
          after: { exists: true, value: preparation(field, after) } }],
        sermonPreparationCheckActions: { [fields[field].key]: {
          observedRevision: 1, time, ...(predecessorOperationId && { predecessorOperationId }),
        } },
      };
    }
    async function seed() {
      const command = create('prep-check-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: opening } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    it.each([
      { field: 'prayer', deskAt: 80, winner: true },
      { field: 'book', deskAt: 80, winner: true },
      { field: 'prayer', deskAt: 30, winner: false },
      { field: 'book', deskAt: 30, winner: false },
    ] as const)('keeps the known last $field choice when two offline actions arrive after the desk action at $deskAt',
      async ({ field, deskAt, winner }) => {
        const owner = await seed();
        expect(await processCommand(owner, saveConfirmation('desk', field, false, true, deskAt))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveConfirmation('phone-on', field, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveConfirmation('phone-off', field, true, false, 50, 'phone-on')))
          .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation(field, winner) } } });
      });

    it('recovers the displaced setting only for its owner and sermon generation', async () => {
      const owner = await seed();
      await processCommand(owner, saveConfirmation('desk', 'book', false, true, 80));
      await processCommand(owner, saveConfirmation('phone-on', 'book', false, true, 15));
      await processCommand(owner, saveConfirmation('phone-off', 'book', true, false, 50, 'phone-on'));
      await expect(listSermonPreparationConfirmationHistory(owner, create('prep-check-seed').resource.id, 'prep-check-seed')).resolves.toMatchObject({
        owner, generation: 'prep-check-seed', entries: [{ fields: [{ field: 'readWholeBookOnceConfirmed', value: false, winner: true }] }],
      });
      await expect(listSermonPreparationConfirmationHistory('another-owner', create('prep-check-seed').resource.id, 'prep-check-seed')).rejects.toThrow();
      await expect(listSermonPreparationConfirmationHistory(owner, create('prep-check-seed').resource.id, 'previous-generation')).rejects.toThrow();
    });

    it('asks about the exact checkbox if the matching stored value has an unknown action time', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveConfirmation('desk', 'book', false, true, null))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveConfirmation('phone-on', 'book', false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveConfirmation('phone-off', 'book', true, false, 50, 'phone-on')))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'textContext', 'readWholeBookOnceConfirmed'] }] });
    });

    it('merges different confirmations without disturbing the sentence', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveConfirmation('desk', 'book', false, true, 45))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveConfirmation('phone-on', 'prayer', false, true, 15)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: {
          ...opening, spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true },
        } } } });
    });
  });

  describe('sermon church chronology', () => {
    const originalChurch = { id: 'opening', name: 'Opening church', city: 'Opening city' };
    const deskChurch = { id: 'desk', name: 'Desk church', city: 'Desk city' };
    const phoneChurch = { id: 'phone', name: 'Phone church', city: 'Phone city' };
    const field = (church: typeof originalChurch | null): FieldValue => church
      ? { exists: true, value: church } : { exists: false };

    it.each([
      { opening: originalChurch, desk: deskChurch, phone: phoneChurch, offset: 20, winner: deskChurch, loser: phoneChurch },
      { opening: originalChurch, desk: deskChurch, phone: phoneChurch, offset: 80, winner: phoneChurch, loser: deskChurch },
      { opening: originalChurch, desk: deskChurch, phone: null, offset: 80, winner: null, loser: deskChurch },
      { opening: originalChurch, desk: null, phone: phoneChurch, offset: 80, winner: phoneChurch, loser: null },
      { opening: null, desk: deskChurch, phone: phoneChurch, offset: 80, winner: phoneChurch, loser: deskChurch },
    ])('keeps the complete winner after delayed delivery at $offset ($opening / $desk / $phone)', async scenario => {
      const seed = create('sermon-church-seed') as Extract<DataCommand, { kind: 'create' }>;
      const notes = 'Notes on a separately named date';
      const preachDates = [{ id: 'date', date: '2099-04-10', church: { id: 'calendar', name: 'Calendar only', city: 'Calendar city' },
        status: 'planned', notes, createdAt: '2099-01-01T00:00:00.000Z' }];
      const value = { ...seed.value, preachDates };
      if (scenario.opening) Object.assign(value, { church: scenario.opening });
      expect((await processCommand(seed.owner, { ...seed, value })).kind).toBe('acknowledged');
      const edit = (operationId: string, chosen: typeof originalChurch | null, offset: number) => ({
        ...update(operationId, 'sermon-church-seed'),
        changes: [{ path: ['church'], before: field(scenario.opening), after: field(chosen) }],
        sermonChurchAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
      });
      expect((await processCommand(seed.owner, edit('desk', scenario.desk, 40))).kind).toBe('acknowledged');
      const request = edit('phone', scenario.phone, scenario.offset);
      const result = await processCommand(seed.owner, request);
      expect(result.kind).toBe('acknowledged');
      const stored = documents.get('sermons/sermon-1');
      expect(stored?.church).toEqual(scenario.winner ?? undefined);
      expect(stored?.preachDates).toEqual(preachDates);
      const history = () => [...documents.entries()].filter(([path]) => path.startsWith('sermons/sermon-1/_churchHistory/'));
      expect(history()).toHaveLength(1);
      expect(history()[0][1]).toMatchObject({ church: scenario.loser, winnerChurch: scenario.winner, generation: 'sermon-church-seed' });
      expect(await listSermonChurchHistory(seed.owner, seed.resource.id, 'sermon-church-seed')).toMatchObject({
        entries: [{ church: scenario.loser, winnerChurch: scenario.winner }],
      });
      await expect(listSermonChurchHistory('another-owner', seed.resource.id, 'sermon-church-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSermonChurchHistory(seed.owner, seed.resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(seed.owner, request)).toEqual(result);
      expect(history()).toHaveLength(1);
    });

    it.each([
      { explicitChurch: false, phoneAt: 20, winner: deskChurch },
      { explicitChurch: true, phoneAt: 20, winner: deskChurch },
      { explicitChurch: true, phoneAt: 80, winner: phoneChurch },
    ])('applies a planned fill only while its date is unnamed and the church choice wins ($explicitChurch / $phoneAt)',
      async ({ explicitChurch, phoneAt, winner }) => {
        const seed = create('sermon-church-projection') as Extract<DataCommand, { kind: 'create' }>;
        const unnamed = { id: 'church-unspecified', name: 'Church not specified', city: '' };
        const calendarChurch = { id: 'calendar', name: 'Calendar only', city: 'Calendar city' };
        const row = { id: 'date', date: '2099-04-10', church: unnamed,
          status: 'planned', notes: 'Keep this note', createdAt: '2099-01-01T00:00:00.000Z' };
        const dateChurch = explicitChurch ? calendarChurch : unnamed;
        expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch, preachDates: [row] } })).kind)
          .toBe('acknowledged');
        const change = (operationId: string, chosen: typeof originalChurch, offset: number) => ({
          ...update(operationId, 'sermon-church-projection'),
          changes: [{ path: ['church'], before: field(originalChurch), after: field(chosen) }],
          sermonChurchAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
        });
        const dates = (after: typeof row) => ({ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [after] } });
        const desk = change('desk', deskChurch, 40);
        expect((await processCommand(seed.owner, { ...desk, changes: explicitChurch
          ? [...desk.changes, dates({ ...row, church: calendarChurch })] : desk.changes })).kind).toBe('acknowledged');
        const phone = change('phone', phoneChurch, phoneAt);
        expect(await processCommand(seed.owner, { ...phone,
          changes: [...phone.changes, dates({ ...row, church: phoneChurch })],
          sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: phoneChurch },
        })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { church: winner, preachDates: [{ ...row, church: dateChurch }] } } });
      });

    it.each([true, false])('moves a date even when its inferred church is stale ($explicitChurch)', async explicitChurch => {
      const seed = create('sermon-date-church-projection') as Extract<DataCommand, { kind: 'create' }>;
      const unnamed = { id: 'church-unspecified', name: 'Church not specified', city: '' };
      const row = { id: 'date', date: '2099-04-10', church: unnamed, status: 'planned', notes: 'Keep notes',
        createdAt: '2099-01-01T00:00:00.000Z' };
      const nextDate = '2099-04-20';
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch, preachDates: [row] } })).kind)
        .toBe('acknowledged');
      const dates = (after: typeof row) => ({ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [after] } });
      const deskChanges = explicitChurch ? [dates({ ...row, church: deskChurch })]
        : [{ path: ['church'], before: field(originalChurch), after: field(deskChurch) }];
      expect((await processCommand(seed.owner, { ...update('desk', 'sermon-date-church-projection'), changes: deskChanges })).kind).toBe('acknowledged');
      const phone = {
        ...update('phone', 'sermon-date-church-projection'), changes: [dates({ ...row, date: nextDate, church: originalChurch })],
        sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: originalChurch },
      };
      expect(await processCommand(seed.owner, phone)).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
        church: explicitChurch ? originalChurch : deskChurch,
        preachDates: [{ ...row, date: nextDate, church: explicitChurch ? deskChurch : unnamed }],
      } } });
    });

    it.each([deskChurch, null])('creates the new date with the current church when the observed sermon choice has since changed (%j)', async latest => {
      const seed = create('sermon-new-date-church') as Extract<DataCommand, { kind: 'create' }>;
      const row = { id: 'date', date: '2099-04-10', church: originalChurch, status: 'planned', createdAt: '2099-01-01T00:00:00.000Z' };
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch, preachDates: [] } })).kind)
        .toBe('acknowledged');
      expect((await processCommand(seed.owner, { ...update('desk', 'sermon-new-date-church'),
        changes: [{ path: ['church'], before: field(originalChurch), after: field(latest) }],
      })).kind).toBe('acknowledged');
      const phone = {
        ...update('phone', 'sermon-new-date-church'),
        changes: [{ path: ['preachDates'], before: { exists: true, value: [] }, after: { exists: true, value: [row] } }],
        sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: originalChurch },
      };
      expect(await processCommand(seed.owner, phone)).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
        preachDates: [{ ...row, church: latest ?? { id: 'church-unspecified', name: 'Church not specified', city: '' } }],
      } } });
    });

    it('retains the two whole churches when the action intervals overlap', async () => {
      const seed = create('sermon-church-uncertain') as Extract<DataCommand, { kind: 'create' }>;
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch } })).kind).toBe('acknowledged');
      const edit = (operationId: string, chosen: typeof originalChurch, offset: number) => ({
        ...update(operationId, 'sermon-church-uncertain'),
        changes: [{ path: ['church'], before: field(originalChurch), after: field(chosen) }],
        sermonChurchAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_010_000 + offset } },
      });
      // Each changes different properties, but a different church must not inherit the other version's city.
      const desk = { ...originalChurch, city: 'Desk city' };
      const phone = { ...phoneChurch, city: originalChurch.city };
      expect((await processCommand(seed.owner, edit('desk', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(seed.owner, edit('phone', phone, 45))).toMatchObject({
        kind: 'conflict', snapshot: { value: { church: desk } },
        conflicts: [{ path: ['church'], base: field(originalChurch), mine: field(phone), theirs: field(desk) }],
      });
      expect([...documents.keys()].filter(path => path.includes('/_churchHistory/'))).toEqual([]);
    });
  });

  it('retains competing free text after a remote return to the opening passage', async () => {
    const seed = create('sermon-verse-return') as Extract<DataCommand, { kind: 'create' }>;
    const verse = 'John 3:16';
    const quote = 'Ephesians 2:8 — ' + 'A note from preparation. '.repeat(300);
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, verse } })).kind).toBe('acknowledged');
    const edit = (id: string, before: string, after: string, observedRevision: number, offset: number) =>
      processCommand('owner-1', { ...update(id, 'sermon-verse-return'),
        changes: [{ path: ['verse'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        sermonVerseAction: { observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_001 + offset } },
      });
    expect((await edit('desk-first', verse, quote, 1, 40)).kind).toBe('acknowledged');
    const metadata = documents.get('sermons/sermon-1')?._dataEngine;
    expect(metadata).toMatchObject({ sermonVerse: { digest: expect.stringMatching(/^[a-zA-Z0-9_-]{43}$/) } });
    expect(JSON.stringify(metadata)).not.toContain(quote);
    expect((await edit('desk-return', quote, verse, 2, 60)).kind).toBe('acknowledged');
    const phone = 'Romans 8:1 — My other note';
    expect(await edit('late-phone', verse, phone, 1, 80)).toMatchObject({
      kind: 'conflict', snapshot: { value: { verse } },
      conflicts: [{ path: ['verse'], mine: { value: phone }, theirs: { value: verse } }],
    });
    expect((await listSermonVerseHistory('owner-1', resource.id, 'sermon-verse-return')).entries).toEqual([]);
  });

  it.each([
    { offset: 20, outcome: 'acknowledged', title: 'Desk title', displaced: 'Phone title' },
    { offset: 80, outcome: 'acknowledged', title: 'Phone title', displaced: 'Desk title' },
    { offset: 45, outcome: 'conflict', title: 'Desk title', displaced: null },
    { offset: null, outcome: 'conflict', title: 'Desk title', displaced: null },
  ] as const)('uses action order for a sermon title delivered later with offset $offset', async ({ offset, outcome, title, displaced }) => {
    const seed = create('sermon-title-seed') as Extract<DataCommand, { kind: 'create' }>;
    const original = { ...seed.value, title: 'Opening title', verse: 'John 1:1' };
    expect((await processCommand('owner-1', { ...seed, value: original })).kind).toBe('acknowledged');
    const rename = (id: string, next: string, at: number | null, verse?: string) => ({
      ...update(id, 'sermon-title-seed'),
      changes: [
        { path: ['title'], before: { exists: true, value: original.title }, after: { exists: true, value: next } },
        ...(verse ? [{ path: ['verse'], before: { exists: true, value: original.verse }, after: { exists: true, value: verse } }] : []),
      ],
      sermonTitleAction: { before: original.title, after: next, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
    });
    expect((await processCommand('owner-1', rename('desk', 'Desk title', 40, 'John 3:16'))).kind).toBe('acknowledged');
    const incoming = rename('phone', 'Phone title', offset);
    const answer = await processCommand('owner-1', incoming);
    expect(answer).toMatchObject({ kind: outcome, snapshot: { value: { title, verse: 'John 3:16' } } });
    if (outcome === 'conflict') expect(answer).toMatchObject({ conflicts: [{ path: ['title'] }] });
    const history = () => [...documents.entries()].filter(([path]) => path.startsWith('sermons/sermon-1/_titleHistory/'));
    expect(history()).toHaveLength(displaced ? 1 : 0);
    if (displaced) {
      expect(history()[0][1]).toMatchObject({ title: displaced, winnerTitle: title, generation: 'sermon-title-seed' });
      expect(await listSermonTitleHistory('owner-1', resource.id, 'sermon-title-seed')).toMatchObject({
        owner: 'owner-1', sermonId: resource.id, entries: [{ title: displaced, winnerTitle: title }],
      });
      await expect(listSermonTitleHistory('other-owner', resource.id, 'sermon-title-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSermonTitleHistory('owner-1', resource.id, 'older-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand('owner-1', incoming)).toEqual(answer);
      expect(history()).toHaveLength(1);
    }
  });

  it.each(['actual local change', 'same-value acknowledgement', 'remote round trip'] as const)(
    'keeps unclocked sermon title evidence scoped to the %s', async scenario => {
      const seed = create('title-chain') as Extract<DataCommand, { kind: 'create' }>;
      const value = { ...seed.value, title: 'Opening' };
      expect((await processCommand('owner-1', { ...seed, value })).kind).toBe('acknowledged');
      const change = (id: string, before: string, after: string, observedRevision = 1, predecessorOperationId?: string) =>
        processCommand('owner-1', {
          ...update(id, 'title-chain'), dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
          changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
          sermonTitleAction: { before, after, observedRevision, time: null, ...(predecessorOperationId && { predecessorOperationId }) },
        });
      if (scenario === 'remote round trip') {
        expect((await change('desk-first', 'Opening', 'Middle')).kind).toBe('acknowledged');
        expect((await change('desk-return', 'Middle', 'Opening', 2)).kind).toBe('acknowledged');
        expect(await change('late-phone', 'Opening', 'Phone')).toMatchObject({
          kind: 'conflict', conflicts: [{ path: ['title'] }], snapshot: { value: { title: 'Opening' } },
        });
      } else {
        const sameValue = scenario === 'same-value acknowledgement';
        if (sameValue) expect((await change('desk', 'Opening', 'Middle')).kind).toBe('acknowledged');
        expect((await change('phone-first', 'Opening', 'Middle')).kind).toBe('acknowledged');
        expect(await change('phone-second', 'Middle', 'Opening', 1, 'phone-first')).toMatchObject({
          kind: sameValue ? 'conflict' : 'acknowledged', snapshot: { value: { title: sameValue ? 'Middle' : 'Opening' } },
        });
      }
      expect((await listSermonTitleHistory('owner-1', resource.id, 'title-chain')).entries).toEqual([]);
    });

  it('does not invent a title edit when removing a legacy series mirror from an older sermon', async () => {
    const now = '2026-11-08T00:00:00.000Z';
    const original = { userId: 'owner-1', title: 'Opening', verse: 'John 1:1', date: now, thoughts: [], seriesId: 'old-series', seriesPosition: 1 };
    documents.set('sermons/sermon-1', { ...original, _dataEngine: { protocol: 1, generation: 'old-sermon', revision: 3, deleted: false } });
    const series = { userId: 'owner-1', title: 'Old series', items: [] };
    documents.set('series/old-series', series);
    const deletion = await processCommand('owner-1', {
      protocol: 1, operationId: 'remove-series', owner: 'owner-1', resource: { collection: 'series', id: 'old-series' },
      kind: 'delete', generation: null, dependsOn: [], baseline: series,
    });
    expect(deletion).toMatchObject({ kind: 'acknowledged', relatedSnapshots: [{
      resource, metadata: { revision: 4 }, value: { title: original.title, seriesId: null },
    }] });
    const renamed = await processCommand('owner-1', { ...update('rename-old-sermon', 'old-sermon'),
      changes: [{ path: ['title'], before: { exists: true, value: original.title }, after: { exists: true, value: 'Revised' } }],
      sermonTitleAction: { before: original.title, after: 'Revised', observedRevision: 3, time: null },
    });
    expect(renamed).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Revised', seriesId: null } } });
  });

  it.each([
    { scenario: 'earlier offline title', offset: 20, title: 'Phone', winner: 'Desk', archived: 'Phone', kind: 'acknowledged' },
    { scenario: 'later offline title', offset: 60, title: 'Phone', winner: 'Phone', archived: 'Desk', kind: 'acknowledged' },
    { scenario: 'overlapping time', offset: 45, title: 'Phone', winner: 'Desk', archived: null, kind: 'conflict' },
    { scenario: 'independent description', offset: 20, title: 'Phone', winner: 'Phone', archived: null, kind: 'acknowledged' },
  ])('orders only the exact group title: $scenario', async ({ scenario, offset, title, winner, archived, kind }) => {
    const resource = { collection: 'groups', id: 'group-title' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original', description: 'Original description', status: 'draft',
      templates: [], flow: [], meetingDates: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, key: 'title' | 'description', after: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: [key], before: { exists: true, value: value[key] }, after: { exists: true, value: after } }],
    });
    const rename = (operationId: string, after: string, offsetMs: number) => ({
      ...update(operationId, 'title', after),
      groupTitleAction: { before: value.title, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offsetMs, latestMs: 1_800_000_000_010 + offsetMs } },
    });
    const adjacent = scenario === 'independent description';
    expect((await processCommand(base.owner, adjacent ? update('desk', 'description', 'Desk notes') : rename('desk', 'Desk', 40))).kind).toBe('acknowledged');
    const phone = rename('phone', title, offset);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind, snapshot: { value: { title: winner, description: adjacent ? 'Desk notes' : value.description,
      status: 'draft', meetingDates: [] } } });
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-title/_titleHistory/'));
    expect(history).toHaveLength(archived === null ? 0 : 1);
    if (archived !== null) {
      expect(history[0][1]).toMatchObject({ title: archived, winnerTitle: winner, generation: 'seed' });
      expect(await listGroupTitleHistory(base.owner, resource.id, 'seed')).toMatchObject({
        owner: base.owner, groupId: resource.id, generation: 'seed', entries: [{ title: archived, winnerTitle: winner }],
      });
      await expect(listGroupTitleHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listGroupTitleHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, phone)).toEqual(result);
      expect([...documents.keys()].filter(path => path.startsWith('groups/group-title/_titleHistory/'))).toHaveLength(1);
    }
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['title'] }] });
  });

  it.each([
    { arrival: 'earlier', offset: 20, bodyOnly: false, winner: 'Computer title', kind: 'acknowledged', archived: 'Phone title' },
    { arrival: 'later', offset: 60, bodyOnly: false, winner: 'Phone title', kind: 'acknowledged', archived: 'Computer title' },
    { arrival: 'overlap', offset: 43, bodyOnly: false, winner: 'Computer title', kind: 'conflict', archived: null },
    { arrival: 'adjacent step', offset: 20, bodyOnly: true, winner: 'Phone title', kind: 'acknowledged', archived: null },
  ])('keeps the correct service order title when the queued action was $arrival', async ({ offset, bodyOnly, winner, kind, archived }) => {
    const order = { collection: 'serviceOrders', id: 'chronology-order' };
    const base = { protocol: 1, owner: 'owner-1', resource: order, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const original = { title: 'Starting title', rank: 100, steps: [{ id: 'open', title: 'Opening', body: 'Original words' }] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'order-seed', generation: null,
      value: { userId: base.owner, ...original, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');

    const rename = (operationId: string, title: string, offsetMs: number) => ({
      ...base, kind: 'update', operationId, generation: 'order-seed',
      changes: [{ path: ['title'], before: { exists: true, value: original.title }, after: { exists: true, value: title } }],
      serviceOrderTitleAction: { before: original.title, after: title, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offsetMs, latestMs: 1_800_000_000_010 + offsetMs } },
    });
    const computer = bodyOnly ? { ...base, kind: 'update', operationId: 'computer', generation: 'order-seed',
      changes: [{ path: ['steps'], before: { exists: true, value: original.steps },
        after: { exists: true, value: [{ ...original.steps[0], body: 'Changed paragraph' }] } }],
    } : rename('computer', 'Computer title', 40);
    expect((await processCommand(base.owner, computer)).kind).toBe('acknowledged');
    const phone = rename('phone', 'Phone title', offset);
    expect(await processCommand(base.owner, phone)).toMatchObject({
      kind, snapshot: { value: { title: winner, steps: [{ body: bodyOnly ? 'Changed paragraph' : 'Original words' }] } },
    });
    const history = () => [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/chronology-order/_titleHistory/'));
    if (archived) {
      expect(history()).toHaveLength(1);
      expect(history()[0][1]).toMatchObject({ title: archived, winnerTitle: winner, generation: 'order-seed' });
      expect(await listServiceOrderTitleHistory(base.owner, order.id, 'order-seed')).toMatchObject({
        owner: base.owner, orderId: order.id, generation: 'order-seed',
        entries: [{ title: archived, winnerTitle: winner }],
      });
      await expect(listServiceOrderTitleHistory('another-owner', order.id, 'order-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderTitleHistory(base.owner, order.id, 'older-generation')).rejects.toMatchObject({ status: 404 });
      expect((await processCommand(base.owner, phone)).kind).toBe('acknowledged');
      expect(history()).toHaveLength(1);
    } else expect(history()).toHaveLength(0);
  });

  it('retains a title conflict when unstamped edits returned the title to its original value', async () => {
    const resource = { collection: 'serviceOrders', id: 'title-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const initialTitle = 'Original title';
    const changedTitle = 'Temporary title';
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: initialTitle, rank: 100, steps: [], createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const rename = (operationId: string, before: string, after: string) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    expect((await processCommand(base.owner, rename('change', initialTitle, changedTitle))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, rename('return', changedTitle, initialTitle))).kind).toBe('acknowledged');
    const delayed = 'Delayed title';
    expect(await processCommand(base.owner, { ...rename('delayed', initialTitle, delayed),
      serviceOrderTitleAction: { before: initialTitle, after: delayed, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } },
    })).toMatchObject({ kind: 'conflict', snapshot: { value: { title: initialTitle } }, conflicts: [{ path: ['title'] }] });
    expect((await listServiceOrderTitleHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([
    { arrival: 'earlier', delayedOffset: 10, word: 2, winner: '0-0-yellow,2-2-blue' },
    { arrival: 'later', delayedOffset: 70, word: 2, winner: '0-0-yellow,2-2-red' },
    { arrival: 'overlap', delayedOffset: 43, word: 2, winner: '0-0-yellow,2-2-blue' },
    { arrival: 'different word', delayedOffset: 10, word: 3, winner: '0-0-yellow,2-2-blue,3-3-red' },
  ])('uses the action order for a delayed Bible mark: $arrival', async ({ arrival, delayedOffset, word, winner }) => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const start = { v1_1: { m: '0-0-yellow' } };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const stamp = '2026-11-08T00:00:00.000Z';
    const created = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'marks-seed', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: start, createdAt: stamp, updatedAt: stamp },
    });
    expect(created.kind).toBe('acknowledged');
    if (created.kind !== 'acknowledged') return;
    const save = (operationId: string, run: string, offset: number) => ({
      ...base, kind: 'update', operationId, generation: 'marks-seed',
      changes: [{ path: ['verses'], before: { exists: true, value: start }, after: { exists: true, value: { v1_1: { m: '0-0-yellow,' + run } } } }],
      bibleMarkStroke: { observedRevision: created.snapshot.metadata!.revision,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } },
    });
    expect((await processCommand(base.owner, save('blue-arrives-first', '2-2-blue', 40))).kind).toBe('acknowledged');
    const red = save('red-arrives-last', word + '-' + word + '-red', delayedOffset);
    const answer = await processCommand(base.owner, red);
    const history = () => [...documents.entries()].filter(([key]) => key.startsWith('bibleMarks/owner-1_kjv_philemon/_markHistory/'));
    expect(answer).toMatchObject({ kind: arrival === 'overlap' ? 'conflict' : 'acknowledged', snapshot: { value: { verses: { v1_1: { m: winner } } } } });
    const ordered = arrival === 'earlier' || arrival === 'later';
    expect(history()).toHaveLength(ordered ? 1 : 0);
    if (ordered) {
      const page = await listBibleMarkHistory(base.owner, book.id, 'marks-seed');
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0].marks).toEqual([expect.objectContaining({ verse: 'v1_1', layer: 'm', first: 2, last: 2,
        colour: arrival === 'later' ? 'blue' : 'red', winnerColour: arrival === 'later' ? 'red' : 'blue' })]);
      await expect(listBibleMarkHistory('another-owner', book.id, 'marks-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listBibleMarkHistory(base.owner, book.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
      expect((await processCommand(base.owner, red)).kind).toBe('acknowledged');
      expect(history()).toHaveLength(1);
    }
  });

  it.each(['earlier', 'later'] as const)('carries the %s first stroke through a logical empty ancestor', async order => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const time = (offset: number) => ({ observedRevision: 0, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } });
    const stamp = '2026-11-08T00:00:00.000Z';
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'first-stroke', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: { v1_1: { p: '2-2-blue' } }, createdAt: stamp, updatedAt: stamp },
      bibleMarkStroke: time(40),
    })).kind).toBe('acknowledged');
    const answer = await processCommand(base.owner, { ...base, kind: 'update', operationId: 'second-delivery', generation: 'first-stroke',
      changes: [{ path: ['verses'], before: { exists: true, value: { v1_1: {} } }, after: { exists: true, value: { v1_1: { p: '2-2-red' } } } }],
      bibleMarkStroke: time(order === 'earlier' ? 20 : 60),
    });
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { verses: { v1_1: { p: order === 'earlier' ? '2-2-blue' : '2-2-red' } } } } });
  });

  it('orders only the overlapping word of a delayed erasure and retains the pencil layer', async () => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const time = (offset: number) => ({ observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } });
    const stamp = '2026-11-08T00:00:00.000Z';
    const original = { v1_1: { m: '2-4-red', p: '2-4-gray' } };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'erase-book', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: original, createdAt: stamp, updatedAt: stamp },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, value: unknown, offset: number) => processCommand(base.owner, { ...base, kind: 'update',
      operationId, generation: 'erase-book', changes: [{ path: ['verses'], before: { exists: true, value: original }, after: { exists: true, value } }],
      bibleMarkStroke: time(offset),
    });
    expect((await edit('blue-word', { v1_1: { m: '2-2-red,3-3-blue,4-4-red', p: '2-4-gray' } }, 40)).kind).toBe('acknowledged');
    expect(await edit('older-erase', { v1_1: { p: '2-4-gray' } }, 20)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { verses: { v1_1: { m: '3-3-blue', p: '2-4-gray' } } } },
    });
    const page = await listBibleMarkHistory(base.owner, book.id, 'erase-book');
    expect(page.entries[0].marks).toEqual([expect.objectContaining({ first: 3, last: 3, colour: null, winnerColour: 'blue' })]);
  });

  it.each(['stamped', 'unstamped'] as const)('keeps a choice when unstamped edits returned a word to its old colour after a %s create', async initial => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const time = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    const stamp = '2026-11-08T00:00:00.000Z';
    const original = { v1_1: { m: '2-2-blue' } };
    const created = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'legacy-aba', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: original, createdAt: stamp, updatedAt: stamp },
      ...(initial === 'stamped' && { bibleMarkStroke: { observedRevision: 0, time } }),
    });
    expect(created.kind).toBe('acknowledged');
    const edit = (operationId: string, before: unknown, after: unknown, bibleMarkStroke?: { observedRevision: number; time: typeof time }) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'legacy-aba',
        changes: [{ path: ['verses'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        ...(bibleMarkStroke && { bibleMarkStroke }),
      });
    const alternate = { v1_1: { m: '2-2-green' } };
    expect((await edit('legacy-alternate', original, alternate)).kind).toBe('acknowledged');
    const conflict = await edit('stale-during-alternate', original, { v1_1: { m: '2-2-red' } }, { observedRevision: 1, time });
    expect(conflict.kind).toBe('conflict');
    expect((await edit('legacy-return', alternate, original)).kind).toBe('acknowledged');
    const delayed = await edit('stale-after-return', original, { v1_1: { m: '2-2-red' } }, { observedRevision: 1, time });
    expect(delayed).toMatchObject({ kind: 'conflict', snapshot: { value: { verses: original } } });
    expect((await listBibleMarkHistory(base.owner, book.id, 'legacy-aba')).entries).toEqual([]);
  });

  it.each([
    { name: 'many strokes in other verses', bulk: false },
    { name: 'an oversized write resets proof coverage', bulk: true },
  ])('protects the newer mark after $name', async ({ bulk }) => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const stamp = '2026-11-08T00:00:00.000Z';
    const original: Record<string, { m: string }> = { v1_1: { m: '2-2-blue' } };
    const created = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'capacity-book', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: original, createdAt: stamp, updatedAt: stamp },
    });
    expect(created.kind).toBe('acknowledged');
    const edit = (operationId: string, before: unknown, after: unknown, observedRevision: number, offset: number) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'capacity-book',
        changes: [{ path: ['verses'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        bibleMarkStroke: { observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_001 + offset } },
      });
    const alternate = { v1_1: { m: '2-2-green' } };
    expect((await edit('alternate', original, alternate, 1, 50)).kind).toBe('acknowledged');
    expect((await edit('return-blue', alternate, original, 2, 60)).kind).toBe('acknowledged');
    let verses = original;
    for (let batch = 0; batch < 3; batch++) {
      const added = Object.fromEntries(Array.from({ length: 44 }, (_, index) => ['v' + (batch + 2) + '_' + (index + 1), { m: '0-0-orange' }]));
      const next = { ...verses, ...added };
      expect((await edit('bulk-' + batch, verses, next, batch + 3, 70 + batch * 10)).kind).toBe('acknowledged');
      verses = next;
    }
    if (bulk) {
      const added = Object.fromEntries(Array.from({ length: 65 }, (_, index) => ['v10_' + (index + 1), { m: '0-0-yellow' }]));
      const next = { ...verses, ...added };
      expect((await edit('oversized', verses, next, 6, 105)).kind).toBe('acknowledged');
      verses = next;
    }
    const answer = await edit('old-red', original, { v1_1: { m: '2-2-red' } }, 1, 40);
    expect(answer).toMatchObject({ kind: bulk ? 'conflict' : 'acknowledged', snapshot: { value: { verses } } });
    const page = await listBibleMarkHistory(base.owner, book.id, 'capacity-book');
    if (bulk) expect(page.entries).toEqual([]);
    else expect(page.entries[0].marks).toEqual([expect.objectContaining({ verse: 'v1_1', colour: 'red', winnerColour: 'blue' })]);
  });

  it.each(['earlier', 'later', 'overlap', 'legacy'] as const)('handles a late-delivered %s date action and preserves the displaced date only when ordering is certain', async arrival => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church', city: 'City' }, audience: 'Original' };
    const seed = create('chronology-seed') as Extract<DataCommand, { kind: 'create' }>;
    const created = await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } });
    expect(created.kind).toBe('acknowledged');
    if (created.kind !== 'acknowledged') return;
    const save = (operationId: string, date: string, earliestMs: number) => ({
      protocol: 1, operationId, owner: 'owner-1', resource, generation: 'chronology-seed', dependsOn: [], kind: 'update',
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [{ ...row, date }] } }],
      preachDateAction: { rowId: 'date', before: row.date, after: date, observedRevision: created.snapshot.metadata!.revision,
        time: { earliestMs, latestMs: earliestMs + 10 } },
    });
    const baseMs = 1_800_000_000_000;
    const initialSave = save('first-arrival', '2026-12-20', baseMs - 50);
    const { preachDateAction: _action, ...legacySave } = initialSave;
    const first = await processCommand('owner-1', arrival === 'legacy' ? legacySave : initialSave);
    expect(first.kind).toBe('acknowledged');
    if (arrival === 'legacy') {
      expect((await processCommand('owner-1', save('already-satisfied', '2026-12-20', baseMs - 70))).kind).toBe('acknowledged');
    }
    const delayed = save('late-arrival', '2026-12-27', baseMs - { earlier: 90, later: 20, overlap: 45, legacy: 20 }[arrival]);
    const answer = await processCommand('owner-1', delayed);
    const history = () => [...documents.entries()].filter(([key]) => key.startsWith('sermons/sermon-1/_preachDateHistory/'));
    if (arrival === 'overlap' || arrival === 'legacy') {
      expect(answer.kind).toBe('conflict');
      expect(history()).toHaveLength(0);
      return;
    }
    const winner = arrival === 'earlier' ? '2026-12-20' : '2026-12-27';
    const loser = arrival === 'earlier' ? '2026-12-27' : '2026-12-20';
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preachDates: [{ date: winner, audience: 'Original' }] } } });
    expect(history()).toHaveLength(1);
    expect(history()[0][1]).toMatchObject({ rowId: 'date', date: loser, winnerDate: winner, generation: 'chronology-seed' });
    expect(await listPreachDateHistory('owner-1', resource.id, 'chronology-seed')).toMatchObject({
      owner: 'owner-1', sermonId: resource.id, generation: 'chronology-seed', entries: [{ date: loser, winnerDate: winner }], nextCursor: null,
    });
    await expect(listPreachDateHistory('other-owner', resource.id, 'chronology-seed')).rejects.toMatchObject({ status: 403 });
    await expect(listPreachDateHistory('owner-1', resource.id, 'different-generation')).rejects.toMatchObject({ status: 404 });
    expect((await processCommand('owner-1', delayed)).kind).toBe('acknowledged');
    expect(history()).toHaveLength(1);
  });

  it.each([[20, '2026-12-13'], [80, '2026-12-13'], [80, '2026-12-13T00:00:00.000Z']] as const)(
    'orders clearing the planned day at offset %i from %s without losing the row or its notes', async (clearAt, originalDay) => {
    const row = { id: 'date', date: originalDay, status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church' }, notes: 'Keep my preparation' };
    const other = { ...row, id: 'another', date: '2027-01-01' };
    const seed = create('date-clear-seed') as Extract<DataCommand, { kind: 'create' }>;
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row, other] } })).kind).toBe('acknowledged');
    const edit = (operationId: string, date: string, offset: number) => processCommand('owner-1', {
      ...update(operationId, 'date-clear-seed'),
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row, other] },
        after: { exists: true, value: [{ ...row, date }, other] } }],
      preachDateAction: { rowId: row.id, before: row.date, after: date, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } },
    });
    expect((await edit('desktop', '2026-12-20', 50)).kind).toBe('acknowledged');
    const expected = clearAt > 50 ? '' : '2026-12-20';
    const earlier = clearAt > 50 ? '2026-12-20' : '';
    expect(await edit('phone', '', clearAt)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { preachDates: [{ ...row, date: expected }, other] } },
    });
    expect(await listPreachDateHistory('owner-1', resource.id, 'date-clear-seed')).toMatchObject({
      entries: [{ rowId: row.id, date: earlier, winnerDate: expected }],
    });
  });

  it.each(['clear', 'mark'] as const)('reports the exact day conflict when a %s arrives after the other action', async late => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church' }, notes: 'Keep the note' };
    const seed = create('date-mark-race') as Extract<DataCommand, { kind: 'create' }>;
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } })).kind).toBe('acknowledged');
    const cleared = { ...row, date: '' }, recorded = { ...row, status: 'preached' };
    const edit = (operationId: string, next: typeof row) => processCommand('owner-1', {
      ...update(operationId, 'date-mark-race'),
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [next] } }],
    });
    const stored = late === 'clear' ? recorded : cleared;
    const mine = late === 'clear' ? cleared : recorded;
    expect((await edit('first', stored)).kind).toBe('acknowledged');
    expect(await edit('second', mine)).toMatchObject({ kind: 'conflict',
      snapshot: { value: { preachDates: [stored] } },
      conflicts: [{ path: ['preachDates', 'id:date', 'date'],
        base: { exists: true, value: row.date }, mine: { exists: true, value: mine.date }, theirs: { exists: true, value: stored.date } }],
    });
  });

  it('keeps a later explicit return to the original date over an older queued change from that original', async () => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church', city: 'City' } };
    const seed = create('chronology-aba') as Extract<DataCommand, { kind: 'create' }>;
    const created = await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } });
    expect(created.kind).toBe('acknowledged');
    const save = (operationId: string, before: string, after: string, observedRevision: number, offset: number) =>
      processCommand('owner-1', { ...update(operationId, 'chronology-aba'),
        changes: [{ path: ['preachDates'], before: { exists: true, value: [{ ...row, date: before }] }, after: { exists: true, value: [{ ...row, date: after }] } }],
        preachDateAction: { rowId: row.id, before, after, observedRevision,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
      });
    expect((await save('change', row.date, '2026-12-20', 1, 20)).kind).toBe('acknowledged');
    expect((await save('return', '2026-12-20', row.date, 2, 40)).kind).toBe('acknowledged');
    expect(await save('late', row.date, '2026-12-27', 1, 10)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { preachDates: [{ date: row.date }] } },
    });
    expect(await listPreachDateHistory('owner-1', resource.id, 'chronology-aba')).toMatchObject({
      entries: [{ date: '2026-12-27', winnerDate: row.date }],
    });
  });

  it('pairs only a requested sermon list sample with the Firestore query read time', async () => {
    expect(await listDocuments('owner-1', 'sermons', { actionClockChallenge: 'fresh' })).toMatchObject({
      snapshots: [], actionClock: { challenge: 'fresh', serverMs: 1_800_000_000_123 },
    });
    expect(await listDocuments('owner-1', 'sermons')).not.toHaveProperty('actionClock');
    expect(await listDocuments('owner-1', 'studyNotes', { actionClockChallenge: 'fresh' })).toMatchObject({
      actionClock: { challenge: 'fresh', serverMs: 1_800_000_000_123 },
    });
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
    it('tells a reader whether legacy writers may still change an optional collection unseen', async () => {
      // `prayerCategories` is registered but opt-in; users is engine-owned.
      documents.set('prayerCategories/category-1', { userId: 'owner-1', name: 'Mine' });
      // Served by the engine, legacy still open: a legacy write raises no feed event, so the
      // reader must be told the feed alone is not the whole truth.
      delete process.env.DATA_ENGINE_ENABLED;
      delete process.env.DATA_ENGINE_CLOSED_COLLECTIONS;
      process.env.DATA_ENGINE_COLLECTIONS = 'prayerCategories';
      expect(await listDocuments('owner-1', 'prayerCategories')).toMatchObject({ legacyOpen: true });
      expect(await readCollectionChanges('owner-1', 'prayerCategories', 0)).toMatchObject({ legacyOpen: true });
      // Closed — the LAST switch of a rollout: from here on the feed is the whole truth.
      process.env.DATA_ENGINE_CLOSED_COLLECTIONS = 'prayerCategories';
      expect(await listDocuments('owner-1', 'prayerCategories')).not.toHaveProperty('legacyOpen');
      expect(await readCollectionChanges('owner-1', 'prayerCategories', 0)).not.toHaveProperty('legacyOpen');
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

describe('share capability receipt replay', () => {
  const owner = 'owner-1';
  const notePath = 'studyNotes/share-note';
  const createLink = (id: string): DataCommand => {
    const observed = documents.get(notePath)?._dataEngine as ResourceSnapshot['metadata'] | undefined;
    return { protocol: 1, owner, operationId: `share-create-${id}`,
    resource: { collection: 'studyNoteShareLinks', id }, generation: null, dependsOn: [], kind: 'relation',
      relation: 'share-link-create', note: { id: 'share-note', generation: observed?.generation ?? null,
        shareRevocation: observed?.shareRevocation ?? null }, authorLanguage: 'en',
    };
  };
  const revokeLink = (id: string, generation: string, operationId = `share-revoke-${id}`): DataCommand => ({ protocol: 1, owner, operationId,
    resource: { collection: 'studyNoteShareLinks', id }, generation, dependsOn: [], kind: 'relation', relation: 'share-link-revoke',
  } as unknown as DataCommand);
  const active = () => [...documents.entries()].filter(([path, value]) => path.startsWith('studyNoteShareLinks/') && value.ownerId === owner && !(value._dataEngine as { deleted?: boolean } | undefined)?.deleted);
  beforeEach(() => { documents.set(notePath, { userId: owner, content: 'Keep the authored note' }); });

  it('replays the original creation after revocation without issuing any new capability', async () => {
    const first = createLink('first');
    const before = structuredClone(documents.get(notePath));
    const created = await processCommand(owner, first);
    expect(created.kind).toBe('acknowledged');
    expect(active()).toHaveLength(1);
    expect(await processCommand(owner, revokeLink('first', first.operationId))).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    const replayed = await processCommand(owner, first);
    expect(replayed).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } }, committed: { operationId: first.operationId, deleted: false } });
    expect(active()).toEqual([]);
    expect(documents.get(notePath)).toMatchObject({ ...before, _dataEngine: { shareRevocation: 'share-revoke-first' } });
    expect(documents.get(notePath)).not.toHaveProperty('updatedAt');
    expect(receipts()).toHaveLength(2);
  });

  it('keeps an alias receipt revoked while allowing a new explicit create', async () => {
    const first = createLink('first');
    await processCommand(owner, first);
    const oldToken = active()[0][1].token;
    const alias = createLink('second');
    expect(await processCommand(owner, alias)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null },
      affected: [{ resource: first.resource, metadata: { operationId: alias.operationId } }] });
    expect(active()).toHaveLength(1);
    await processCommand(owner, revokeLink('first', first.operationId));
    expect(await processCommand(owner, alias)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null },
      relatedSnapshots: [{ resource: first.resource, value: null, metadata: { deleted: true } }] });
    expect(active()).toEqual([]);
    expect((await processCommand(owner, createLink('third'))).kind).toBe('acknowledged');
    expect(active()).toHaveLength(1);
    expect(active()[0][1].token).not.toBe(oldToken);
    await processCommand(owner, revokeLink('first', first.operationId, 'later-old-link-revoke'));
    expect(active()[0][0]).toBe('studyNoteShareLinks/third');
  });

  it('serializes two different create actions to one active capability and keeps both receipts', async () => {
    const results = await Promise.all([processCommand(owner, createLink('one')), processCommand(owner, createLink('two'))]);
    expect(results.map(result => result.kind)).toEqual(['acknowledged', 'acknowledged']);
    expect(active()).toHaveLength(1);
    expect(receipts()).toHaveLength(2);
  });

  it('rejects the older first delivery and keeps its refusal after the note is edited', async () => {
    const held = createLink('held');
    const current = createLink('current');
    expect((await processCommand(owner, current)).kind).toBe('acknowledged');
    expect((await processCommand(owner, revokeLink('current', current.operationId))).kind).toBe('acknowledged');
    const refusal = await processCommand(owner, held);
    expect(refusal).toMatchObject({ kind: 'refused', code: 'share-link-review-required' });
    expect(active()).toEqual([]);
    const stored = documents.get(notePath)!;
    const metadata = stored._dataEngine as NonNullable<ResourceSnapshot['metadata']>;
    expect(await processCommand(owner, { protocol: 1, owner, operationId: 'edit-shared-note',
      resource: { collection: 'studyNotes', id: 'share-note' }, generation: metadata.generation, dependsOn: [], kind: 'update',
      changes: [{ path: ['content'], before: { exists: true, value: stored.content }, after: { exists: true, value: 'Edited after revoke' } }],
    })).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { shareRevocation: 'share-revoke-current' } } });
    expect(await processCommand(owner, held)).toEqual(refusal);
    expect((await processCommand(owner, createLink('explicit'))).kind).toBe('acknowledged');
    expect(active()).toHaveLength(1);
  });

  it('retains both revocation effects in the canonical receipt', async () => {
    const create = createLink('first');
    await processCommand(owner, create);
    const revoke = revokeLink('first', create.operationId);
    const result = await processCommand(owner, revoke);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    expect(documents.get(notePath)?._dataEngine).toMatchObject({ shareRevocation: revoke.operationId });
    expect(active()).toEqual([]);
    for (const ack of [result, await processCommand(owner, revoke)]) expect(ack).toMatchObject({
      relatedSnapshots: [{ resource: { collection: 'studyNotes', id: 'share-note' }, metadata: { shareRevocation: revoke.operationId } }],
    });
  });

  it('keeps the same operation identity immutable across create and revoke', async () => {
    const create = createLink('first');
    await processCommand(owner, create);
    await expect(processCommand(owner, { ...revokeLink('first', create.operationId), operationId: create.operationId }))
      .resolves.toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    expect(active()).toHaveLength(1);
  });
});

describe('public share-link view counter projection', () => {
  it('advances the owned snapshot revision and change feed when a public view increments the counter', async () => {
    const owner = 'owner-1';
    const id = 'view-counter-link';
    const collection = 'studyNoteShareLinks';
    const resource = { collection, id };
    const headPath = `${HEADS_COLLECTION}/${collectionHeadId(owner, collection)}`;
    documents.set(`${collection}/${id}`, {
      ownerId: owner, noteId: 'note-1', token: 'public-view-token', createdAt: '2026-10-01T00:00:00.000Z', viewCount: 0,
      _dataEngine: { protocol: 1, generation: 'create-view-counter-link', revision: 1, deleted: false, operationId: 'create-view-counter-link' },
    });
    documents.set(headPath, {
      userId: owner, collection, version: 1,
      _dataEngine: { protocol: 1, generation: collectionHeadId(owner, collection), revision: 2, deleted: false, operationId: 'create-view-counter-link' },
    });
    documents.set(`${headPath}/changes/${sequenceId(1)}`, { resource, version: 1 });

    const before = await readDocument(owner, resource);
    const beforeFeed = await readCollectionChanges(owner, collection, 0);
    expect(before).toMatchObject({ value: { viewCount: 0 }, metadata: { revision: 1 } });
    expect(beforeFeed).toMatchObject({ version: 1, cursor: 1, snapshots: [{ value: { viewCount: 0 }, metadata: { revision: 1 } }] });

    await recordSharedNoteView(id, 'public-view-token');

    expect(await readDocument(owner, resource)).toMatchObject({ value: { viewCount: 1 }, metadata: { revision: 2 } });
    expect(await readCollectionChanges(owner, collection, beforeFeed.cursor)).toMatchObject({
      version: 2, cursor: 2, snapshots: [{ resource, value: { viewCount: 1 }, metadata: { revision: 2 } }],
    });
  });
  it.each(['missing', 'deleted', 'revoked', 'wrong-token'] as const)('does not count or publish a %s capability', async variant => {
    const raw = { ownerId: 'owner-1', noteId: 'note', token: 'token', createdAt: 'created', viewCount: 3,
      ...(variant === 'revoked' ? { revoked: true } : {}),
      _dataEngine: { protocol: 1, generation: 'creation', revision: 1, deleted: variant === 'deleted' } };
    if (variant !== 'missing') documents.set('studyNoteShareLinks/control', raw);
    const before = structuredClone([...documents.entries()]);
    await recordSharedNoteView('control', variant === 'wrong-token' ? 'another-token' : 'token');
    expect([...documents.entries()]).toEqual(before);
  });

  it('commits count and feed together, preserving the permanent token, note and generation', async () => {
    const owner = 'owner-1', collection = 'studyNoteShareLinks';
    documents.set(`${collection}/counter`, { ownerId: owner, noteId: 'note', token: 'token', createdAt: 'created', viewCount: 0,
      _dataEngine: { protocol: 1, generation: 'creation', revision: 1, deleted: false } });
    await Promise.all([recordSharedNoteView('counter', 'token'), recordSharedNoteView('counter', 'token')]);
    expect(await readDocument(owner, { collection, id: 'counter' })).toMatchObject({
      value: { viewCount: 2, token: 'token', noteId: 'note', createdAt: 'created' }, metadata: { generation: 'creation', revision: 3 } });
    expect(await readCollectionChanges(owner, collection, 0)).toMatchObject({ version: 2, snapshots: [{ value: { viewCount: 2 } }] });
    expect(receipts()).toHaveLength(0);
    const before = structuredClone([...documents.entries()]); failCommit = true;
    await expect(recordSharedNoteView('counter', 'token')).rejects.toThrow('Commit failed');
    expect([...documents.entries()]).toEqual(before);
  });

  it('keeps an exact legacy revocation valid after counting adds the first protocol marker', async () => {
    const owner = 'owner-1', resource = { collection: 'studyNoteShareLinks', id: 'legacy-counter' };
    documents.set('studyNoteShareLinks/legacy-counter', { ownerId: owner, noteId: 'note', token: 'token', createdAt: 'created', viewCount: 0 });
    await recordSharedNoteView(resource.id, 'token');
    expect(await processCommand(owner, { protocol: 1, owner, operationId: 'revoke-legacy-counter', resource, generation: null,
      dependsOn: [], kind: 'relation', relation: 'share-link-revoke' })).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    const before = structuredClone([...documents.entries()]);
    await recordSharedNoteView(resource.id, 'token');
    expect([...documents.entries()]).toEqual(before);
  });

});

it.each([
  { label: 'earlier offline lock', initiallyLocked: false, both: false, offlineAt: 15, expected: false },
  { label: 'earlier offline unlock', initiallyLocked: true, both: false, offlineAt: 15, expected: true },
  { label: 'earlier offline lock for two thoughts', initiallyLocked: false, both: true, offlineAt: 15, expected: false },
  { label: 'later offline lock', initiallyLocked: false, both: false, offlineAt: 110, expected: true },
])('keeps the latest deliberate thought lock action: $label', async ({ initiallyLocked, both, offlineAt, expected }) => {
  const generation = 'thought-lock-seed';
  const date = '2026-11-08T00:00:00.000Z';
  const selected = both ? ['one', 'two'] : ['one'];
  const initial = ['one', 'two', 'other'].map(id => ({
    id, date, tags: [], text: 'Original ' + id, isLocked: id === 'other' ? false : initiallyLocked,
  }));
  const create = {
    protocol: 1, kind: 'create', operationId: generation, owner: 'owner-1', resource, generation: null, dependsOn: [],
    value: { userId: 'owner-1', title: 'Sermon', verse: 'John 1:1', date, thoughts: initial },
  };
  expect((await processCommand(create.owner, create)).kind).toBe('acknowledged');
  const withLock = (rows: typeof initial, isLocked: boolean) =>
    rows.map(row => selected.includes(row.id) ? { ...row, isLocked } : row);
  const change = (operationId: string, before: typeof initial, after: typeof initial, at: number, observedRevision: number) => ({
    ...create, kind: 'update', operationId, generation,
    changes: [{ path: ['thoughts'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    thoughtLockActions: before.flatMap((row, index) => selected.includes(row.id) ? [{
      rowId: row.id, rowCreatedAt: row.date, before: row.isLocked, after: after[index].isLocked, observedRevision,
      time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at },
    }] : []),
  });
  const desktop = withLock(initial, !initiallyLocked).map(row =>
    row.id === 'one' ? { ...row, text: 'Independent desktop edit' } : row);
  expect((await processCommand(create.owner, change('desktop-first', initial, desktop, 55, 1))).kind).toBe('acknowledged');
  const desktopLast = withLock(desktop, initiallyLocked);
  expect((await processCommand(create.owner, change('desktop-last', desktop, desktopLast, 85, 2))).kind).toBe('acknowledged');
  const delayed = change('offline-delayed', initial, withLock(initial, !initiallyLocked), offlineAt, 1);
  const answer = await processCommand(create.owner, delayed);
  expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: withLock(desktopLast, expected) } } });
  expect(await processCommand(create.owner, delayed)).toEqual(answer);
  expect(await readDocument(create.owner, resource)).toMatchObject({ value: { thoughts: withLock(desktopLast, expected) } });
  const history = await listThoughtLockHistory(create.owner, resource.id, generation);
  expect(history.entries).toHaveLength(1);
  expect(history.entries[0].fields).toEqual(selected.map(rowId => expect.objectContaining({
    field: 'isLocked', rowId, rowCreatedAt: date, value: !expected, winnerValue: expected,
  })));
  await expect(listThoughtLockHistory('another-owner', resource.id, generation)).rejects.toMatchObject({ status: 403 });
  await expect(listThoughtLockHistory(create.owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
});

it.each([
  { label: 'earlier offline move', offlineAt: 15, desktop: 'right', phone: 'left', winner: 'right', kind: 'acknowledged' },
  { label: 'later offline move', offlineAt: 110, desktop: 'left', phone: 'right', winner: 'right', kind: 'acknowledged' },
  { label: 'later return to the opening assignment', offlineAt: 15, desktop: 'right', phone: 'left', winner: 'opening', kind: 'acknowledged', returnToOpening: true },
  { label: 'two subpoints of the same destination', offlineAt: 110, desktop: 'left', phone: 'leftOther', winner: 'leftOther', kind: 'acknowledged' },
  { label: 'unknown order cannot form an invalid combination', offlineAt: null, desktop: 'sameParent', phone: 'otherParent', winner: 'sameParent', kind: 'conflict', parentOnly: true },
  { label: 'legacy move without a timing proof', offlineAt: 110, desktop: 'sameParent', phone: 'otherParent', winner: 'sameParent', kind: 'conflict', parentOnly: true, legacy: true },
  { label: 'unknown cross-section move has one comparison', offlineAt: null, desktop: 'left', phone: 'right', winner: 'left', kind: 'conflict', cross: true },
  { label: 'legacy board keeps a second move in the same Save', offlineAt: 110, desktop: 'left', phone: 'right', winner: 'right', kind: 'acknowledged', cross: true, legacyBoard: true },
  { label: 'unknown action order', offlineAt: null, desktop: 'left', phone: 'right', winner: 'left', kind: 'conflict' },
] as const)('orders the exact thought point and subpoint together: $label', async scenario => {
  const generation = 'thought-location-seed';
  const date = '2026-11-08T00:00:00.000Z';
  const locations: Record<'opening' | 'left' | 'leftOther' | 'right' | 'sameParent' | 'otherParent', { outlinePointId: string; subPointId: string | null }> = {
    opening: { outlinePointId: 'start', subPointId: 'sub-start' },
    left: { outlinePointId: 'left', subPointId: 'sub-left' },
    leftOther: { outlinePointId: 'left', subPointId: 'sub-left-other' },
    right: { outlinePointId: 'right', subPointId: 'sub-right' },
    sameParent: { outlinePointId: 'start', subPointId: 'sub-start' },
    otherParent: { outlinePointId: 'right', subPointId: null },
  };
  const thought = { id: 'one', date, tags: ['main'], text: 'Original thought', ...('parentOnly' in scenario ? { outlinePointId: 'start', subPointId: null } : locations.opening) };
  const neighbor = { id: 'two', date, tags: ['main'], text: 'Independent thought', ...locations.opening };
  const start = { id: 'start', text: 'Start', subPoints: [{ id: 'sub-start', text: 'Start child', position: 0 }] };
  const left = { id: 'left', text: 'Left', subPoints: [{ id: 'sub-left', text: 'Left child', position: 0 }, { id: 'sub-left-other', text: 'Other child', position: 1 }] };
  const right = { id: 'right', text: 'Right', subPoints: [{ id: 'sub-right', text: 'Right child', position: 0 }] };
  const cross = 'cross' in scenario;
  const outline = cross ? { introduction: [left], main: [start], conclusion: [right] }
    : { introduction: [], main: [start, left, right], conclusion: [] };
  const board = (...rows: typeof thought[]) => ({
    introduction: rows.filter(row => cross && row.outlinePointId === 'left').map(row => row.id),
    main: rows.filter(row => !cross || row.outlinePointId === 'start').map(row => row.id),
    conclusion: rows.filter(row => cross && row.outlinePointId === 'right').map(row => row.id), ambiguous: [],
  });
  const structure = board(thought, neighbor);
  const legacyBoard = 'legacyBoard' in scenario;
  const create = {
    protocol: 1, kind: 'create', operationId: generation, owner: 'owner-1', resource, generation: null, dependsOn: [],
    value: { userId: 'owner-1', title: 'Sermon', verse: 'John 1:1', date, thoughts: [thought, neighbor], outline, ...(!legacyBoard && { structure, thoughtsBySection: structure }) },
  };
  expect(await processCommand(create.owner, create)).toMatchObject({ kind: 'acknowledged' });
  const pick = (row: typeof thought) => ({ outlinePointId: row.outlinePointId, subPointId: row.subPointId });
  const change = (operationId: string, before: typeof thought, after: typeof thought, at: number | null,
    observedRevision: number, changedNeighbor = neighbor) => ({
    ...create, kind: 'update', operationId, generation,
    changes: [{ path: ['thoughts'], before: { exists: true, value: [before, neighbor] },
      after: { exists: true, value: [after, changedNeighbor] } },
    ...cross ? ['structure', 'thoughtsBySection'].map(key => ({
      path: [key], before: legacyBoard && observedRevision === 1 ? { exists: false } : { exists: true, value: board(before, neighbor) },
      after: { exists: true, value: board(after, changedNeighbor) },
    })) : []],
    thoughtPlacementActions: [{ rowId: thought.id, rowCreatedAt: date, before: pick(before), after: pick(after), observedRevision,
      time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
  });
  let desktop = { ...thought, ...locations[scenario.desktop], text: 'Independent text edited on desktop' };
  const desktopCommand = change('desktop-first', thought, desktop, 55, 1);
  expect((await processCommand(create.owner, 'legacy' in scenario ? { ...desktopCommand, thoughtPlacementActions: [] } : desktopCommand)).kind).toBe('acknowledged');
  if ('returnToOpening' in scenario) {
    const restored = { ...desktop, ...locations.opening };
    expect((await processCommand(create.owner, change('desktop-last', desktop, restored, 85, 2))).kind).toBe('acknowledged');
    desktop = restored;
  }
  const finalNeighbor = legacyBoard ? { ...neighbor, ...locations.left } : neighbor;
  const delayed = change('offline-delayed', thought, { ...thought, ...locations[scenario.phone] }, scenario.offlineAt, 1, finalNeighbor);
  const answer = await processCommand(create.owner, delayed);
  const wanted = { ...desktop, ...locations[scenario.winner] };
  expect(answer).toMatchObject({ kind: scenario.kind, snapshot: { value: { thoughts: [wanted, finalNeighbor] } } });
  if (scenario.kind === 'conflict') expect(answer).toMatchObject({ conflicts: [{
    path: ['thoughts', 'id:one', 'outlineLocation'], base: { exists: true, value: pick(thought) },
    mine: { exists: true, value: locations[scenario.phone] }, theirs: { exists: true, value: locations[scenario.winner] },
  }] });
  expect(await processCommand(create.owner, delayed)).toEqual(answer);
  const finalBoard = board(wanted, finalNeighbor);
  expect(await readDocument(create.owner, resource)).toMatchObject({ value: {
    thoughts: [wanted, finalNeighbor], outline, structure: finalBoard, thoughtsBySection: finalBoard,
  } });
  const history = await listThoughtPlacementHistory(create.owner, resource.id, generation);
  if (scenario.kind === 'conflict') expect(history.entries).toEqual([]);
  else expect(history.entries).toMatchObject([{ fields: [{
    field: 'outlineLocation', rowId: thought.id, rowCreatedAt: date, winnerValue: locations[scenario.winner],
  }] }]);
  await expect(listThoughtPlacementHistory('another-owner', resource.id, generation)).rejects.toMatchObject({ status: 403 });
  await expect(listThoughtPlacementHistory(create.owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
});


describe('deleting an outline node while a thought is linked to it', () => {
  function fixture(wholePoint: boolean) {
    const generation = 'outline-removal-seed';
    const date = '2026-11-08T00:00:00.000Z';
    const owner = 'owner-1';
    const original = { outlinePointId: 'opening', subPointId: 'old-sub' };
    const repaired = { outlinePointId: wholePoint ? null : 'opening', subPointId: null };
    const destination = { outlinePointId: 'destination', subPointId: 'next-sub' };
    const first = { id: 'one', date, text: 'Original words', tags: ['main'], ...original };
    const neighbor = { id: 'two', date, text: 'Independent words', tags: ['main'], outlinePointId: 'opening' };
    const initial = [first, neighbor];
    const repairedRows = [{ ...first, ...repaired }, wholePoint ? { ...neighbor, ...repaired } : neighbor];
    const movedRows = [{ ...first, ...destination, text: 'New independent words' }, neighbor];
    const opening = { id: 'opening', text: 'Opening point', subPoints: [{ id: 'old-sub', text: 'Old subpoint', position: 0 }] };
    const other = { id: 'destination', text: 'Destination point', subPoints: [{ id: 'next-sub', text: 'Next subpoint', position: 0 }] };
    const alternate = { id: 'alternate', text: 'Alternate point' };
    const outline = { introduction: [], main: [opening, other, alternate], conclusion: [] };
    const nextOutline = { ...outline, main: wholePoint ? [other, alternate] : [{ ...opening, subPoints: [] }, other, alternate] };
    const board = { introduction: [], main: ['one', 'two'], conclusion: [], ambiguous: [] };
    const create = { protocol: 1, kind: 'create', operationId: generation, owner, resource, generation: null, dependsOn: [],
      value: { userId: owner, title: 'Sermon', verse: 'John 1:1', date, thoughts: initial, outline, structure: board, thoughtsBySection: board } };
    const update = { protocol: 1, kind: 'update', owner, resource, generation, dependsOn: [] };
    const change = (field: string, before: unknown, after: unknown) => ({
      path: [field], before: { exists: true, value: before }, after: { exists: true, value: after },
    });
    const time = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at });
    const remove = { ...update, operationId: 'remove-outline-node',
      changes: [change('outline', outline, nextOutline), change('thoughts', initial, repairedRows)] };
    const legacyBoardRemove = { ...remove,
      changes: [change('outline', outline, nextOutline), change('thoughts', repairedRows, repairedRows)],
      thoughtPlacementActions: repairedRows.slice(0, wholePoint ? 2 : 1).map(row => ({
        rowId: row.id, rowCreatedAt: date, before: repaired, after: repaired, observedRevision: 1, time: time(85),
      })),
    };
    const move = { ...update, operationId: 'move-thought', changes: [change('thoughts', initial, movedRows)],
      thoughtPlacementActions: [{ rowId: first.id, rowCreatedAt: date, before: original, after: destination, observedRevision: 1, time: time(15) }],
    };
    return { owner, create, remove, legacyBoardRemove, move, nextOutline, repairedRows, outline, opening, initial, change, time,
      expected: [movedRows[0], repairedRows[1]] };
  }

  it.each([false, true])('applies a deletion with the repaired location already shown on both command sides (%s is whole point)', async wholePoint => {
    const f = fixture(wholePoint);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.legacyBoardRemove)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.repairedRows } },
    });
  });

  it.each([
    { wholePoint: false, outlineFirst: true }, { wholePoint: false, outlineFirst: false },
    { wholePoint: true, outlineFirst: true }, { wholePoint: true, outlineFirst: false },
  ])('composes an automatic repair and a separate explicit move ($wholePoint whole point, $outlineFirst outline first)', async ({ wholePoint, outlineFirst }) => {
    const f = fixture(wholePoint);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, outlineFirst ? f.remove : f.move)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, outlineFirst ? f.move : f.remove)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.expected } },
    });
  });

  it('keeps the latest deliberate assignment proof even after its point was deleted', async () => {
    const f = fixture(true);
    const later = { ...f.move, operationId: 'later-explicit-assignment',
      thoughtPlacementActions: f.move.thoughtPlacementActions.map(action => ({ ...action, time: f.time(85) })) };
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, later)).toMatchObject({ kind: 'acknowledged' });
    const saved = (await readDocument(f.owner, resource)).value!;
    const detached = { ...f.expected[0], outlinePointId: null, subPointId: null };
    const after = { ...f.outline, main: f.outline.main.filter(point => point.id !== 'destination') };
    const removeChosen = { ...f.remove, operationId: 'delete-later-destination', changes: [
      f.change('outline', f.outline, after), f.change('thoughts', saved.thoughts, [detached, f.initial[1]]),
    ] };
    expect(await processCommand(f.owner, removeChosen)).toMatchObject({ kind: 'acknowledged' });
    const earlier = { ...f.move, operationId: 'delayed-earlier-assignment',
      changes: [f.change('thoughts', f.initial, [{ ...f.initial[0], outlinePointId: 'alternate', subPointId: null }, f.initial[1]])],
      thoughtPlacementActions: f.move.thoughtPlacementActions.map(action => ({ ...action, after: { outlinePointId: 'alternate', subPointId: null } })),
    };
    expect(await processCommand(f.owner, earlier)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { outline: after, thoughts: [detached, f.initial[1]] } } });
  });

  it('does not treat a deliberate clear as an automatic repair when the outline is later edited', async () => {
    const f = fixture(true);
    const cleared = { ...f.initial[0], outlinePointId: null, subPointId: null };
    const clear = { ...f.move, operationId: 'later-explicit-clear',
      changes: [f.change('thoughts', f.initial, [cleared, f.initial[1]])],
      thoughtPlacementActions: f.move.thoughtPlacementActions.map(action => ({
        ...action, after: { outlinePointId: null, subPointId: null }, time: f.time(85),
      })),
    };
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, clear)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.move)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { outline: f.nextOutline, thoughts: [{ ...cleared, text: 'New independent words' }, f.repairedRows[1]] } } });
  });

  it('repairs a linked thought added after the plan was opened without deleting it', async () => {
    const f = fixture(false);
    const added = { ...f.initial[0], id: 'added', text: 'Written after the plan opened' };
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    const addition = { ...f.move, operationId: 'add-thought', thoughtPlacementActions: [],
      changes: [f.change('thoughts', f.initial, [...f.initial, added])] };
    expect(await processCommand(f.owner, addition)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { outline: f.nextOutline, thoughts: [...f.repairedRows, { ...added, subPointId: null }] } } });
  });


  it('preserves a moved thought when a legacy deletion cannot prove the duplicated stamp was explicit', async () => {
    const f = fixture(true);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.move)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.legacyBoardRemove)).toMatchObject({ kind: 'conflict',
      snapshot: { value: { outline: f.outline, thoughts: [f.expected[0], f.initial[1]] } },
    });
  });

  it('checks a legacy cleanup stamp even when the same node was already deleted elsewhere', async () => {
    const f = fixture(true);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.move)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, { ...f.legacyBoardRemove, operationId: 'repeat-old-delete' })).toMatchObject({
      kind: 'conflict', snapshot: { value: { outline: f.nextOutline, thoughts: f.expected } },
    });
  });

  it('keeps a thought deleted elsewhere deleted while accepting the outline removal', async () => {
    const f = fixture(true);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    const deletion = { ...f.move, operationId: 'remove-linked-thought', thoughtPlacementActions: [], changes: [
      f.change('thoughts', f.initial, [f.initial[1]]),
      ...['structure', 'thoughtsBySection'].map(field =>
        f.change(field, f.create.value.structure, { ...f.create.value.structure, main: ['two'] })),
    ] };
    expect(await processCommand(f.owner, deletion)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: [f.repairedRows[1]] } },
    });
  });


  describe('moving a plan node while another device assigns a thought', () => {
    const boardFields = ['structure', 'thoughtsBySection'] as const;
    function movingFixture(selectMovedNode: boolean, moveAcrossSections: boolean) {
      const f = fixture(true);
      const [opening, destination, alternate] = f.outline.main;
      const [sourceSub] = f.opening.subPoints;
      const oldTarget = { outlinePointId: opening.id, subPointId: sourceSub.id };
      const source = selectMovedNode ? f.move.thoughtPlacementActions[0].after : oldTarget;
      const target = selectMovedNode ? oldTarget : f.move.thoughtPlacementActions[0].after;
      const initial = [{ ...f.initial[0], ...source, tags: ['topic', 'main'] }, f.initial[1]];
      const main = moveAcrossSections ? [destination, alternate] : [
        { ...opening, subPoints: [] }, destination, { ...alternate, subPoints: [sourceSub] },
      ];
      const nextOutline = { ...f.outline, introduction: moveAcrossSections ? [opening] : [], main };
      const board = f.create.value.structure;
      const neighborMoved = { ...board, introduction: ['two'], main: ['one'] };
      const bothMoved = { ...board, introduction: ['one', 'two'], main: [] };
      const repairedBoard = moveAcrossSections ? (selectMovedNode ? neighborMoved : bothMoved) : board;
      const neighbor = moveAcrossSections ? { ...initial[1], tags: ['intro'] } : initial[1];
      const repairedRows = [selectMovedNode ? initial[0] : {
        ...initial[0], ...(moveAcrossSections ? { tags: ['topic', 'intro'] } : { outlinePointId: alternate.id }),
      }, neighbor];
      const assignedRows = [{ ...initial[0], ...target, text: 'New independent words' }, initial[1]];
      const assignedBoard = { ...board, main: ['two', 'one'] };
      const outlineSave = { ...f.remove, operationId: 'move-plan-node', changes: [
        f.change('outline', f.outline, nextOutline), f.change('thoughts', initial, repairedRows),
        ...boardFields.map(field => f.change(field, board, repairedBoard)),
      ] };
      const thoughtSave = { ...f.move, changes: [f.change('thoughts', initial, assignedRows),
        ...boardFields.map(field => f.change(field, board, assignedBoard))],
        thoughtPlacementActions: [{ ...f.move.thoughtPlacementActions[0], before: source, after: target }],
      };
      const expectedPoint = selectMovedNode && !moveAcrossSections ? alternate.id : target.outlinePointId;
      const expectedTag = selectMovedNode && moveAcrossSections ? 'intro' : 'main';
      const expected = [{ ...assignedRows[0], outlinePointId: expectedPoint, tags: ['topic', expectedTag] }, neighbor];
      const expectedBoard = moveAcrossSections ? (expectedTag === 'intro' ? bothMoved : neighborMoved) : assignedBoard;
      return { ...f, create: { ...f.create, value: { ...f.create.value, thoughts: initial } }, outlineSave, thoughtSave, nextOutline, expected, expectedBoard };
    }

    it('keeps the indexed long tag proof through a repaired thought placement', async () => {
      const f = movingFixture(true, true);
      const tag = 'A'.repeat(257);
      const original = f.thoughtSave.changes[0].after.value as typeof f.expected;
      const add = [{ ...original[0], tags: [...original[0].tags, tag] }, original[1]];
      const action = { rowId: original[0].id, rowCreatedAt: original[0].date, tagIndex: add[0].tags.length - 1,
        before: false, after: true, observedRevision: 1, time: f.time(80) };
      expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, f.outlineSave)).toMatchObject({ kind: 'acknowledged' });
      const later = await processCommand(f.owner, { ...f.thoughtSave,
        changes: [f.change('thoughts', f.create.value.thoughts, add), ...f.thoughtSave.changes.slice(1)], thoughtTagActions: [action],
      });
      expect(later).toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: [{ tags: ['topic', tag, 'intro'] }, f.expected[1]] } } });
      const accepted = (later as { snapshot: ResourceSnapshot }).snapshot.value!.thoughts as typeof f.expected;
      const withoutTag = [{ ...accepted[0], tags: accepted[0].tags.filter(name => name !== tag) }, accepted[1]];
      const settled = await processCommand(f.owner, { ...f.thoughtSave, operationId: 'older-tag-removal', thoughtPlacementActions: [],
        changes: [f.change('thoughts', accepted, withoutTag)],
        thoughtTagActions: [{ ...action, tagIndex: accepted[0].tags.indexOf(tag), before: true, after: false, time: f.time(50) }],
      });
      expect(settled.kind).toBe('acknowledged');
      const final = (settled as { snapshot: ResourceSnapshot }).snapshot.value!.thoughts as typeof accepted;
      const orderedTags = (rows: typeof accepted) => rows.map(row => ({ ...row, tags: [...row.tags].sort() }));
      expect(orderedTags(final)).toEqual(orderedTags(accepted));
    });

    it('preserves linked neighbors when the device adds legacy board aliases after the outline move', async () => {
      const f = movingFixture(true, true);
      const { structure: _structure, thoughtsBySection: _thoughtsBySection, ...value } = f.create.value;
      const fromAbsent = (change: (typeof f.outlineSave.changes)[number]) =>
        boardFields.some(field => change.path[0] === field) ? { ...change, before: { exists: false } } : change;
      expect(await processCommand(f.owner, { ...f.create, value })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, { ...f.outlineSave, changes: f.outlineSave.changes.map(fromAbsent) })).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(f.owner, { ...f.thoughtSave, changes: f.thoughtSave.changes.map(fromAbsent) });
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
        outline: f.nextOutline, thoughts: f.expected,
        structure: { introduction: expect.arrayContaining(['one', 'two']), main: [] },
        thoughtsBySection: { introduction: expect.arrayContaining(['one', 'two']), main: [] },
      } } });
    });

    it('keeps rejecting a mismatched parent even after a real move of the selected subpoint', async () => {
      const f = movingFixture(true, false);
      const malformed = { outlinePointId: 'destination', subPointId: 'old-sub' };
      const initial = f.create.value.thoughts;
      const next = [{ ...initial[0], ...malformed }, initial[1]];
      expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, f.outlineSave)).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(f.owner, { ...f.thoughtSave,
        changes: [f.change('thoughts', initial, next)],
        thoughtPlacementActions: [{ ...f.thoughtSave.thoughtPlacementActions[0], after: malformed }],
      });
      expect(result).toMatchObject({ kind: 'refused', code: 'invalid-document' });
    });

    it.each([
      { selectMovedNode: false, moveAcrossSections: true, outlineFirst: false },
      { selectMovedNode: false, moveAcrossSections: true, outlineFirst: true },
      { selectMovedNode: true, moveAcrossSections: true, outlineFirst: true },
      { selectMovedNode: true, moveAcrossSections: false, outlineFirst: true },
      { selectMovedNode: false, moveAcrossSections: false, outlineFirst: true },
    ])('keeps the thought in the section of the chosen live node ($selectMovedNode moved target, $moveAcrossSections cross section, $outlineFirst outline first)',
      async ({ selectMovedNode, moveAcrossSections, outlineFirst }) => {
        const f = movingFixture(selectMovedNode, moveAcrossSections);
        const [first, second] = outlineFirst ? [f.outlineSave, f.thoughtSave] : [f.thoughtSave, f.outlineSave];
        expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(f.owner, first)).toMatchObject({ kind: 'acknowledged' });
        const result = await processCommand(f.owner, second);
        expect(result).toMatchObject({
          kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.expected } },
        });
        for (const field of boardFields) {
          const value = (result as { snapshot: ResourceSnapshot }).snapshot.value?.[field];
          const board = Object.fromEntries(Object.entries(value ?? {}).map(([section, ids]) => [section, Array.isArray(ids) ? [...ids].sort() : ids]));
          const expected = Object.fromEntries(Object.entries(f.expectedBoard).map(([section, ids]) => [section, [...ids].sort()]));
          expect(board).toEqual(expected);
        }
      });
  });

  it('ignores malformed placement evidence without blocking the automatic repair', async () => {
    const f = fixture(false);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, { ...f.remove, thoughtPlacementActions: [null] })).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.repairedRows } },
    });
  });

});
