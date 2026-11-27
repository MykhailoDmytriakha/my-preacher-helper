/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';
import { takeDroppedProof } from '@test-utils/droppedEvidence';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { checkpointKey } from '../checkpointStorage.client';
import { CommitQueue, createMemoryCommitStore, type CommitRequest } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { EditorController, type EditorRecord } from '../controller';
import { COUNCIL_OUTCOME_POLICY } from '../councilOutcomeAction';
import { readPrivateCouncilComparison } from '../councilPrivateFields';
import { COUNCIL_TOPIC_TITLE_POLICY } from '../councilTopicTitleAction';
import { uncapturedAutosaveFields } from '../documentFieldAction';
import { GROUP_BLOCK_STATUS_POLICY } from '../groupBlockStatusAction';
import { GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_TITLE_POLICY } from '../groupFlowTitleAction';
import { GROUP_STEP_DURATION_POLICY } from '../groupStepDurationAction';
import { readGroupFlowFieldConflict } from '../groupTextReview';
import { retainedAnchoredPlacementDraft } from '../manualChoice';
import { diffFields } from '../protocol';
import { commitRowKey } from '../retention.client';
import { readSermonConflict, readThoughtPlacementComparison } from '../rowConflictDetails';
import { DataEngineRuntime } from '../runtime';
import { recoveredThoughtLock } from '../sermonThoughtLockRecovery';
import { projectRecoveredThoughtPlacement, recoveredThoughtPlacement } from '../sermonThoughtPlacementRecovery';
import { processCommand, readDocument } from '../server';
import { DataSession } from '../session';
import { THOUGHT_LOCK_POLICY } from '../thoughtLockAction';
import { THOUGHT_PLACEMENT_POLICY } from '../thoughtPlacementAction';
import { installStorageHarness } from './storageHarness';

import type { RowDetailPolicy } from '../rowDetailAction';
import type { RowValue } from '../rowFieldAction';
import type { DataCommand, DocumentData, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));
jest.mock('firebase-admin/firestore', () => ({ ...jest.requireActual('firebase-admin/firestore'), Filter: {
  where: (field: string, operator: string, value: unknown) => ({ kind: 'field', field, operator, value }),
  or: (...filters: unknown[]) => ({ kind: 'or', filters }),
} }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/*
 * BUG-20261112-checkpoint-validation-strips-action-time: the point of keeping proof on the device. The phone keeps
 * a private change at revision 1; the laptop changes the same field away and deliberately back (revisions 2, 3);
 * then the phone's draft is saved. Never persisted, it carries its proof and the server asks (conflict). Written
 * to device storage and read back — as when the page is left and reopened — it must get the same decision.
 */
const T = 1_800_000_000_000;
const clone = <V,>(value: V): V => JSON.parse(JSON.stringify(value)) as V;
type Loose = Record<string, unknown>;
const loose = (value: unknown) => value as Loose;
let sequence = 0;
type Outcome = { kind?: string; code?: string; commands: Loose[] };

async function save(checkpoint: EditorRecord['checkpoint'], preceding = false): Promise<Outcome> {
  const commands: Loose[] = [];
  const transport = {
    read: async (_owner: string, resource: ResourceRef) => readDocument('owner', resource),
    send: async (command: DataCommand) => { commands.push(loose(clone(command))); return processCommand('owner', command); },
  };
  const entries = new Map<string, JournalEntry>();
  const runtime = new DataEngineRuntime({ transport, journal: {
    list: async () => clone([...entries.values()]),
    put: async row => { entries.set(row.command.operationId, clone(row)); },
    remove: async (_owner, id) => { entries.delete(id); },
  } });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store: createMemoryCommitStore(), runtime, operationId: () => 'phone-save-' + ++sequence,
    readConfirmed: resource => readDocument('owner', resource) });
  queue.setOwner('owner');
  try {
    let predecessorId: string | undefined;
    if (preceding) {
      const opening = new DataSession(checkpoint.confirmed);
      opening.edit({ ...checkpoint.confirmed.value, title: 'Earlier queued name' });
      const predecessor = (await queue.save('old-editor', opening.checkpoint()))!;
      predecessorId = predecessor.id;
      checkpoint = { ...checkpoint, editGeneration: checkpoint.editGeneration + 1 };
    }
    const request = await queue.save('old-editor', checkpoint, { predecessorId });
    await queue.drain(true);
    const answer = (await queue.list()).find(item => item.id === request?.id)?.result;
    return { kind: answer?.kind, ...(answer?.kind === 'refused' && { code: answer.code }), commands };
  } catch (error) {
    return { code: (error as { code?: string }).code, commands };
  } finally { runtime.setOwner(null); }
}

/** The draft as the device stores it and an editor restores it: written through the native adapter, read back. */
async function throughDeviceStorage(record: EditorRecord, request?: CommitRequest): Promise<EditorRecord> {
  installStorageHarness();
  if (request) await createIndexedDbCommitStore().create(request);
  const store = createIndexedDbCheckpoints();
  await store.put(record);
  return (await store.read('owner', record.editorId))!;
}

it.each([
  ['queued', 'unchanged'], ['queued', 'later return'], ['prepared', 'unchanged'], ['prepared', 'later return'], ['missing', 'unchanged'],
] as const)('reopens a %s Save with a damaged copy of its evidence after %s', async (phase, remote) => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'captured-proof' };
  const block = { id: 'block', title: 'Original block', type: 'custom', content: '', status: 'empty', createdAt: 'born', updatedAt: 'born' };
  const opening = { userId: 'owner', title: 'Opening group', status: 'draft', templates: [block], flow: [], meetingDates: [] };
  const snapshot: ResourceSnapshot = { resource, value: opening, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set('groups/' + resource.id, { ...opening, _dataEngine: snapshot.metadata });
  const mine = { ...opening, title: 'Offline group title', templates: [{ ...block, title: 'Offline block title' }] };
  const storage = installStorageHarness();
  const store = createIndexedDbCheckpoints();
  const commitStore = createIndexedDbCommitStore();
  const entries = new Map<string, JournalEntry>();
  const sent: DataCommand[] = [];
  const runtime = new DataEngineRuntime({
    transport: { read: (_owner, ref) => readDocument('owner', ref),
      send: async command => { sent.push(clone(command)); return processCommand('owner', command); } },
    journal: { list: async () => clone([...entries.values()]), put: async item => { entries.set(item.command.operationId, clone(item)); },
      remove: async (_owner, id) => { entries.delete(id); } },
  });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store: commitStore, runtime, operationId: () => 'phone-' + ++sequence,
    readConfirmed: ref => readDocument('owner', ref) });
  queue.setOwner('owner');
  const editorId = 'phone-editor';
  const options = { owner: 'owner', editorId, snapshot, store, runtime, commits: queue, isCurrentOwner: (owner: string) => owner === 'owner',
    operationId: () => 'editor-' + ++sequence };
  let editor = await EditorController.open(options);
  try {
    await editor.edit({ ...opening, title: mine.title }, undefined, { field: 'title', time: null });
    await editor.edit(mine, undefined, { field: 'group-block-title', rowId: 'block', time: null });
    await editor.save();
    if (phase === 'prepared') await queue.drain(false);
    const [captured] = await queue.list();
    expect(captured.state).toBe(phase === 'missing' ? 'queued' : phase);
    expect(captured.groupTitleAction).toMatchObject({ before: opening.title, after: mine.title, observedRevision: 1, time: null });
    expect(captured.groupBlockTitleActions).toEqual([expect.objectContaining({ rowId: 'block', before: block.title, after: mine.templates[0].title, observedRevision: 1 })]);
    editor.dispose();

    const key = JSON.stringify(checkpointKey('owner', editorId));
    const damaged = clone(storage.rows.get(key)) as EditorRecord;
    const pending = damaged.checkpoint.pending[captured.id];
    loose(pending.groupTitleAction).observedRevision = 'unreadable';
    loose(pending.groupBlockTitleActions?.[0]).rowId = 42;
    storage.rows.set(key, damaged);
    if (phase === 'missing') storage.rows.delete(JSON.stringify(commitRowKey(captured)));

    if (remote === 'later return') {
      const temporary = { ...opening, title: 'Temporary desktop title' };
      const write = (operationId: string, before: typeof opening, after: typeof opening, observedRevision: number) => processCommand('owner', {
        protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
        changes: diffFields(before, after), groupTitleAction: { observedRevision, time: null },
      });
      expect((await write('desktop-away', opening, temporary, 1)).kind).toBe('acknowledged');
      expect((await write('desktop-back', temporary, opening, 2)).kind).toBe('acknowledged');
    }

    editor = await EditorController.open(options);
    takeDroppedProof('pending.groupTitleAction', 'pending.groupBlockTitleActions');
    if (phase === 'missing') {
      await expect(editor.save()).rejects.toThrow();
      await queue.drain(true);
      expect(sent).toEqual([]);
      expect(editor.getState().checkpoint.draft).toMatchObject(mine);
      expect((await readDocument('owner', resource)).value).toMatchObject(opening);
      return;
    }
    expect(editor.getState().checkpoint.pending[captured.id]).toMatchObject({
      groupTitleAction: captured.groupTitleAction, groupBlockTitleActions: captured.groupBlockTitleActions,
    });
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
    await editor.save();
    expect((await queue.list()).map(request => request.id)).toEqual([captured.id]);

    await queue.drain(true);
    await editor.settled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ operationId: captured.id,
      groupTitleAction: captured.groupTitleAction, groupBlockTitleActions: captured.groupBlockTitleActions,
    });
    if (captured.command) expect(sent[0]).toEqual(captured.command);
    if (remote === 'later return') {
      expect(editor.getState().result?.kind).toBe('conflict');
      expect(editor.getState().checkpoint.draft).toMatchObject(mine);
      expect((await readDocument('owner', resource)).value).toMatchObject(opening);
    } else {
      expect((await readDocument('owner', resource)).value).toMatchObject(mine);
    }
  } finally {
    editor.dispose();
    runtime.setOwner(null);
  }
});

const PROOF_RECOVERY = ['never persisted', 'persisted and reloaded', 'persisted with unreadable time'] as const;
async function reopenWithTime(record: EditorRecord, mode: typeof PROOF_RECOVERY[number], key: string, row?: string) {
  if (mode === 'never persisted') return record.checkpoint;
  if (mode === 'persisted with unreadable time') {
    const evidence = loose(record.checkpoint)[key];
    loose(loose(row ? loose(evidence)[row] : evidence).action).time = 'unreadable';
  }
  const restored = await throughDeviceStorage(record);
  if (mode === 'persisted with unreadable time') takeDroppedProof(key);
  return restored.checkpoint;
}

const SCALARS = [
  ['groupTitleDraft', 'groupTitleAction', 'groups', 'title', 'Opening', 'Mine', 'Other'],
  ['groupStatusDraft', 'groupStatusAction', 'groups', 'status', 'draft', 'active', 'completed'],
  ['councilTitleDraft', 'councilTitleAction', 'councils', 'title', 'Opening', 'Mine', 'Other'],
  ['councilDateDraft', 'councilDateAction', 'councils', 'date', '2099-04-10', '2099-04-20', '2099-04-30'],
  ['councilLifecycleDraft', 'councilLifecycleAction', 'councils', 'heldAt', null, '2026-11-08T00:00:01.000Z', '2026-11-08T00:00:02.000Z'],
] as const;

describe.each(SCALARS)('a scalar draft keeps its proof across device storage: %s', (key, action, collection, field, before, mine, other) => {
  it.each(PROOF_RECOVERY)('%s', async mode => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection, id: 'scalar' };
    const value: Loose = { userId: 'owner', title: 'Opening', status: collection === 'groups' ? 'draft' : 'preparing', date: '2099-04-10', topics: [], flow: [], templates: [], meetingDates: [] };
    if (before !== null) value[field] = before;
    const snapshot: ResourceSnapshot = { resource, value: value as DocumentData, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
    db.documents.set(collection + '/scalar', { ...clone(value), _dataEngine: clone(snapshot.metadata) });
    const session = new DataSession(snapshot);
    session.edit({ ...value, [field]: mine, ...(field === 'heldAt' ? { status: 'held' } : {}) } as DocumentData, undefined, { field, time: null } as never);
    const record: EditorRecord = { owner: 'owner', editorId: 'old-editor', prepared: null, unfinalized: [], checkpoint: session.checkpoint() };
    expect(loose(record.checkpoint)[key]).toBeDefined();
    const version = (state: string | null): Loose => {
      const next: Loose = { ...value, ...(state === null ? {} : { [field]: state }), ...(field === 'heldAt' ? { status: state === null ? 'preparing' : 'held' } : {}) };
      if (state === null) delete next[field];
      return next;
    };
    const laptop = (operationId: string, from: string | null, to: string | null, revision: number) => processCommand('owner', {
      protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
      changes: diffFields(version(from) as DocumentData, version(to) as DocumentData),
      [action]: { observedRevision: revision, time: { earliestMs: T + 100 + revision * 10, latestMs: T + 105 + revision * 10 }, before: from, after: to },
    } as unknown as DataCommand);
    expect((await laptop('later-away', before, other, 1)).kind).toBe('acknowledged');
    expect((await laptop('later-back', other, before, 2)).kind).toBe('acknowledged');
    const outcome = await save(await reopenWithTime(record, mode, key));
    expect(outcome.kind).toBe('conflict');
    expect(loose(outcome.commands[0])[action]).toBeDefined();
    expect((await readDocument('owner', resource)).value?.[field] ?? null).toBe(before);
  });
});

it.each(['an empty description', 'a previously absent description', 'existing words'] as const)('keeps a deliberate return to %s after a delayed group edit', async opening => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'group-description-return' };
  const root = { userId: 'owner', title: 'Independent title', status: 'draft', templates: [], flow: [], meetingDates: [] };
  const description = opening === 'existing words' ? 'Original description' : opening === 'an empty description' ? '' : undefined;
  const initial = description === undefined ? root : { ...root, description };
  const snapshot: ResourceSnapshot = { resource, value: initial, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set('groups/' + resource.id, { ...initial, _dataEngine: snapshot.metadata });
  const session = new DataSession(snapshot);
  session.edit({ ...initial, description: 'Earlier offline description' }, undefined, { field: 'description', time: null });
  const record = { owner: 'owner', editorId: 'old-editor', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
  const reopened = (await throughDeviceStorage(record)).checkpoint;
  const temporary = { ...initial, description: 'Temporary desktop description' };
  const desktop = (operationId: string, before: DocumentData, after: DocumentData) => processCommand('owner', {
    protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update', changes: diffFields(before, after),
  });
  expect((await desktop('away', initial, temporary)).kind).toBe('acknowledged');
  expect((await desktop('return', temporary, initial)).kind).toBe('acknowledged');
  const outcome = await save(reopened);
  expect(outcome.kind).toBe('conflict');
  expect(outcome.commands[0]).toHaveProperty('groupDescriptionAction.observedRevision', 1);
  expect((await readDocument('owner', resource)).value).toMatchObject({ title: root.title });
  expect((await readDocument('owner', resource)).value?.description).toBe(description);
  expect((await desktop('legacy-phone', initial, { ...initial, description: 'Delayed from an older client' })).kind).toBe('conflict');
});

it('orders a timed group description and retains the displaced words once', async () => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'timed-group-description' };
  const initial = { userId: 'owner', title: 'Independent title', description: 'Original', status: 'draft', templates: [], flow: [], meetingDates: [] };
  db.documents.set('groups/' + resource.id, { ...initial, _dataEngine: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  const change = (operationId: string, before: string, after: string, observedRevision: number, offset: number): DataCommand => ({
    protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
    changes: diffFields({ ...initial, description: before }, { ...initial, description: after }),
    groupDescriptionAction: { observedRevision, time: { earliestMs: T + offset, latestMs: T + offset + 1 } },
  });
  const old = change('earlier', 'Original', 'Earlier device words', 1, 10);
  expect((await processCommand('owner', change('away', 'Original', 'Later words', 1, 100))).kind).toBe('acknowledged');
  expect((await processCommand('owner', change('return', 'Later words', 'Original', 2, 200))).kind).toBe('acknowledged');
  for (let delivery = 0; delivery < 2; delivery++) {
    expect(await processCommand('owner', old)).toMatchObject({ kind: 'acknowledged', snapshot: { value: initial } });
  }
  const history = [...db.documents].filter(([key]) => key.startsWith('groups/timed-group-description/_metadataHistory/'));
  expect(history).toHaveLength(1);
  expect(history[0][1]).toMatchObject({ fields: [{ field: 'description', value: 'Earlier device words', winnerDigest: expect.any(String) }] });
});

