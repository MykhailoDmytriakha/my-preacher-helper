import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { applyCommand } from '../protocol';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { CommitRequest } from '../commits';
import type { CommandResult, DataCommand, DocumentData, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const absent = (resource: ResourceRef): ResourceSnapshot => ({ resource, value: null, metadata: null });

function initial(resource: ResourceRef): ResourceSnapshot {
  if (resource.collection === 'groups' || resource.collection === 'series') return absent(resource);
  return {
    resource,
    value: { userId: owner, title: 'Opening title', content: 'Opening words', tags: [], scriptureRefs: [], isDraft: false,
      createdAt: '2026-10-30', updatedAt: '2026-10-30' },
    metadata: { protocol: 1, generation: 'recovery-269-generation', revision: 1, deleted: false },
  };
}

function sourceDraft(resource: ResourceRef): DocumentData {
  if (resource.collection === 'groups') return {
    userId: owner, title: 'Recovered group', status: 'draft', templates: [], flow: [], meetingDates: [], createdAt: '2026-10-30', updatedAt: '2026-10-30',
  };
  if (resource.collection === 'series') return {
    userId: owner, title: 'Recovered series', theme: 'Recovery', bookOrTopic: '', status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon', createdAt: '2026-10-30', updatedAt: '2026-10-30',
  };
  return { ...initial(resource).value!, title: 'Recovered title', content: 'Recovered words' };
}

function record(editorId: string, checkpoint: ReturnType<DataSession['checkpoint']>): EditorRecord {
  return { owner, editorId, checkpoint, prepared: null, unfinalized: [] };
}

function setup() {
  const storage = installStorageHarness();
  const checkpoints = createIndexedDbCheckpoints();
  const commits = createIndexedDbCommitStore();
  const snapshots = new Map<string, ResourceSnapshot>();
  const journals = new Map<string, JournalEntry>();
  const key = (ref: ResourceRef) => JSON.stringify([owner, ref.collection, ref.id]);
  let operation = 0;
  const transport = {
    read: async (_uid: string, resource: ResourceRef) => clone(snapshots.get(key(resource)) ?? absent(resource)),
    send: async (command: DataCommand): Promise<CommandResult> => {
      const current = snapshots.get(key(command.resource)) ?? absent(command.resource);
      const result = applyCommand(command, clone(current));
      if (result.kind === 'acknowledged') snapshots.set(key(command.resource), clone(result.snapshot));
      return result;
    },
  };
  const runtime = new DataEngineRuntime({ transport, journal: {
    list: async uid => clone([...journals.values()].filter(entry => entry.command.owner === uid)),
    put: async entry => { journals.set(entry.command.operationId, clone(entry)); },
    remove: async (_uid, id) => { journals.delete(id); },
  } });
  runtime.setOwner(owner);
  const queue = new CommitQueue({ store: commits, runtime, operationId: () => `recovery-269-${++operation}`,
    readConfirmed: resource => transport.read(owner, resource) });
  queue.setOwner(owner);
  return { storage, checkpoints, commits, queue, snapshots };
}

async function captureRecoveredTarget(resource: ResourceRef, id: string, words: DocumentData) {
  const s = setup();
  s.snapshots.set(JSON.stringify([owner, resource.collection, resource.id]), initial(resource));
  const sourceId = recoveryCheckpointId(owner, `${id}-source`);
  const sourceSession = new DataSession(initial(resource));
  sourceSession.edit(words);
  await s.checkpoints.put(record(`${id}-source`, sourceSession.checkpoint()));
  const target = await forkCheckpoint(s.checkpoints, owner, sourceId, `${id}-target`, resource);
  const targetSession = DataSession.restore(target.checkpoint);
  targetSession.edit(words);
  const request = await s.queue.save(target.editorId, targetSession.checkpoint(), {
    checkpoint: saved => {
      const submitted = DataSession.restore(target.checkpoint);
      submitted.registerCommit(saved.id, saved.editGeneration, saved.value, saved.command?.operationId);
      return { ...target, checkpoint: submitted.checkpoint() };
    },
  });
  if (!request) throw new Error('The recovered target did not produce a native commit request');
  return { ...s, sourceId, targetId: target.editorId, request };
}

async function acknowledgeAndRelease(s: ReturnType<typeof setup>, request: CommitRequest): Promise<void> {
  await s.queue.drain(true);
  const accepted = (await s.commits.list(owner)).find(item => item.id === request.id);
  if (accepted?.state !== 'acknowledged' || accepted.result?.kind !== 'acknowledged') {
    throw new Error('The actual commit queue did not produce an acknowledged protocol result');
  }
  await s.commits.releaseProjection!(owner, [accepted.id]);
}

describe('closed recovered checkpoint projection for BUG-20261006-recovery-list-offers-resolved-and-live-drafts', () => {
  it.each([
    ['group creation', { collection: 'groups', id: 'recovered-group-269' }],
    ['series creation', { collection: 'series', id: 'recovered-series-269' }],
    ['ordinary document update', { collection: 'studyNotes', id: 'recovered-note-269' }],
  ] as const)('retires only the exact recovered source after a closed target receives a real ACK: %s', async (_label, resource) => {
    const s = await captureRecoveredTarget(resource, resource.id, sourceDraft(resource));
    await acknowledgeAndRelease(s, s.request);

    expect(await s.checkpoints.read(owner, `${resource.id}-source`)).toBeUndefined();
    expect(await s.checkpoints.read(owner, `${resource.id}-target`)).toBeUndefined();
    const acceptedValue = clone(s.snapshots.get(JSON.stringify([owner, resource.collection, resource.id]))!.value!);
    delete acceptedValue.rev;
    expect(acceptedValue).toEqual(sourceDraft(resource));
  });

  it('keeps later independently edited source words and their rotated version after the target ACK', async () => {
    const resource: ResourceRef = { collection: 'studyNotes', id: 'later-source-269' };
    const s = await captureRecoveredTarget(resource, resource.id, sourceDraft(resource));
    const captured = (await s.checkpoints.read(owner, `${resource.id}-source`))!;
    const later = clone(captured); later.checkpoint.draft!.content = 'Independent later source words';
    await s.checkpoints.put(later);
    const newer = (await s.checkpoints.read(owner, `${resource.id}-source`))!;

    await acknowledgeAndRelease(s, s.request);

    expect((await s.checkpoints.read(owner, `${resource.id}-source`))?.checkpoint.draft?.content).toBe('Independent later source words');
    expect((await s.checkpoints.read(owner, `${resource.id}-source`))?.recoveryVersion).toBe(newer.recoveryVersion);
  });

  it('retains later unsent target words and the source until that target work is settled', async () => {
    const resource: ResourceRef = { collection: 'studyNotes', id: 'later-target-269' };
    const s = await captureRecoveredTarget(resource, resource.id, sourceDraft(resource));
    const captured = (await s.checkpoints.read(owner, `${resource.id}-target`))!;
    const laterSession = DataSession.restore(captured.checkpoint);
    laterSession.edit({ ...laterSession.checkpoint().draft!, content: 'Later unsent target words' });
    await s.checkpoints.put({ ...captured, checkpoint: laterSession.checkpoint() });

    await acknowledgeAndRelease(s, s.request);

    expect((await s.checkpoints.read(owner, `${resource.id}-target`))?.checkpoint.draft?.content).toBe('Later unsent target words');
    expect((await s.checkpoints.read(owner, `${resource.id}-target`))?.checkpoint.pending).toEqual({});
    expect((await s.checkpoints.read(owner, `${resource.id}-source`))?.checkpoint.draft?.content).toBe('Recovered words');
  });

  it('does not settle a source for an unresolved queued request or an unknown request ID', async () => {
    const resource: ResourceRef = { collection: 'studyNotes', id: 'unresolved-target-269' };
    const s = await captureRecoveredTarget(resource, resource.id, sourceDraft(resource));
    await s.commits.releaseProjection!(owner, [s.request.id]);
    await s.commits.releaseProjection!(owner, ['unknown-recovery-269-request']);

    expect((await s.commits.list(owner)).find(item => item.id === s.request.id)?.state).toBe('queued');
    expect(await s.checkpoints.read(owner, `${resource.id}-source`)).toBeDefined();
    expect((await s.checkpoints.read(owner, `${resource.id}-target`))?.recoveryOrigins).toHaveLength(1);
  });

  it('keeps an unpinned source after a recovered target receives a real ACK', async () => {
    const resource: ResourceRef = { collection: 'studyNotes', id: 'legacy-unpinned-269' };
    const s = setup();
    s.snapshots.set(JSON.stringify([owner, resource.collection, resource.id]), initial(resource));
    const sourceId = recoveryCheckpointId(owner, `${resource.id}-source`);
    const sourceSession = new DataSession(initial(resource));
    sourceSession.edit(sourceDraft(resource));
    await s.checkpoints.put(record(`${resource.id}-source`, sourceSession.checkpoint()));
    const sourceBefore = (await s.checkpoints.read(owner, `${resource.id}-source`))!;
    const target = await forkCheckpoint({ read: s.checkpoints.read, create: s.checkpoints.create }, owner,
      sourceId, `${resource.id}-target`, resource);
    expect(target.recoveryOrigins).toBeUndefined();
    const targetSession = DataSession.restore(target.checkpoint);
    targetSession.edit(sourceDraft(resource));
    const request = await s.queue.save(target.editorId, targetSession.checkpoint(), {
      checkpoint: saved => {
        const submitted = DataSession.restore(target.checkpoint);
        submitted.registerCommit(saved.id, saved.editGeneration, saved.value, saved.command?.operationId);
        return { ...target, checkpoint: submitted.checkpoint() };
      },
    });
    if (!request) throw new Error('The recovered target did not produce a native commit request');
    await acknowledgeAndRelease(s, request);

    expect((await s.checkpoints.read(owner, `${resource.id}-source`))?.checkpoint).toEqual(sourceBefore.checkpoint);
    expect((await s.checkpoints.read(owner, `${resource.id}-source`))?.recoveryVersion).toBe(sourceBefore.recoveryVersion);
  });

  it('allows repeated projection release after an acknowledged recovered target settles', async () => {
    const resource: ResourceRef = { collection: 'studyNotes', id: 'repeated-release-269' };
    const s = await captureRecoveredTarget(resource, resource.id, sourceDraft(resource));
    await acknowledgeAndRelease(s, s.request);
    await s.commits.releaseProjection!(owner, [s.request.id]);

    expect(await s.checkpoints.read(owner, `${resource.id}-source`)).toBeUndefined();
    expect(await s.checkpoints.read(owner, `${resource.id}-target`)).toBeUndefined();
  });

  it('rolls back checkpoint cleanup if the native projection transaction fails', async () => {
    const resource: ResourceRef = { collection: 'studyNotes', id: 'rollback-target-269' };
    const s = await captureRecoveredTarget(resource, resource.id, sourceDraft(resource));
    const captured = (await s.checkpoints.read(owner, `${resource.id}-target`))!;
    const laterSession = DataSession.restore(captured.checkpoint);
    laterSession.edit({ ...laterSession.checkpoint().draft!, content: 'Later words retained through rollback' });
    await s.checkpoints.put({ ...captured, checkpoint: laterSession.checkpoint() });
    await s.queue.drain(true);
    const accepted = (await s.commits.list(owner)).find(item => item.id === s.request.id)!;
    expect(accepted.state).toBe('acknowledged');
    s.storage.writeFailure = true;

    await expect(s.commits.releaseProjection!(owner, [accepted.id])).rejects.toThrow('disk full');
    s.storage.writeFailure = false;

    expect(await s.checkpoints.read(owner, `${resource.id}-source`)).toBeDefined();
    expect((await s.checkpoints.read(owner, `${resource.id}-target`))?.recoveryOrigins).toHaveLength(1);
  });
});
