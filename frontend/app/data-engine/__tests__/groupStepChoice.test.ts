import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';
import { initializeCommit } from '../atomicCommits';
import { CommitQueue, createMemoryCommitStore } from '../commits';
import { captureGroupStepPlacement } from '../groupStepPlacement';
import { projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { DataEngineRuntime } from '../runtime';
import { planDataCommand } from '../serverRelations';
import { DataSession } from '../session';

import type { CommitRequest } from '../commits';
import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'groups', id: 'group' };
const metadata = { protocol: 1 as const, generation: 'group-generation', revision: 1, deleted: false };
const time = { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_014 };
const flow = (order: string, duration = 12) => [...order].map((id, index) => ({
  id, templateId: 'template-' + id, order: index + 1, durationMin: id === 'b' ? duration : 12,
}));
const value = (order: string, duration = 12): DocumentData => ({ userId: 'owner', flow: flow(order, duration) });
const snapshot = (order: string, duration: number, revision: number): ResourceSnapshot => ({
  resource, value: value(order, duration), metadata: { ...metadata, revision },
});
function request(id: string, after: DocumentData, predecessor: string | null = null): CommitRequest {
  const baseline = snapshot('abcd', 12, 1);
  return { id, owner: 'owner', editorId: 'group-editor', editGeneration: predecessor ? 2 : 1, predecessor,
    baseline, working: baseline, value: after, intended: after, initialized: false, command: null,
    submitted: null, state: 'cancelled', sequence: 0, revision: 0, result: null, unfinalized: [],
    ...(predecessor && { retainedAfterChoice: true as const }) };
}

it.each([
  { choice: 'saved', accepted: 'acbd', retained: 'adcb' },
  { choice: 'local', accepted: 'bacd', retained: 'badc' },
])('keeps the second exact move and the current duration after choosing $choice', ({ accepted, retained }) => {
  const first = request('first', value('bacd'));
  const second = request('second', value('badc'), first.id);
  second.groupFlowStepPlacement = captureGroupStepPlacement(first.value!.flow, second.value!.flow, 'd', metadata.generation, 1, time);
  const stored = snapshot(accepted, 40, 3);
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  expect(copy.checkpoint.draft?.flow).toEqual(flow(retained, 40));

  const newer = snapshot(accepted, 50, 4);
  const recovered = recoverManualChoiceCopy(copy, newer);
  expect(recovered.checkpoint.draft?.flow).toEqual(flow(retained, 50));
  expect(recovered.checkpoint.groupFlowStepPlacementRetry?.placement).toMatchObject({
    stepId: 'd', time, observedRevision: 1,
  });
});

it('keeps an unavailable step move recoverable without rebuilding a removed anchor', () => {
  const first = request('first', value('bacd'));
  const second = request('second', value('badc'), first.id);
  second.groupFlowStepPlacement = captureGroupStepPlacement(first.value!.flow, second.value!.flow, 'd', metadata.generation, 1, time);
  const stored = snapshot('abd', 40, 3);
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  expect(copy.checkpoint.dirty).toBe(true);
  expect(() => recoverManualChoiceCopy(copy, stored)).toThrow(/position is unavailable/);
  expect(stored.value?.flow).toEqual(flow('abd', 40));
});

it.each([false, true])('only carries the first versionless placement revision from its exact ACK (newer receipt: %s)', newer => {
  const legacy = { ...snapshot('abcd', 12, 1), metadata: null };
  const first = { ...request('first', value('abcd')), state: 'acknowledged' as const, baseline: legacy, working: legacy };
  const accepted = { ...snapshot('abcd', 40, 1), metadata: { ...metadata, operationId: first.id } };
  const result = { kind: 'acknowledged' as const, operationId: first.id,
    snapshot: newer ? snapshot('abcd', 50, 2) : accepted, committed: accepted.metadata };
  const second = { ...request('second', value('bacd'), first.id), baseline: legacy, working: legacy, state: 'queued' as const,
    groupFlowStepPlacement: captureGroupStepPlacement(legacy.value!.flow, flow('bacd'), 'b', null, 0, time) };
  expect(initializeCommit(second, [{ ...first, result }, second])).toMatchObject({
    working: result.snapshot, intended: value('bacd', newer ? 50 : 40),
    ...(newer ? {} : { groupFlowPlacementLegacyRevision: 1 }),
  });
  if (newer) expect(initializeCommit(second, [{ ...first, result }, second])).not.toHaveProperty('groupFlowPlacementLegacyRevision');
});

