import { createIndexedDbManualScopes } from '../manualScopes.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { installStorageHarness } from './storageHarness';

import type { StoredManualScope } from '../manualScopes.client';
import type { CommitRequest } from '../commits';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'sermons', id: 'one' };
const baseline = { resource, value: { userId: 'owner', title: 'A' }, metadata: null };
const envelope = (): StoredManualScope => ({ owner: 'owner', scopeId: 'scope', parentEditorId: 'tab', slot: 'title', commitReferences: [], record: {
  kind: 'manual', version: 1, owner: 'owner', resource, scopeId: 'scope', selection: [['title']], baseline, predecessor: null,
  stage: [{ exists: true, value: 'B' }], savedSelection: [{ exists: true, value: 'A' }], generation: 1, savedGeneration: null, active: true,
} });
const request = (): CommitRequest => ({ id: 'request', owner: 'owner', editorId: 'scope', editGeneration: 1, baseline,
  value: { ...baseline.value, title: 'B' }, predecessor: null, revision: 0, initialized: false, working: baseline,
  intended: { ...baseline.value, title: 'B' }, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });

describe('durable manual stages', () => {
  let storage: ReturnType<typeof installStorageHarness>;
  beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

  it('keeps stage-only recovery owner scoped and detached across adapters', async () => {
    const first = createIndexedDbManualScopes(), second = createIndexedDbManualScopes();
    await first.create(envelope());
    const saved = (await second.list('owner', resource))[0]; saved.record.stage = [];
    expect((await first.read('owner', 'scope'))?.record?.stage).toEqual([{ exists: true, value: 'B' }]);
    expect(await first.read('other', 'scope')).toBeUndefined(); expect(await first.list('other')).toEqual([]);
    expect(await first.list('owner', { ...resource, id: 'other' })).toEqual([]);
    await expect(second.create(envelope())).rejects.toThrow('exists');
    await expect(second.put({ ...envelope(), slot: 'different' })).rejects.toThrow('identity changed');
    await expect(second.put({ ...envelope(), scopeId: 'absent', record: { ...envelope().record, scopeId: 'absent' } })).rejects.toThrow('no longer');
  });

  it('validates references atomically and never writes a dangling saved predecessor', async () => {
    const stages = createIndexedDbManualScopes(); const value = envelope();
    value.record.predecessor = { id: 'request', owner: 'owner', resource, value: { ...baseline.value, title: 'B' }, predecessorId: null };
    value.record.savedSelection = [{ exists: true, value: 'B' }]; value.record.savedGeneration = 1;
    value.commitReferences = ['request'];
    await expect(stages.create(value)).rejects.toMatchObject({ code: 'commit-reference-changed' });
    expect(await stages.list('owner')).toEqual([]);
    await createIndexedDbCommitStore().create(request()); await stages.create(value);
    expect((await stages.read('owner', 'scope'))?.commitReferences).toEqual(['request']);
    await expect(stages.put({ ...value, commitReferences: [] })).rejects.toThrow('references mismatch');
    await expect(stages.put({ ...value, owner: 'foreign' })).rejects.toThrow('identity mismatch');
  });

  it.each(['acknowledged', 'cancelled'] as const)('compacts only closed clean %s stages to a generation watermark', async terminal => {
    const stages = createIndexedDbManualScopes(), commits = createIndexedDbCommitStore();
    const queued = await commits.create(request());
    const value = envelope(); value.record.predecessor = { id: queued.id, owner: 'owner', resource, value: queued.value!, predecessorId: null };
    value.record.savedSelection = [{ exists: true, value: 'B' }]; value.record.savedGeneration = 1; value.commitReferences = [queued.id];
    await stages.create(value); await stages.compact('owner', 'scope'); expect(await stages.list('owner')).toHaveLength(1);
    value.record.active = false; await stages.put(value); await stages.compact('owner', 'scope'); expect(await stages.list('owner')).toHaveLength(1);
    await commits.compareAndSet(queued, { ...queued, state: terminal, result: terminal === 'acknowledged' ? { kind: 'acknowledged', operationId: queued.id, snapshot: { ...baseline, value: queued.value } } : null });
    await stages.compact('owner', 'scope');
    expect(await stages.list('owner')).toEqual([]);
    expect(await stages.read('owner', 'scope')).toEqual({ owner: 'owner', scopeId: 'scope', parentEditorId: 'tab', slot: 'title', record: null,
      watermark: { generation: 1, selection: [['title']], resource }, commitReferences: [] });
    await stages.compact('owner', 'scope'); await stages.compact('owner', 'missing');
    await stages.put({ ...envelope(), record: { ...envelope().record, generation: 2 } });
    expect((await stages.read('owner', 'scope'))?.record?.generation).toBe(2);
  });

  it('preserves unsaved cancellation-independent data and reports transaction failure', async () => {
    const stages = createIndexedDbManualScopes(); const value = envelope(); value.record.active = false;
    await stages.create(value); await stages.compact('owner', 'scope'); expect(await stages.list('owner')).toHaveLength(1);
    storage.writeFailure = true; await expect(stages.put(value)).rejects.toThrow('disk full'); storage.writeFailure = false;
    expect((await stages.list('owner'))[0]).toEqual(value);
    value.record.stage = value.record.savedSelection; await stages.put(value); await stages.compact('owner', 'scope');
    expect((await stages.read('owner', 'scope'))?.record).toBeNull();
    storage.rows.set(JSON.stringify(['manual', 'owner', 'scope']), { owner: 'owner', scopeId: 'scope', record: null, watermark: { generation: -1 }, commitReferences: [] });
    await expect(stages.read('owner', 'scope')).rejects.toThrow('watermark');
  });
});