it.each(['block content', 'leader notes'] as const)('holds delayed %s after the same group row returns to its earlier words', async surface => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'group-flow-text-return' };
  const isBlock = surface === 'block content';
  const field = isBlock ? 'content' : 'instanceNotes';
  const root = isBlock ? 'templates' : 'flow';
  const opening = isBlock ? 'Opening words' : undefined;
  const block = { id: 'block', title: 'Meeting block', type: 'custom', content: 'Opening words', status: 'filled', createdAt: 'born', updatedAt: 'born' };
  const step = { id: 'step', order: 1, durationMin: 12, templateId: 'block' };
  const value = { userId: 'owner', title: 'Independent title', status: 'draft', templates: [block], flow: [step], meetingDates: [] };
  const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set('groups/' + resource.id, { ...value, _dataEngine: snapshot.metadata });
  const withWords = (text: string) => ({ ...value, [root]: [{ ...(isBlock ? block : step), [field]: text }] });
  const session = new DataSession(snapshot);
  session.edit(withWords('Earlier words'), undefined, { field: isBlock ? 'group-block-content' : 'group-step-notes', rowId: isBlock ? 'block' : 'step', time: null });
  const record = { owner: 'owner', editorId: 'old-editor', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
  const reopened = (await throughDeviceStorage(record)).checkpoint;
  const temporary = withWords('Temporary desktop words');
  const desktop = (operationId: string, before: DocumentData, after: DocumentData) => processCommand('owner', {
    protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update', changes: diffFields(before, after),
  });
  expect((await desktop('away', value, temporary)).kind).toBe('acknowledged');
  expect((await desktop('return', temporary, value)).kind).toBe('acknowledged');
  const outcome = await save(reopened);
  expect(outcome.kind).toBe('conflict');
  const action = isBlock ? 'groupBlockContentActions' : 'groupStepNotesActions';
  expect(outcome.commands[0]).toHaveProperty(action + '.0.observedRevision', 1);
  expect(outcome.commands[0]).not.toHaveProperty(action + '.0.before');
  expect(outcome.commands[0]).not.toHaveProperty(action + '.0.after');
  const live = await readDocument('owner', resource);
  expect(live.value).toMatchObject({ title: value.title, [root]: value[root] });
  expect((live.value?.[root] as DocumentData[])[0][field]).toBe(opening);
  expect((await desktop('legacy-phone', value, withWords('Legacy delayed text'))).kind).toBe('conflict');
});

it.each(['older client', 'current client without time', 'current client with earlier time'] as const)(
  'keeps the deliberate return of a thought when the late Save comes from a %s', async variant => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'sermons', id: 'thought-text-return' };
    const value = (text: string): DocumentData => ({
      userId: 'owner', title: 'Independent sermon', verse: '', date: 'born',
      thoughts: [{ id: 'a', date: 'born', text, tags: [] }, { id: 'b', date: 'born', text: 'Neighbor', tags: [] }],
    });
    const opening = value('Opening words');
    const later = value('Later words');
    const earlier = value('Earlier offline words');
    db.documents.set('sermons/' + resource.id, { ...opening, _dataEngine: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
    const command = (operationId: string, before: DocumentData, after: DocumentData, observedRevision: number,
      offset: number | null | undefined): DataCommand => ({
      protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
      changes: diffFields(before, after),
      ...(offset !== undefined && { thoughtTextActions: [{ rowId: 'a', rowCreatedAt: 'born', observedRevision,
        time: offset === null ? null : { earliestMs: T + offset, latestMs: T + offset + 1 } }] }),
    });
    const late = command('phone', opening, earlier, 1, variant === 'older client' ? undefined : variant === 'current client without time' ? null : 10);
    expect((await processCommand('owner', command('desktop-away', opening, later, 1, 100))).kind).toBe('acknowledged');
    expect((await processCommand('owner', command('desktop-back', later, opening, 2, 200))).kind).toBe('acknowledged');
    const result = await processCommand('owner', late);
    if (variant === 'current client with earlier time') {
      expect(result.kind).toBe('acknowledged');
    } else {
      expect(result).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['thoughts', 'id:a', 'text'] }] });
    }
    expect((await readDocument('owner', resource)).value).toMatchObject(opening);
  });

it.each([
  'unlock', 'keep locked', 'already unlocked', 'legacy unlocked', 'replacement thought',
  'batch unlock', 'batch partly matches', 'batch includes a replacement',
  'types neighboring words while waiting', 'locks a neighboring thought while waiting',
  'keeps own competing neighboring words', 'takes stored competing neighboring words', 'keeps an independent lock while taking stored competing words',
] as const)(
  'recovers an unreadable return to an unlocked thought (%s)', async choice => {
    const world = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'sermons', id: 'thought-lock-undo' };
    const batch = choice.startsWith('batch');
    const thought = { id: 'a', date: 'born', text: 'Independent thought', tags: [],
      ...(choice !== 'legacy unlocked' && { isLocked: false }) };
    const neighbor = { ...thought, id: 'b', text: 'Neighbor thought' };
    const original = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-27', thoughts: [thought, neighbor] };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const opening: ResourceSnapshot = { resource, value: original, metadata };
    world.documents.set('sermons/' + resource.id, { ...original, _dataEngine: metadata });
    const editor = new DataSession(opening);
    const locked = { ...original, thoughts: [{ ...thought, isLocked: true }, batch ? { ...neighbor, isLocked: true } : neighbor] };
    const stamp = { field: 'thought-lock' as const, rowIds: batch ? [thought.id, neighbor.id] : [thought.id], time: null };
    editor.edit(locked, undefined, stamp);
    const first = editor.checkpoint();
    const actions = Object.values(first.thoughtLockDrafts!).map(proof => proof.action);
    editor.registerCommit('lock-first', first.editGeneration, locked, undefined, { thoughtLockActions: actions });
    editor.edit({ ...original, thoughts: [{ ...thought, isLocked: false }, neighbor] }, undefined, stamp);
    const checkpoint = editor.checkpoint();
    expect(checkpoint.thoughtLockDrafts?.a.action).toMatchObject({ before: true, after: false });
    for (const proof of Object.values(checkpoint.thoughtLockDrafts!)) loose(proof.action).observedRevision = 'invalid';
    const request: CommitRequest = { id: 'lock-first', owner: 'owner', editorId: 'old-editor', editGeneration: first.editGeneration,
      baseline: opening, working: opening, value: locked, intended: locked, predecessor: null, revision: 0, initialized: false,
      command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [], thoughtLockActions: actions };
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
    let reopened = DataSession.restore((await throughDeviceStorage(record, request)).checkpoint);
    takeDroppedProof('thoughtLockDrafts');
    expect(reopened.checkpoint().conflicts).toEqual([]);
    if (choice === 'already unlocked' || choice === 'legacy unlocked') {
      reopened.applyCommit({ ...request, state: 'cancelled' });
      reopened.observe(opening, { source: 'cache' });
      expect(reopened.checkpoint().unreadableRowProofs).toHaveLength(1);
      expect(reopened.checkpoint().conflicts).toEqual([]);
      const savedLocally = await throughDeviceStorage({ ...record, checkpoint: reopened.checkpoint() });
      const reload = DataSession.restore(savedLocally.checkpoint);
      reload.observe(opening, { source: 'server' });
      expect(reload.checkpoint()).toMatchObject({ dirty: false, conflicts: [] });
      expect(reload.checkpoint().unreadableRowProofs).toBeUndefined();
      expect((await save(reload.checkpoint())).commands).toEqual([]);
      return;
    }
    const competing = choice.includes('competing');
    const writesDuringWait = competing || choice === 'types neighboring words while waiting';
    const locksDuringWait = choice === 'locks a neighboring thought while waiting' || choice.startsWith('keeps an independent lock');
    const editsDuringWait = writesDuringWait || locksDuringWait;
    const time = { earliestMs: T + 200, latestMs: T + 250 };
    const neighboringLockTime = { earliestMs: T + 300, latestMs: T + 310 };
    const words = writesDuringWait ? { ...neighbor, text: 'New local words in the neighboring thought' } : neighbor;
    const editedNeighbor = locksDuringWait ? { ...words, isLocked: true } : words;
    if (editsDuringWait) {
      reopened.applyCommit({ ...request, state: 'cancelled' });
      if (writesDuringWait) reopened.edit({ ...original, thoughts: [thought, words] }, undefined, {
        field: 'thought-text', rowId: neighbor.id, time,
      });
      if (locksDuringWait) reopened.edit({ ...original, thoughts: [thought, editedNeighbor] }, undefined, {
        field: 'thought-lock', rowId: neighbor.id, time: neighboringLockTime,
      });
      reopened = DataSession.restore((await throughDeviceStorage({ ...record, checkpoint: reopened.checkpoint() })).checkpoint);
      const restored = reopened.checkpoint();
      if (writesDuringWait) expect(restored.thoughtTextDrafts?.b?.action.time).toEqual(time);
      if (locksDuringWait) expect(restored.thoughtLockDrafts?.b?.action.time).toEqual(neighboringLockTime);
    }
    const receipt = await processCommand('owner', {
      protocol: 1, operationId: 'lock-first', owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
      changes: diffFields(original, locked), thoughtLockActions: actions,
    });
    if (receipt.kind !== 'acknowledged') throw new Error('The lock was not saved');
    if (editsDuringWait) reopened.observe(receipt.snapshot, { source: 'server' });
    else reopened.accept(receipt);
    const restored = reopened.checkpoint();
    expect(restored.remoteCandidate).not.toBeNull();
    expect(recoveredThoughtLock(restored, restored.remoteCandidate!)).toMatchObject({ settled: false });
    expect(await save(restored)).toEqual({ code: 'resolve-version-first', commands: [] });
    const saved = (await readDocument('owner', resource)).value;
    expect(saved?.thoughts).toEqual(locked.thoughts);
    if (choice === 'replacement thought') {
      const replacement = { ...thought, date: 'replacement', text: 'Replacement text', isLocked: true };
      reopened.observe({ resource, value: { ...saved, thoughts: [replacement, neighbor] },
        metadata: { ...metadata, revision: 3, operationId: 'replacement' } }, { source: 'server' });
      expect(reopened.checkpoint()).toMatchObject({ dirty: false, conflicts: [], draft: { thoughts: [replacement, neighbor] } });
      expect(reopened.checkpoint().unreadableRowProofs).toBeUndefined();
      return;
    }
    const firstSettled = choice === 'batch partly matches' || choice === 'batch includes a replacement';
    let displayed = stamp.rowIds;
    let lastRevision = 2;
    let currentFirst = thought;
    const storedNeighbor = competing ? { ...neighbor, text: 'Newer saved words in the neighboring thought' } : neighbor;
    if (competing) {
      const target = { resource, value: { ...saved, thoughts: [locked.thoughts[0], storedNeighbor] },
        metadata: { ...metadata, revision: 3, operationId: 'stored-neighbor' } };
      world.documents.set('sermons/' + resource.id, { ...target.value, _dataEngine: target.metadata });
      reopened.observe(target, { source: 'server' });
      lastRevision = 3;
    }
    if (firstSettled) {
      currentFirst = choice === 'batch includes a replacement'
        ? { ...thought, date: 'new row', text: 'Replacement first thought', isLocked: true } : thought;
      const target = { resource, value: { ...saved, thoughts: [currentFirst, { ...neighbor, isLocked: true }] },
        metadata: { ...metadata, revision: 3, operationId: 'other-device' } };
      world.documents.set('sermons/' + resource.id, { ...target.value, _dataEngine: target.metadata });
      reopened.observe(target, { source: 'server' });
      const current = reopened.checkpoint();
      expect(recoveredThoughtLock(current, current.remoteCandidate!)).toMatchObject({ choices: [{ rowId: neighbor.id }], settled: false });
      displayed = [neighbor.id];
      lastRevision = 3;
    }
    const lockChoiceTime = { earliestMs: T + 500, latestMs: T + 510 };
    expect(reopened.choosePrivateFields(choice === 'keep locked' ? 'remote' : 'local', lockChoiceTime)).toBe(true);
    const useStored = competing && !choice.startsWith('keeps own');
    if (competing) {
      expect(reopened.checkpoint().conflicts).toEqual([expect.objectContaining({ path: ['thoughts', 'id:b', 'text'] })]);
      expect(await save(reopened.checkpoint())).toEqual({ code: 'resolve-version-first', commands: [] });
      if (useStored) reopened.acceptRemote(reopened.checkpoint().draft);
      else reopened.keepLocal(undefined, { earliestMs: T + 700, latestMs: T + 710 });
    }
    const outcome = await save(reopened.checkpoint());
    if (choice !== 'keep locked') {
      expect(outcome.kind).toBe('acknowledged');
      expect(outcome.commands).toHaveLength(1);
      const reviewed = displayed.map(rowId => ({ rowId, before: true, after: false, observedRevision: lastRevision, time: lockChoiceTime }));
      const actions = locksDuringWait ? [...reviewed, { rowId: neighbor.id, before: false, after: true, observedRevision: 1, time: neighboringLockTime }] : reviewed;
      expect(outcome.commands[0]).toMatchObject({ thoughtLockActions: expect.arrayContaining(actions.map(action => expect.objectContaining(action))) });
      expect(outcome.commands[0].thoughtLockActions).toHaveLength(actions.length);
    } else expect(outcome.commands).toEqual([]);
    const thoughts = (await readDocument('owner', resource)).value?.thoughts as typeof original.thoughts;
    expect(Boolean(thoughts[0].isLocked)).toBe(choice === 'keep locked' || choice === 'batch includes a replacement');
    expect(thoughts[0].text).toBe(currentFirst.text);
    expect(thoughts[0].date).toBe(currentFirst.date);
    expect(thoughts[1]).toEqual(useStored ? { ...storedNeighbor, isLocked: locksDuringWait } : editedNeighbor);
    if (writesDuringWait && !competing) expect(outcome.commands[0]).toMatchObject({ thoughtTextActions: [
      { rowId: neighbor.id, observedRevision: 1, time: { earliestMs: T + 200, latestMs: T + 250 } },
    ] });
  });

