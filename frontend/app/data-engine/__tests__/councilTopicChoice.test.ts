import { waitFor } from '@testing-library/react';

import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';
import { initializeCommit } from '../atomicCommits';
import { captureCouncilTopicPlacement } from '../councilTopicPlacement';
import { COUNCIL_TOPIC_TEXT, COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED, councilTopicTextId, type CouncilTopicTextField } from '../councilTopicTextAction';
import { readCouncilTopicTextComparison } from '../councilTopicTextReview';
import { editorIdentity } from '../editorIdentity';
import { projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { ordinaryAnswerChoice, ordinaryStoredChoice } from '../ordinaryAnswerChoice';
import { diffFields } from '../protocol';
import { existingRowField, replaceExistingRowField, rowConflictPath, rowConflictValue } from '../rowFieldAction';
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


describe('council nested text choices through the durable editor', () => {
  const owner = 'owner';
  const id = (field: CouncilTopicTextField) => councilTopicTextId('topic', 'item', field);
  const at = (clock: number) => ({ earliestMs: 1_800_000_000_000 + clock, latestMs: 1_800_000_000_001 + clock });
  const opening = {
    id: 'topic', title: 'Section', kind: 'decision', summary: 'Opening summary',
    questions: [{ id: 'item', question: 'Opening question', answer: 'Opening answer' }],
    options: [{ id: 'item', text: 'Opening option' }],
  };
  const initial: ResourceSnapshot = { resource, metadata, value: { userId: owner, title: 'Council',
    status: 'preparing', rev: 1, topics: [opening], updatedAt: 'opening' } };
  const read = (doc: DocumentData | null, field: CouncilTopicTextField) => existingRowField(doc?.topics, id(field), COUNCIL_TOPIC_TEXT);
  const conflict = (field: CouncilTopicTextField, mine: string, shown: string, code?: string) => ({
    path: rowConflictPath(id(field), COUNCIL_TOPIC_TEXT), base: rowConflictValue(read(initial.value, field)!),
    mine: rowConflictValue(mine), theirs: rowConflictValue(shown), ...(code && { code }),
  });
  const delay = (h: ReturnType<typeof documentEngineHarness>, conflicts: ReturnType<typeof conflict>[]) => {
    jest.mocked(h.transport.send).mockImplementationOnce(async command => ({
      kind: 'conflict', operationId: command.operationId, snapshot: h.server, conflicts,
    }));
  };
  const open = async (fields?: DocumentData) => {
    const h = documentEngineHarness(fields ? { ...initial, value: { ...initial.value, ...fields } } : initial);
    const engine = h.createBrowser().engine;
    engine.setOwner(owner); engine.setOnline(false);
    const editor = await engine.openEditor(resource, editorIdentity('tab-A', resource, 'council', 'first'));
    const editField = async (field: CouncilTopicTextField, text: string, millis: number) => {
      const checkpoint = editor.getState().checkpoint;
      const draft = checkpoint.draft!;
      await editor.edit({ ...draft, topics: replaceExistingRowField(draft.topics, id(field), text, COUNCIL_TOPIC_TEXT)! },
        checkpoint, { field: 'council-topic-text', rowId: id(field), time: at(millis) });
    };
    return { h, engine, editor, editField };
  };

  it.each(['local', 'saved'] as const)('keeps the ordered winners and independent summary when the %s option is selected', async side => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Earlier local question', 10);
      await editField('answer', 'Later local answer', 40);
      await editField('option', 'Uncertain local option', 30);
      const draft = editor.getState().checkpoint.draft!;
      const topic = (draft.topics as Record<string, unknown>[])[0];
      await editor.edit({ ...draft, topics: [{ ...topic, summary: 'Independent summary' } as DocumentData] });
      await editor.save();
      h.silentRemote({ rev: 3, updatedAt: 'server', topics: [{ ...opening, options: [{ id: 'item', text: 'Saved option' }] }] });
      delay(h, [
        conflict('question', 'Earlier local question', 'Opening question', COUNCIL_TOPIC_TEXT_SETTLED),
        conflict('answer', 'Later local answer', 'Opening answer', COUNCIL_TOPIC_TEXT_QUEUED),
        conflict('option', 'Uncertain local option', 'Saved option'),
      ]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      expect(h.transport.send).toHaveBeenCalledWith(expect.objectContaining({
        councilTopicTextActions: expect.arrayContaining([
          { rowId: id('question'), rowCreatedAt: id('question'), observedRevision: 1, time: at(10) },
          { rowId: id('answer'), rowCreatedAt: id('answer'), observedRevision: 1, time: at(40) },
        ]),
      }));
      const compared = editor.getState().checkpoint;
      expect(readCouncilTopicTextComparison(compared)).toMatchObject({ field: 'option', mine: 'Uncertain local option', stored: 'Saved option' });
      if (side === 'local') await editor.keepLocal(undefined, compared, at(80));
      else await editor.acceptRemote(undefined, compared);
      await waitFor(() => expect(read(h.server.value, 'answer')).toBe('Later local answer'));
      expect(read(h.server.value, 'question')).toBe('Opening question');
      expect(read(h.server.value, 'option')).toBe(side === 'local' ? 'Uncertain local option' : 'Saved option');
      expect(h.server.value?.topics).toMatchObject([{ summary: 'Independent summary' }]);
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTopicTextActions: [
          { rowId: id('answer'), rowCreatedAt: id('answer'), observedRevision: 1, time: at(40) },
          ...(side === 'local' ? [{ rowId: id('option'), rowCreatedAt: id('option'), observedRevision: 2, time: at(80) }] : []),
        ],
      }));
    } finally { engine.dispose(); }
  });

  it.each(['local', 'saved'] as const)('keeps a later question when reviewing the %s outcome', async side => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Later local question', 40);
      const checkpoint = editor.getState().checkpoint;
      const draft = checkpoint.draft!;
      const [topic] = draft.topics as DocumentData[];
      await editor.edit({ ...draft, topics: [{ ...topic, decision: 'Local outcome' }] }, checkpoint,
        { field: 'council-topic-outcome', rowId: 'topic', time: null });
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, decision: 'Saved outcome' }] });
      jest.mocked(h.transport.send).mockImplementationOnce(async command => ({
        kind: 'conflict', operationId: command.operationId, snapshot: h.server, conflicts: [
          conflict('question', 'Later local question', 'Opening question', COUNCIL_TOPIC_TEXT_QUEUED),
          { path: ['topics', 'id:topic', 'outcome'], base: rowConflictValue({}),
            mine: rowConflictValue({ decision: 'Local outcome' }), theirs: rowConflictValue({ decision: 'Saved outcome' }) },
        ],
      }));
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      const compared = editor.getState().checkpoint;
      expect(readCouncilTopicTextComparison(compared)).toMatchObject({
        field: 'outcome', mine: { decision: 'Local outcome' }, stored: { decision: 'Saved outcome' },
      });
      if (side === 'local') await editor.keepLocal(undefined, compared, at(80));
      else await editor.acceptRemote(undefined, compared);
      await waitFor(() => expect(read(h.server.value, 'question')).toBe('Later local question'));
      expect(h.server.value?.topics).toMatchObject([{ decision: side === 'local' ? 'Local outcome' : 'Saved outcome',
        options: opening.options }]);
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTopicTextActions: [expect.objectContaining({ rowId: id('question'), time: at(40) })],
        ...(side === 'local' && { councilOutcomeActions: [expect.objectContaining({ rowId: 'topic', time: at(80) })] }),
      }));
    } finally { engine.dispose(); }
  });

  it.each(['local', 'saved'] as const)('keeps the ordered question when reviewing the %s assembly mark', async side => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Later local question', 40);
      await editor.commit(draft => {
        const [topic] = draft!.topics as DocumentData[];
        return { ...draft, topics: [{ ...topic, forAssembly: true }] };
      }, { kind: 'council-assembly', flag: {
        rowId: 'topic', before: false, after: true, generation: metadata.generation, observedRevision: 1, time: null,
      } });
      // The other device toggled the same mark off after a concurrent edit; its stored value equals the opening.
      h.silentRemote({ topics: [{ ...opening, forAssembly: true }] });
      h.silentRemote({ topics: [{ ...opening, forAssembly: false }] });
      jest.mocked(h.transport.send).mockImplementationOnce(async command => ({
        kind: 'conflict', operationId: command.operationId, snapshot: h.server, conflicts: [
          conflict('question', 'Later local question', 'Opening question', COUNCIL_TOPIC_TEXT_QUEUED),
          { path: ['topics', 'id:topic', 'forAssembly'], base: rowConflictValue(false),
            mine: rowConflictValue(true), theirs: rowConflictValue(false) },
        ],
      }));
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      const compared = editor.getState().checkpoint;
      expect(readCouncilTopicTextComparison(compared)).toMatchObject({ field: 'assembly', mine: true, stored: false });
      if (side === 'local') await editor.keepLocal(undefined, compared, at(80));
      else await editor.acceptRemote(undefined, compared);
      await waitFor(() => expect(read(h.server.value, 'question')).toBe('Later local question'));
      expect(Boolean((h.server.value?.topics as DocumentData[])[0].forAssembly)).toBe(side === 'local');
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTopicTextActions: [expect.objectContaining({ rowId: id('question'), time: at(40) })],
        ...(side === 'local' && { councilAssemblyActions: { forAssembly: expect.objectContaining({ rowId: 'topic', time: at(80) }) } }),
      }));
    } finally { engine.dispose(); }
  });

  it.each([false, true])('preserves the ordered assembly mark while taking the saved answer (phone later: %s)', async phoneLater => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('answer', 'Uncertain local answer', 40);
      await editor.commit(draft => {
        const [topic] = draft!.topics as DocumentData[];
        return { ...draft, topics: [{ ...topic, forAssembly: true }] };
      }, { kind: 'council-assembly', flag: {
        rowId: 'topic', before: false, after: true, generation: metadata.generation, observedRevision: 1, time: at(35),
      } });
      h.silentRemote({ topics: [{ ...opening, forAssembly: false,
        questions: [{ ...opening.questions[0], answer: 'Saved answer' }] }] });
      jest.mocked(h.transport.send).mockImplementationOnce(async command => ({
        kind: 'conflict', operationId: command.operationId, snapshot: h.server, conflicts: [
          { path: ['topics', 'id:topic', 'forAssembly'], base: rowConflictValue(false), mine: rowConflictValue(true),
            theirs: rowConflictValue(false), code: phoneLater ? COUNCIL_TOPIC_TEXT_QUEUED : COUNCIL_TOPIC_TEXT_SETTLED },
          conflict('answer', 'Uncertain local answer', 'Saved answer'),
        ],
      }));
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      const compared = editor.getState().checkpoint;
      expect(readCouncilTopicTextComparison(compared)).toMatchObject({ field: 'answer', mine: 'Uncertain local answer', stored: 'Saved answer' });
      await editor.acceptRemote(undefined, compared);
      await waitFor(() => expect(Boolean((h.server.value?.topics as DocumentData[])[0].forAssembly)).toBe(phoneLater));
      expect(read(h.server.value, 'answer')).toBe('Saved answer');
      if (phoneLater) {
        expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
          councilAssemblyActions: { forAssembly: expect.objectContaining({ rowId: 'topic', observedRevision: 1, time: at(35) }) },
        }));
      } else {
        expect(h.transport.send).toHaveBeenCalledTimes(1);
      }
    } finally { engine.dispose(); }
  });

  it('keeps a later dependent autosave when reviewing the answered question', async () => {
    const { h, engine, editor, editField } = await open();
    let unblock = () => {};
    const held = new Promise<void>(resolve => { unblock = resolve; });
    jest.mocked(h.transport.send).mockImplementationOnce(async command => {
      await held;
      return { kind: 'conflict', operationId: command.operationId, snapshot: h.server,
        conflicts: [conflict('question', 'Local question', 'Saved question')] };
    });
    try {
      await editField('question', 'Local question', 10);
      await editor.save();
      engine.setOnline(true);
      const retrying = engine.retry();
      await waitFor(() => expect(h.transport.send).toHaveBeenCalledTimes(1));
      await editField('answer', 'Later dependent answer', 30);
      await editor.save();
      await waitFor(() => expect(Object.keys(editor.getState().checkpoint.pending)).toHaveLength(2));
      h.silentRemote({ topics: [{ ...opening, questions: [{ ...opening.questions[0], question: 'Saved question' }] }] });
      unblock();
      await retrying;
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'question', mine: 'Local question', stored: 'Saved question',
      });
      await editor.acceptRemote(undefined, editor.getState().checkpoint);
      await waitFor(() => expect(read(h.server.value, 'answer')).toBe('Later dependent answer'));
      expect(read(h.server.value, 'question')).toBe('Saved question');
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTopicTextActions: [expect.objectContaining({ rowId: id('answer'), time: at(30) })],
      }));
    } finally { unblock(); engine.dispose(); }
  });

  it('keeps a later change to the reviewed question as separate recoverable work', async () => {
    const { h, engine, editor, editField } = await open();
    let unblock = () => {};
    const held = new Promise<void>(resolve => { unblock = resolve; });
    jest.mocked(h.transport.send).mockImplementationOnce(async command => {
      await held;
      return { kind: 'conflict', operationId: command.operationId, snapshot: h.server,
        conflicts: [conflict('question', 'First local question', 'Saved question')] };
    });
    try {
      await editField('question', 'First local question', 10);
      await editor.save();
      engine.setOnline(true);
      const retrying = engine.retry();
      await waitFor(() => expect(h.transport.send).toHaveBeenCalledTimes(1));
      await editField('question', 'Second local question', 30);
      await editor.save();
      await waitFor(() => expect(Object.keys(editor.getState().checkpoint.pending)).toHaveLength(2));
      h.silentRemote({ topics: [{ ...opening, questions: [{ ...opening.questions[0], question: 'Saved question' }] }] });
      unblock();
      await retrying;
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ mine: 'First local question' }));
      await editor.keepLocal(undefined, editor.getState().checkpoint, at(80));
      await waitFor(() => expect(read(h.server.value, 'question')).toBe('First local question'));
      const retained = (await engine.listRecoverable(resource)).find(item =>
        read(item.record.checkpoint.draft, 'question') === 'Second local question');
      expect(retained).toBeDefined();
      expect(retained?.record.checkpoint.councilTopicTextDrafts?.[id('question')]?.action.time).toEqual(at(30));
    } finally { unblock(); engine.dispose(); }
  });

  it.each(['question', 'answer'] as const)('preserves typing a later %s before the first answer', async field => {
    const { h, engine, editor, editField } = await open();
    let unblock = () => {};
    const held = new Promise<void>(resolve => { unblock = resolve; });
    jest.mocked(h.transport.send).mockImplementationOnce(async command => {
      await held;
      return { kind: 'conflict', operationId: command.operationId, snapshot: h.server,
        conflicts: [conflict('question', 'First local question', 'Saved question')] };
    });
    try {
      await editField('question', 'First local question', 10);
      await editor.save();
      engine.setOnline(true);
      const retrying = engine.retry();
      await waitFor(() => expect(h.transport.send).toHaveBeenCalledTimes(1));
      await editField(field, 'Later typing', 30);
      expect(Object.keys(editor.getState().checkpoint.pending)).toHaveLength(1);
      h.silentRemote({ topics: [{ ...opening, questions: [{ ...opening.questions[0], question: 'Saved question' }] }] });
      unblock();
      await retrying;
      const compared = editor.getState().checkpoint;
      expect(readCouncilTopicTextComparison(compared)).toMatchObject({ mine: 'First local question', stored: 'Saved question' });
      await editor.keepLocal(undefined, compared, at(80));
      await waitFor(() => expect(read(h.server.value, 'question')).toBe('First local question'));
      if (field === 'question') {
        const retained = (await engine.listRecoverable(resource)).find(item =>
          read(item.record.checkpoint.draft, field) === 'Later typing');
        expect(retained?.record.checkpoint.councilTopicTextDrafts?.[id(field)]?.action.time).toEqual(at(30));
      } else {
        await waitFor(() => expect(read(h.server.value, field)).toBe('Later typing'));
        expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
          councilTopicTextActions: expect.arrayContaining([expect.objectContaining({ rowId: id(field), time: at(30) })]),
        }));
      }
    } finally { unblock(); engine.dispose(); }
  });

  it('offers the deleted option as stored-only on its first server answer', async () => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('option', 'Private option before deletion', 10);
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, options: [] }] });
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'option', mine: 'Private option before deletion', removed: true,
      });
      await editor.acceptRemote(undefined, editor.getState().checkpoint);
      expect(read(h.server.value, 'option')).toBeUndefined();
      expect(read(h.server.value, 'question')).toBe('Opening question');
    } finally { engine.dispose(); }
  });

  it('shows the deleted option separately and retains the reviewed question', async () => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Local question', 10);
      await editField('option', 'Local option to keep readable', 15);
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, questions: [{ ...opening.questions[0], question: 'Saved question' }],
        options: [{ id: 'item', text: 'Saved option' }] }] });
      delay(h, [conflict('question', 'Local question', 'Saved question'), conflict('option', 'Local option to keep readable', 'Saved option')]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ field: 'question' }));
      await editor.keepLocal(undefined, editor.getState().checkpoint, at(50));
      await h.remote({ topics: [{ ...opening, questions: [{ ...opening.questions[0], question: 'Saved question' }], options: [] }] });
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'option', mine: 'Local option to keep readable', stored: null, removed: true,
      }));
      await expect(editor.keepLocal(undefined, editor.getState().checkpoint, at(80))).rejects.toBeDefined();
      await editor.acceptRemote(undefined, editor.getState().checkpoint);
      await waitFor(() => expect(read(h.server.value, 'question')).toBe('Local question'));
      expect(read(h.server.value, 'option')).toBeUndefined();
    } finally { engine.dispose(); }
  });

  it('lets a later deletion of the section finish the open text comparison', async () => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Local question in removed topic', 10);
      await editField('option', 'Local option in removed topic', 15);
      const draft = editor.getState().checkpoint.draft!;
      const [topic] = draft.topics as DocumentData[];
      await editor.edit({ ...draft, topics: [{ ...topic, title: 'Local renamed section',
        options: [...topic.options as DocumentData[], { id: 'new', text: 'New option in removed section' }] }] });
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, questions: [{ ...opening.questions[0], question: 'Saved question' }],
        options: [{ id: 'item', text: 'Saved option' }] }] });
      delay(h, [conflict('question', 'Local question in removed topic', 'Saved question'),
        conflict('option', 'Local option in removed topic', 'Saved option')]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ field: 'question' }));
      await editor.keepLocal(undefined, editor.getState().checkpoint, at(50));
      await h.remote({ topics: [] });
      const compared = editor.getState().checkpoint;
      expect(readCouncilTopicTextComparison(compared)).toMatchObject({ field: 'question',
        mine: 'Local question in removed topic', removed: true });
      await editor.acceptRemote(undefined, compared);
      expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ field: 'option',
        mine: 'Local option in removed topic', removed: true });
      await editor.acceptRemote(undefined, editor.getState().checkpoint);
      expect(h.server.value?.topics).toEqual([]);
      expect(editor.getState().checkpoint.draft?.topics).toEqual([]);
      const recoveries = await engine.listRecoverable(resource);
      expect(recoveries.some(item => {
        const [topic] = (item.record.checkpoint.draft?.topics ?? []) as DocumentData[];
        return topic?.title === 'Local renamed section'
          && (topic.options as DocumentData[]).some(option => option.text === 'New option in removed section');
      })).toBe(true);
    } finally { engine.dispose(); }
  });

  it.each([
    { code: COUNCIL_TOPIC_TEXT_SETTLED, chooseLocal: true, expectedTitle: 'Section' },
    { code: COUNCIL_TOPIC_TEXT_QUEUED, chooseLocal: false, expectedTitle: 'Local section' },
  ])('keeps the decided section title through a summary choice: $code', async ({ code, chooseLocal, expectedTitle }) => {
    const { h, engine, editor } = await open();
    try {
      const titleTime = at(35);
      const first = editor.getState().checkpoint;
      await editor.edit({ ...first.draft!, topics: [{ ...opening, title: 'Local section' }] }, first,
        { field: 'council-topic-title', rowId: opening.id, time: titleTime });
      const second = editor.getState().checkpoint;
      await editor.edit({ ...second.draft!, topics: [{ ...opening, title: 'Local section', summary: 'Local summary' }] }, second,
        { field: 'council-topic-summary', rowId: opening.id, time: null });
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, summary: 'Saved summary' }] });
      delay(h, [
        { path: ['topics', 'id:topic', 'title'], code, base: rowConflictValue(opening.title),
          mine: rowConflictValue('Local section'), theirs: rowConflictValue(opening.title) },
        { path: ['topics', 'id:topic', 'summary'], base: rowConflictValue(opening.summary),
          mine: rowConflictValue('Local summary'), theirs: rowConflictValue('Saved summary') },
      ]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'summary', mine: 'Local summary', stored: 'Saved summary',
      }));
      const compared = editor.getState().checkpoint;
      if (chooseLocal) await editor.keepLocal(undefined, compared, at(80));
      else await editor.acceptRemote(undefined, compared);
      await waitFor(() => expect(h.server.value?.topics).toMatchObject([{
        title: expectedTitle, summary: chooseLocal ? 'Local summary' : 'Saved summary', questions: opening.questions, options: opening.options,
      }]));
      const last = jest.mocked(h.transport.send).mock.calls.at(-1)?.[0];
      expect(last?.kind === 'update' && last.councilTopicTitleActions).toEqual(chooseLocal ? undefined : [{
        rowId: opening.id, rowCreatedAt: opening.id, before: opening.title, after: 'Local section', observedRevision: 1, time: titleTime,
      }]);
    } finally { engine.dispose(); }
  });

  it.each(['mine', 'stored'])('compares a returned council title on its own ($side)', async side => {
    const { h, engine, editor } = await open();
    try {
      const title = 'Title typed on the phone';
      const checkpoint = editor.getState().checkpoint;
      await editor.edit({ ...checkpoint.draft!, title }, checkpoint, { field: 'title', time: at(20) });
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, summary: 'New section text' }] });
      delay(h, [{ path: ['title'], base: rowConflictValue('Council'), mine: rowConflictValue(title), theirs: rowConflictValue('Council') }]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'council-title', mine: title, stored: 'Council',
      }));
      const shown = editor.getState().checkpoint;
      if (side === 'mine') {
        await editor.keepLocal(undefined, shown, at(80));
        await waitFor(() => expect(h.server.value?.title).toBe(title));
        expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
          councilTitleAction: { before: 'Council', after: title, observedRevision: 2, time: at(80) },
        }));
      } else await editor.acceptRemote(undefined, shown);
      expect(editor.getState().checkpoint.draft?.title).toBe(side === 'mine' ? title : 'Council');
      expect(h.server.value?.topics).toMatchObject([{ summary: 'New section text' }]);
    } finally { engine.dispose(); }
  });

  it.each([false, true])('keeps the decided date when the returned council title needs review (phone later: %s)', async phoneLater => {
    const originalDate = '2026-11-20', updatedDate = '2026-11-23';
    const { h, engine, editor } = await open({ date: originalDate });
    try {
      const title = 'Phone council title';
      const first = editor.getState().checkpoint;
      await editor.edit({ ...first.draft!, title }, first, { field: 'title', time: at(10) });
      const second = editor.getState().checkpoint;
      const { date: _date, ...withoutDate } = second.draft!;
      const dateTime = at(phoneLater ? 50 : 12);
      await editor.edit(withoutDate, second, { field: 'date', time: dateTime });
      await editor.save();
      h.silentRemote({ date: updatedDate, topics: [{ ...opening, summary: 'New section text' }] });
      delay(h, [
        { path: ['title'], base: rowConflictValue('Council'), mine: rowConflictValue(title), theirs: rowConflictValue('Council') },
        { path: ['date'], base: rowConflictValue(originalDate), mine: rowConflictValue(null), theirs: rowConflictValue(updatedDate),
          code: phoneLater ? COUNCIL_TOPIC_TEXT_QUEUED : COUNCIL_TOPIC_TEXT_SETTLED },
      ]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'council-title', mine: title, stored: 'Council',
      }));
      if (phoneLater) jest.mocked(h.transport.send).mockImplementationOnce(async command => {
        expect(command).toMatchObject({ kind: 'update', councilDateAction: { observedRevision: 1, time: dateTime },
          changes: [{ path: ['date'], before: rowConflictValue(originalDate), after: rowConflictValue(null) }] });
        const { date: _date, ...undated } = h.server.value!;
        return { kind: 'acknowledged', operationId: command.operationId,
          snapshot: { ...h.server, value: undated, metadata: { ...h.server.metadata!, revision: 3 } } };
      });
      const shown = editor.getState().checkpoint;
      if (phoneLater) await editor.acceptRemote(undefined, shown);
      else await editor.keepLocal(undefined, shown, at(70));
      await waitFor(() => expect(editor.getState().checkpoint.confirmed.value?.date).toBe(phoneLater ? undefined : updatedDate));
      const final = editor.getState().checkpoint.confirmed.value;
      expect(final).toMatchObject({ title: phoneLater ? 'Council' : title, topics: [{ summary: 'New section text' }] });
      if (!phoneLater) expect(jest.mocked(h.transport.send).mock.calls.at(-1)?.[0]).not.toHaveProperty('councilDateAction');
    } finally { engine.dispose(); }
  });

  it.each(['mine', 'stored'])('compares a returned council date on its own and keeps the council (%s)', async side => {
    const { h, engine, editor } = await open();
    try {
      const selected = '2026-11-22';
      const basis = editor.getState().checkpoint;
      await editor.edit({ ...basis.draft!, date: selected }, basis, { field: 'date', time: at(20) });
      await editor.save();
      h.silentRemote({ title: 'New council title', topics: [{ ...opening, summary: 'New section text' }] });
      delay(h, [{ path: ['date'], base: rowConflictValue(null), mine: rowConflictValue(selected), theirs: rowConflictValue(null) }]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'council-date', mine: selected, stored: null,
      }));
      const shown = editor.getState().checkpoint;
      if (side === 'mine') {
        await editor.keepLocal(undefined, shown, at(80));
        await waitFor(() => expect(h.server.value?.date).toBe(selected));
        expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
          councilDateAction: { observedRevision: 2, time: at(80) },
        }));
      } else await editor.acceptRemote(undefined, shown);
      const stored = editor.getState().checkpoint.confirmed;
      expect(stored.value?.date).toBe(side === 'mine' ? selected : undefined);
      expect(stored.value).toMatchObject({ title: 'New council title', status: 'preparing', topics: [{ summary: 'New section text' }] });
      expect(stored.metadata?.deleted).toBe(false);
    } finally { engine.dispose(); }
  });

  it('does not show a second council date when a newer stored representation is the same day', async () => {
    const initialDate = '2026-11-20', selected = '2026-11-22';
    const { h, engine, editor } = await open({ date: initialDate });
    try {
      const basis = editor.getState().checkpoint;
      await editor.edit({ ...basis.draft!, date: selected }, basis, { field: 'date', time: at(20) });
      await editor.save();
      h.silentRemote({ date: initialDate });
      delay(h, [{ path: ['date'], base: rowConflictValue(initialDate), mine: rowConflictValue(selected), theirs: rowConflictValue(initialDate) }]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'council-date', mine: selected, stored: initialDate,
      }));
      const iso = selected + 'T00:00:00.000Z';
      await h.remote({ date: iso });
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ complete: true }));
      await editor.acceptRemote(undefined, editor.getState().checkpoint);
      expect(editor.getState().checkpoint.confirmed.value?.date).toBe(iso);
      expect(h.transport.send).toHaveBeenCalledTimes(1);
    } finally { engine.dispose(); }
  });

  it('refreshes the returned council title before applying a choice about the displayed words', async () => {
    const { h, engine, editor } = await open();
    try {
      const title = 'Phone council title';
      const first = editor.getState().checkpoint;
      await editor.edit({ ...first.draft!, title }, first, { field: 'title', time: at(10) });
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, summary: 'New section text' }] });
      delay(h, [{ path: ['title'], base: rowConflictValue('Council'), mine: rowConflictValue(title), theirs: rowConflictValue('Council') }]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ stored: 'Council' }));
      h.silentRemote({ title: 'Newest words' });
      await expect(editor.keepLocal(undefined, editor.getState().checkpoint, at(50))).rejects.toMatchObject({ code: 'commit-changed' });
      expect(h.transport.send).toHaveBeenCalledTimes(1);
      expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ mine: title, stored: 'Newest words' });
      await editor.keepLocal(undefined, editor.getState().checkpoint, at(80));
      await waitFor(() => expect(h.server.value?.title).toBe(title));
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTitleAction: { before: 'Newest words', after: title, observedRevision: 3, time: at(80) },
      }));
    } finally { engine.dispose(); }
  });

  it('leaves a saved question in place while the council title is reviewed', async () => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Earlier local question', 10);
      const draft = editor.getState().checkpoint.draft!;
      await editor.edit({ ...draft, title: 'Local council title' }, undefined, { field: 'title', time: at(40) });
      await editor.save();
      h.silentRemote({ title: 'Saved council title' });
      delay(h, [
        conflict('question', 'Earlier local question', 'Opening question', COUNCIL_TOPIC_TEXT_SETTLED),
        { path: ['title'], base: rowConflictValue('Council'), mine: rowConflictValue('Local council title'),
          theirs: rowConflictValue('Saved council title') },
      ]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
      expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({
        field: 'council-title', mine: 'Local council title', stored: 'Saved council title',
      });
      await editor.keepLocal(undefined, editor.getState().checkpoint, at(80));
      await waitFor(() => expect(h.server.value?.title).toBe('Local council title'));
      expect(read(h.server.value, 'question')).toBe('Opening question');
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTitleAction: expect.objectContaining({ after: 'Local council title', time: at(80) }),
      }));
    } finally { engine.dispose(); }
  });

  it('reopens an unfinished comparison and keeps the time of each local choice', async () => {
    const { h, engine, editor, editField } = await open();
    try {
      await editField('question', 'Local question', 10);
      await editField('answer', 'Local answer', 15);
      await editor.save();
      h.silentRemote({ topics: [{ ...opening, questions: [{ id: 'item', question: 'Saved question', answer: 'Saved answer' }] }] });
      delay(h, [conflict('question', 'Local question', 'Saved question'), conflict('answer', 'Local answer', 'Saved answer')]);
      engine.setOnline(true); await engine.retry();
      await waitFor(() => expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ field: 'question' }));
      await editor.keepLocal(undefined, editor.getState().checkpoint, at(50));
      expect(readCouncilTopicTextComparison(editor.getState().checkpoint)).toMatchObject({ field: 'answer' });
      expect(h.transport.send).toHaveBeenCalledTimes(1);
      editor.close({ flush: false });
      await settleEngine();
      const reopened = await engine.openEditor(resource, editorIdentity('tab-A', resource, 'council', 'reopened'));
      await waitFor(() => expect(readCouncilTopicTextComparison(reopened.getState().checkpoint)).toMatchObject({ field: 'answer' }));
      await reopened.keepLocal(undefined, reopened.getState().checkpoint, at(90));
      await waitFor(() => expect(read(h.server.value, 'answer')).toBe('Local answer'));
      expect(read(h.server.value, 'question')).toBe('Local question');
      expect(h.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        councilTopicTextActions: expect.arrayContaining([
          { rowId: id('question'), rowCreatedAt: id('question'), observedRevision: 2, time: at(50) },
          { rowId: id('answer'), rowCreatedAt: id('answer'), observedRevision: 2, time: at(90) },
        ]),
      }));
    } finally { engine.dispose(); }
  });
});
