import { createIndexedDbCommitStore } from '../commits.client';
import { prepareDomainCommand } from '../domainPolicy';
import { validateCommand } from '../protocol';
import { createEngineStorageTransaction, engineOwnerRange } from '../storage.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const source: ResourceSnapshot = {
  resource: { collection: 'studyNotes', id: 'source' },
  value: { userId: 'owner', title: 'Source', content: 'Words' },
  metadata: { protocol: 1, generation: 'source-generation', revision: 1, deleted: false },
};
const material: ResourceSnapshot = { resource: { collection: 'studyMaterials', id: 'consumer' }, value: null, metadata: null };

const request = (id: string, editorId: string, editGeneration: number, baseline: ResourceSnapshot,
  value: DocumentData | null, extra: Partial<CommitRequest> = {}): CommitRequest => ({
  id, owner: 'owner', editorId, editGeneration, baseline, value, predecessor: null,
  revision: 0, initialized: false, working: baseline, intended: value,
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [], ...extra,
});
const consumerRequest = (id = 'consumer-save', value: DocumentData = { userId: 'owner', title: 'Material', noteIds: ['source'] }) =>
  request(id, `editor-${id}`, 1, material, value);
const deleteRequest = (id = 'source-delete', editorId = 'delete-editor', editGeneration = 1) =>
  request(id, editorId, editGeneration, source, null);
const terminal = (record: CommitRequest, state: 'acknowledged' | 'conflict' | 'refused' | 'cancelled'): CommitRequest => ({
  ...record, state, ...(state === 'acknowledged' ? { result: { kind: 'acknowledged', operationId: record.id, snapshot: { ...record.baseline, value: record.value } } } : {}),
});

let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