it.each([
  'my position', 'saved position', 'already returned', 'removed destination', 'later neighboring text',
  'keep my competing words', 'take the competing saved words', 'take saved competing words returned with acknowledgement',
  'third saved destination before the acknowledgement', 'removed destination before the acknowledgement',
  'deleted thought before the acknowledgement', 'replacement thought before the acknowledgement',
] as const)(
  'compares a recovered undo of a thought move (%s)', async resolution => {
    const world = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'sermons', id: 'thought-move-undo' };
    const thought = { id: 'a', date: 'born', text: 'Thought to move', tags: [], outlinePointId: 'main', subPointId: null };
    const neighbor = { ...thought, id: 'b', text: 'Independent thought', outlinePointId: 'intro' };
    const structure = { introduction: ['b'], main: ['a'], conclusion: [], ambiguous: [] };
    const original = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-27', thoughts: [thought, neighbor],
      structure, thoughtsBySection: structure, outline: { introduction: [{ id: 'intro', text: 'Opening', subPoints: [] }],
        main: [{ id: 'main', text: 'Main', subPoints: [] }], conclusion: [{ id: 'end', text: 'Conclusion', subPoints: [] }] } };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const opening: ResourceSnapshot = { resource, value: original, metadata };
    world.documents.set('sermons/' + resource.id, { ...original, _dataEngine: metadata });
    const editor = new DataSession(opening);
    const main = { outlinePointId: 'main', subPointId: null }, end = { outlinePointId: 'end', subPointId: null };
    const moved = projectRecoveredThoughtPlacement(original, thought.id, thought.date, end)!;
    const undo = projectRecoveredThoughtPlacement(moved, thought.id, thought.date, main)!;
    expect(undo).toEqual(original);
    const stamp = { field: 'thought-placement' as const, rowId: thought.id, time: null };
    editor.edit(moved, undefined, stamp);
    const first = editor.checkpoint();
    const action = first.thoughtPlacementDrafts!.a.action;
    editor.registerCommit('move-first', first.editGeneration, moved, undefined, { thoughtPlacementActions: [action] });
    editor.edit(undo, undefined, stamp);
    const checkpoint = editor.checkpoint();
    expect(checkpoint.thoughtPlacementDrafts?.a.action).toMatchObject({ before: end, after: main });
    loose(checkpoint.thoughtPlacementDrafts?.a.action).observedRevision = 'unreadable';
    const request: CommitRequest = { id: 'move-first', owner: 'owner', editorId: 'old-editor', editGeneration: first.editGeneration,
      baseline: opening, working: opening, value: moved, intended: moved, predecessor: null, revision: 0, initialized: false,
      command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [], thoughtPlacementActions: [action] };
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
    const recovered = await throughDeviceStorage(record, request);
    takeDroppedProof('thoughtPlacementDrafts');
    let reopened = DataSession.restore(recovered.checkpoint);
    const competing = resolution.includes('competing');
    const withAcknowledgement = resolution === 'take saved competing words returned with acknowledgement';
    const thirdDestination = resolution.startsWith('third saved');
    const removedBeforeAcknowledgement = resolution.startsWith('removed destination before');
    const deletedThought = resolution.startsWith('deleted thought');
    const replacementThought = resolution.startsWith('replacement thought');
    const differentBirth = deletedThought || replacementThought;
    const unavailable = resolution.startsWith('removed destination') || differentBirth;
    const replacement = { ...thought, date: 'replacement', text: 'Independent replacement thought', ...end };
    const intro = { outlinePointId: 'intro', subPointId: null };
    const savedLocation = thirdDestination ? intro : end;
    let beforeChoice = moved;
    const localWords = resolution === 'later neighboring text' || competing;
    const takeStoredWords = resolution.startsWith('take');
    const ownNeighbor = { ...neighbor, text: 'Words added while waiting' };
    const savedNeighbor = { ...neighbor, text: 'Newer words on the server' };
    if (resolution === 'already returned' || localWords) {
      if (!withAcknowledgement) reopened.applyCommit({ ...request, state: 'cancelled' });
      reopened.observe(opening, { source: 'cache' });
      expect(reopened.checkpoint().unreadableRowProofs).toHaveLength(1);
      expect(reopened.checkpoint().conflicts).toEqual([]);
      if (localWords) {
        reopened.edit({ ...original, thoughts: [thought, ownNeighbor] }, undefined,
          withAcknowledgement ? undefined : { field: 'thought-text', rowId: neighbor.id, time: { earliestMs: T + 200, latestMs: T + 250 } });
      }
      reopened = DataSession.restore((await throughDeviceStorage({ ...record, checkpoint: reopened.checkpoint() },
        withAcknowledgement ? request : undefined)).checkpoint);
      if (resolution === 'already returned') {
        reopened.observe(opening, { source: 'server' });
        expect(reopened.checkpoint().unreadableRowProofs).toBeUndefined();
        expect((await save(reopened.checkpoint())).commands).toEqual([]);
        return;
      }
    }
    if (withAcknowledgement) {
      const other = await processCommand('owner', {
        protocol: 1, operationId: 'words-before-move-ack', owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
        changes: diffFields(original, { ...original, thoughts: [thought, savedNeighbor] }),
      });
      expect(other.kind).toBe('acknowledged');
    }
    const receipt = await processCommand('owner', {
      protocol: 1, operationId: 'move-first', owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
      changes: diffFields(original, moved), thoughtPlacementActions: [action],
    });
    if (receipt.kind !== 'acknowledged') throw new Error('The move was not saved');
    if (thirdDestination || removedBeforeAcknowledgement || differentBirth) {
      const current = receipt.snapshot.value!;
      if (thirdDestination) {
        beforeChoice = projectRecoveredThoughtPlacement(current, thought.id, thought.date, intro)!;
        const later = await processCommand('owner', {
          protocol: 1, operationId: 'move-on-other-device', owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
          changes: diffFields(current, beforeChoice),
          thoughtPlacementActions: [{ ...action, before: end, after: intro, observedRevision: 2 }],
        });
        if (later.kind !== 'acknowledged') throw new Error('The later server move was not saved');
        reopened.observe(later.snapshot, { source: 'server' });
      } else {
        const removedOrder = { ...structure, main: [] };
        const value = deletedThought ? { ...current, thoughts: [neighbor], structure: removedOrder, thoughtsBySection: removedOrder }
          : replacementThought ? { ...current, thoughts: [replacement, neighbor] }
          : { ...current, outline: { ...original.outline, main: [] } };
        beforeChoice = { ...beforeChoice, ...value } as typeof beforeChoice;
        const latest = { resource, value, metadata: { ...metadata, revision: 3, operationId: 'remove-before-ack' } };
        world.documents.set('sermons/' + resource.id, { ...value, _dataEngine: latest.metadata });
        reopened.observe(latest, { source: 'server' });
      }
    }
    if (localWords && !withAcknowledgement) reopened.observe(receipt.snapshot, { source: 'server' });
    else reopened.accept(receipt);
    if (resolution === 'removed destination') {
      const value = { ...receipt.snapshot.value, outline: { ...original.outline, main: [] } };
      const latest = { resource, value, metadata: { ...metadata, revision: 3, operationId: 'remove-point' } };
      world.documents.set('sermons/' + resource.id, { ...value, _dataEngine: latest.metadata });
      reopened.observe(latest, { source: 'server' });
    }
    if (competing && !withAcknowledgement && receipt.snapshot.value) {
      const current = receipt.snapshot.value;
      const value = { ...current, thoughts: [(current.thoughts as DocumentData[])[0], savedNeighbor] };
      const latest = { resource, value, metadata: { ...metadata, revision: 3, operationId: 'other-device-words' } };
      world.documents.set('sermons/' + resource.id, { ...value, _dataEngine: latest.metadata });
      reopened.observe(latest, { source: 'server' });
    }
    const restored = reopened.checkpoint();
    if (differentBirth) {
      const shown = restored.draft?.thoughts as DocumentData[];
      expect(shown.find(row => row.id === thought.id)).toEqual(thought);
      expect(await save(restored)).toEqual({ code: 'resolve-version-first', commands: [] });
      expect(readThoughtPlacementComparison(restored)).toMatchObject({
        recovered: true, keepMineDisabled: true,
        locations: [{ id: thought.id, mine: main, stored: undefined, text: thought.text }],
      });
      expect(reopened.choosePrivateFields('remote', null)).toBe(true);
      expect((await save(reopened.checkpoint())).commands).toEqual([]);
      expect(reopened.checkpoint().draft).toEqual((await readDocument('owner', resource)).value);
      const stored = (await readDocument('owner', resource)).value!;
      expect(stored.thoughts).toEqual(deletedThought ? [neighbor] : [replacement, neighbor]);
      expect(stored.structure).toEqual(beforeChoice.structure);
      expect(stored.thoughtsBySection).toEqual(beforeChoice.thoughtsBySection);
      return;
    }
    if (withAcknowledgement) expect({
      draft: (restored.draft?.thoughts as DocumentData[])[1].text,
      confirmed: (restored.confirmed.value?.thoughts as DocumentData[])[1].text,
      conflicts: restored.conflicts.map(({ path }) => path),
    }).toEqual({ draft: ownNeighbor.text, confirmed: savedNeighbor.text,
      conflicts: [['thoughts', 'id:b', 'text'], ['thoughts', 'id:a', 'outlineLocation']] });
    expect(restored.remoteCandidate).not.toBeNull();
    expect(recoveredThoughtPlacement(restored, restored.remoteCandidate!)).toMatchObject({
      locations: [{ id: thought.id, mine: main, stored: savedLocation }], rowIds: [thought.id], samePlace: false,
    });
    expect(readThoughtPlacementComparison(restored)).toMatchObject({ recovered: true, locations: [{ id: thought.id, mine: main, stored: savedLocation }] });
    expect(await save(restored)).toEqual({ code: 'resolve-version-first', commands: [] });
    expect((await readDocument('owner', resource)).value?.structure).toEqual(beforeChoice.structure);
    const mine = resolution === 'my position' || localWords || thirdDestination;
    if (unavailable) expect(recoveredThoughtPlacement(restored, restored.remoteCandidate!)?.proposed).toBeUndefined();
    const time = { earliestMs: T + 650, latestMs: T + 700 };
    expect(reopened.choosePrivateFields(mine ? 'local' : 'remote', time)).toBe(true);
    if (competing) {
      expect(reopened.checkpoint().conflicts).toEqual([expect.objectContaining({ path: ['thoughts', 'id:b', 'text'] })]);
      expect(await save(reopened.checkpoint())).toEqual({ code: 'resolve-version-first', commands: [] });
      if (takeStoredWords) reopened.acceptRemote(reopened.checkpoint().draft);
      else reopened.keepLocal(undefined, { earliestMs: T + 850, latestMs: T + 900 });
    }
    const outcome = await save(reopened.checkpoint());
    if (mine) {
      expect(outcome.kind).toBe('acknowledged');
      expect(outcome.commands).toHaveLength(1);
      expect(outcome.commands[0]).toMatchObject({ thoughtPlacementActions: [
        { rowId: thought.id, before: savedLocation, after: main, observedRevision: competing || thirdDestination ? 3 : 2, time },
      ] });
    } else expect(outcome.commands).toEqual([]);
    const stored = (await readDocument('owner', resource)).value!;
    expect(stored.structure).toEqual(mine ? original.structure : beforeChoice.structure);
    expect(stored.thoughtsBySection).toEqual(mine ? original.thoughtsBySection : beforeChoice.thoughtsBySection);
    expect(stored.thoughts).toEqual([
      { ...thought, ...(mine ? main : savedLocation) },
      takeStoredWords ? savedNeighbor : localWords ? ownNeighbor : neighbor,
    ]);
    if (resolution === 'later neighboring text') expect(outcome.commands[0]).toMatchObject({ thoughtTextActions: [
      { rowId: neighbor.id, observedRevision: 1, time: { earliestMs: T + 200, latestMs: T + 250 } },
    ] });
  });

it.each(['opening words', 'missing summary'] as const)('holds a delayed council summary after an intentional return to %s', async mode => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'councils', id: 'council-summary-return' };
  const topic = { id: 'topic', title: 'Section', kind: 'decision', options: [], questions: [],
    ...(mode === 'opening words' && { summary: 'Opening summary' }) };
  const value = { userId: 'owner', title: 'Independent council title', status: 'preparing', topics: [topic] };
  const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set('councils/' + resource.id, { ...value, _dataEngine: snapshot.metadata });
  const withSummary = (summary: string) => ({ ...value, topics: [{ ...topic, summary }] });
  const phone = new DataSession(snapshot);
  phone.edit(withSummary('Earlier offline summary'), undefined, { field: 'council-topic-summary', rowId: 'topic', time: null });
  const record = { owner: 'owner', editorId: 'old-editor', checkpoint: phone.checkpoint(), prepared: null, unfinalized: [] };
  const reopened = (await throughDeviceStorage(record)).checkpoint;
  const temporary = withSummary('Later temporary summary');
  const edit = (operationId: string, before: DocumentData, after: DocumentData) => processCommand('owner', {
    protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update', changes: diffFields(before, after),
  });
  expect((await edit('away', value, temporary)).kind).toBe('acknowledged');
  expect((await edit('return', temporary, value)).kind).toBe('acknowledged');

  expect((await save(reopened)).kind).toBe('conflict');
  expect((await readDocument('owner', resource)).value).toMatchObject(value);
});

it('retains the exact displaced group row texts once when known action order keeps the later words', async () => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'timed-group-row-text' };
  const value = (content: string, instanceNotes: string): DocumentData => ({
    userId: 'owner', title: 'Group', status: 'draft', meetingDates: [],
    templates: [{ id: 'block', title: 'Meeting block', type: 'custom', content, status: 'filled', createdAt: 'born', updatedAt: 'born' }],
    flow: [{ id: 'step', order: 1, durationMin: 12, templateId: 'block', instanceNotes }],
  });
  const opening = value('Opening content', 'Opening notes');
  const temporary = value('Later content', 'Later notes');
  const earlier = value('Earlier offline content', 'Earlier offline notes');
  db.documents.set('groups/' + resource.id, { ...opening, _dataEngine: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  const change = (operationId: string, before: DocumentData, after: DocumentData, observedRevision: number, offset: number): DataCommand => {
    const proof = { observedRevision, time: { earliestMs: T + offset, latestMs: T + offset + 1 } };
    return { protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
      changes: diffFields(before, after),
      groupBlockContentActions: [{ ...proof, rowId: 'block', rowCreatedAt: 'born' }],
      groupStepNotesActions: [{ ...proof, rowId: 'step', rowCreatedAt: 'block' }] };
  };
  expect((await processCommand('owner', change('away', opening, temporary, 1, 100))).kind).toBe('acknowledged');
  expect((await processCommand('owner', change('return', temporary, opening, 2, 200))).kind).toBe('acknowledged');
  const phone = change('earlier', opening, earlier, 1, 10);
  for (let delivery = 0; delivery < 2; delivery++) {
    expect(await processCommand('owner', phone)).toMatchObject({ kind: 'acknowledged', snapshot: { value: opening } });
  }
  const history = (kind: string) => [...db.documents].filter(([key]) => key.startsWith('groups/' + resource.id + '/' + kind + '/')).map(([, entry]) => entry);
  expect(history('_blockContentHistory')).toEqual([{ generation: 'g', fields: [
    expect.objectContaining({ rowId: 'block', field: 'content', value: 'Earlier offline content', winnerDigest: expect.any(String) }),
  ] }]);
  expect(history('_stepNotesHistory')).toEqual([{ generation: 'g', fields: [
    expect.objectContaining({ rowId: 'step', field: 'instanceNotes', value: 'Earlier offline notes', winnerDigest: expect.any(String) }),
  ] }]);
});

it('does not apply a delayed block edit to a replacement with the same ID and opening text', async () => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'reused-block' };
  const original = { id: 'block', title: 'Meeting block', type: 'custom', content: 'Opening words', status: 'filled', createdAt: 'original', updatedAt: 'original' };
  const value = { userId: 'owner', title: 'Group', status: 'draft', templates: [original], flow: [], meetingDates: [] };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const replacement = { ...original, createdAt: 'replacement', updatedAt: 'replacement' };
  db.documents.set('groups/' + resource.id, { ...value, templates: [replacement], _dataEngine: { ...metadata, revision: 3 } });
  const session = new DataSession({ resource, value, metadata });
  session.edit({ ...value, templates: [{ ...original, content: 'Earlier words' }] }, undefined, {
    field: 'group-block-content', rowId: 'block', time: null,
  });

  const outcome = await save(session.checkpoint());

  expect(outcome.kind).toBe('conflict');
  expect((await readDocument('owner', resource)).value?.templates).toEqual([replacement]);
});

it.each(['none', 'acknowledged', 'cancelled'] as const)('asks before sending a recovered council title with unreadable revision after %s earlier work', async earlier => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'councils', id: 'council-with-unreadable-proof' };
  const value = { userId: 'owner', title: 'Opening', status: 'preparing', date: '2099-04-10', topics: [] };
  const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set(resource.collection + '/' + resource.id, { ...value, _dataEngine: snapshot.metadata });
  const session = new DataSession(snapshot);
  const queuedValue = { ...value, title: 'Previously submitted title' };
  if (earlier !== 'none') {
    session.edit(queuedValue, undefined, { field: 'title', time: null });
    session.registerCommit('earlier', session.checkpoint().editGeneration, queuedValue);
  }
  const privateTitle = earlier === 'none' ? 'Private title' : 'Opening';
  session.edit({ ...value, title: privateTitle }, undefined, { field: 'title', time: null });
  const checkpoint = session.checkpoint();
  expect(checkpoint.councilTitleDraft).toBeDefined();
  loose(checkpoint.councilTitleDraft?.action).observedRevision = 'unreadable';
  const earlierRequest: CommitRequest = { id: 'earlier', owner: 'owner', editorId: 'old-editor', editGeneration: 1, baseline: snapshot,
    working: snapshot, value: queuedValue, intended: queuedValue, predecessor: null, revision: 0, initialized: false,
    command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
  const recovered = await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] },
    earlier === 'none' ? undefined : earlierRequest);
  takeDroppedProof('councilTitleDraft');
  const setTitle = (operationId: string, before: string, after: string, observedRevision: number) => processCommand('owner', {
    protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
    changes: diffFields({ ...value, title: before }, { ...value, title: after }),
    councilTitleAction: { before, after, observedRevision, time: null },
  });
  const reopened = DataSession.restore(recovered.checkpoint);
  const storedTitle = earlier === 'none' ? 'Opening' : 'Previously submitted title';
  const storedRevision = earlier === 'none' ? 1 : 2;
  if (earlier !== 'none') {
    const answer = await setTitle('earlier', 'Opening', 'Previously submitted title', 1);
    expect(answer.kind).toBe('acknowledged');
    if (earlier === 'acknowledged') reopened.accept(answer);
    else {
      if (answer.kind !== 'acknowledged') throw new Error('The remote version was not saved');
      reopened.observe(answer.snapshot, { source: 'server' });
      reopened.applyCommit({ ...earlierRequest, state: 'cancelled', cancelledByChoice: true });
    }
  }
  expect((await setTitle('desktop-away', storedTitle, 'Desktop edit', storedRevision)).kind).toBe('acknowledged');
  expect((await setTitle('desktop-return', 'Desktop edit', storedTitle, storedRevision + 1)).kind).toBe('acknowledged');
  const outcome = await save(reopened.checkpoint());
  expect(outcome.commands).toHaveLength(0);
  expect(outcome.code).toBe('resolve-version-first');
  expect(reopened.checkpoint().draft?.title).toBe(privateTitle);
  expect((await readDocument('owner', resource)).value?.title).toBe(storedTitle);

  // Deciding the title does not discard an unrelated draft field.
  const live = await readDocument('owner', resource);
  const existingDraft = reopened.checkpoint().draft!;
  reopened.edit({ ...existingDraft, description: 'Independent words' });
  reopened.observe(live, { source: 'server' });
  const savedChoice = DataSession.restore(reopened.checkpoint());
  savedChoice.acceptRemote(savedChoice.checkpoint().draft);
  expect(savedChoice.checkpoint()).toMatchObject({ dirty: true, conflicts: [], draft: { title: storedTitle, description: 'Independent words' } });
  expect(savedChoice.checkpoint()).not.toHaveProperty('unreadableScalarProof');
  reopened.keepLocal();
  expect(reopened.checkpoint()).toMatchObject({ dirty: true, conflicts: [], draft: { title: privateTitle, description: 'Independent words' } });
  expect(reopened.checkpoint()).not.toHaveProperty('unreadableScalarProof');
  if (earlier === 'none') {
    // The user's current words may equal the original opening but differ from an already displayed remote edit.
    const returned = DataSession.restore(recovered.checkpoint);
    returned.observe({ ...live, value: { ...live.value!, title: 'New saved words' } }, { source: 'server' });
    returned.edit({ ...returned.checkpoint().draft!, title: value.title });
    returned.keepLocal();
    expect(returned.checkpoint().draft?.title).toBe(value.title);
  }
});


it.each(['local', 'remote'] as const)('compares the council title and date independently after restoring a private draft (%s first)', async first => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'councils', id: 'council-recovered-two-fields' };
  const value = { userId: 'owner', title: 'Saved council name', status: 'preparing', date: '2099-04-10', topics: [] };
  const confirmed: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'g', revision: 3, deleted: false } };
  db.documents.set('councils/' + resource.id, { ...value, _dataEngine: confirmed.metadata });
  const device = new DataSession(confirmed);
  device.edit({ ...value, title: 'Private council name' }, undefined, { field: 'title', time: null });
  device.edit({ ...value, title: 'Private council name', date: '2099-04-12' }, undefined, { field: 'date', time: null });
  const checkpoint = device.checkpoint();
  loose(checkpoint.councilTitleDraft?.action).observedRevision = 'unreadable';
  loose(checkpoint.councilDateDraft?.action).observedRevision = 'unreadable';
  const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
  const restored = DataSession.restore((await throughDeviceStorage(record)).checkpoint);
  takeDroppedProof('councilTitleDraft');
  takeDroppedProof('councilDateDraft');

  expect(restored.choosePrivateFields(first, null)).toBe(true);
  const awaitingSecond = restored.checkpoint();
  expect((await save(awaitingSecond)).code).toBe('resolve-version-first');
  expect(restored.choosePrivateFields(first === 'local' ? 'remote' : 'local', null)).toBe(true);
  const completed = restored.checkpoint();
  const expected = { ...value, ...(first === 'local' ? { title: 'Private council name' } : { date: '2099-04-12' }) };
  expect(completed.draft).toEqual(expected);
  expect((await save(completed)).kind).toBe('acknowledged');
  expect((await readDocument('owner', resource)).value).toMatchObject(expected);
});

