import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';
import { initializeCommit } from '../atomicCommits';
import { captureCouncilTopicPlacement } from '../councilTopicPlacement';
import { editorIdentity } from '../editorIdentity';
import { projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { ordinaryAnswerChoice, ordinaryStoredChoice } from '../ordinaryAnswerChoice';
import { diffFields } from '../protocol';
import { planDataCommand } from '../serverRelations';

import type { CommitRequest } from '../commits';
import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'councils', id: 'council' };
const metadata = { protocol: 1 as const, generation: 'council-generation', revision: 1, deleted: false };
const time = { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_014 };
const topics = (order: string, words = 'First words') => [...order].map(id => ({ id, title: 'Section ' + id,
  summary: id === 'b' ? words : '', questions: [], options: [] }));
const value = (order: string, words?: string): DocumentData => ({ userId: 'owner', status: 'preparing', topics: topics(order, words) });
const snapshot = (order: string, words: string, revision: number): ResourceSnapshot => ({
  resource, value: value(order, words), metadata: { ...metadata, revision },
});
function request(id: string, after: DocumentData, predecessor: string | null = null): CommitRequest {
  const baseline = snapshot('abcd', 'First words', 1);
  return { id, owner: 'owner', editorId: 'council-editor', editGeneration: predecessor ? 2 : 1, predecessor,
    baseline, working: baseline, value: after, intended: after, initialized: false, command: null,
    submitted: null, state: 'cancelled', sequence: 0, revision: 0, result: null, unfinalized: [],
    ...(predecessor && { retainedAfterChoice: true as const }) };
}

it.each([
  { order: 'acbd', expected: 'adcb' },
  { order: 'bacd', expected: 'badc' },
])('recovers only the second topic move after choosing $order', ({ order, expected }) => {
  const first = request('first', value('bacd'));
  const second = request('second', value('badc'), first.id);
  second.councilTopicPlacement = captureCouncilTopicPlacement(first.value!.topics, second.value!.topics, 'd', metadata.generation, 1, time);
  const stored = snapshot(order, 'Words saved elsewhere', 3);
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  expect(copy.checkpoint.draft?.topics).toEqual(topics(expected, 'Words saved elsewhere'));

  const fresh = snapshot(order, 'Still newer words', 4);
  const recovered = recoverManualChoiceCopy(copy, fresh);
  expect(recovered.checkpoint.draft?.topics).toEqual(topics(expected, 'Still newer words'));
  expect(recovered.checkpoint.councilTopicPlacementRetry?.placement).toMatchObject({ stepId: 'd', time, observedRevision: 1 });
});

it('requires a separate choice for a queued summary that overlaps words stored while the position was pending', () => {
  const first = request('first', { ...value('bacd'), title: 'Opening council' });
  first.councilTopicPlacement = captureCouncilTopicPlacement(first.baseline.value!.topics, first.value!.topics, 'b', metadata.generation, 1, time);
  const second = request('second', { ...value('bacd', 'Typed before the position answered'), title: 'Private title' }, first.id);
  second.councilTitleAction = { before: 'Opening council', after: 'Private title', observedRevision: 1, time };
  const stored = snapshot('acbd', 'Separately stored words', 3);
  stored.value = { ...stored.value, title: 'Separately stored title' };
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  const current = snapshot('acbd', 'Newer saved words', 4);
  current.value = { ...current.value, title: 'Newer saved title' };
  expect(recoverManualChoiceCopy(copy, current).checkpoint).toMatchObject({
    draft: { ...value('acbd', 'Typed before the position answered'), title: 'Private title' }, remoteCandidate: current,
    conflicts: [{ path: ['topics', 'id:b', 'summary'] }],
    councilTitleDraft: { action: { observedRevision: 1, time } },
  });
});

it('leaves a retained move readable if its anchor is gone or the council is held', () => {
  const first = request('first', value('bacd'));
  const second = request('second', value('badc'), first.id);
  second.councilTopicPlacement = captureCouncilTopicPlacement(first.value!.topics, second.value!.topics, 'd', metadata.generation, 1, time);
  const stored = snapshot('acbd', 'Words saved elsewhere', 3);
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  expect(() => recoverManualChoiceCopy(copy, snapshot('abd', 'Still newer words', 4))).toThrow(/position is unavailable/);
  expect(() => recoverManualChoiceCopy(copy, { ...stored, value: { ...stored.value, status: 'held' } })).toThrow(/position is unavailable/);
  expect(copy.checkpoint.draft?.topics).toEqual(topics('adcb', 'Words saved elsewhere'));
});

it.each([false, true])('carries a versionless opening only across the exact acknowledgement (newer receipt: %s)', newer => {
  const legacy = { ...snapshot('abcd', 'First words', 1), metadata: null };
  const first = { ...request('first', value('abcd')), state: 'acknowledged' as const, baseline: legacy, working: legacy };
  const accepted = { ...snapshot('abcd', 'Own prior words', 1), metadata: { ...metadata, operationId: first.id } };
  const result = { kind: 'acknowledged' as const, operationId: first.id,
    snapshot: newer ? snapshot('abcd', 'Still newer words', 2) : accepted, committed: accepted.metadata };
  const second = { ...request('second', value('bacd'), first.id), baseline: legacy, working: legacy, state: 'queued' as const,
    councilTopicPlacement: captureCouncilTopicPlacement(legacy.value!.topics, topics('bacd'), 'b', null, 0, time) };
  const queued = initializeCommit(second, [{ ...first, result }, second]);
  expect(queued?.intended).toEqual(value('bacd', newer ? 'Still newer words' : 'Own prior words'));
  expect(queued?.councilTopicPlacementLegacyRevision).toBe(newer ? undefined : 1);
});