describe('IndexedDB commit-store delete frontier capture', () => {
  it('captures an unrelated DELETE despite a pending malformed membership draft', async () => {
    const store = createIndexedDbCommitStore();
    const baseline: ResourceSnapshot = { ...material, value: { userId: 'owner', noteIds: [] },
      metadata: { protocol: 1, generation: 'material-generation', revision: 1, deleted: false } };
    await store.create(request('invalid-membership', 'invalid-editor', 1, baseline,
      { userId: 'owner', noteIds: 'invalid saved input' }));
    const deletion = await store.create(deleteRequest());
    expect(deletion.deleteAfter).toEqual([]);
    expect(deletion.value).toBeNull();
  });

  it('freezes the linked-consumer frontier at DELETE capture and preserves it on exact replay', async () => {
    const first = createIndexedDbCommitStore(), second = createIndexedDbCommitStore();
    const early = await first.create(consumerRequest());
    const deletion = await second.create(deleteRequest());
    expect(deletion.deleteAfter).toEqual([early.id]);

    // A later linked use must not be added by retrying the already captured DELETE.
    await second.create(consumerRequest('later-consumer'));
    const replay = await first.create(deleteRequest('different-operation-id'));
    expect(replay).toEqual(deletion);
    expect((await first.list('owner')).find(record => record.id === deletion.id)?.deleteAfter).toEqual([early.id]);
  });

  it('serializes competing deletes from separate store instances and returns one immutable capture', async () => {
    const a = createIndexedDbCommitStore(), b = createIndexedDbCommitStore();
    const early = await a.create(consumerRequest());
    const [left, right] = await Promise.all([
      a.create(deleteRequest('delete-left', 'same-delete-editor')),
      b.create(deleteRequest('delete-right', 'same-delete-editor')),
    ]);
    expect(left.id).toBe(right.id);
    expect(left.deleteAfter).toEqual([early.id]);
    expect(right.deleteAfter).toEqual([early.id]);
    expect((await a.list('owner')).filter(record => record.baseline.resource.id === 'source')).toHaveLength(1);
  });

  it('scopes the frontier by owner and exact resource identity', async () => {
    const store = createIndexedDbCommitStore();
    const matching = await store.create(consumerRequest());
    const otherOwner = await store.create({ ...consumerRequest('other-owner'), owner: 'another-owner' });
    const sameIdOtherCollection = await store.create(request('other-collection', 'other-collection-editor', 1,
      { resource: { collection: 'sermons', id: source.resource.id }, value: null, metadata: null },
      { userId: 'owner', title: 'Other collection with the same document ID' }));
    const sameCollectionOtherId = await store.create(request('other-source', 'other-source-editor', 1,
      { ...source, resource: { collection: 'studyNotes', id: 'different-source' } }, { userId: 'owner', title: 'Other source' }));
    expect(otherOwner.deleteAfter).toBeUndefined();
    expect(sameIdOtherCollection.deleteAfter).toBeUndefined();
    expect(sameCollectionOtherId.deleteAfter).toBeUndefined();
    expect((await store.create(deleteRequest())).deleteAfter).toEqual([matching.id]);
    expect(await store.list('another-owner')).toEqual([otherOwner]);
  });

  it.each(['acknowledged', 'conflict', 'refused', 'cancelled'] as const)(
    'does not make prior %s work a DELETE prerequisite', async state => {
      const store = createIndexedDbCommitStore();
      const earlier = await store.create(consumerRequest());
      await store.compareAndSet(earlier, terminal(earlier, state));
      expect((await store.create(deleteRequest())).deleteAfter).toEqual([]);
    });

  it('keeps unknown delivery outstanding until the prior saved request reaches terminal state', async () => {
    const store = createIndexedDbCommitStore();
    const earlier = await store.create(consumerRequest());
    const deletion = await store.create(deleteRequest());
    expect(deletion.deleteAfter).toEqual([earlier.id]);
    expect((await store.list('owner')).find(record => record.id === deletion.id)?.state).toBe('queued');
    await store.compareAndSet(earlier, { ...earlier, state: 'prepared', command: {
      protocol: 1, operationId: earlier.id, owner: 'owner', resource: material.resource, generation: null,
      dependsOn: [], kind: 'create', value: earlier.value!,
    } });
    expect((await store.list('owner')).find(record => record.id === deletion.id)?.deleteAfter).toEqual([earlier.id]);
  });

  it('retains an acknowledged prerequisite through projection release using the generic reference sidecar', async () => {
    const store = createIndexedDbCommitStore(), transaction = createEngineStorageTransaction();
    const earlier = await store.create(consumerRequest());
    const deletion = await store.create(deleteRequest());
    const acknowledged = await store.compareAndSet(earlier, terminal(earlier, 'acknowledged'));
    await store.releaseProjection!('owner', [acknowledged.id]);

    const references = await transaction<string[]>('readonly', (rows, read, done) => {
      read(rows.getAll(engineOwnerRange('reference', 'owner')), values => done(values.flatMap(row => row.commitReferences ?? [])));
    });
    expect(references).toContain(earlier.id);
    expect((await store.list('owner')).map(record => record.id)).toEqual([earlier.id, deletion.id]);

    const currentDelete = (await store.list('owner')).find(record => record.id === deletion.id)!;
    const terminalDelete = await store.compareAndSet(currentDelete, terminal(currentDelete, 'acknowledged'));
    await store.releaseProjection!('owner', [terminalDelete.id]);
    expect(await store.list('owner')).toEqual([]);
  });

  it('keeps a frontier larger than one hundred local IDs out of the wire command', async () => {
    const store = createIndexedDbCommitStore();
    const prior: CommitRequest[] = [];
    for (let index = 0; index < 105; index += 1) {
      const value = { userId: 'owner', title: `Material ${index}`, noteIds: ['source'] };
      prior.push(await store.create(consumerRequest(`consumer-${index}`, value)));
    }
    const deletion = await store.create(deleteRequest());
    expect(deletion.deleteAfter).toHaveLength(105);
    expect(deletion.deleteAfter).toEqual(prior.map(record => record.id));
    expect(deletion.deleteAfter!.length).toBeGreaterThan(100);
    expect(deletion.command).toBeNull();
    const command = prepareDomainCommand('owner', 'wire-delete', source, null).command;
    expect(command.dependsOn).toEqual([]);
    expect(command).not.toHaveProperty('deleteAfter');
    expect(validateCommand(command)).toEqual(command);
  });

  it('captures references from a material membership update', async () => {
    const store = createIndexedDbCommitStore();
    const baseline: ResourceSnapshot = { ...material, value: { userId: 'owner', noteIds: [] },
      metadata: { protocol: 1, generation: 'material-generation', revision: 1, deleted: false } };
    const prior = await store.create(request('relation-save', 'relation-editor', 1, baseline, { userId: 'owner', noteIds: ['source'] }));
    expect((await store.create(deleteRequest())).deleteAfter).toEqual([prior.id]);
  });

  it('captures references from a series membership update to a sermon being deleted', async () => {
    const store = createIndexedDbCommitStore();
    const sermon: ResourceSnapshot = { resource: { collection: 'sermons', id: 'linked-sermon' },
      value: { userId: 'owner', title: 'Sermon' }, metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false } };
    const seriesBaseline: ResourceSnapshot = { resource: { collection: 'series', id: 'series' },
      value: { userId: 'owner', items: [] }, metadata: { protocol: 1, generation: 'series-generation', revision: 1, deleted: false } };
    const prior = await store.create(request('series-save', 'series-editor', 1, seriesBaseline,
      { userId: 'owner', items: [{ type: 'sermon', refId: sermon.resource.id, position: 0 }] }));
    const deletion = await store.create(request('sermon-delete', 'sermon-delete-editor', 1, sermon, null));
    expect(deletion.deleteAfter).toEqual([prior.id]);
  });

  it('captures an embedded source-note use in an atomic series-member create', async () => {
    const store = createIndexedDbCommitStore();
    const atomic = { id: 'series-member-action', participants: ['new-member', 'series-edit'], kind: 'create-member' as const };
    const memberResource = { collection: 'sermons', id: 'new-member' };
    const memberValue = { userId: 'owner', title: 'New member', sourceNoteIds: ['source'], scratch: [] };
    const member = request('new-member', 'new-member-editor', 1,
      { resource: memberResource, value: null, metadata: null }, memberValue, { atomic });
    const seriesRequest = request('series-edit', 'series-editor', 1,
      { resource: { collection: 'series', id: 'new-series' }, value: null, metadata: null },
      { userId: 'owner', items: [{ type: 'sermon', refId: 'new-member', position: 0 }] }, { atomic });
    const saved = await store.createBatch!([member, seriesRequest]);
    expect((await store.create(deleteRequest())).deleteAfter).toContain(saved[0].id);
  });

  it('replays legacy delete captures without inventing a frontier', async () => {
    const store = createIndexedDbCommitStore();
    const legacy = await store.create(deleteRequest());
    // Simulate an older persisted row that has no deleteAfter capture field.
    const legacyRow = { ...legacy } as { deleteAfter?: string[] };
    delete legacyRow.deleteAfter;
    const oldKey = ['ordered-delete-request', legacy.owner, legacy.editorId, legacy.editGeneration];
    const key = ['request', legacy.owner, legacy.editorId, legacy.editGeneration];
    storage.rows.delete(JSON.stringify(oldKey));
    storage.rows.set(JSON.stringify(key), legacyRow);
    storage.rows.set(JSON.stringify(['identity', legacy.owner, legacy.id]), key);
    await store.create(consumerRequest());

    const replay = await store.create(deleteRequest('legacy-replay-operation')).catch(error => error as Error);
    expect(replay).not.toBeInstanceOf(Error);
    if (replay instanceof Error) return;
    expect(replay.id).toBe(legacy.id);
    expect(replay.deleteAfter).toBeUndefined();
  });
});