const ROWS = [
  ['councilOutcomeDrafts', 'council-topic-outcome', COUNCIL_OUTCOME_POLICY, 'outcome',
    { discussed: false, acceptedOptionId: null, decision: null, resolution: null }, { discussed: true, acceptedOptionId: null, decision: 'Mine', resolution: null },
    { discussed: true, acceptedOptionId: null, decision: 'Other', resolution: null }],
  ['councilTopicTitleDrafts', 'council-topic-title', COUNCIL_TOPIC_TITLE_POLICY, 'title', 'Opening', 'Mine', 'Other'],
  ['groupBlockTitleDrafts', 'group-block-title', GROUP_BLOCK_TITLE_POLICY, 'title', 'Opening', 'Mine', 'Other'],
  ['groupStepTitleDrafts', 'group-step-title', GROUP_STEP_TITLE_POLICY, 'title', 'Opening', 'Mine', 'Other'],
  ['groupBlockStatusDrafts', 'group-block-status', GROUP_BLOCK_STATUS_POLICY, 'status', 'draft', 'filled', 'empty'],
  ['groupStepDurationDrafts', 'group-step-duration', GROUP_STEP_DURATION_POLICY, 'durationMin', 1, 2, 3],
  ['thoughtLockDrafts', 'thought-lock', THOUGHT_LOCK_POLICY, 'isLocked', false, true, true],
  ['thoughtPlacementDrafts', 'thought-placement', THOUGHT_PLACEMENT_POLICY, 'outlineLocation',
    { outlinePointId: null, subPointId: null }, { outlinePointId: 'p1', subPointId: null }, { outlinePointId: 'p2', subPointId: null }],
] as unknown as Array<[string, string, RowDetailPolicy<string, RowValue>, string, RowValue, RowValue, RowValue]>;


it.each(['local', 'remote'] as const)('compares a whole recovered council outcome alongside its title (%s outcome)', async side => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'councils', id: 'council-private-outcome' };
  const topic = { id: 'topic', title: 'Section', questions: [], options: [], kind: 'decision' };
  const value = { userId: 'owner', title: 'Stored title', status: 'preparing', topics: [topic] };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const checkpoint = new DataSession({ resource, value, metadata }).checkpoint();
  const stored = { ...value, topics: [{ ...topic, resolution: 'postponed' }] };
  const local = { ...topic, decision: 'Private decision', discussed: true };
  checkpoint.draft = { ...value, title: 'Private title', topics: [local] };
  checkpoint.unreadableScalarProof = ['title'];
  checkpoint.unreadableRowProofs = [{ field: 'councilOutcomeDrafts', rowId: topic.id, birth: topic.id, generation: 'g' }];
  checkpoint.remoteCandidate = { resource, value: stored, metadata: { ...metadata, revision: 3 } };
  db.documents.set('councils/' + resource.id, { ...stored, _dataEngine: checkpoint.remoteCandidate.metadata });
  const recovered = DataSession.restore(checkpoint);
  expect(recovered.choosePrivateFields('local', null)).toBe(true);
  expect(readPrivateCouncilComparison(recovered.checkpoint())).toMatchObject({
    field: 'outcome', mine: { decision: 'Private decision', discussed: true },
    stored: { resolution: 'postponed' },
  });
  expect(recovered.choosePrivateFields(side, null)).toBe(true);
  const complete = recovered.checkpoint();
  expect(complete.conflicts).toEqual([]);
  expect(complete.draft?.topics).toEqual(side === 'local' ? [local] : stored.topics);
  expect((await save(complete)).kind).toBe('acknowledged');
  expect((await readDocument('owner', resource)).value?.topics).toEqual(complete.draft?.topics);
});

it('keeps the stored outcome choice available when the draft selected an option removed elsewhere', () => {
  const resource = { collection: 'councils', id: 'removed-option-recovery' };
  const topic = { id: 'topic', title: 'Section', questions: [], options: [{ id: 'option', text: 'An option' }] };
  const value = { userId: 'owner', title: 'Council', status: 'preparing', topics: [topic] };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const checkpoint = new DataSession({ resource, value, metadata }).checkpoint();
  checkpoint.draft = { ...value, topics: [{ ...topic, acceptedOptionId: 'option', discussed: true }] };
  checkpoint.unreadableRowProofs = [{ field: 'councilOutcomeDrafts', rowId: topic.id, birth: topic.id, generation: 'g' }];
  const stored = { ...value, topics: [{ ...topic, options: [] }] };
  checkpoint.remoteCandidate = { resource, value: stored, metadata: { ...metadata, revision: 2 } };
  const recovered = DataSession.restore(checkpoint);
  expect(readPrivateCouncilComparison(recovered.checkpoint())).toMatchObject({ field: 'outcome', localAvailable: false });
  expect(() => recovered.choosePrivateFields('local', null)).toThrow('The selected council option is unavailable');
  expect(recovered.checkpoint().draft).toEqual(checkpoint.draft);
  expect(recovered.choosePrivateFields('remote', null)).toBe(true);
  expect(recovered.checkpoint()).toMatchObject({ draft: stored, dirty: false, conflicts: [] });
});

it.each(['local', 'remote'] as const)('chooses council lifecycle and topic title independently (%s lifecycle)', side => {
  const resource = { collection: 'councils', id: 'council-lifecycle-and-topic-recovery' };
  const topic = { id: 'topic', title: 'Stored section name' };
  const value = { userId: 'owner', title: 'Council', status: 'preparing', topics: [topic] };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const opened = new DataSession({ resource, value, metadata }).checkpoint();
  const heldAt = '2026-11-13T10:00:00.000Z';
  const otherHeldAt = '2026-11-13T11:00:00.000Z';
  opened.unreadableScalarProof = ['heldAt'];
  opened.unreadableRowProofs = [{ field: 'councilTopicTitleDrafts', rowId: topic.id, birth: topic.id, generation: 'g' }];
  opened.draft = { ...value, status: 'held', heldAt, topics: [{ ...topic, title: 'Private section name' }] };
  opened.remoteCandidate = { resource, value: { ...value, status: 'held', heldAt: otherHeldAt }, metadata: { ...metadata, revision: 3 } };
  const recovered = DataSession.restore(opened);
  expect(recovered.choosePrivateFields(side, null)).toBe(true);
  expect(recovered.choosePrivateFields('local', null)).toBe(true);
  const checkpoint = recovered.checkpoint();
  expect(checkpoint.conflicts).toEqual([]);
  expect(checkpoint.draft).toMatchObject({ status: 'held', heldAt: side === 'local' ? heldAt : otherHeldAt,
    topics: [{ ...topic, title: 'Private section name' }] });
  expect(checkpoint.councilTopicTitleDrafts?.topic.action.observedRevision).toBe(3);
  if (side === 'local') expect(checkpoint.councilLifecycleDraft?.action.observedRevision).toBe(3);
});

describe.each(ROWS)('a row draft keeps its proof across device storage: %s', (key, stamp, policy, field, before, mine, other) => {
  it.each([...PROOF_RECOVERY, 'persisted with unreadable row revision'] as const)('%s', async mode => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection: policy.collection, id: 'rowdoc' };
    const target = policy.target(field), born = policy.birth.leaf === 'id' ? 'r' : 'row-born';
    const row: Loose = { id: 'r', title: 'Opening', text: 'Words', tags: [], content: 'Words', status: 'draft', createdAt: 'born', updatedAt: 'now', order: 1,
      type: 'custom', kind: field === 'outcome' ? 'decision' : 'info', options: [], questions: [], discussed: true, [policy.birth.leaf as string]: born, [target.leaf as string]: before };
    if (target.projection) { Object.assign(row, before); delete row[target.leaf as string]; }
    const setRow = (next: RowValue) => (target.projection ? target.projection.write(row as DocumentData, next) : { ...row, [target.leaf as string]: next });
    const value: Loose = { userId: 'owner', title: 'Opening', verse: 'John 1:1', date: '2026-11-12', createdAt: 'now', updatedAt: 'now',
      status: policy.collection === 'councils' ? 'preparing' : 'draft', topics: [], thoughts: [], templates: [], flow: [], meetingDates: [],
      outline: { introduction: [], main: [{ id: 'p1', text: 'P1', subPoints: [] }, { id: 'p2', text: 'P2', subPoints: [] }], conclusion: [] },
      [target.field]: [setRow(before)] };
    const snapshot: ResourceSnapshot = { resource, value: value as DocumentData, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
    db.documents.set(resource.collection + '/' + resource.id, { ...clone(value), _dataEngine: clone(snapshot.metadata) });
    const session = new DataSession(snapshot);
    session.edit({ ...value, [target.field]: [setRow(mine)] } as DocumentData, undefined, { field: stamp, rowId: 'r', time: null } as never);
    const record: EditorRecord = { owner: 'owner', editorId: 'old-editor', prepared: null, unfinalized: [], checkpoint: session.checkpoint() };
    expect(loose(record.checkpoint)[key]).toBeDefined();
    const laptop = (operationId: string, from: RowValue, to: RowValue, revision: number) => processCommand('owner', {
      protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
      changes: diffFields({ ...value, [target.field]: [setRow(from)] } as DocumentData, { ...value, [target.field]: [setRow(to)] } as DocumentData),
      [policy.actions]: [{ rowId: 'r', rowCreatedAt: born, before: from, after: to, observedRevision: revision,
        time: { earliestMs: T + 100 + revision * 10, latestMs: T + 105 + revision * 10 } }],
    } as unknown as DataCommand);
    expect((await laptop('later-away', before, other, 1)).kind).toBe('acknowledged');
    expect((await laptop('later-back', other, before, 2)).kind).toBe('acknowledged');
    const stored = (await readDocument('owner', resource)).value?.[target.field];
    if (mode === 'persisted with unreadable row revision') {
      const damaged = loose(loose(record.checkpoint)[key]);
      loose(loose(damaged.r).action).observedRevision = 'unreadable';
    }
    const recovered = mode === 'persisted with unreadable row revision' ? (await throughDeviceStorage(record)).checkpoint : await reopenWithTime(record, mode, key, 'r');
    if (mode === 'persisted with unreadable row revision') takeDroppedProof(key);
    const outcome = await save(recovered);
    if (mode === 'persisted with unreadable row revision') {
      expect(outcome.commands).toHaveLength(0);
      expect(outcome.code).toBe('resolve-version-first');
    } else {
      expect(outcome.kind).toBe('conflict');
      expect(loose(outcome.commands[0])[policy.actions]).toBeDefined();
    }
    expect((await readDocument('owner', resource)).value?.[target.field]).toEqual(stored);
  });
});

it.each([
  'acknowledged',
  'cancelled',
  'already saved',
  'row removed locally',
  'another damaged title',
  'matching server with a damaged neighbor',
  'new cache before acknowledgement',
] as const)(
  'recovers a damaged block title undo (%s)', async (earlier) => {
    const world = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'groups', id: 'block-title-undo' };
    const row = { id: 'block', title: 'Opening title', type: 'custom', content: 'Keep content', status: 'filled', createdAt: 'born', updatedAt: 'born' };
    const neighbor = { ...row, id: 'neighbor', title: 'Saved neighbor', createdAt: 'neighbor-born' };
    const value = { userId: 'owner', title: 'Group', status: 'draft', templates: [row, neighbor], flow: [], meetingDates: [] };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const snapshot: ResourceSnapshot = { resource, value, metadata };
    world.documents.set('groups/' + resource.id, { ...value, _dataEngine: metadata });
    const session = new DataSession(snapshot);
    const submitted = { ...value, templates: [{ ...row, title: 'Submitted title' }, neighbor] };
    const stamp = { field: 'group-block-title' as const, rowId: row.id, time: null };
    session.edit(submitted, undefined, stamp);
    const captured = session.checkpoint();
    session.registerCommit('earlier', captured.editGeneration, submitted, undefined,
      { groupBlockTitleActions: [captured.groupBlockTitleDrafts!.block.action] });
    session.edit(value, undefined, stamp);
    const damagedNeighbor = earlier === 'another damaged title' || earlier === 'matching server with a damaged neighbor';
    const draft = damagedNeighbor
      ? { ...value, templates: [row, { ...neighbor, title: 'Private neighbor' }] } : value;
    if (draft !== value) session.edit(draft, undefined, { ...stamp, rowId: neighbor.id });
    const checkpoint = session.checkpoint();
    expect(checkpoint.groupBlockTitleDrafts?.block.action).toMatchObject({ before: 'Submitted title', after: 'Opening title' });
    for (const proof of Object.values(checkpoint.groupBlockTitleDrafts!)) loose(proof.action).observedRevision = 'unreadable';
    const request: CommitRequest = { id: 'earlier', owner: 'owner', editorId: 'old-editor', editGeneration: captured.editGeneration,
      baseline: snapshot, working: snapshot, value: submitted, intended: submitted, predecessor: null, revision: 0, initialized: false,
      command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
    const recovered = DataSession.restore((await throughDeviceStorage(record, request)).checkpoint);
    takeDroppedProof('groupBlockTitleDrafts');
    expect(recovered.checkpoint().conflicts).toEqual([]);

    const setTitle = async (operationId: string, from: typeof value, to: typeof value, revision: number) => {
      const result = await processCommand('owner', {
        protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
        changes: diffFields(from, to), groupBlockTitleActions: [{ rowId: row.id, rowCreatedAt: row.createdAt,
          before: from.templates[0].title, after: to.templates[0].title, time: null, observedRevision: revision }],
      });
      if (result.kind !== 'acknowledged') throw new Error('The group was not saved');
      return result;
    };
    let restored = recovered;
    let actual = submitted;
    if (earlier === 'acknowledged' || earlier === 'new cache before acknowledgement') {
      const acknowledged = await setTitle('earlier', value, submitted, 1);
      if (earlier === 'new cache before acknowledgement') {
        actual = { ...value, templates: [{ ...row, title: 'Newer server title' }, neighbor] };
        const newer = await setTitle('other-device', submitted, actual, 2);
        restored.observe(newer.snapshot, { source: 'cache' });
        restored.accept(acknowledged);
        expect(readGroupFlowFieldConflict(restored.checkpoint())?.stored).toBe(submitted.templates[0].title);
        restored.observe(newer.snapshot, { source: 'server' });
      } else restored.accept(acknowledged);
    } else {
      restored.applyCommit({ ...request, state: 'cancelled' });
      restored.observe(snapshot, { source: 'cache' });
      expect(restored.checkpoint().conflicts).toEqual([]);
      const afterCancel = await throughDeviceStorage({ ...record, checkpoint: restored.checkpoint() });
      restored = DataSession.restore(afterCancel.checkpoint);
      if (earlier === 'row removed locally') {
        restored.edit({ ...value, templates: [neighbor] });
        restored.observe(snapshot, { source: 'server' });
        expect(restored.checkpoint().unreadableRowProofs).toBeUndefined();
        const outcome = await save(restored.checkpoint());
        expect(outcome.kind).toBe('acknowledged');
        expect((await readDocument('owner', resource)).value?.templates).toEqual([neighbor]);
        return;
      }
      if (earlier === 'matching server with a damaged neighbor') {
        restored.observe(snapshot, { source: 'server' });
        expect(restored.checkpoint().unreadableRowProofs?.map(proof => proof.rowId)).toEqual([neighbor.id]);
        expect(readGroupFlowFieldConflict(restored.checkpoint())).toMatchObject({
          rowId: neighbor.id, mine: 'Private neighbor', stored: 'Saved neighbor',
        });
        expect(await save(restored.checkpoint())).toEqual({ code: 'resolve-version-first', commands: [] });
        return;
      }
      if (earlier === 'already saved') {
        restored.observe(snapshot, { source: 'server' });
        expect(restored.checkpoint()).toMatchObject({ dirty: false, conflicts: [] });
        expect(restored.checkpoint().unreadableRowProofs).toBeUndefined();
        expect((await save(restored.checkpoint())).commands).toEqual([]);
        return;
      }
      actual = { ...value, templates: [{ ...row, title: 'Newer server title' }, neighbor] };
      const newer = await setTitle('other-device', value, actual, 1);
      restored.observe(newer.snapshot, { source: 'cache' });
      expect(readGroupFlowFieldConflict(restored.checkpoint())).toBeUndefined();
      const cached = await throughDeviceStorage({ ...record, checkpoint: restored.checkpoint() });
      restored = DataSession.restore(cached.checkpoint);
      expect(readGroupFlowFieldConflict(restored.checkpoint())).toBeUndefined();
      restored.observe(newer.snapshot, { source: 'server' });
    }

    expect(readGroupFlowFieldConflict(restored.checkpoint())).toMatchObject({
      rowId: row.id, mine: value.templates[0].title, stored: actual.templates[0].title,
    });
    expect(restored.checkpoint().draft?.templates).toEqual(draft.templates);
    if (earlier === 'another damaged title') expect(restored.checkpoint().conflicts).toHaveLength(2);
    expect(await save(restored.checkpoint())).toEqual({ code: 'resolve-version-first', commands: [] });
    expect((await readDocument('owner', resource)).value?.templates).toEqual(actual.templates);
  });


