import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { DataEngineRuntime } from '../runtime';
import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const sourceRef = { collection: 'studyNotes', id: 'source' };
const targetRef = { collection: 'studyNotes', id: 'target' };
const sourceValue: DocumentData = { userId: 'owner', type: 'analysis', content: 'Local marks', analysis: { cuts: [5] } };
const absent: ResourceSnapshot = { resource: sourceRef, value: null, metadata: null };
const confirmed: ResourceSnapshot = { resource: targetRef,
  value: { userId: 'owner', type: 'analysis', content: 'Stored marks', analysis: { cuts: [2] } },
  metadata: { protocol: 1, generation: 'target-generation', revision: 1, deleted: false } };
const request = (id: string, editorId: string, baseline: ResourceSnapshot, value: DocumentData): CommitRequest => ({
  id, owner: 'owner', editorId, editGeneration: 1, baseline, value, predecessor: null, revision: 0,
  initialized: false, working: baseline, intended: value, command: null, submitted: null, sequence: 0,
  state: 'queued', result: null, unfinalized: [],
});
const project = (saved: CommitRequest): EditorRecord => {
  const session = new DataSession(saved.baseline); session.edit(saved.value); session.applyCommit(saved);
  return { owner: saved.owner, editorId: saved.editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
};
async function fixture() {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const initial = request('source-request', 'source-editor', absent, sourceValue);
  const captured = await commits.createWithCheckpoint!(initial, project);
  const source = await commits.compareAndSet(captured, { ...captured, initialized: true,
    command: { protocol: 1, operationId: captured.id, owner: 'owner', resource: sourceRef, generation: null,
      dependsOn: [], kind: 'create', value: sourceValue },
    state: 'refused', result: { kind: 'refused', operationId: captured.id, code: 'analysis-exists' } });
  const target = { ...request('target-request', 'target-editor', confirmed,
    { ...confirmed.value!, content: 'Both sets of marks', analysis: { cuts: [2, 5] } }),
    retentionScope: 'analysis-creation-transfer:source-request',
    transferredFrom: { source: sourceRef, requestIds: [source.id], value: sourceValue } };
  return { commits, checkpoints, source, target };
}

describe('native captured creation transfer', () => {
  beforeEach(() => { jest.clearAllMocks(); installStorageHarness(); });

  it('captures the replacement and its checkpoint while retiring only its exact refused source', async () => {
    const { commits, checkpoints, source, target } = await fixture();
    const result = await commits.createWithTransfer!(target, project, [source]);
    expect(result.request.id).toBe(target.id);
    expect(result.retired).toMatchObject([{ id: source.id, state: 'cancelled', cancelledByAction: true,
      transferredTo: { requestId: target.id, resource: targetRef } }]);
    const rows = await commits.list('owner');
    expect(rows.find(row => row.id === source.id)).toMatchObject({ state: 'cancelled', revision: source.revision + 1, unfinalized: [source.id] });
    expect(rows.find(row => row.id === target.id)?.value).toEqual(target.value);
    expect((await checkpoints.read('owner', target.editorId))?.checkpoint.pending[target.id].value).toEqual(target.value);
    expect((await commits.listCaptures!('owner', 'analysis-creation-transfer:')).map(row => row.id)).toEqual([target.id]);
    expect((await checkpoints.read('owner', source.editorId))?.checkpoint.draft).toEqual(sourceValue);
  });

  it('rolls back the target and source retirement when the target checkpoint cannot be stored', async () => {
    const { commits, checkpoints, source, target } = await fixture();
    await expect(commits.createWithTransfer!(target, () => { throw new Error('Checkpoint failed'); }, [source])).rejects.toThrow('Checkpoint failed');
    expect(await commits.list('owner')).toEqual([source]);
    expect(await checkpoints.read('owner', target.editorId)).toBeUndefined();
    expect(await commits.listCaptures!('owner', 'analysis-creation-transfer:')).toEqual([]);
    await expect(commits.createWithTransfer!(target, project, [source])).resolves.toMatchObject({ request: { id: target.id } });
  });

  it('rolls back a newly staged replacement when the source revision changed', async () => {
    const { commits, checkpoints, source, target } = await fixture();
    const newer = await commits.compareAndSet(source, { ...source, unfinalized: ['retained-proof'] });
    await expect(commits.createWithTransfer!(target, project, [source])).rejects.toMatchObject({ code: 'capture-transfer-changed' });
    expect(await commits.list('owner')).toEqual([newer]);
    expect(await checkpoints.read('owner', target.editorId)).toBeUndefined();
  });

  it('keeps an unselected later source capture instead of consuming only the first request', async () => {
    const { commits, source, target } = await fixture();
    const later = { ...request('later-request', 'later-editor', absent, { ...sourceValue, content: 'Later private marks' }), predecessor: source.id };
    await commits.create(later);
    await expect(commits.createWithTransfer!(target, project, [source])).rejects.toMatchObject({ code: 'capture-transfer-changed' });
    expect((await commits.list('owner')).map(row => row.state)).toEqual(['refused', 'queued']);
  });

  it.each(['prepared', 'conflict', 'acknowledged'] as const)('does not retire a source in %s state', async state => {
    const { commits, source, target } = await fixture();
    const changed = await commits.compareAndSet(source, { ...source, state });
    await expect(commits.createWithTransfer!(target, project, [changed])).rejects.toMatchObject({ code: 'capture-transfer-changed' });
    expect(await commits.list('owner')).toEqual([changed]);
  });

  it('does not let ordinary capture manufacture a transfer proof', async () => {
    const { commits, source, target } = await fixture();
    await expect(commits.createWithCheckpoint!(target, project)).rejects.toThrow('requires atomic source transfer');
    expect(await commits.list('owner')).toEqual([source]);
  });

  it('replays the exact transfer without replacing a newer private target checkpoint', async () => {
    const { commits, checkpoints, source, target } = await fixture();
    await commits.createWithTransfer!(target, project, [source]);
    const held = (await checkpoints.read('owner', target.editorId))!;
    const newer = { ...held, checkpoint: { ...held.checkpoint, draft: { ...held.checkpoint.draft, content: 'Later target words' }, editGeneration: 2 } };
    await checkpoints.put(newer);
    const replay = await commits.createWithTransfer!({ ...target, id: 'losing-replay-id' }, () => { throw new Error('Must not project twice'); }, [source]);
    expect(replay.request.id).toBe(target.id);
    expect(replay.retired).toEqual([]);
    expect((await commits.list('owner')).filter(row => row.transferredFrom)).toHaveLength(1);
    expect((await checkpoints.read('owner', target.editorId))?.checkpoint.draft?.content).toBe('Later target words');
  });

  it('retires the exact selected refused root and queued successor chain at its latest captured value', async () => {
    const { commits, checkpoints, source, target } = await fixture();
    const successorValue: DocumentData = { ...sourceValue, content: 'First queued marks', analysis: { cuts: [5, 8] } };
    const latestValue: DocumentData = { ...sourceValue, content: 'Latest queued marks', analysis: { cuts: [5, 8, 11] } };
    const first = { ...request('source-successor-2', source.editorId, absent, successorValue),
      editGeneration: 2, predecessor: source.id };
    const second = { ...request('source-successor-3', source.editorId, absent, latestValue),
      editGeneration: 3, predecessor: first.id };
    const unrelatedRef = { collection: 'studyNotes', id: 'unrelated-source' };
    const unrelated = request('unrelated-request', 'unrelated-editor',
      { resource: unrelatedRef, value: null, metadata: null }, { ...sourceValue, content: 'Unrelated private marks' });
    await commits.create(first);
    await commits.create(second);
    await commits.create(unrelated);
    const targetValue: DocumentData = { ...target.value!, content: 'Stored plus latest local marks', analysis: { cuts: [2, 5, 8, 11] } };
    const transfer = { ...target, value: targetValue, intended: targetValue,
      transferredFrom: { source: sourceRef, requestIds: [source.id, first.id, second.id], value: latestValue } };

    const result = await commits.createWithTransfer!(transfer, project, [source, first, second]);

    expect(result.retired.map(record => record.id)).toEqual([source.id, first.id, second.id]);
    expect(result.retired).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: source.id, state: 'cancelled', cancelledByAction: true }),
      expect.objectContaining({ id: first.id, predecessor: source.id, state: 'cancelled', cancelledByAction: true }),
      expect.objectContaining({ id: second.id, predecessor: first.id, state: 'cancelled', cancelledByAction: true }),
    ]));
    expect(result.request.value).toEqual(targetValue);
    expect(result.request.transferredFrom).toEqual(transfer.transferredFrom);
    const stored = await commits.list('owner');
    expect(stored.filter(record => record.state === 'cancelled').map(record => record.id).sort())
      .toEqual([source.id, first.id, second.id].sort());
    for (const original of [source, first, second]) {
      expect(stored.find(record => record.id === original.id)).toMatchObject({
        state: 'cancelled', cancelledByAction: true, revision: original.revision + 1,
        transferredTo: { requestId: target.id, resource: targetRef },
      });
    }
    expect(stored.find(record => record.id === target.id)?.value).toEqual(targetValue);
    expect(stored.find(record => record.id === unrelated.id)).toEqual(unrelated);
    expect((await checkpoints.read('owner', target.editorId))?.checkpoint.pending[target.id].value).toEqual(targetValue);
  });

  it('rejects an atomic refused source without changing either participant or any checkpoint', async () => {
    const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
    const peerRef = { collection: 'studyNotes', id: 'atomic-peer' };
    const peerBaseline: ResourceSnapshot = { resource: peerRef, value: null, metadata: null };
    const atomic = { id: 'atomic-source', participants: ['source-request', 'atomic-peer'], kind: 'analysis-reshape' as const };
    const initialSource = { ...request('source-request', 'source-editor', absent, sourceValue), atomic };
    const initialPeer = { ...request('atomic-peer', 'peer-editor', peerBaseline, { ...sourceValue, content: 'Peer marks' }), atomic };
    const [capturedSource, capturedPeer] = await commits.createBatch!([initialSource, initialPeer]);
    const sourceCommand = { protocol: 1 as const, operationId: capturedSource.id, owner: 'owner', resource: sourceRef,
      generation: null, dependsOn: [], kind: 'create' as const, value: sourceValue };
    const [source, peer] = await commits.compareAndSetBatch!([
      { previous: capturedSource, next: { ...capturedSource, initialized: true, command: sourceCommand,
        state: 'refused', result: { kind: 'refused', operationId: capturedSource.id, code: 'analysis-exists' } } },
      { previous: capturedPeer, next: { ...capturedPeer, initialized: true,
        state: 'refused', result: { kind: 'refused', operationId: capturedPeer.id, code: 'atomic-operation-conflict' } } },
    ]);
    const sourceSession = new DataSession(absent);
    sourceSession.edit(sourceValue);
    const sourceCheckpoint: EditorRecord = { owner: 'owner', editorId: source.editorId, checkpoint: sourceSession.checkpoint(),
      prepared: null, unfinalized: [] };
    await checkpoints.create(sourceCheckpoint);
    const beforeSourceCheckpoint = await checkpoints.read('owner', source.editorId);
    const target = { ...request('target-request', 'target-editor', confirmed,
      { ...confirmed.value!, content: 'Local marks', analysis: { cuts: [2, 5] } }),
      retentionScope: 'analysis-creation-transfer:source-request',
      transferredFrom: { source: sourceRef, requestIds: [source.id], value: sourceValue } };
    const beforeRows = await commits.list('owner');

    await expect(commits.createWithTransfer!(target, project, [source])).rejects.toMatchObject({ code: 'capture-transfer-changed' });

    expect(await commits.list('owner')).toEqual(beforeRows);
    expect((await commits.list('owner')).find(record => record.id === source.id)).toEqual(source);
    expect((await commits.list('owner')).find(record => record.id === peer.id)).toEqual(peer);
    expect(await checkpoints.read('owner', source.editorId)).toEqual(beforeSourceCheckpoint);
    expect(await checkpoints.read('owner', target.editorId)).toBeUndefined();
    expect(await commits.listCaptures!('owner', 'analysis-creation-transfer:')).toEqual([]);
  });

  it('keeps the target proof through source collection, replay, and capture release until projection completes', async () => {
    const { commits, checkpoints, source, target } = await fixture();
    const first = await commits.createWithTransfer!(target, project, [source]);
    const retiredSource = first.retired[0];
    expect(retiredSource.unfinalized).toContain(source.id);

    // Journal retirement is complete, but the source checkpoint still references the cancelled request.
    const finalizedSource = await commits.compareAndSet(retiredSource, { ...retiredSource, unfinalized: [] });
    expect((await commits.list('owner')).find(record => record.id === source.id)).toEqual(finalizedSource);
    const heldSourceCheckpoint = await checkpoints.read('owner', source.editorId);
    expect(heldSourceCheckpoint?.checkpoint.pending[source.id]).toBeDefined();

    // Canonical cancellation projection removes the pending reference while preserving the source draft.
    const settledSourceCheckpoint: EditorRecord = { ...heldSourceCheckpoint!,
      checkpoint: { ...heldSourceCheckpoint!.checkpoint, pending: {} }, completedCommits: [source.id] };
    await checkpoints.put(settledSourceCheckpoint);
    expect((await checkpoints.read('owner', source.editorId))?.checkpoint.draft).toEqual(sourceValue);
    expect((await commits.list('owner')).some(record => record.id === source.id)).toBe(false);

    const targetCapture = await commits.listCaptures!('owner', 'analysis-creation-transfer:');
    expect(targetCapture).toHaveLength(1);
    expect(targetCapture[0].id).toBe(target.id);
    expect(targetCapture[0].transferredFrom).toEqual(target.transferredFrom);

    const existingTargetCheckpoint = (await checkpoints.read('owner', target.editorId))!;
    const laterTargetCheckpoint: EditorRecord = { ...existingTargetCheckpoint,
      checkpoint: { ...existingTargetCheckpoint.checkpoint,
        draft: { ...existingTargetCheckpoint.checkpoint.draft!, content: 'Later target words' }, dirty: true, editGeneration: 2 } };
    await checkpoints.put(laterTargetCheckpoint);
    const replay = await commits.createWithTransfer!(target, () => { throw new Error('Replay must not rewrite the target checkpoint'); }, [source]);
    expect(replay.request.id).toBe(target.id);
    expect(replay.retired).toEqual([]);
    expect((await checkpoints.read('owner', target.editorId))?.checkpoint.draft?.content).toBe('Later target words');
    expect((await commits.list('owner')).some(record => record.id === source.id)).toBe(false);
    expect((await commits.listCaptures!('owner', 'analysis-creation-transfer:')).map(record => record.id)).toEqual([target.id]);

    await commits.releaseCapture!('owner', target.retentionScope!, target.id);
    expect(await commits.listCaptures!('owner', 'analysis-creation-transfer:')).toEqual([]);
    const heldTarget = (await commits.list('owner')).find(record => record.id === target.id)!;
    expect(heldTarget.transferredFrom).toEqual(target.transferredFrom);

    const acknowledged = await commits.compareAndSet(heldTarget, { ...heldTarget, working: confirmed, intended: confirmed.value,
      sequence: heldTarget.sequence + 1, state: 'acknowledged', result: { kind: 'acknowledged', operationId: target.id, snapshot: confirmed } });
    expect((await commits.list('owner')).find(record => record.id === target.id)).toEqual(acknowledged);
    const targetCheckpoint = (await checkpoints.read('owner', target.editorId))!;
    await checkpoints.put({ ...targetCheckpoint,
      checkpoint: { ...targetCheckpoint.checkpoint, confirmed, draft: confirmed.value, dirty: false, pending: {} },
      completedCommits: [target.id] });
    await commits.releaseProjection!('owner', [target.id]);
    expect((await commits.list('owner')).some(record => record.id === target.id)).toBe(false);
    await expect(commits.createWithTransfer!(target, project, [source])).rejects.toMatchObject({ code: 'commit-generation-complete' });
  });
});


