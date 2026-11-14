/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue, createMemoryCommitStore } from '../commits';
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

async function save(checkpoint: EditorRecord['checkpoint']): Promise<Outcome> {
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
    const request = await queue.save('old-editor', checkpoint);
    await queue.drain(true);
    return { kind: (await queue.list()).find(item => item.id === request?.id)?.result?.kind, commands };
  } catch (error) {
    return { code: (error as { code?: string }).code, commands };
  } finally { runtime.setOwner(null); }
}

/** The draft as the device stores it and an editor restores it: written through the native adapter, read back. */
async function throughDeviceStorage(record: EditorRecord): Promise<EditorRecord> {
  installStorageHarness();
  const store = createIndexedDbCheckpoints();
  await store.put(record);
  return (await store.read('owner', record.editorId))!;
}

const SCALARS = [
  ['groupTitleDraft', 'groupTitleAction', 'groups', 'title', 'Opening', 'Mine', 'Other'],
  ['groupStatusDraft', 'groupStatusAction', 'groups', 'status', 'draft', 'active', 'completed'],
  ['councilTitleDraft', 'councilTitleAction', 'councils', 'title', 'Opening', 'Mine', 'Other'],
  ['councilDateDraft', 'councilDateAction', 'councils', 'date', '2099-04-10', '2099-04-20', '2099-04-30'],
  ['councilLifecycleDraft', 'councilLifecycleAction', 'councils', 'heldAt', null, '2026-11-08T00:00:01.000Z', '2026-11-08T00:00:02.000Z'],
] as const;

describe.each(SCALARS)('a scalar draft keeps its proof across device storage: %s', (key, action, collection, field, before, mine, other) => {
  it.each(['never persisted', 'persisted and reloaded'] as const)('%s', async mode => {
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
    const outcome = await save((mode === 'never persisted' ? record : await throughDeviceStorage(record)).checkpoint);
    expect(outcome.kind).toBe('conflict');
    expect(loose(outcome.commands[0])[action]).toBeDefined();
    expect((await readDocument('owner', resource)).value?.[field] ?? null).toBe(before);
  });
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
  it.each(['never persisted', 'persisted and reloaded'] as const)('%s', async mode => {
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
    const outcome = await save((mode === 'never persisted' ? record : await throughDeviceStorage(record)).checkpoint);
    expect(outcome.kind).toBe('conflict');
    expect(loose(outcome.commands[0])[policy.actions]).toBeDefined();
    expect((await readDocument('owner', resource)).value?.[target.field]).toEqual(stored);
  });
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
  it.each([['keeps the move', false], ['undoes the move', true]] as const)('then private words: the draft %s, the words are sent and kept', async (_label, undo) => {
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
    const reopened = DataSession.restore((await throughDeviceStorage(record)).checkpoint);
    const words = 'Private words after recovery';
    reopened.edit({ ...(undo ? clone(value) : reopened.checkpoint().draft!), title: words } as DocumentData);
    const outcome = await save((await throughDeviceStorage({ ...record, checkpoint: reopened.checkpoint() })).checkpoint);

    const moved = { rank: 'rank', step: 'steps', outline: 'outline' }[family];
    expect(outcome.kind).toBe('acknowledged');
    expect(outcome.commands.map(command => (command.changes as Array<{ path: string[] }>).map(change => change.path)))
      .toEqual([undo ? [['title']] : [['title'], [moved]]]);
    const server = (await readDocument('owner', resource)).value!;
    expect(server.title).toBe(words);
    const order = family === 'rank' ? server.rank : (family === 'step' ? server.steps as Loose[] : (server.outline as { main: Loose[] }).main).map(point => point.id);
    expect(order).toEqual(family === 'rank' ? (undo ? 1 : 4) : (undo ? ['a', 'b'] : ['b', 'a']));
  });
});