it('keeps the valid opening of a group block when a different block proof is unreadable', async () => {
  const resource = { collection: 'groups', id: 'group-partially-readable-blocks' };
  const first = { id: 'a', title: 'First opening name', createdAt: 'first-row' };
  const second = { id: 'b', title: 'Second opening name', createdAt: 'second-row' };
  const value = { userId: 'owner', title: 'Group', templates: [first, second] };
  const session = new DataSession({ resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  const localFirst = { ...first, title: 'First private name' };
  const localSecond = { ...second, title: 'Second private name' };
  session.edit({ ...value, templates: [localFirst, second] }, undefined, { field: 'group-block-title', rowId: 'a', time: null });
  session.edit({ ...value, templates: [localFirst, localSecond] }, undefined, { field: 'group-block-title', rowId: 'b', time: null });
  const checkpoint = session.checkpoint();
  expect(checkpoint.groupBlockTitleDrafts).toHaveProperty('a.action.observedRevision', 1);
  expect(checkpoint.groupBlockTitleDrafts).toHaveProperty('b.action.observedRevision', 1);
  loose(checkpoint.groupBlockTitleDrafts?.a?.action).observedRevision = 'unreadable';
  loose(checkpoint.groupBlockTitleDrafts?.b?.action).time = 'unreadable';
  const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
  const recovered = (await throughDeviceStorage(record)).checkpoint;
  takeDroppedProof('groupBlockTitleDrafts');
  const expectedProof = { generation: 'g', action: { rowId: 'b', rowCreatedAt: 'second-row', before: second.title, after: localSecond.title,
    observedRevision: 1, time: null } };
  expect(recovered.groupBlockTitleDrafts).toEqual({ b: expectedProof });
  expect(recovered.unreadableRowProofs).toEqual([{ field: 'groupBlockTitleDrafts', rowId: 'a', birth: 'first-row', generation: 'g' }]);
  expect(recovered.conflicts.map(({ path }) => path)).toEqual([['templates', 'id:a', 'title']]);
  for (const side of ['mine', 'stored']) {
    const reopened = DataSession.restore(recovered);
    if (side === 'mine') reopened.keepLocal();
    else reopened.acceptRemote(reopened.checkpoint().draft);
    expect(reopened.checkpoint().draft?.templates).toEqual([side === 'mine' ? localFirst : first, localSecond]);
    expect(reopened.checkpoint().groupBlockTitleDrafts?.b).toEqual(expectedProof);
  }
});

it.each(['local', 'remote'] as const)('persists a %s choice for one recovered field without deciding the next one', async firstChoice => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'groups', id: 'two-unreadable-group-openings' };
  const block = (id: string, title: string) => ({ id, title, createdAt: 'born-' + id, updatedAt: 'born-' + id,
    type: 'custom', content: 'Independent words', status: 'filled' });
  const a = block('a', 'First saved name'), b = block('b', 'Second saved name'), c = block('c', 'Third saved name');
  const value = { userId: 'owner', title: 'Group', status: 'draft', templates: [a, b, c], flow: [], meetingDates: [] };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const session = new DataSession({ resource, value, metadata });
  const authored = (row: typeof a) => ({ ...row, title: row.title.replace('saved', 'private') });
  const local = { ...value, templates: [authored(a), authored(b), authored(c)] };
  for (const row of local.templates) {
    const draft = session.checkpoint().draft!;
    session.edit({ ...draft, templates: (draft.templates as DocumentData[]).map(item => item.id === row.id ? row : item) },
      undefined, { field: 'group-block-title', rowId: row.id, time: null });
  }
  const checkpoint = session.checkpoint();
  for (const id of ['a', 'b']) loose(checkpoint.groupBlockTitleDrafts?.[id].action).observedRevision = 'unreadable';
  const stored = { resource, value, metadata: { ...metadata, revision: 3 } };
  const record = { owner: 'owner', editorId: 'old-editor', checkpoint: { ...checkpoint, remoteCandidate: stored }, prepared: null, unfinalized: [] };
  db.documents.set('groups/' + resource.id, { ...value, _dataEngine: stored.metadata });
  const recovered = DataSession.restore((await throughDeviceStorage(record)).checkpoint);
  takeDroppedProof('groupBlockTitleDrafts');
  expect(recovered.choosePrivateFields(firstChoice, null)).toBe(true);
  const stage = recovered.checkpoint();
  expect(stage.draft).toEqual(local);
  expect(stage.unreadableRowProofs).toHaveLength(2);
  expect((await save(stage)).code).toBe('resolve-version-first');

  const { privateFieldReview, ...openingStage } = stage;
  const storedStage = firstChoice === 'remote' ? { ...openingStage, privateGroupTextReview: privateFieldReview } : stage;
  const resumed = DataSession.restore((await throughDeviceStorage({ ...record, checkpoint: storedStage })).checkpoint);
  expect(readGroupFlowFieldConflict(resumed.checkpoint())).toMatchObject({ rowId: 'b', mine: authored(b).title, stored: b.title });
  const secondChoice = firstChoice === 'local' ? 'remote' : 'local';
  expect(resumed.choosePrivateFields(secondChoice, null)).toBe(true);
  const complete = resumed.checkpoint();
  expect(complete.conflicts).toEqual([]);
  expect(complete.privateFieldReview).toBeUndefined();
  expect(complete.groupBlockTitleDrafts?.c?.action.observedRevision).toBe(1);
  expect(complete.groupBlockTitleDrafts?.[firstChoice === 'local' ? 'a' : 'b']?.action.observedRevision).toBe(3);
  expect(complete.draft?.templates).toEqual([firstChoice === 'local' ? authored(a) : a, secondChoice === 'local' ? authored(b) : b, authored(c)]);
  expect((await save(complete)).kind).toBe('acknowledged');
  expect((await readDocument('owner', resource)).value?.templates).toEqual(complete.draft?.templates);
});

it.each(['block-removed-on-desktop', 'step-removed-on-desktop', 'block-removed-on-phone', 'confirm-phone-removal', 'damaged-proof-of-removed-block',
  'last-step-notes', 'remote-keeps-a-copy', 'cleared-leader-notes', 'remote-block-with-notes', 'restore-step-order', 'keep-other-deletion', 'restore-only-step-with-block'] as const)(
  'reviews a recovered group name separately from a removed row (%s)', async mode => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'groups', id: 'group-private-with-removed-row' };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const row = { id: 'b', title: 'Block to review', content: 'Opening words', status: 'filled', type: 'custom', createdAt: 'b-born', updatedAt: 'b-born' };
    const other = { ...row, id: 'other', title: 'Other block', createdAt: 'other-born' };
    const step = { id: 's', templateId: row.id, order: 1, instanceNotes: 'Opening leader notes' };
    const restoreOrder = mode === 'restore-step-order';
    const keepOtherDeletion = mode === 'keep-other-deletion';
    const following = { ...step, id: 'following', order: 2 };
    const value = { userId: 'owner', title: 'The saved group name', status: 'active', templates: [row, other],
      flow: restoreOrder || keepOtherDeletion ? [step, following] : [step], meetingDates: [] };
    const opened = new DataSession({ resource, value, metadata });
    const checkpoint = opened.checkpoint();
    const keepRemoval = mode === 'confirm-phone-removal';
    const survivingCopy = mode === 'remote-keeps-a-copy';
    const notesOnly = mode === 'last-step-notes' || keepOtherDeletion;
    const restoreOnlyStep = mode === 'restore-only-step-with-block';
    const cleared = mode === 'cleared-leader-notes';
    const linkedText = mode === 'remote-block-with-notes';
    const localRemoval = mode === 'block-removed-on-phone' || keepRemoval || notesOnly || survivingCopy || restoreOnlyStep;
    const removedStep = mode === 'step-removed-on-desktop' || cleared;
    const damagedRowProof = mode === 'damaged-proof-of-removed-block';
    const privateWords = "The leader's unsent words in the removed row";
    const linkedWords = 'Separate leader words in the linked step';
    const changed = { ...row, ...(damagedRowProof ? { title: privateWords } : { content: privateWords }) };
    const changedStep: Omit<typeof step, 'instanceNotes'> & { instanceNotes?: string } = { ...step };
    if (cleared) delete changedStep.instanceNotes;
    else changedStep.instanceNotes = linkedText ? linkedWords : privateWords;
    const savedRow = notesOnly || survivingCopy ? row : { ...row, content: 'Block text edited on the desktop' };
    const savedStep = survivingCopy || restoreOnlyStep ? step : { ...step, instanceNotes: 'Leader notes edited on the desktop' };
    const copiedStep = { ...step, id: 'copy', order: 2 };
    const savedNeighbor = { ...other, content: 'Independent content saved on the desktop' };
    const stored = { ...value, templates: removedStep || restoreOrder ? [row, savedNeighbor] : localRemoval ? [savedRow, savedNeighbor] : [savedNeighbor],
      flow: survivingCopy ? [savedStep, copiedStep] : restoreOrder || keepOtherDeletion ? [savedStep, following] : localRemoval ? [savedStep] : [] };
    const local = { ...value, title: 'The unsent group name', templates: removedStep || restoreOrder ? [row, other] : localRemoval ? [other] : [changed, other],
      flow: removedStep || linkedText ? [changedStep] : restoreOrder ? [{ ...following, order: 1 }] : localRemoval ? [] : [step] };
    checkpoint.draft = local;
    checkpoint.dirty = true;
    checkpoint.unreadableScalarProof = ['title'];
    if (damagedRowProof) checkpoint.unreadableRowProofs = [{ field: 'groupBlockTitleDrafts', rowId: row.id, birth: row.createdAt, generation: 'g' }];
    checkpoint.remoteCandidate = { resource, value: stored, metadata: { ...metadata, revision: 3 } };
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
    db.documents.set('groups/' + resource.id, { ...stored, _dataEngine: checkpoint.remoteCandidate.metadata });
    const session = DataSession.restore((await throughDeviceStorage(record)).checkpoint);
    expect(readGroupFlowFieldConflict(session.checkpoint())).toMatchObject({
      field: 'title', mine: local.title, stored: stored.title,
    });
    expect(session.choosePrivateFields('local', null)).toBe(true);
    const intermediate = session.checkpoint();
    if (survivingCopy) {
      const surviving = { ...copiedStep, order: 1 };
      expect(intermediate.conflicts).toEqual([]);
      expect(intermediate.draft).toEqual({ ...stored, title: local.title, flow: [surviving] });
      expect((await save(intermediate)).kind).toBe('acknowledged');
      expect((await readDocument('owner', resource)).value).toMatchObject(intermediate.draft!);
      return;
    }
    expect((await save(intermediate)).code).toBe('resolve-version-first');
    const reopened = DataSession.restore((await throughDeviceStorage({ ...record, checkpoint: intermediate })).checkpoint);
    expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({
      field: removedStep || restoreOrder ? 'removedNotes' : 'removedContent', removedBy: localRemoval || restoreOrder ? 'local' : 'remote',
      ...(localRemoval ? { stored: [savedRow.content, savedStep.instanceNotes].join('\n') } : restoreOrder ? { stored: savedStep.instanceNotes }
        : { mine: damagedRowProof ? 'Opening words\n' + privateWords : cleared ? null : linkedText ? privateWords + '\n' + linkedWords : privateWords }),
    });
    if (!localRemoval && !restoreOrder) {
      expect(() => reopened.choosePrivateFields('local', null)).toThrow(/removed|unavailable/i);
      expect(reopened.checkpoint()).toEqual(intermediate);
    }
    expect(reopened.choosePrivateFields(keepRemoval ? 'local' : 'remote', null)).toBe(true);
    const completed = reopened.checkpoint();
    expect(completed.draft).toEqual({ ...stored, title: local.title, ...(keepRemoval && { templates: [savedNeighbor], flow: [] }),
      ...(keepOtherDeletion && { flow: [savedStep] }) });
    expect(completed.conflicts).toEqual([]);
    expect(completed.groupTitleDraft?.action.observedRevision).toBe(3);
    const delivered = await save(completed);
    expect(delivered.kind).toBe('acknowledged');
    expect(delivered.commands).toHaveLength(1);
    expect(delivered.commands[0]?.changes).toMatchObject(keepRemoval || keepOtherDeletion ?
      expect.arrayContaining([{ path: ['title'], before: expect.anything(), after: expect.anything() }]) : [{ path: ['title'] }]);
    expect((await readDocument('owner', resource)).value).toMatchObject(completed.draft!);
  });

it.each(['keep', 'drop', 'two-copies'] as const)(
  'chooses a new group step copy separately from the saved deletion (%s)', async mode => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'groups', id: 'group-private-copied-step' };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const block = { id: 'b', title: 'Opening block', content: 'Opening text', status: 'filled', type: 'custom', createdAt: 'born', updatedAt: 'born' };
    const neighbor = { ...block, id: 'other', title: 'Other block', createdAt: 'other-born' };
    const step = { id: 's', templateId: block.id, order: 1 };
    const other = { id: 'other-step', templateId: neighbor.id, order: 2 };
    const value = { userId: 'owner', title: 'Opening group', status: 'active', templates: [block, neighbor], flow: [step, other] };
    const checkpoint = new DataSession({ resource, value, metadata }).checkpoint();
    const localBlock = { ...block, content: 'Current words in the copied block' };
    const local = { ...step, id: 'new-copy', order: 2, instanceNotes: "This copied step's own notes" };
    const copies = mode === 'two-copies' ? [local, { ...local, id: 'second-copy', order: 3, instanceNotes: 'Words of the second copy' }] : [local];
    checkpoint.draft = { ...value, title: 'My private name', templates: [localBlock, neighbor],
      flow: [step, ...copies, { ...other, order: copies.length + 2 }] };
    checkpoint.dirty = true;
    checkpoint.unreadableScalarProof = ['title'];
    const savedNeighbor = { ...neighbor, content: 'New independent saved words' };
    const savedStep = { ...other, order: 1, instanceNotes: 'Saved neighbor notes' };
    const stored = { resource, value: { ...value, templates: [savedNeighbor], flow: [savedStep] }, metadata: { ...metadata, revision: 2 } };
    checkpoint.remoteCandidate = stored;
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
    db.documents.set('groups/' + resource.id, { ...stored.value, _dataEngine: stored.metadata });
    const session = DataSession.restore((await throughDeviceStorage(record)).checkpoint);
    const before = session.checkpoint();
    expect(() => session.keepLocal()).toThrow('The copied group step needs its own review');
    expect(() => session.acceptRemote(before.draft)).toThrow('The copied group step needs its own review');
    expect(session.checkpoint()).toEqual(before);
    expect(readGroupFlowFieldConflict(before)).toMatchObject({ field: 'title', mine: 'My private name', stored: value.title });
    expect(session.choosePrivateFields('local', null)).toBe(true);
    expect((await save(session.checkpoint())).code).toBe('resolve-version-first');
    const reopened = DataSession.restore((await throughDeviceStorage({ ...record, checkpoint: session.checkpoint() })).checkpoint);
    expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({ field: 'copiedSteps',
      mine: expect.stringContaining(localBlock.content), stored: null });
    const comparison = readGroupFlowFieldConflict(reopened.checkpoint());
    for (const copy of copies) expect(comparison?.mine).toContain(copy.instanceNotes);
    const keep = mode !== 'drop';
    expect(reopened.choosePrivateFields(keep ? 'local' : 'remote', null)).toBe(true);
    const resolved = reopened.checkpoint();
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.draft?.title).toBe('My private name');
    expect(resolved.groupTitleDraft?.action.observedRevision).toBe(2);
    const templates = resolved.draft?.templates as DocumentData[];
    const steps = resolved.draft?.flow as DocumentData[];
    expect(templates).not.toContainEqual(expect.objectContaining({ id: block.id }));
    expect(steps).not.toContainEqual(expect.objectContaining({ id: step.id }));
    if (keep) {
      const restored = templates.find(row => row.id !== neighbor.id)!;
      expect(restored).toMatchObject({ title: block.title, content: localBlock.content });
      expect(restored.createdAt).not.toBe(block.createdAt);
      expect(steps).toEqual([...copies.map((copy, index) => ({ ...copy, templateId: restored.id, order: index + 1 })),
        { ...savedStep, order: copies.length + 1 }]);
    } else {
      expect(templates).toEqual([savedNeighbor]);
      expect(steps).toEqual([savedStep]);
    }
    expect(templates).toContainEqual(savedNeighbor);
    const delivery = await save(resolved);
    expect([delivery.kind, delivery.code, delivery.commands.length]).toEqual(['acknowledged', undefined, 1]);
    expect((await readDocument('owner', resource)).value).toMatchObject(resolved.draft!);
  });

