/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';
import { takeDroppedProof } from '@test-utils/droppedEvidence';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue, createMemoryCommitStore, type CommitRequest } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { COUNCIL_OUTCOME_POLICY } from '../councilOutcomeAction';
import { COUNCIL_TOPIC_TITLE_POLICY } from '../councilTopicTitleAction';
import { GROUP_BLOCK_STATUS_POLICY } from '../groupBlockStatusAction';
import { GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_TITLE_POLICY } from '../groupFlowTitleAction';
import { GROUP_STEP_DURATION_POLICY } from '../groupStepDurationAction';
import { diffFields } from '../protocol';
import { DataEngineRuntime } from '../runtime';
import { processCommand, readDocument } from '../server';
import { DataSession } from '../session';
import { THOUGHT_LOCK_POLICY } from '../thoughtLockAction';
import { THOUGHT_PLACEMENT_POLICY } from '../thoughtPlacementAction';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
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
    return { kind: (await queue.list()).find(item => item.id === request?.id)?.result?.kind, commands };
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
    const sentPlacement = !undo && !reload;
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
    if (family === 'rank' && !undo && !reload) expect(order).toBeGreaterThan(3);
    else expect(order).toEqual(family === 'rank' ? (undo ? 1 : 4) : (undo ? ['a', 'b'] : ['b', 'a']));
  });
});