it('binds an archived versionless move to its first known generation without advancing its opening revision', () => {
  const first = request('first', value('bacd'));
  const second = request('second', value('badc'), first.id);
  second.groupFlowStepPlacement = captureGroupStepPlacement(first.value!.flow, second.value!.flow, 'd', null, 0, time);
  const stored = snapshot('acbd', 40, 3);
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  expect(recoverManualChoiceCopy(copy, stored).checkpoint.groupFlowStepPlacementRetry).toMatchObject({
    generation: metadata.generation, placement: { observedRevision: 0, stepId: 'd', time },
  });
});

it('keeps an independent removal after an earlier placement was displaced', () => {
  const stored = snapshot('acbd', 40, 3);
  const first = { ...request('first', value('bacd')), state: 'acknowledged' as const,
    result: { kind: 'acknowledged' as const, operationId: 'first', snapshot: stored },
    groupFlowStepPlacement: captureGroupStepPlacement(flow('abcd'), flow('bacd'), 'b', metadata.generation, 1, time) };
  const second = { ...request('second', value('bcd'), first.id), state: 'queued' as const };
  expect(initializeCommit(second, [first, second])).toMatchObject({
    state: 'queued', working: stored, intended: value('cbd', 40),
  });
});

it('keeps a pending removal visible after the server displaces a prior placement', () => {
  const session = new DataSession(snapshot('abcd', 12, 1));
  const first = { ...request('first', value('bacd')), state: 'acknowledged' as const,
    result: { kind: 'acknowledged' as const, operationId: 'first', snapshot: snapshot('acbd', 40, 3) },
    groupFlowStepPlacement: captureGroupStepPlacement(flow('abcd'), flow('bacd'), 'b', metadata.generation, 1, time) };
  const second = { ...request('second', value('bcd'), first.id), state: 'queued' as const };
  for (const saved of [first, second]) {
    session.edit(saved.value);
    session.registerCommit(saved.id, session.checkpoint().editGeneration, saved.value, undefined, saved);
  }
  expect(session.applyCommit(first)).toBe(true);
  expect(session.checkpoint()).toMatchObject({ draft: value('cbd', 40), conflicts: [] });
});

it('saves words and duration typed before a recovered move is submitted as a separate change', async () => {
  const opening = snapshot('acbd', 40, 3);
  const session = new DataSession(opening);
  const move = captureGroupStepPlacement(opening.value!.flow, flow('adcb', 40), 'd', metadata.generation, 1, time)!;
  session.stageGroupStepPlacementRetry(move, value('adcb', 40));
  const edited = { ...value('adcb', 50), description: 'Notes typed after recovery' };
  session.edit(edited, undefined, { field: 'group-step-duration', rowId: 'b', time });
  const transport = { read: async () => opening, send: async () => { throw new Error('No delivery in this capture test'); } };
  const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => {}, remove: async () => {} } });
  let next = 0;
  const queue = new CommitQueue({ store: createMemoryCommitStore(), runtime, operationId: () => 'move-' + ++next, readConfirmed: async () => opening });
  queue.setOwner('owner');
  const first = (await queue.save('group-editor', session.checkpoint()))!;
  expect(first.value).toEqual(value('adcb', 40));
  expect(first.groupStepDurationActions).toBeUndefined();
  session.applyCommit(first);
  expect(session.checkpoint().editGeneration).toBeGreaterThan(first.editGeneration);
  session.applyCommit({ ...first, state: 'acknowledged',
    result: { kind: 'acknowledged', operationId: first.id, snapshot: snapshot('adcb', 40, 4) } });
  expect(session.checkpoint()).toMatchObject({ draft: edited, dirty: true });
  const second = (await queue.save('group-editor', session.checkpoint()))!;
  expect(second.value).toEqual(edited);
  expect(second.groupFlowStepPlacement).toBeUndefined();
  expect(second.groupStepDurationActions).toMatchObject([{ rowId: 'b', after: 50 }]);
});