it.each(['source-returns', 'source-returns-edited', 'copy-duration-edited', 'name-matches-saved', 'name-matches-before-choice', 'group-deleted'] as const)(
  'keeps a separate question for an already compared copy when %s', async mode => {
    const resource = { collection: 'groups', id: 'group-private-copy-follows-choice' };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const blocks = ['a', 'b'].map(id => ({ id, title: 'Block ' + id, content: 'Words of ' + id,
      status: 'filled', type: 'custom', createdAt: 'born-' + id, updatedAt: 'born-' + id }));
    const rows = blocks.map(({ id }, index) => ({ id: 'original-' + id, templateId: id, order: index + 1 }));
    const original = { userId: 'owner', title: 'Original name', status: 'active', templates: blocks, flow: rows };
    const checkpoint = new DataSession({ resource, value: original, metadata }).checkpoint();
    const sourceEdited = mode === 'source-returns-edited';
    const sourceReturns = mode === 'source-returns' || sourceEdited;
    const localBlocks = sourceEdited ? [{ ...blocks[0], title: 'The block name written on this phone' }, blocks[1]] : blocks;
    const mine = { ...original, title: 'My group name', templates: localBlocks, flow: rows.flatMap((row, index) => [
      { ...row, order: 2 * index + 1 }, { ...row, id: 'copy-' + row.templateId, order: 2 * index + 2 },
    ]) };
    const absent = { resource, value: { ...original, templates: [], flow: [] }, metadata: { ...metadata, revision: 2 } };
    checkpoint.draft = mine;
    checkpoint.remoteCandidate = absent;
    checkpoint.unreadableScalarProof = ['title'];
    if (sourceEdited) checkpoint.unreadableRowProofs = [{ field: 'groupBlockTitleDrafts', rowId: 'a', birth: blocks[0].createdAt, generation: 'g' }];
    const session = DataSession.restore(checkpoint);
    if (mode !== 'name-matches-before-choice') {
      expect(session.choosePrivateFields('local', null)).toBe(true);
      expect(readGroupFlowFieldConflict(session.checkpoint())).toMatchObject({ field: 'copiedSteps', rowTitle: localBlocks[0].title });
      expect(session.choosePrivateFields('remote', null)).toBe(true);
      expect(readGroupFlowFieldConflict(session.checkpoint())).toMatchObject({ field: 'copiedSteps', rowTitle: 'Block b' });
    }
    const returned = sourceEdited ? { ...blocks[0], title: 'The block name saved from the other device' } : blocks[0];
    const later = { ...absent, value: { ...original, templates: [returned], flow: [rows[0]] }, metadata: { ...metadata, revision: 3 } };
    if (sourceReturns) {
      session.observe(later, { source: 'server' });
    } else if (mode === 'group-deleted') {
      session.observe({ ...later, value: null, metadata: { ...later.metadata, deleted: true } }, { source: 'server' });
    } else if (mode === 'name-matches-saved' || mode === 'name-matches-before-choice') {
      session.edit({ ...session.checkpoint().draft!, title: original.title });
    } else {
      const changed = mine.flow.map(row => row.id === 'copy-a' ? { ...row, durationMin: 25 } : row);
      session.edit({ ...session.checkpoint().draft!, flow: changed });
    }
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
    const reopened = DataSession.restore((await throughDeviceStorage(record)).checkpoint);
    if (mode === 'group-deleted') {
      const before = reopened.checkpoint();
      expect(before.draft).toEqual(mine);
      expect(readGroupFlowFieldConflict(before)).toBeUndefined();
      expect(() => reopened.keepLocal()).toThrow();
      expect(await save(before)).toEqual({ code: 'resolve-version-first', commands: [] });
      reopened.acceptRemote(before.draft);
      expect(reopened.checkpoint()).toMatchObject({ confirmed: { value: null }, draft: null, dirty: false, conflicts: [] });
      expect(reopened.checkpoint().privateFieldReview).toBeUndefined();
      return;
    }
    if (sourceReturns) {
      expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({ field: 'title' });
      expect(reopened.choosePrivateFields('local', null)).toBe(true);
    }
    if (sourceEdited) {
      expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({
        field: 'block', mine: localBlocks[0].title, stored: returned.title,
      });
      expect(reopened.choosePrivateFields('local', null)).toBe(true);
    }
    if (mode === 'name-matches-before-choice') {
      expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({ field: 'copiedSteps', rowTitle: 'Block a' });
      expect(reopened.choosePrivateFields('remote', null)).toBe(true);
    }
    if (mode === 'name-matches-saved' || mode === 'name-matches-before-choice') {
      expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({ field: 'copiedSteps', rowTitle: 'Block b' });
      expect(await save(reopened.checkpoint())).toEqual({ code: 'resolve-version-first', commands: [] });
      expect(reopened.choosePrivateFields('remote', null)).toBe(true);
      expect(reopened.checkpoint().draft).toEqual(absent.value);
      return;
    }
    expect(readGroupFlowFieldConflict(reopened.checkpoint())).toMatchObject({
      field: 'copiedSteps', rowTitle: localBlocks[0].title, sourcePresent: sourceReturns,
      ...(mode === 'copy-duration-edited' && { steps: [expect.objectContaining({ durationMin: 25 })] }),
    });
    expect(reopened.choosePrivateFields('remote', null)).toBe(true);
    expect(reopened.choosePrivateFields('remote', null)).toBe(true);
    const saved = sourceReturns ? later.value : absent.value;
    const selected = reopened.checkpoint();
    expect(selected.conflicts).toEqual([]);
    expect(selected.draft).toEqual({ ...saved, title: mine.title, ...(sourceEdited && { templates: [localBlocks[0]] }) });
  });

it.each(['missing birth', 'wrong birth', 'wrong generation', 'wrong row id', 'wrong words', 'wrong opening', 'unreadable map'] as const)(
  'holds the exact group block whose original observation has %s', async mode => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection: 'groups', id: 'group-with-damaged-row-address' };
    const row = { id: 'block', title: 'Saved block', type: 'custom', content: 'Keep content', status: 'filled', createdAt: 'born', updatedAt: 'born' };
    const neighbor = { ...row, id: 'neighbor', title: 'Independent block' };
    const value = { userId: 'owner', title: 'Group', status: 'draft', templates: [row, neighbor], flow: [], meetingDates: [] };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const session = new DataSession({ resource, value, metadata });
    session.edit({ ...value, templates: [{ ...row, title: 'Private name' }, neighbor] }, undefined, {
      field: 'group-block-title', rowId: row.id, time: null,
    });
    const checkpoint = session.checkpoint();
    if (mode === 'unreadable map') loose(checkpoint).groupBlockTitleDrafts = 'unreadable';
    else {
      const entry = loose(checkpoint.groupBlockTitleDrafts?.block);
      if (mode === 'wrong generation') entry.generation = 'another-generation';
      else if (mode === 'wrong row id') loose(entry.action).rowId = 'neighbor';
      else if (mode === 'wrong words') loose(entry.action).after = 'Different private words';
      else if (mode === 'wrong opening') loose(entry.action).before = 'Different opening words';
      else loose(entry.action).rowCreatedAt = mode === 'missing birth' ? null : 'another-row';
    }
    db.documents.set('groups/' + resource.id, { ...value, _dataEngine: { ...metadata, revision: 3 } });
    const record = { owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] };
    const recovered = (await throughDeviceStorage(record)).checkpoint;
    takeDroppedProof('groupBlockTitleDrafts');
    expect(recovered.conflicts.map(({ path }) => path)).toEqual([['templates', 'id:block', 'title']]);
    expect((await save(recovered)).code).toBe('resolve-version-first');
    expect((await readDocument('owner', resource)).value?.templates).toEqual([row, neighbor]);
  });

it.each(['replacement row', 'deleted row'] as const)('keeps an unreadable row edit from acting on a %s', async situation => {
  const resource = { collection: 'groups', id: 'group-proof-row' };
  const opening = { id: 'row', title: 'Opening block name', createdAt: 'opening-row' };
  const sibling = { id: 'sibling', title: 'Independent block', createdAt: 'other-row' };
  const original = { userId: 'owner', title: 'Group', description: 'Opening description', templates: [opening, sibling] };
  const snapshot: ResourceSnapshot = { resource, value: original, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  const session = new DataSession(snapshot);
  session.edit({ ...original, description: 'Independent words', templates: [{ ...opening, title: 'Private block name' }, sibling] },
    undefined, { field: 'group-block-title', rowId: opening.id, time: null });
  const checkpoint = session.checkpoint();
  loose(checkpoint.groupBlockTitleDrafts?.row?.action).observedRevision = 'unreadable';
  const recovered = await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] });
  takeDroppedProof('groupBlockTitleDrafts');
  const reopened = DataSession.restore(recovered.checkpoint);
  const replacement = { ...opening, title: 'Replacement block name', createdAt: 'replacement-row' };
  const templates = situation === 'deleted row' ? [sibling] : [replacement, sibling];
  reopened.observe({ ...snapshot, value: { ...original, templates }, metadata: { ...snapshot.metadata!, revision: 2 } }, { source: 'server' });
  expect(() => reopened.keepLocal()).toThrow('The edited row is gone');
  expect(reopened.checkpoint().draft?.templates).toContainEqual({ ...opening, title: 'Private block name' });
  reopened.acceptRemote(reopened.checkpoint().draft);
  expect(reopened.checkpoint()).toMatchObject({ conflicts: [], draft: { description: 'Independent words', templates } });
});

it.each(['wrong id', 'same-title neighbor', 'different-title neighbor', 'wrong branch', 'wrong generation', 'wrong words', 'broken list'] as const)('holds an exegetical title when its stored address has %s', async mode => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'sermons', id: 'damaged-exegetical-address' };
  const point = { id: 'point', title: 'Saved title' };
  const second = { id: 'other', title: mode === 'same-title neighbor' ? 'Private title' : 'Independent point' };
  const value = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-13', thoughts: [],
    preparation: { exegeticalPlan: [point, second], authorIntent: 'Independent words' } };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const session = new DataSession({ resource, value, metadata });
  session.edit({ ...value, preparation: { ...value.preparation, exegeticalPlan: [{ ...point, title: 'Private title' }, second] } },
    undefined, { field: 'exegetical-point', nodeId: point.id, intent: 'title', time: null });
  const checkpoint = session.checkpoint();
  const item = loose(checkpoint.exegeticalPointDrafts?.[0]);
  if (mode === 'wrong id') item.nodeId = 'wrong-but-readable-point';
  else if (mode === 'same-title neighbor' || mode === 'different-title neighbor') item.nodeId = second.id;
  else if (mode === 'wrong branch') item.ancestors = ['other'];
  else if (mode === 'wrong generation') item.generation = 'old-generation';
  else if (mode === 'wrong words') item.title = 'Unrelated title';
  else loose(checkpoint).exegeticalPointDrafts = 'unreadable';
  db.documents.set('sermons/' + resource.id, { ...value, _dataEngine: { ...metadata, revision: 3 } });
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  takeDroppedProof('exegeticalPointDrafts');
  expect(recovered.unreadableExegeticalProofs).toEqual([{ nodeId: point.id, kind: 'title', generation: 'g', ancestors: [] }]);
  expect((await save(recovered)).code).toBe('resolve-version-first');
  expect((await readDocument('owner', resource)).value?.preparation).toEqual(value.preparation);
});

it('asks about the whole removed branch when the stored proof points to its child', async () => {
  const resource = { collection: 'sermons', id: 'damaged-exegetical-removal' };
  const child = { id: 'child', title: 'Nested point' };
  const branch = { id: 'branch', title: 'Removed point', children: [child] };
  const sibling = { id: 'sibling', title: 'Independent point' };
  const value = { userId: 'owner', preparation: { exegeticalPlan: [branch, sibling], authorIntent: 'Opening words' } };
  const draft = { ...value, preparation: { exegeticalPlan: [sibling], authorIntent: 'Private words' } };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const session = new DataSession({ resource, value, metadata });
  session.edit({ ...draft, preparation: { ...draft.preparation, authorIntent: 'Opening words' } },
    undefined, { field: 'exegetical-point', nodeId: branch.id, intent: 'remove', time: null });
  session.edit(draft);
  const checkpoint = session.checkpoint();
  loose(checkpoint.exegeticalPointDrafts?.[0]).nodeId = child.id;
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  takeDroppedProof('exegeticalPointDrafts');
  expect(recovered.conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan', 'id:branch']]);
  const restored = DataSession.restore(recovered);
  restored.acceptRemote(restored.checkpoint().draft);
  expect(restored.checkpoint().draft?.preparation).toEqual({ exegeticalPlan: [branch, sibling], authorIntent: 'Private words' });
});

it.each(['current', 'legacy', 'invalid identity witness', 'unreadable legacy revision'] as const)('holds two removed siblings when their %s observations name the same point', async format => {
  const resource = { collection: 'sermons', id: 'damaged-sibling-removals' };
  const a = { id: 'a', title: 'First point' }, b = { id: 'b', title: 'Second point' };
  const c = { id: 'c', title: 'Independent point' };
  const value = { userId: 'owner', preparation: { exegeticalPlan: [a, b, c], authorIntent: 'Opening words' } };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const session = new DataSession({ resource, value, metadata });
  const removing = (nodeId: string, plan: typeof a[]) => session.edit({ ...value, preparation: { ...value.preparation, exegeticalPlan: plan } },
    undefined, { field: 'exegetical-point', nodeId, intent: 'remove', time: null });
  removing(a.id, [b, c]);
  removing(b.id, [c]);
  const checkpoint = session.checkpoint();
  expect(checkpoint.exegeticalPointDrafts).toHaveLength(2);
  if (format === 'legacy' || format === 'unreadable legacy revision') {
    for (const proof of checkpoint.exegeticalPointDrafts ?? []) delete loose(proof).removedPointId;
  }
  const damaged = loose(checkpoint.exegeticalPointDrafts?.find(proof => proof.nodeId === a.id));
  damaged.nodeId = b.id;
  if (format === 'invalid identity witness') damaged.removedPointId = 15;
  if (format === 'unreadable legacy revision') damaged.observedRevision = 'unreadable';
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  takeDroppedProof('exegeticalPointDrafts');
  const held = recovered.unreadableExegeticalProofs?.map(address => address.nodeId).sort();
  const legacy = format === 'legacy' || format === 'unreadable legacy revision';
  expect(held).toEqual(legacy ? [a.id, b.id] : [a.id]);
  const kept = recovered.exegeticalPointDrafts?.map(proof => proof.nodeId);
  expect(kept).toEqual(legacy ? undefined : [b.id]);
  expect((await save(recovered)).code).toBe('resolve-version-first');
  for (const choice of ['local', 'stored']) {
    const reopened = DataSession.restore(recovered);
    if (choice === 'local') reopened.keepLocal();
    else reopened.acceptRemote(reopened.checkpoint().draft);
    const expected = choice === 'local' ? [c] : legacy ? [a, b, c] : [a, c];
    expect(reopened.checkpoint().draft?.preparation).toEqual({ exegeticalPlan: expected, authorIntent: 'Opening words' });
    expect(reopened.checkpoint().exegeticalPointDrafts?.map(proof => proof.nodeId)).toEqual(kept);
  }
});

it.each(['current', 'legacy', 'duplicated current binding'] as const)('discards an acknowledged removal alias beside a later %s observation', async format => {
  const resource = { collection: 'sermons', id: 'acknowledged-removal-alias' };
  const a = { id: 'a', title: 'First point' }, b = { id: 'b', title: 'Second point' };
  const c = { id: 'c', title: 'Independent point' };
  const value = { userId: 'owner', preparation: { exegeticalPlan: [a, b, c] } };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const session = new DataSession({ resource, value, metadata });
  const document = (exegeticalPlan: typeof a[]) => ({ ...value, preparation: { exegeticalPlan } });
  session.edit(document([b, c]), undefined, { field: 'exegetical-point', nodeId: a.id, intent: 'remove', time: null });
  session.registerCommit('remove-first', session.checkpoint().editGeneration, document([b, c]));
  session.accept({ kind: 'acknowledged', operationId: 'remove-first', snapshot: { resource, value: document([b, c]),
    metadata: { ...metadata, revision: 2, operationId: 'remove-first' } } });
  const time = { earliestMs: T, latestMs: T + 5 };
  session.edit(document([c]), undefined, { field: 'exegetical-point', nodeId: b.id, intent: 'remove', time });
  const checkpoint = session.checkpoint();
  const older = loose(checkpoint.exegeticalPointDrafts?.find(action => action.nodeId === a.id));
  if (format === 'duplicated current binding') older.removedPointId = b.id;
  else delete older.removedPointId;
  older.nodeId = b.id;
  if (format === 'legacy') delete loose(checkpoint.exegeticalPointDrafts?.[0]).removedPointId;
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  takeDroppedProof('exegeticalPointDrafts');
  if (format === 'current') {
    expect(recovered.unreadableExegeticalProofs).toBeUndefined();
    expect(recovered.exegeticalPointDrafts).toEqual([expect.objectContaining({ nodeId: b.id, observedRevision: 2, time })]);
  } else {
    expect(recovered.unreadableExegeticalProofs).toEqual([{ nodeId: b.id, kind: 'remove', generation: 'g', ancestors: [] }]);
    expect(recovered.exegeticalPointDrafts).toBeUndefined();
  }
});

it.each(['acknowledged', 'cancelled'] as const)('reviews an unreadable new point title after its first Save is %s', async disposition => {
  const resource = { collection: 'sermons', id: 'pending-point-proof' };
  const sibling = { id: 'sibling', title: 'Other point', children: [] };
  const point = { id: 'new-point', title: '', children: [] };
  const document = (plan: typeof point[], authorIntent = 'Opening words') =>
    ({ userId: 'owner', preparation: { exegeticalPlan: plan, authorIntent } });
  const value = document([sibling]);
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const session = new DataSession({ resource, value, metadata });
  const submitted = document([sibling, point]);
  session.edit(submitted);
  session.registerCommit('first-save', session.checkpoint().editGeneration, submitted);
  const privateTitle = 'Private title typed while saving';
  const draft = document([sibling, { ...point, title: privateTitle }], 'Independent private words');
  session.edit(draft, undefined, { field: 'exegetical-point', nodeId: point.id, intent: 'title', time: null });
  const checkpoint = session.checkpoint();
  expect(checkpoint.exegeticalPointDrafts?.[0]?.nodeId).toBe(point.id);
  loose(checkpoint).exegeticalPointDrafts = 'broken address list';
  const first: CommitRequest = { id: 'first-save', owner: 'owner', editorId: 'old-editor', editGeneration: 1,
    baseline: { resource, value, metadata }, working: { resource, value, metadata }, value: submitted, intended: submitted,
    predecessor: null, revision: 0, initialized: false, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] }, first)).checkpoint;
  takeDroppedProof('exegeticalPointDrafts');
  const reopened = DataSession.restore(recovered);
  expect(reopened.checkpoint().conflicts).toEqual([]);
  const savedSibling = { ...sibling, title: 'Newer saved neighbor' };
  const savedPlan = disposition === 'cancelled' ? [savedSibling] : [savedSibling, point];
  const saved = { resource, value: document(savedPlan), metadata: { ...metadata, revision: 2, operationId: 'next-version' } };
  if (disposition === 'cancelled') {
    reopened.observe(saved, { source: 'server' });
    reopened.applyCommit({ ...first, state: 'cancelled', cancelledByChoice: true });
  } else {
    reopened.accept({ kind: 'acknowledged', operationId: 'first-save', snapshot: saved });
  }
  const kept = document([savedSibling, { ...point, title: privateTitle }], 'Independent private words');
  expect(reopened.checkpoint().draft?.preparation).toEqual(kept.preparation);
  expect(reopened.checkpoint().conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan', 'id:new-point']]);
  expect(reopened.prepare('next-save', 'owner')).toBeNull();
  const stored = DataSession.restore(reopened.checkpoint());
  stored.acceptRemote(stored.checkpoint().draft);
  expect(stored.checkpoint().draft?.preparation).toEqual(document(savedPlan, 'Independent private words').preparation);
  expect(stored.prepare('independent-edit', 'owner')?.kind).toBe('update');
  reopened.keepLocal();
  expect(reopened.checkpoint().draft?.preparation).toEqual(kept.preparation);
});