describe('queue capture transfer publication', () => {
  beforeEach(() => { jest.clearAllMocks(); installStorageHarness(); });

  it('publishes source retirement only after the replacement is durably captured', async () => {
    const { commits, source, target } = await fixture();
    const queue = new CommitQueue({ store: commits, runtime: {} as DataEngineRuntime,
      operationId: () => target.id, readConfirmed: async () => confirmed });
    queue.setOwner('owner');
    const events: CommitRequest[] = []; queue.subscribe(event => events.push(event.request));
    const session = new DataSession(confirmed); session.edit(target.value);
    const options = { retentionScope: target.retentionScope,
      transfer: { proof: target.transferredFrom, sources: [source] }, checkpoint: project };
    const saved = await queue.save(target.editorId, session.checkpoint(), options);
    expect(saved?.transferredFrom).toEqual(target.transferredFrom);
    expect(events.map(row => [row.id, row.state])).toEqual([[source.id, 'cancelled'], [target.id, 'queued']]);
    expect((await commits.list('owner')).find(row => row.id === source.id)?.transferredTo?.requestId).toBe(saved?.id);
    await queue.save(target.editorId, session.checkpoint(), options);
    expect(await commits.list('owner')).toHaveLength(2);
  });

  it('captures an unchanged destination when its exact source still needs durable ownership', async () => {
    const { commits, source, target } = await fixture();
    const queue = new CommitQueue({ store: commits, runtime: {} as DataEngineRuntime,
      operationId: () => target.id, readConfirmed: async () => confirmed });
    queue.setOwner('owner');
    const options = { retentionScope: target.retentionScope,
      transfer: { proof: target.transferredFrom, sources: [source] }, checkpoint: project };
    expect(await queue.save(target.editorId, new DataSession(confirmed).checkpoint(), options)).toMatchObject({ transferredFrom: target.transferredFrom });
    expect((await commits.list('owner')).find(row => row.id === source.id)?.state).toBe('cancelled');
  });

  it('refuses a transfer on a document-only port before capturing or retiring anything', async () => {
    const { commits, source, target } = await fixture();
    const create = jest.fn(commits.create);
    const queue = new CommitQueue({ store: { list: commits.list, create, compareAndSet: commits.compareAndSet },
      runtime: {} as DataEngineRuntime, operationId: () => target.id, readConfirmed: async () => confirmed });
    queue.setOwner('owner');
    const session = new DataSession(confirmed); session.edit(target.value);
    const options = { retentionScope: target.retentionScope,
      transfer: { proof: target.transferredFrom, sources: [source] }, checkpoint: project };
    await expect(queue.save(target.editorId, session.checkpoint(), options)).rejects.toThrow('Atomic capture transfer storage is required');
    expect(create).not.toHaveBeenCalled();
    expect(await commits.list('owner')).toEqual([source]);
  });
});