it.each([
  { choice: 'local', overlap: false, order: 'adcb', duringChoice: false },
  { choice: 'remote', overlap: false, order: 'acbd', duringChoice: false },
  { choice: 'local', overlap: true, order: 'adcb', duringChoice: false },
  { choice: 'remote', overlap: true, order: 'acbd', duringChoice: false },
  { choice: 'local', overlap: true, order: 'adcb', duringChoice: true },
  { choice: 'remote', overlap: true, order: 'acbd', duringChoice: true },
])('keeps unqueued typing when the recovered move conflicts before autosave ($choice, overlap: $overlap, during choice: $duringChoice)', async ({ choice, overlap, order, duringChoice }) => {
  const opening = snapshot('acbd', 40, 3);
  const initial = { ...opening, value: { ...opening.value!, title: 'Group', status: 'active',
    createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
    templates: [...'abcd'].map(id => ({ id: 'template-' + id, type: 'custom', status: 'filled', title: id,
      createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' })),
  } };
  const h = documentEngineHarness(initial, { apply: async (command, stored) => (await planDataCommand(command, stored,
    { get: async () => stored, list: async () => [stored] })).result });
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false);
  engine.setOwner('owner');
  const editorId = browser.editorId(resource);
  const recovered = new DataSession(initial);
  const placed = { ...initial.value, flow: flow('adcb', 40) };
  const move = captureGroupStepPlacement(opening.value!.flow, placed.flow, 'd', metadata.generation, 0, time)!;
  recovered.stageGroupStepPlacementRetry(move, placed);
  await h.checkpoints.put({ owner: 'owner', editorId, checkpoint: recovered.checkpoint(), prepared: null, unfinalized: [] });
  const editor = await engine.openEditor(resource, editorId);
  try {
    const description = 'Unqueued words while the position is being saved';
    const edited = { ...placed, flow: flow('adcb', 50), description };
    const typeTail = () => Promise.all([
      editor.edit(edited, undefined, { field: 'group-step-duration', rowId: 'b', time }),
      editor.edit({ ...edited, title: 'New group title' }, undefined, { field: 'title', time }),
    ]);
    if (!duringChoice) await typeTail();
    await editor.save();
    if (overlap) h.silentRemote({ description: 'Separately stored words' });
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();
    expect(editor.getState().result).toMatchObject({ kind: 'conflict', serviceOrderPlacementComparison: { step: { id: 'd' } } });
    const choose = () => choice === 'local' ? editor.keepLocal(undefined, undefined, null) : editor.acceptRemote();
    if (duringChoice) {
      let reached!: () => void;
      const committed = new Promise<void>(resolve => { reached = resolve; });
      h.storage.holdCompletionAfterCommit = (rows, mode) => {
        if (mode !== 'readwrite' || ![...rows.values()].some(row => (row as CommitRequest | undefined)?.state === 'cancelled')) return false;
        h.storage.holdCompletionAfterCommit = undefined;
        reached();
        return true;
      };
      const choosing = choose();
      await committed;
      const typing = typeTail();
      h.storage.finishCompletion();
      await choosing;
      await typing;
    } else await choose();
    await engine.retry();
    await settleEngine();
    const after = editor.getState().checkpoint;
    expect(h.server.value?.flow).toEqual(flow(order, 40));
    const positionCommands = jest.mocked(h.transport.send).mock.calls.map(([command]) => command)
      .filter(command => command.kind === 'update' && command.groupFlowStepPlacement);
    expect(positionCommands).toHaveLength(choice === 'local' ? 2 : 1);
    if (overlap) {
      expect(after.draft?.description).toBe('Separately stored words');
      const retained = await h.checkpoints.listManualChoiceCopies!('owner', resource);
      expect(retained).toHaveLength(1);
      expect(retained[0].record.checkpoint.draft).toMatchObject({ flow: flow('adcb', 50), description });
      await h.remote({ description: 'Newer saved words', flow: flow(order, 60) });
      const recovered = await engine.recoverEditor(resource, browser.editorId(resource), retained[0].id);
      expect(recovered.getState().checkpoint).toMatchObject({
        draft: { flow: flow(order, 50), description }, remoteCandidate: { value: { description: 'Newer saved words' } },
        conflicts: [{ path: ['description'] }], groupStepDurationDrafts: { b: { action: { time } } },
        groupTitleDraft: { action: { after: 'New group title', time } },
      });
      await expect(recovered.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
      expect(h.server.value).toMatchObject({ description: 'Newer saved words', flow: flow(order, 60) });
      await recovered.keepLocal();
      expect(recovered.getState().checkpoint).toMatchObject({
        draft: { description, flow: flow(order, 50) }, conflicts: [],
        groupStepDurationDrafts: { b: { action: { observedRevision: 3, time } } },
        groupTitleDraft: { action: { observedRevision: 3, time } },
      });
      return;
    }
    expect(after).toMatchObject({ draft: { flow: flow(order, 50), description }, dirty: true, conflicts: [] });
    expect(after.groupStepDurationDrafts?.b.action).toMatchObject({ after: 50, observedRevision: 3, time });
    expect((await h.checkpoints.read('owner', editorId))?.checkpoint).toMatchObject({
      draft: { flow: flow(order, 50), description, title: 'New group title' }, groupStepDurationDrafts: { b: { action: { time } } },
      groupTitleDraft: { action: { after: 'New group title', time } },
    });
    await editor.save();
    await engine.retry();
    await settleEngine();
    expect(h.server.value).toMatchObject({ flow: flow(order, 50), description });
  } finally { browser.dispose(); }
});