it.each([false, true])('reviews the missing parent with its recovered titles (multiple: %s)', async multiple => {
  const resource = { collection: 'sermons', id: 'pending-nested-point' };
  const savedPoint = { id: 'sibling', title: 'Saved point' };
  const child = { id: 'child', title: '', children: [] };
  const secondChild = { id: 'second-child', title: 'Another child' };
  const parent = { id: 'parent', title: 'Unsaved parent', children: multiple ? [child, secondChild] : [child] };
  const document = (exegeticalPlan: DocumentData[], authorIntent = 'Opening intent') =>
    ({ userId: 'owner', preparation: { exegeticalPlan, authorIntent } });
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const opening = { resource, value: document([savedPoint]), metadata };
  const session = new DataSession(opening);
  const submitted = document([savedPoint, parent]);
  session.edit(submitted);
  session.registerCommit('earlier-addition', session.checkpoint().editGeneration, submitted);
  const changedChild = { ...child, title: 'Later child title' };
  let updatedParent = { ...parent, children: multiple ? [changedChild, secondChild] : [changedChild] };
  session.edit(document([savedPoint, updatedParent], 'Independent private intent'), undefined,
    { field: 'exegetical-point', nodeId: child.id, intent: 'title', time: null });
  if (multiple) {
    updatedParent = { ...updatedParent, children: [changedChild, { ...secondChild, title: 'Second later child title' }] };
    session.edit(document([savedPoint, updatedParent], 'Independent private intent'), undefined,
      { field: 'exegetical-point', nodeId: secondChild.id, intent: 'title', time: null });
  }
  const checkpoint = session.checkpoint();
  expect(checkpoint.exegeticalPointDrafts?.[0]?.nodeId).toBe(multiple ? secondChild.id : child.id);
  loose(checkpoint).exegeticalPointDrafts = 'broken observations';
  const earlier: CommitRequest = { id: 'earlier-addition', owner: 'owner', editorId: 'old-editor', editGeneration: 1,
    baseline: opening, working: opening, value: submitted, intended: submitted,
    predecessor: null, revision: 0, initialized: false, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] }, earlier)).checkpoint;
  takeDroppedProof('exegeticalPointDrafts');
  const reopened = DataSession.restore(recovered);
  const changed = { ...savedPoint, title: 'New saved neighbor' };
  reopened.observe({ ...opening, value: document([changed]), metadata: { ...metadata, revision: 2 } }, { source: 'server' });
  reopened.applyCommit({ ...earlier, state: 'cancelled', cancelledByChoice: true });
  expect(reopened.checkpoint().conflicts.map(issue => issue.path)).toEqual([['preparation', 'exegeticalPlan', 'id:parent']]);
  const comparison = readSermonConflict(reopened.checkpoint());
  expect(comparison).toMatchObject({ kind: 'exegetical-point', versions: [
    { mine: 'Unsaved parent', descendantTitles: multiple ? ['Later child title', 'Second later child title'] : ['Later child title'] },
  ] });
  const saved = DataSession.restore(reopened.checkpoint());
  saved.acceptRemote(saved.checkpoint().draft);
  expect(saved.checkpoint().draft?.preparation).toEqual(document([changed], 'Independent private intent').preparation);
  reopened.keepLocal();
  expect(reopened.checkpoint().draft?.preparation).toEqual(document([changed, updatedParent], 'Independent private intent').preparation);
});

it.each(['title', 'remove'] as const)('holds a recovered exegetical %s when the original point revision is unreadable', async kind => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'sermons', id: 'sermon-point-proof' };
  const point = { id: 'point', title: 'Opening title', children: [{ id: 'child', title: 'Opening child' }] };
  const sibling = { id: 'sibling', title: 'Independent point', children: [] };
  const document = (exegeticalPlan: typeof point[]) => ({ userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-13',
    thoughts: [], preparation: { exegeticalPlan, authorIntent: 'Independent words' } });
  const opening = document([point, sibling]);
  const snapshot: ResourceSnapshot = { resource, value: opening, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set(resource.collection + '/' + resource.id, { ...opening, _dataEngine: snapshot.metadata });
  const session = new DataSession(snapshot);
  const proposed = document(kind === 'remove' ? [sibling] : [{ ...point, title: 'Private point words' }, sibling]);
  session.edit(proposed, undefined, { field: 'exegetical-point', nodeId: point.id, intent: kind, time: null });
  const checkpoint = session.checkpoint();
  expect(checkpoint.exegeticalPointDrafts).toHaveLength(1);
  loose(checkpoint.exegeticalPointDrafts?.[0]).observedRevision = 'unreadable';
  const restored = await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] });
  takeDroppedProof('exegeticalPointDrafts');
  const edit = (operationId: string, before: typeof point, after: typeof point, observedRevision: number) => processCommand('owner', {
    protocol: 1, operationId, owner: 'owner', resource, generation: 'g', dependsOn: [], kind: 'update',
    changes: diffFields(document([before, sibling]), document([after, sibling])),
    exegeticalPlanActions: [{ nodeId: point.id, kind: 'title', observedRevision, time: null }],
  });
  const desktop = { ...point, title: 'Desktop title' };
  expect((await edit('desktop-title', point, desktop, 1)).kind).toBe('acknowledged');
  expect((await edit('desktop-return', desktop, point, 2)).kind).toBe('acknowledged');
  const outcome = await save(restored.checkpoint);
  expect(outcome.commands).toHaveLength(0);
  expect(outcome.code).toBe('resolve-version-first');
  expect(restored.checkpoint.draft?.preparation).toEqual(proposed.preparation);
  const stored = await readDocument('owner', resource);
  expect(stored.value?.preparation).toEqual(opening.preparation);
  const reopened = DataSession.restore(restored.checkpoint);
  reopened.observe(stored, { source: 'server' });
  const branch = { ...point, children: [{ id: 'child', title: 'Private nested words' }] };
  const localPlan = kind === 'title' ? [{ ...branch, title: 'Private point words' }, sibling] : [sibling];
  reopened.edit({ ...proposed, preparation: { exegeticalPlan: localPlan, authorIntent: 'New independent words' } });
  const storedChoice = DataSession.restore(reopened.checkpoint());
  storedChoice.acceptRemote(storedChoice.checkpoint().draft);
  expect(storedChoice.checkpoint()).toMatchObject({ conflicts: [], draft: { preparation: {
    exegeticalPlan: [kind === 'title' ? branch : point, sibling], authorIntent: 'New independent words' } } });
  reopened.keepLocal();
  expect(reopened.checkpoint()).toMatchObject({ conflicts: [], draft: { preparation: { exegeticalPlan: localPlan, authorIntent: 'New independent words' } } });
  expect(reopened.checkpoint()).not.toHaveProperty('unreadableExegeticalProofs');
  if (kind === 'title') {
    for (const moved of [[{ ...sibling, children: [point] }], [sibling]]) {
      // Start with the original unreadable title again, before seeing the changed plan.
      const selection = DataSession.restore(restored.checkpoint);
      selection.edit({ ...proposed, preparation: { ...proposed.preparation, authorIntent: 'New independent words' } });
      selection.observe({ ...stored, value: document(moved), metadata: { ...stored.metadata!, revision: 4 } }, { source: 'server' });
      expect(() => selection.keepLocal()).toThrow('The edited plan point has changed places or was removed');
      expect(selection.checkpoint().draft?.preparation).toMatchObject({ exegeticalPlan: proposed.preparation.exegeticalPlan });
      selection.acceptRemote(selection.checkpoint().draft);
      expect(selection.checkpoint()).toMatchObject({ conflicts: [], draft: { preparation: { exegeticalPlan: moved, authorIntent: 'New independent words' } } });
    }
  }
});

it('retains a readable sibling proof when another exegetical opening cannot be read', async () => {
  const resource = { collection: 'sermons', id: 'sermon-sibling-proof' };
  const opening = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const value = { userId: 'owner', preparation: { exegeticalPlan: opening } };
  const session = new DataSession({ resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  const edit = (nodeId: string, nodes: typeof opening) => session.edit({ ...value, preparation: { exegeticalPlan: nodes } },
    undefined, { field: 'exegetical-point', nodeId, intent: 'title', time: null });
  const privateA = { ...opening[0], title: 'New A' };
  edit('a', [privateA, opening[1]]);
  edit('b', [privateA, { ...opening[1], title: 'New B' }]);
  const checkpoint = session.checkpoint();
  loose(checkpoint.exegeticalPointDrafts?.find(proof => proof.nodeId === 'a')).observedRevision = 'unreadable';
  const recovered = await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] });
  takeDroppedProof('exegeticalPointDrafts');
  expect(recovered.checkpoint.unreadableExegeticalProofs).toEqual([{ nodeId: 'a', kind: 'title', generation: 'g', ancestors: [] }]);
  expect(recovered.checkpoint.exegeticalPointDrafts).toEqual([expect.objectContaining({ nodeId: 'b', observedRevision: 1 })]);
  for (const side of ['mine', 'stored']) {
    const reopened = DataSession.restore(recovered.checkpoint);
    if (side === 'mine') reopened.keepLocal();
    else reopened.acceptRemote(reopened.checkpoint().draft);
    expect(reopened.checkpoint().exegeticalPointDrafts).toEqual(recovered.checkpoint.exegeticalPointDrafts);
  }
});

/*
 * BUG-20261113-placement-retry-submits-unsent-words: a placement retry is an instruction to resend a move, not proof,
 * and device storage does not keep it, as before. A recovered draft that still holds the move — or has undone it —
 * and then gets private words is saved as the draft says: the words go on the wire and are kept, and no abandoned
 * move is replayed.
 */
const POINTS = [{ id: 'a', text: 'First', title: 'First', type: 'custom', subPoints: [] }, { id: 'b', text: 'Second', title: 'Second', type: 'custom', subPoints: [] }];
const MOVED = [POINTS[1], POINTS[0]];

describe.each(['rank', 'step', 'outline'] as const)('a recovered %s placement retry', family => {
  it.each([
    ['after reload', 'keeps the move', true, false, false], ['after reload', 'undoes the move', true, true, false],
    ['on the same screen', 'keeps the move', false, false, false], ['on the same screen', 'undoes the move', false, true, false],
    ['with an earlier Save still queued', 'keeps the move', false, false, true],
  ] as const)('%s, then private words: the draft %s and the words survive', async (_mode, _label, reload, undo, preceding) => {
    const db = installWorldFirestore(() => T + 1000);
    const value: Loose = { userId: 'owner', title: 'Opening', createdAt: 'now', updatedAt: 'now', date: '2026-11-12', rank: 1, steps: POINTS,
      thoughts: [], verse: 'John 1:1', outline: { introduction: [], main: POINTS, conclusion: [] } };
    const resource = { collection: family === 'outline' ? 'sermons' : 'serviceOrders', id: 'doc' };
    const snapshot: ResourceSnapshot = { resource, value: value as DocumentData, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
    db.documents.set(resource.collection + '/doc', { ...clone(value), _dataEngine: clone(snapshot.metadata) });
    db.documents.set('serviceOrders/neighbor', { userId: 'owner', title: 'Neighbor', rank: 3, _dataEngine: clone(snapshot.metadata) });
    const session = new DataSession(snapshot);
    if (family === 'rank') session.stageServiceOrderPlacementRetry({ generation: 'g', before: { exists: true, value: 1 }, rank: 4, placement: {
      opening: { previous: null, next: { id: 'neighbor', generation: 'g' } }, destination: { previous: { id: 'neighbor', generation: 'g' }, next: null },
      observedRevision: 1, time: null } });
    if (family === 'step') session.stageServiceOrderStepPlacementRetry({ generation: 'g', shownIds: ['a', 'b'], placement: { stepId: 'a',
      opening: { previous: null, next: 'b' }, destination: { previous: 'b', next: null }, observedRevision: 1, time: null } }, MOVED);
    if (family === 'outline') session.stageOutlinePointPlacementRetry({ generation: 'g',
      before: { introduction: [], main: [{ id: 'a' }, { id: 'b' }], conclusion: [] }, after: { introduction: [], main: [{ id: 'b' }, { id: 'a' }], conclusion: [] },
      placement: { pointId: 'a', opening: { section: 'main', previous: null, next: 'b' }, destination: { section: 'main', previous: 'b', next: null },
        observedRevision: 1, time: null } }, { ...value, outline: { introduction: [], main: MOVED, conclusion: [] } } as DocumentData);
    const record: EditorRecord = { owner: 'owner', editorId: 'old-editor', prepared: null, unfinalized: [], checkpoint: session.checkpoint() };

    // Left and reopened: the recovered draft continues; then the person types.
    const reopened = reload ? DataSession.restore((await throughDeviceStorage(record)).checkpoint) : session;
    const words = 'Private words after recovery';
    const draft = undo ? clone(value) : reopened.checkpoint().draft!;
    const rowWords = (rows: Loose[]) => rows.map(row => row.id === 'a' ? { ...row, title: words, text: words } : row);
    // A placement-only command must not take credit for words in the same array as the move.
    if (family === 'step') draft.steps = rowWords(draft.steps as Loose[]) as DocumentData[];
    if (family === 'outline') {
      const outline = draft.outline as { main: Loose[] };
      draft.outline = { ...outline, main: rowWords(outline.main) } as DocumentData;
    }
    reopened.edit({ ...draft, title: words } as DocumentData);
    const edited = reopened.checkpoint();
    const outcome = await save(reload ? (await throughDeviceStorage({ ...record, checkpoint: edited })).checkpoint : edited, preceding);

    const moved = { rank: 'rank', step: 'steps', outline: 'outline' }[family];
    expect(outcome.kind).toBe('acknowledged');
    const sentPaths = outcome.commands.flatMap(command => (command.changes as Array<{ path: string[] }>).map(change => change.path[0]));
    const hasRowWords = family !== 'rank';
    const sentPlacement = !undo;
    const placementActions = outcome.commands.filter(command => command.serviceOrderPlacement || command.serviceOrderStepPlacement || command.outlinePointPlacement);
    expect(placementActions).toHaveLength(Number(sentPlacement));
    if (sentPlacement && hasRowWords) expect(JSON.stringify(placementActions[0].changes)).not.toContain(words);
    expect(sentPaths).toContain('title');
    expect(sentPaths.filter(path => path === moved)).toHaveLength(Number(!undo || hasRowWords) + Number(sentPlacement && hasRowWords));
    const server = (await readDocument('owner', resource)).value!;
    expect(server.title).toBe(words);
    const rows = family === 'step' ? server.steps as Loose[] : (server.outline as { main: Loose[] }).main;
    if (hasRowWords) expect(rows.find(row => row.id === 'a')?.title).toBe(words);
    const order = family === 'rank' ? server.rank : rows.map(point => point.id);
    if (family === 'rank') {
      if (undo) expect(order).toBe(1);
      else expect(order).toBeGreaterThan(3);
    } else expect(order).toEqual(undo ? ['a', 'b'] : ['b', 'a']);
  });
});

const recoveredTitles = [
  { collection: 'groups', key: 'groupTitleDraft', action: 'groupTitleAction', fields: { status: 'draft' } },
  { collection: 'councils', key: 'councilTitleDraft', action: 'councilTitleAction', fields: { status: 'preparing', topics: [] as DocumentData[] } },
  { collection: 'studyNotes', key: 'studyNoteTitleDraft', action: 'studyNoteTitleAction', fields: { type: 'note', content: 'A note.' } },
] as const;

it.each(recoveredTitles.flatMap(target => ['foreign generation', 'future revision', 'different title'].map(damage => ({ ...target, damage }))))(
  'offers both $collection titles when the stored opening names a $damage', async ({ collection, key, action, fields, damage }) => {
    const db = installWorldFirestore(() => T + 1000);
    const resource = { collection, id: 'title-with-incompatible-opening' };
    const opening: DocumentData = { ...fields, userId: 'owner', title: 'Original title' };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    db.documents.set(collection + '/' + resource.id, { ...opening, _dataEngine: metadata });
    const phone = new DataSession({ resource, value: opening, metadata });
    const privateTitle = 'Earlier offline title';
    phone.edit({ ...opening, title: privateTitle }, undefined, { field: 'title', time: null });
    const checkpoint = phone.checkpoint();
    const proof = checkpoint[key]!;
    expect(proof.action.observedRevision).toBe(1);
    if (damage === 'foreign generation') proof.generation = 'another-generation';
    else if (damage === 'future revision') proof.action.observedRevision = 101;
    else {
      const earlierTitle = 'Earlier title from the same draft';
      proof.action.after = typeof proof.action.after === 'string' ? earlierTitle : { exists: true, value: earlierTitle };
    }

    const tabletTitle = 'Temporary title on the tablet';
    const tablet = (operationId: string, before: DocumentData, after: DocumentData, observedRevision: number) => processCommand('owner', {
      protocol: 1, kind: 'update', owner: 'owner', operationId, resource, generation: 'g', dependsOn: [],
      changes: diffFields(before, after), [action]: { observedRevision, time: null, before: before.title, after: after.title },
    });
    const temporary = { ...opening, title: tabletTitle };
    expect((await tablet('away', opening, temporary, 1)).kind).toBe('acknowledged');
    expect((await tablet('return', temporary, opening, 2)).kind).toBe('acknowledged');

    const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
    const outcome = await save(recovered);
    expect(outcome).toMatchObject({ code: 'resolve-version-first', commands: [] });
    expect((await readDocument('owner', resource)).value?.title).toBe(opening.title);
    expect(recovered.draft?.title).toBe(privateTitle);
    expect(recovered).not.toHaveProperty(key);
    expect(recovered.conflicts).toEqual([expect.objectContaining({ path: ['title'], code: 'unreadable-scalar-proof',
      mine: { exists: true, value: privateTitle }, theirs: { exists: true, value: opening.title } })]);
  },
);

it.each(['matching', 'different'] as const)('retains an equal cached title until the actual saved title is %s', async matching => {
  const resource = { collection: 'groups', id: 'equal-cached-title' };
  const opening = { userId: 'owner', title: 'Earlier title', status: 'draft' };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const matched = { resource, value: { ...opening, title: 'Returned title' }, metadata: { ...metadata, revision: 2 } };
  const phone = new DataSession({ resource, value: opening, metadata });
  phone.edit(matched.value, undefined, { field: 'title', time: { earliestMs: T, latestMs: T + 5 } });
  phone.observe(matched, { source: 'server' });
  const checkpoint = phone.checkpoint();
  expect(checkpoint).toMatchObject({ confirmed: matched, draft: matched.value, dirty: true });
  expect(checkpoint.groupTitleDraft?.action).toMatchObject({ before: opening.title, after: matched.value.title });
  checkpoint.groupTitleDraft!.action.observedRevision = 101;
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  expect(recovered).toMatchObject({ unreadableScalarProof: ['title'], conflicts: [], draft: matched.value });

  const reopened = DataSession.restore(recovered);
  reopened.observe(matched, { source: 'cache' });
  expect(reopened.checkpoint().unreadableScalarProof).toEqual(['title']);
  const fresh = matching === 'matching' ? matched : { ...matched, value: { ...matched.value, title: 'Newly saved on the tablet' },
    metadata: { ...metadata, revision: 3 } };
  reopened.observe(fresh, { source: 'server' });
  if (matching === 'matching') {
    expect(reopened.checkpoint()).toMatchObject({ dirty: false, conflicts: [], draft: matched.value });
    expect(reopened.checkpoint().unreadableScalarProof).toBeUndefined();
  } else {
    expect(reopened.checkpoint()).toMatchObject({ draft: matched.value, remoteCandidate: fresh, conflicts: [{
      path: ['title'], mine: { value: matched.value.title }, theirs: { value: fresh.value.title },
    }] });
  }
});

it('keeps the original opening of healthy note text after choosing the damaged title', async () => {
  const resource = { collection: 'studyNotes', id: 'note-title-beside-proved-body' };
  const opening = { userId: 'owner', title: 'Earlier title', type: 'note', content: 'Original body' };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const phone = new DataSession({ resource, value: opening, metadata });
  const draft = { ...opening, title: 'Private title', content: 'Private body' };
  phone.edit({ ...opening, title: draft.title }, undefined, { field: 'title', time: null });
  phone.edit(draft, undefined, { field: 'content', time: { earliestMs: T, latestMs: T + 3 } });
  const checkpoint = phone.checkpoint();
  const bodyProof = checkpoint.studyNoteContentDraft;
  expect(bodyProof?.action.observedRevision).toBe(1);
  checkpoint.studyNoteTitleDraft!.generation = 'unrelated-generation';
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  const reopened = DataSession.restore(recovered);
  const saved = { resource, value: { ...opening, title: 'Newly saved title' }, metadata: { ...metadata, revision: 3 } };
  reopened.observe(saved, { source: 'server' });
  expect(reopened.checkpoint().conflicts.map(({ path }) => path)).toEqual([['title']]);

  reopened.keepLocal(undefined, { earliestMs: T + 20, latestMs: T + 25 });

  expect(reopened.checkpoint()).toMatchObject({ draft, studyNoteContentDraft: bodyProof });
  expect(reopened.checkpoint().studyNoteContentDraft).toEqual(bodyProof);
});

it('settles a matching saved title and retains the separately authored note body', async () => {
  const resource = { collection: 'studyNotes', id: 'matching-title-beside-proved-body' };
  const opening = { userId: 'owner', title: 'Earlier title', type: 'note', content: 'Original body' };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const phone = new DataSession({ resource, value: opening, metadata });
  const title = 'Shared title';
  phone.edit({ ...opening, title }, undefined, { field: 'title', time: null });
  phone.edit({ ...opening, title, content: 'Separate body text' }, undefined, { field: 'content', time: null });
  const checkpoint = phone.checkpoint();
  const bodyProof = checkpoint.studyNoteContentDraft;
  expect(bodyProof).toBeDefined();
  checkpoint.studyNoteTitleDraft!.action.observedRevision = 101;
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'old-editor', checkpoint, prepared: null, unfinalized: [] })).checkpoint;
  const reopened = DataSession.restore(recovered);
  const saved = { resource, value: { ...opening, title }, metadata: { ...metadata, revision: 3 } };

  reopened.observe(saved, { source: 'server' });

  expect(reopened.checkpoint()).toMatchObject({ confirmed: saved, draft: { title, content: 'Separate body text' },
    dirty: true, conflicts: [], studyNoteContentDraft: bodyProof });
  expect(reopened.checkpoint().unreadableScalarProof).toBeUndefined();
});

