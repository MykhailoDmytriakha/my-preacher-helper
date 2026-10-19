import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const snapshot: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'capture' },
  value: { userId: 'owner', title: 'Draft', content: 'base', tags: [], scriptureRefs: [], isDraft: false,
    createdAt: '2026-10-18', updatedAt: '2026-10-18' }, metadata: null };
const request = (id = 'capture'): CommitRequest => ({ id, owner: 'owner', editorId: 'editor', editGeneration: 1,
  baseline: snapshot, value: { ...snapshot.value, content: 'saved words' }, predecessor: null, revision: 0,
  initialized: false, working: snapshot, intended: { ...snapshot.value, content: 'saved words' },
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });
const project = (saved: CommitRequest): EditorRecord => {
  const session = new DataSession(snapshot);
  session.edit(saved.value); session.applyCommit(saved);
  return { owner: saved.owner, editorId: saved.editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
};

describe('native submitted checkpoint capture', () => {
  beforeEach(() => { jest.clearAllMocks(); installStorageHarness(); });

  it('rolls back the request, identity and checkpoint when checkpoint validation fails', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    await expect(commits.createWithCheckpoint!(request(), saved => {
      const record = project(saved); record.checkpoint.pending.missing = { generation: 0, value: saved.value };
      return record;
    })).rejects.toMatchObject({ code: 'commit-reference-changed' });
    expect(await commits.list('owner')).toEqual([]);
    expect(await checkpoints.read('owner', 'editor')).toBeUndefined();
    // Aborted identity rows cannot block a genuine retry with the original id.
    const saved = await commits.createWithCheckpoint!(request(), project);
    expect((await checkpoints.read('owner', 'editor'))?.checkpoint.pending[saved.id].value).toEqual(saved.value);
  });

  it('projects the winning stored identity when two tabs capture the same generation', async () => {
    const a = createIndexedDbCommitStore(), b = createIndexedDbCommitStore();
    const [first, duplicate] = await Promise.all([
      a.createWithCheckpoint!(request('first'), project), b.createWithCheckpoint!(request('second'), project),
    ]);
    expect(first.id).toBe(duplicate.id);
    const checkpoint = await createIndexedDbCheckpoints().read('owner', 'editor');
    expect(Object.keys(checkpoint!.checkpoint.pending)).toEqual([first.id]);
    expect(await a.list('owner')).toHaveLength(1);
  });
});