function retireUnsignedCouncilOrder(edited: DocumentData, stored: ResourceSnapshot) {
  const first = request('legacy', edited);
  const refused: CommitRequest = { ...first, editorId: editorIdentity('tab', resource, 'detail', 'one'),
    initialized: true, state: 'refused', submitted: edited,
    command: { protocol: 1, kind: 'update', owner: first.owner, operationId: first.id,
      resource, generation: metadata.generation, dependsOn: [], changes: diffFields(first.baseline.value!, edited) },
    result: { kind: 'refused', operationId: first.id, code: 'council-topic-placement-needs-review' },
  };
  const choice = ordinaryAnswerChoice(refused, [refused]);
  expect(choice).not.toBeNull();
  return ordinaryStoredChoice('owner', [choice!], [{ ...refused, state: 'cancelled', revision: 1 }], stored).editorRecords;
}

it('keeps the refused unsigned council Save’s words without restoring its topic order', () => {
  const stored = snapshot('acbd', 'Words saved elsewhere', 3);
  const [copy] = retireUnsignedCouncilOrder({ ...value('bacd', 'Words from the older device'), title: 'My council' }, stored);
  expect(copy).toBeDefined();
  const current = snapshot('dacb', 'Even newer words', 4);
  expect(recoverManualChoiceCopy(copy, current).checkpoint).toMatchObject({
    draft: { ...value('dacb', 'Words from the older device'), title: 'My council' },
    confirmed: current, remoteCandidate: current, conflicts: [{ path: ['topics', 'id:b', 'summary'] }],
  });
});

it('requires explicit review instead of silently recreating a topic edited in a refused unsigned Save', () => {
  const stored = snapshot('acd', 'First words', 3);
  const [copy] = retireUnsignedCouncilOrder(value('bacd', 'Kept after deletion'), stored);
  expect(copy).toBeDefined();
  expect(recoverManualChoiceCopy(copy, stored).checkpoint).toMatchObject({
    confirmed: stored, remoteCandidate: stored, conflicts: [{ path: ['topics', 'id:b'] }],
  });
});

it('creates no extra draft for an unsigned topic move with no authored fields', () => {
  expect(retireUnsignedCouncilOrder({ ...value('bacd'), updatedAt: '2026-11-09' }, snapshot('acbd', 'First words', 3))).toEqual([]);
});


it('keeps the unqueued summary when a signed move reaches an already held council', async () => {
  const initial = snapshot('abcd', 'First words', 1);
  initial.value = { ...initial.value, title: 'Council', createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' };
  const h = documentEngineHarness(initial, { apply: async (command, stored) => (await planDataCommand(command, stored,
    { get: async () => stored, list: async () => [stored] })).result });
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false);
  engine.setOwner('owner');
  const editor = await engine.openEditor(resource, browser.editorId(resource));
  try {
    const submitted = { ...initial.value, topics: topics('bacd') };
    const move = captureCouncilTopicPlacement(initial.value.topics, submitted.topics, 'b', metadata.generation, 1, time)!;
    await editor.commit(() => submitted, { kind: 'council-topic-placement', move });
    await editor.edit({ ...submitted, topics: topics('bacd', 'Words typed before the refusal') });
    h.silentRemote({ status: 'held', topics: topics('acbd', 'Stored from the other device') });
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();
    expect(h.transport.send).toHaveBeenCalledWith(expect.objectContaining({ councilTopicPlacement: expect.objectContaining({ stepId: 'b' }) }));
    expect(editor.getState().result).toMatchObject({ kind: 'refused', code: 'council-topic-placement-needs-review' });
    await editor.acceptRemote();
    expect(editor.getState().checkpoint).toMatchObject({ confirmed: h.server, draft: h.server.value, dirty: false });
    const retained = await h.checkpoints.listManualChoiceCopies!('owner', resource);
    expect(retained).toHaveLength(1);
    expect(retained[0].record.checkpoint.draft?.topics).toEqual(topics('bacd', 'Words typed before the refusal'));
    expect(() => recoverManualChoiceCopy(retained[0].record)).toThrow(expect.objectContaining({ code: 'reopen-council-to-recover' }));
    expect(recoverManualChoiceCopy(retained[0].record, snapshot('acbd', 'Stored from the other device', 3)).checkpoint).toMatchObject({
      draft: { topics: topics('acbd', 'Words typed before the refusal') },
      conflicts: [{ path: ['topics', 'id:b', 'summary'] }],
    });
  } finally { browser.dispose(); }
});


it('keeps unconflicted words in a held council’s local copy until the council reopens', () => {
  const stored = snapshot('acbd', 'First words', 3);
  stored.value = { ...stored.value, status: 'held' };
  const [copy] = retireUnsignedCouncilOrder(value('bacd', 'Words to keep locally'), stored);
  expect(() => recoverManualChoiceCopy(copy)).toThrow(expect.objectContaining({ code: 'reopen-council-to-recover' }));
  const reopened = snapshot('acbd', 'First words', 4);
  expect(recoverManualChoiceCopy(copy, reopened).checkpoint).toMatchObject({
    confirmed: reopened, draft: value('acbd', 'Words to keep locally'), conflicts: [],
  });
});
