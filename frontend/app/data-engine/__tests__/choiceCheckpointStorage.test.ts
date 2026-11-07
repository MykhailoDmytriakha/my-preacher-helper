import { checkpointKey } from '../checkpointStorage.client';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner', editorId = 'choice-editor';
const snapshot: ResourceSnapshot = { resource: { collection: 'sermons', id: 'choice-storage' },
  value: { userId: owner, title: 'Confirmed words' }, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } };
const request = (id: string, editGeneration = 1): CommitRequest => ({ id, owner, editorId, editGeneration,
  baseline: snapshot, value: { ...snapshot.value!, title: `Saved ${id}` }, predecessor: null, revision: 0,
  initialized: false, working: snapshot, intended: { ...snapshot.value!, title: `Saved ${id}` },
  command: null, submitted: null, sequence: editGeneration, state: 'queued', result: null, unfinalized: [] });
const checkpoint = (title: string, confirmed: ResourceSnapshot = snapshot): EditorRecord => {
  const session = new DataSession(confirmed);
  session.edit({ ...confirmed.value!, title });
  return { owner, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
};
const projection = (saved: CommitRequest[], title = 'Chosen private words'): EditorRecord => {
  const session = new DataSession(snapshot);
  for (const request of saved) {
    session.edit(request.value);
    session.registerCommit(request.id, request.editGeneration, request.value);
  }
  if (title !== 'Chosen private words') session.edit({ ...snapshot.value!, title });
  return { owner, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
};
const cancelChanges = (saved: CommitRequest[]) => saved.map(previous => ({ previous, next: { ...previous, state: 'cancelled' as const } }));

describe('atomic choice checkpoint storage', () => {
  let storage: ReturnType<typeof installStorageHarness>;
  beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

  it('rolls back every CAS row when the exact chosen checkpoint PUT fails, then allows retry', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    const saved = await commits.createBatch!([request('choice-a', 1), request('choice-b', 2)]);
    await checkpoints.put(checkpoint('Old private checkpoint'));
    const oldCheckpoint = (await checkpoints.read(owner, editorId))!;
    const key = JSON.stringify(checkpointKey(owner, editorId));
    storage.writeFailureFor = (writeKey, value) => JSON.stringify(writeKey) === key && value !== undefined;

    await expect(commits.compareAndSetWithCheckpoint!(cancelChanges(saved), projection)).rejects.toThrow('disk full');
    expect(await commits.list(owner)).toEqual(saved);
    expect(await checkpoints.read(owner, editorId)).toEqual(oldCheckpoint);

    storage.writeFailureFor = undefined;
    const won = await commits.compareAndSetWithCheckpoint!(cancelChanges(saved), projection);
    expect(won.map(row => [row.state, row.revision])).toEqual([['cancelled', 1], ['cancelled', 1]]);
    expect((await checkpoints.read(owner, editorId))?.checkpoint.pending).toMatchObject({
      'choice-a': { value: request('choice-a', 1).value }, 'choice-b': { value: request('choice-b', 2).value },
    });
  });

  it('rolls back the choice when writing a retained dependent fails', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    const saved = await commits.createBatch!([request('chosen', 1), request('dependent', 2)]);
    await checkpoints.put(checkpoint('Original decision checkpoint'));
    const original = await checkpoints.read(owner, editorId);
    const later = { ...checkpoint('Later work'), editorId: 'later-recovery' };
    const key = JSON.stringify(checkpointKey(owner, later.editorId));
    storage.writeFailureFor = (writeKey, value) => JSON.stringify(writeKey) === key && value !== undefined;
    const changes = cancelChanges(saved);
    const project = () => [checkpoint('Chosen words'), later];

    await expect(commits.compareAndSetWithCheckpoint!(changes, project)).rejects.toThrow('disk full');
    expect(await commits.list(owner)).toEqual(saved);
    expect(await checkpoints.read(owner, editorId)).toEqual(original);
    expect(await checkpoints.read(owner, later.editorId)).toBeUndefined();

    storage.writeFailureFor = undefined;
    await commits.compareAndSetWithCheckpoint!(changes, project);
    expect((await checkpoints.read(owner, editorId))?.checkpoint.draft?.title).toBe('Chosen words');
    expect((await checkpoints.read(owner, later.editorId))?.checkpoint.draft?.title).toBe('Later work');
  });

  it('rejects a new capture that names a predecessor already retired by a choice', async () => {
    const commits = createIndexedDbCommitStore();
    const earlier = await commits.create(request('old-predecessor'));
    await commits.compareAndSet(earlier, { ...earlier, state: 'cancelled', cancelledByChoice: true });
    const later = { ...request('too-late', 2), predecessor: earlier.id };
    await expect(commits.create(later)).rejects.toMatchObject({ code: 'commit-reference-changed' });
    expect((await commits.list(owner)).map(row => [row.id, row.state])).toEqual([[earlier.id, 'cancelled']]);
  });

  it('leaves all rows and the old checkpoint untouched when one batch member is stale', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    const saved = await commits.createBatch!([request('stale-a', 1), request('stale-b', 2)]);
    await checkpoints.put(checkpoint('Old private checkpoint'));
    const oldCheckpoint = (await checkpoints.read(owner, editorId))!;
    const project = jest.fn(projection);
    const changes = cancelChanges(saved);
    changes[1] = { previous: { ...saved[1], revision: saved[1].revision + 1 }, next: { ...saved[1], state: 'cancelled' } };

    await expect(commits.compareAndSetWithCheckpoint!(changes, project)).rejects.toMatchObject({ code: 'commit-changed' });
    expect(project).not.toHaveBeenCalled();
    expect(await commits.list(owner)).toEqual(saved);
    expect(await checkpoints.read(owner, editorId)).toEqual(oldCheckpoint);
  });

  it('aborts the batch when the projected checkpoint belongs to another owner', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    const saved = await commits.createBatch!([request('owner-a', 1), request('owner-b', 2)]);
    await checkpoints.put(checkpoint('Old private checkpoint'));
    const oldCheckpoint = (await checkpoints.read(owner, editorId))!;

    await expect(commits.compareAndSetWithCheckpoint!(cancelChanges(saved), rows => ({ ...projection(rows), owner: 'foreign' })))
      .rejects.toThrow('Checkpoint projection owner differs from changed commits');
    expect(await commits.list(owner)).toEqual(saved);
    expect(await checkpoints.read(owner, editorId)).toEqual(oldCheckpoint);
    expect(await checkpoints.read('foreign', editorId)).toBeUndefined();
  });

  it('rolls back Take Remote cancellation when deleting its exact clean checkpoint fails', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    const queued = await commits.create(request('take-remote'));
    const oldRecord = projection([queued], 'Old private checkpoint');
    await checkpoints.put(oldRecord);
    const oldCheckpoint = (await checkpoints.read(owner, editorId))!;
    const remote: ResourceSnapshot = { ...snapshot, value: { ...snapshot.value!, title: 'Remote words' },
      metadata: { protocol: 1, generation: 'g1', revision: 2, deleted: false } };
    const cleanSession = new DataSession(remote);
    const cleanRecord: EditorRecord = { owner, editorId, checkpoint: cleanSession.checkpoint(), prepared: null, unfinalized: [] };
    const key = JSON.stringify(checkpointKey(owner, editorId));
    storage.writeFailureFor = (writeKey, value) => JSON.stringify(writeKey) === key && value === undefined;

    await expect(commits.compareAndSetWithCheckpoint!([{ previous: queued, next: { ...queued, state: 'cancelled' } }], () => cleanRecord))
      .rejects.toThrow('disk full');
    expect(await commits.list(owner)).toEqual([queued]);
    expect(await checkpoints.read(owner, editorId)).toEqual(oldCheckpoint);
  });
});