it.each(['receipt', 'listener', 'cache', 'cache only field'] as const)(
  'settles a matched damaged title after the preceding body save using %s evidence', evidence => {
  const { metadata, value, resource } = {
    resource: { collection: 'studyNotes', id: 'settled-title-after-pending' },
    value: { userId: 'owner', title: 'Opening title', content: 'Opening body', type: 'note' },
    metadata: { protocol: 1 as const, generation: 'g', revision: 1, deleted: false },
  };
  const phone = new DataSession({ resource, metadata, value });
  const submitted = { ...value, content: 'Queued body' };
  phone.edit(submitted, undefined, { field: 'content', time: null });
  const captured = phone.checkpoint();
  phone.registerCommit('earlier', captured.editGeneration, submitted, undefined,
    uncapturedAutosaveFields(captured, captured.confirmed, undefined, []));
  const cacheOnly = evidence.startsWith('cache');
  const title = 'Matching title';
  const draft = { ...submitted, title, type: evidence === 'cache only field' ? 'note' : 'question' };
  phone.edit({ ...submitted, title }, undefined, { field: 'title', time: null });
  if (draft.type === 'question') phone.edit(draft, undefined, { field: 'type', time: null });
  const checkpoint = phone.checkpoint();
  const typeProof = checkpoint.studyNoteTypeDraft;
  if (draft.type === 'question') expect(typeProof).toBeDefined();
  delete checkpoint.studyNoteTitleDraft;
  checkpoint.unreadableScalarProof = ['title'];
  const restored = DataSession.restore(checkpoint);
  const saved = { resource, value: { ...submitted, title: draft.title }, metadata: { ...metadata, revision: 3 } };
  restored.observe(saved, { source: cacheOnly ? 'cache' : 'server' });
  expect(restored.checkpoint().unreadableScalarProof).toEqual(['title']);
  const receipt = evidence === 'receipt' ? saved : { resource, value: submitted, metadata: { ...metadata, revision: 2 } };

  restored.accept({ kind: 'acknowledged', operationId: 'earlier', snapshot: receipt });

  expect(restored.checkpoint()).toMatchObject({ confirmed: saved, draft, dirty: true, conflicts: [] });
  expect(restored.checkpoint().studyNoteTypeDraft).toEqual(typeProof);
  expect(restored.checkpoint().unreadableScalarProof).toEqual(cacheOnly ? ['title'] : undefined);
});

it.each([
  ['cache', false], ['server', false], ['cache', true], ['server', true],
] as const)('settles a held note title after cancelling an earlier body save using %s evidence (other edit: %s)', async (source, sibling) => {
  const db = installWorldFirestore(() => T + 1000);
  const resource = { collection: 'studyNotes', id: 'title-after-cancelled-save' };
  const value = { userId: 'owner', title: 'Opening title', content: 'Original body', type: 'note' };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const opening = { resource, value, metadata };
  const phone = new DataSession(opening);
  const submitted = { ...value, content: 'Cancelled body edit' };
  phone.edit(submitted, undefined, { field: 'content', time: null });
  const capture = phone.checkpoint();
  const queued: CommitRequest = { id: 'earlier', owner: 'owner', editorId: 'old-editor', editGeneration: capture.editGeneration,
    baseline: opening, working: opening, value: submitted, intended: submitted, predecessor: null,
    revision: 0, initialized: false, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
    ...uncapturedAutosaveFields(capture, opening, undefined, []),
  };
  phone.applyCommit(queued);
  const privateTitle = 'Private title entered after Save';
  const privateDraft = { ...submitted, title: privateTitle };
  phone.edit(privateDraft, undefined, { field: 'title', time: null });
  if (sibling) phone.edit({ ...privateDraft, type: 'question' }, undefined, { field: 'type', time: null });
  const checkpoint = phone.checkpoint();
  checkpoint.studyNoteTitleDraft!.action.observedRevision = 99;
  const old = { owner: 'owner', editorId: queued.editorId, checkpoint, prepared: null, unfinalized: [] };
  const restored = DataSession.restore((await throughDeviceStorage(old, queued)).checkpoint);
  const matching = { ...opening, value: { ...value, title: privateTitle }, metadata: { ...metadata, revision: 2 } };
  restored.observe(matching, { source });
  expect(restored.checkpoint()).toMatchObject({ pending: { earlier: expect.anything() }, unreadableScalarProof: ['title'] });

  restored.applyCommit({ ...queued, state: 'cancelled', cancelledByChoice: true });

  const afterCancel = restored.checkpoint();
  expect(afterCancel).toMatchObject({ pending: {}, dirty: source === 'cache' || sibling, conflicts: [],
    draft: { title: privateTitle, content: value.content } });
  expect(afterCancel.unreadableScalarProof).toEqual(source === 'cache' ? ['title'] : undefined);
  if (sibling) {
    expect(afterCancel.draft?.type).toBe('question');
    expect(afterCancel.studyNoteTypeDraft).toEqual(checkpoint.studyNoteTypeDraft);
  }
  const newer = { ...opening, value: { ...value, title: 'Later title saved on tablet' }, metadata: { ...metadata, revision: 3 } };
  db.documents.set(resource.collection + '/' + resource.id, { ...newer.value, _dataEngine: newer.metadata });
  if (source === 'cache') {
    const reopened = DataSession.restore((await throughDeviceStorage({ ...old, checkpoint: afterCancel })).checkpoint);
    reopened.observe(newer, { source: 'server' });
    expect(reopened.checkpoint()).toMatchObject({ conflicts: [{ path: ['title'], code: 'unreadable-scalar-proof',
      mine: { value: privateTitle }, theirs: { value: newer.value.title },
    }], draft: { title: privateTitle, content: value.content } });
    expect(await save(reopened.checkpoint())).toMatchObject({ code: 'resolve-version-first', commands: [] });
  } else {
    restored.observe(newer, { source: 'server' });
    expect(restored.checkpoint()).toMatchObject({
      draft: { ...newer.value, ...(sibling && { type: 'question' }) }, dirty: sibling, conflicts: [],
    });
  }
});

it.each(['captured only', 'captured with sibling edit', 'later readable', 'later unclocked', 'later unreadable'] as const)(
  'applies an earlier cancellation without cancelling a same-title return (%s)', async version => {
    const resource = { collection: 'studyNotes', id: 'title-return-after-cancel' };
    const value = { userId: 'owner', title: 'Originally saved', content: 'Original body', type: 'note' };
    const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
    const opening = { resource, value, metadata };
    const phone = new DataSession(opening);
    const title = 'Title to keep';
    const kept = version.startsWith('later');
    const sibling = version === 'captured with sibling edit';
    const time = (offset: number) => version === 'later unclocked' ? null : { earliestMs: T + offset, latestMs: T + offset + 1 };
    const submitted = { ...value, title };
    phone.edit(submitted, undefined, { field: 'title', time: time(0) });
    const capture = phone.checkpoint();
    const queued: CommitRequest = { id: 'earlier', owner: 'owner', editorId: 'old-editor', editGeneration: capture.editGeneration,
      baseline: opening, working: opening, value: submitted, intended: submitted, predecessor: null,
      revision: 0, initialized: false, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
      ...uncapturedAutosaveFields(capture, opening, undefined, []),
    };
    if (kept) {
      phone.edit({ ...value, title: 'Intervening edit' }, undefined, { field: 'title', time: time(20) });
    }
    phone.applyCommit(queued);
    if (kept) {
      phone.edit(submitted, undefined, { field: 'title', time: time(40) });
    }
    if (sibling) phone.edit({ ...submitted, type: 'question' }, undefined, { field: 'type', time: null });
    const checkpoint = phone.checkpoint();
    const later = checkpoint.studyNoteTitleDraft;
    if (kept) expect(later?.action.time).toEqual(time(40));
    if (version === 'later unreadable') checkpoint.studyNoteTitleDraft!.action.observedRevision = 99;
    const old = { owner: 'owner', editorId: queued.editorId, checkpoint, prepared: null, unfinalized: [] };
    const restored = DataSession.restore((await throughDeviceStorage(old, queued)).checkpoint);
    const current = { ...opening, metadata: { ...metadata, revision: 2 } };
    restored.observe(current, { source: 'server' });

    restored.applyCommit({ ...queued, state: 'cancelled', cancelledByChoice: true });

    const afterCancel = restored.checkpoint();
    expect(afterCancel).toMatchObject({ confirmed: current, pending: {}, dirty: kept || sibling,
      draft: { title: kept ? title : value.title, type: sibling ? 'question' : value.type } });
    if (sibling) expect(afterCancel.studyNoteTypeDraft).toEqual(checkpoint.studyNoteTypeDraft);
    if (version === 'later unreadable') {
      expect(afterCancel).toMatchObject({ unreadableScalarProof: ['title'], conflicts: [{
        path: ['title'], mine: { value: title }, theirs: { value: value.title }, code: 'unreadable-scalar-proof',
      }] });
    } else {
      expect(afterCancel.conflicts).toEqual([]);
      expect(afterCancel.studyNoteTitleDraft).toEqual(kept ? later : undefined);
    }
  });

it.each(['separate recovery', 'same editor'] as const)('preserves a newer scalar proof when transferring placement work (%s)', async target => {
  const resource = { collection: 'groups', id: 'later-modelled-group' };
  const base = { userId: 'owner', title: 'Opening title', status: 'draft', description: 'Opening description', flow: [], templates: [] };
  const opening = { resource, value: base, metadata: { protocol: 1 as const, generation: 'g', revision: 1, deleted: false } };
  const phone = new DataSession(opening);
  phone.edit({ ...base, description: 'Updated description' }, undefined, { field: 'description', time: null });
  const draft = { ...base, description: 'Updated description', title: 'Later title' };
  phone.edit(draft, undefined, { field: 'title', time: null });
  const source = phone.checkpoint();
  expect(source.groupTitleDraft?.editGeneration).toBeGreaterThan(1);
  const accepted = { ...opening, metadata: { ...opening.metadata, revision: 2 } };
  let projected;
  if (target === 'separate recovery') {
    const retained = retainedAnchoredPlacementDraft('owner', 'phone-editor', 'placement-save', 'during-choice', source, accepted, base, draft);
    projected = (await throughDeviceStorage(retained)).checkpoint;
  } else {
    const editor = new DataSession(accepted);
    expect(editor.retainAnchoredPlacementChoiceEdits(source, base, draft)).toBe(true);
    projected = editor.checkpoint();
  }
  expect(projected.draft).toEqual(draft);
  expect(projected.groupTitleDraft).toEqual(source.groupTitleDraft);
  expect(uncapturedAutosaveFields(projected, accepted, undefined, [])).toMatchObject({
    groupTitleAction: { before: base.title, after: draft.title, observedRevision: 1 },
  });
});

it.each(['view default', 'after captured meeting'] as const)('recovers empty legacy group meeting lists as %s', async kind => {
  const resource = { collection: 'groups', id: 'legacy-meeting-list' };
  const value = { userId: 'owner', title: 'Legacy group', description: 'Opening description', status: 'draft', templates: [], flow: [] };
  const confirmed = { resource, value, metadata: { protocol: 1 as const, generation: 'g', revision: 1, deleted: false } };
  const session = new DataSession(confirmed);
  let request: CommitRequest | undefined;
  if (kind === 'after captured meeting') {
    const submitted = { ...value, meetingDates: [{ id: 'meeting', date: '', createdAt: '2026-11-25' }] };
    session.edit(submitted);
    request = { id: 'first-meeting', owner: 'owner', editorId: 'legacy-group', editGeneration: session.checkpoint().editGeneration,
      baseline: confirmed, working: confirmed, value: submitted, intended: submitted, predecessor: null, revision: 0,
      initialized: false, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
    session.applyCommit(request);
  }
  session.edit({ ...value, description: 'Private description', meetingDates: [] });
  const recovered = (await throughDeviceStorage({ owner: 'owner', editorId: 'legacy-group', checkpoint: session.checkpoint(),
    prepared: null, unfinalized: [] }, request)).checkpoint;
  expect(recovered.draft?.description).toBe('Private description');
  if (kind === 'view default') expect(recovered.draft).not.toHaveProperty('meetingDates');
  else expect(recovered.draft?.meetingDates).toEqual([]);
});
