/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';
import { outlinePointOrder, projectOutlinePoint } from '@/utils/outlineDnd';
import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue, createMemoryCommitStore } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngineRuntime } from '../runtime';
import { processCommand, readDocument } from '../server';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { SessionCheckpoint } from '../session';
import type { SermonOutline } from '@/models/models';
import type { DataCommand, DocumentData, EditorCommitAction, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));
jest.mock('firebase-admin/firestore', () => ({ ...jest.requireActual('firebase-admin/firestore'), Filter: {
  where: (field: string, operator: string, value: unknown) => ({ kind: 'field', field, operator, value }),
  or: (...filters: unknown[]) => ({ kind: 'or', filters }),
} }));

type CommitSaveOptions = NonNullable<Parameters<CommitQueue['save']>[2]>;

const T = 1_800_000_000_000;
const clone = <V,>(value: V): V => JSON.parse(JSON.stringify(value)) as V;
type Family = 'rank' | 'step' | 'outline';
type Row = { id: string; text: string; title: string; type: string; subPoints: [] };
const points: Row[] = ['a', 'b', 'c'].map(id => ({ id, text: id, title: id, type: 'custom', subPoints: [] }));
const words = 'Words typed after the move';
let sequence = 0;

function fixture(family: Family | 'preference', nativeCapture = false) {
  const db = installWorldFirestore(() => T + 1000);
  // Count the fake's exact transaction SDK calls, alongside its native activity counter.
  const cost = { reads: 0, writes: 0 };
  const transact = (adminDb.runTransaction as jest.Mock).getMockImplementation()!;
  (adminDb.runTransaction as jest.Mock).mockImplementation(callback => transact((tx: {
    get: (...args: unknown[]) => unknown; set: (...args: unknown[]) => unknown;
  }) => callback({ ...tx,
    get: (...args: unknown[]) => { cost.reads++; return tx.get(...args); },
    set: (...args: unknown[]) => { cost.writes++; return tx.set(...args); },
  })));
  const value: DocumentData = family === 'preference' ? { language: 'en', firstDayOfWeek: 'sunday', createdAt: 'now', updatedAt: 'now' }
    : { userId: 'owner', title: 'Opening', createdAt: 'now', updatedAt: 'now', date: '2026-11-12', rank: 1,
      steps: clone(points), thoughts: [], verse: 'John 1:1', outline: { introduction: [], main: clone(points), conclusion: [] } };
  const resource = { collection: family === 'preference' ? 'users' : family === 'outline' ? 'sermons' : 'serviceOrders', id: family === 'preference' ? 'owner' : 'doc' };
  const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  db.documents.set(resource.collection + '/' + resource.id, { ...clone(value), _dataEngine: clone(snapshot.metadata) });
  db.documents.set('serviceOrders/neighbor', { userId: 'owner', title: 'Neighbor', rank: 3, _dataEngine: clone(snapshot.metadata) });
  const session = new DataSession(snapshot);
  const rankMove = { generation: 'g', before: { exists: true as const, value: 1 }, rank: 4, placement: {
    opening: { previous: null, next: { id: 'neighbor', generation: 'g' } }, destination: { previous: { id: 'neighbor', generation: 'g' }, next: null },
    observedRevision: 1, time: null } };
  const stepMove = { generation: 'g', shownIds: ['a', 'b', 'c'], placement: { stepId: 'a',
    opening: { previous: null, next: 'b' }, destination: { previous: 'b', next: 'c' }, observedRevision: 1, time: null } };
  const outlineMove = { generation: 'g', before: { introduction: [], main: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], conclusion: [] },
    after: { introduction: [], main: [{ id: 'b' }, { id: 'a' }, { id: 'c' }], conclusion: [] }, placement: { pointId: 'a',
      opening: { section: 'main' as const, previous: null, next: 'b' }, destination: { section: 'main' as const, previous: 'b', next: 'c' }, observedRevision: 1, time: null } };
  const moved = [points[1], points[0], points[2]];
  const movedDraft = { ...value, ...(family === 'rank' ? { rank: 4 } : family === 'step' ? { steps: moved }
    : { outline: { introduction: [], main: moved, conclusion: [] } }) };
  const stage = () => {
    if (family === 'rank') session.stageServiceOrderPlacementRetry(rankMove);
    if (family === 'step') session.stageServiceOrderStepPlacementRetry(stepMove, moved);
    if (family === 'outline') session.stageOutlinePointPlacementRetry(outlineMove, { ...session.checkpoint().draft!, outline: { introduction: [], main: moved, conclusion: [] } });
  };
  const retry = () => {
    const state = session.checkpoint();
    return state.serviceOrderPlacementRetry ?? state.serviceOrderStepPlacementRetry ?? state.outlinePointPlacementRetry;
  };
  const action: EditorCommitAction = family === 'rank' ? { kind: 'service-order-placement', move: rankMove }
    : family === 'step' ? { kind: 'service-order-step-placement', move: stepMove } : { kind: 'outline-point-placement', move: outlineMove };
  const commands: DataCommand[] = [];
  let beforeSend: (() => void) | undefined;
  const transport = { read: async (_owner: string, ref: ResourceRef) => readDocument('owner', ref),
    send: async (command: DataCommand) => { beforeSend?.(); commands.push(clone(command)); return processCommand('owner', command); } };
  const entries = new Map<string, JournalEntry>();
  const runtime = new DataEngineRuntime({ transport, journal: { list: async () => clone([...entries.values()]),
    put: async row => { entries.set(row.command.operationId, clone(row)); }, remove: async (_owner, id) => { entries.delete(id); } } });
  runtime.setOwner('owner');
  if (nativeCapture) installStorageHarness();
  const store = nativeCapture ? createIndexedDbCommitStore() : createMemoryCommitStore();
  let closing: EditorRecord | undefined;
  const queue = new CommitQueue({ store, runtime, operationId: () => 'retry-words-' + ++sequence, readConfirmed: ref => readDocument('owner', ref) });
  queue.setOwner('owner');
  const detach = queue.subscribe(({ request }) => { session.applyCommit(request); });
  const save = async (options?: CommitSaveOptions) => {
    const request = await queue.save('editor', session.checkpoint(), options);
    if (request) session.registerCommit(request.id, request.editGeneration, request.value, request.command?.operationId, request);
    return request;
  };
  const saveClosing = () => save({ deferRetention: true, checkpoint: saved => {
    session.registerCommit(saved.id, saved.editGeneration, saved.value, saved.command?.operationId, saved);
    closing = { owner: 'owner', editorId: 'editor', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
    return closing;
  } });
  const drain = async () => { await queue.drain(true); await queue.drain(true); };
  const server = async () => (await readDocument('owner', resource)).value;
  return { db, cost, session, value, snapshot, movedDraft, stage, retry, action, commands, save, saveClosing, drain, server, queue,
    closing: () => closing, detach, onSend: (fn: () => void) => { beforeSend = fn; }, stop: () => runtime.setOwner(null) };
}
type Harness = ReturnType<typeof fixture>;
const wire = (h: Harness) => h.commands.map(command => command.kind === 'update' ? command.changes.map(change => change.path.join('.')) : [command.kind]);
const order = (family: Family, value: DocumentData | null) => family === 'rank' ? value?.rank : family === 'step'
  ? (value?.steps as Row[] | undefined)?.map(row => row.id) : value?.outline && outlinePointOrder(value.outline as unknown as SermonOutline);
const editWords = (h: Harness) => h.session.edit({ ...h.session.checkpoint().draft!, title: words });
const costOf = (h: Harness) => ({ transactions: h.db.activity, ...h.cost });

// Each family exercises both histories, including the already-correct rank follow-up.
it.each(['rank', 'step', 'outline'] as const)('%s retry sends words and forgets an undone move (six histories)', async family => {
  const failures: string[] = [];
  for (const undo of [false, true]) {
    const h = fixture(family);
    try {
      h.stage();
      if (undo) h.session.edit(clone(h.value));
      editWords(h);
      const retained = Boolean(h.retry());
      let secondSend: SessionCheckpoint | undefined;
      h.onSend(() => { if (h.commands.length === 1) secondSend = h.session.checkpoint(); });
      await h.save(); await h.drain();
      process.stdout.write('HISTORY ' + JSON.stringify({ family, undo, wire: wire(h), cost: costOf(h) }) + '\n');
      expect(retained).toBe(!undo);
      expect(wire(h)).toEqual(undo ? [['title']] : [[{ rank: 'rank', step: 'steps', outline: 'outline' }[family]], ['title']]);
      expect((await h.server())?.title).toBe(words);
      expect(h.session.checkpoint()).toMatchObject({ draft: { title: words }, dirty: false, conflicts: [] });
      expect(order(family, await h.server())).toEqual(undo ? order(family, h.value) : family === 'rank' ? 1003 : order(family, h.movedDraft));
      if (!undo) expect(secondSend).toMatchObject({ dirty: true, draft: { title: words } });
    } catch (error) { failures.push(`${family}${undo ? '-undo' : ''}: ${String(error)}`); }
    finally { h.stop(); }
  }
  expect(failures).toEqual([]);
});

it('ordinary step and outline moves carry sibling differences; a preference switched back sends nothing', async () => {
  for (const family of ['step', 'outline'] as const) {
    const h = fixture(family);
    try {
      h.session.edit({ ...h.movedDraft, title: words, updatedAt: 'changed by the screen' });
      await h.save({ action: h.action }); await h.drain();
      expect(wire(h)).toEqual([[family === 'step' ? 'steps' : 'outline'], ['title']]);
      expect(await h.server()).toMatchObject({ title: words });
      // Accepted recency is server metadata; mergeDocumentFields deliberately takes it from the ACK.
      expect(h.session.checkpoint()).toMatchObject({ dirty: false, draft: { title: words } });
    } finally { h.stop(); }
  }
  const h = fixture('preference');
  try {
    h.session.edit({ ...h.value, language: 'ru' }); h.session.stageAccountPreferenceRetry('language', { earliestMs: T, latestMs: T + 2 });
    h.session.edit(h.value);
    expect(await h.save()).toBeNull(); await h.drain();
    expect(wire(h)).toEqual([]);
    // Keeping that record changes only the action type: a later sibling edit still sends its current value.
    h.session.edit({ ...h.value, firstDayOfWeek: 'monday' });
    await h.save(); await h.drain();
    expect(wire(h)).toEqual([['firstDayOfWeek']]);
    expect(await h.server()).toMatchObject({ language: 'en', firstDayOfWeek: 'monday' });
    expect(h.session.checkpoint()).toMatchObject({ dirty: false, draft: { language: 'en', firstDayOfWeek: 'monday' } });
  } finally { h.stop(); }
});

type Edit = 'words' | 'back' | 'third' | 'remove' | 'add';
const edits: Edit[] = ['words', 'back', 'third', 'remove', 'add'];
function followUp(h: Harness, family: Family, edit: Edit) {
  const draft = clone(h.session.checkpoint().draft ?? h.value);
  if (edit === 'words') { h.session.edit({ ...draft, title: words }); return; }
  if (family === 'rank') {
    h.session.edit(edit === 'remove' ? null : edit === 'add' ? { ...draft, steps: [...points, { ...points[0], id: 'd' }] }
      : { ...draft, rank: edit === 'back' ? 1 : 7 });
    return;
  }
  const rows = family === 'step' ? draft.steps as Row[] : (draft.outline as { main: Row[] }).main;
  const byId = new Map(rows.map(row => [row.id, row]));
  const next = edit === 'back' ? points.map(row => byId.get(row.id) ?? row)
    : edit === 'third' ? ['b', 'c', 'a'].map(id => byId.get(id) ?? points.find(row => row.id === id)!)
      : edit === 'remove' ? rows.filter(row => row.id !== 'a') : [...rows, { ...points[0], id: 'd' }];
  h.session.edit({ ...draft, ...(family === 'step' ? { steps: next } : { outline: { ...draft.outline as object, main: next } }) });
}

it.each(['rank', 'step', 'outline'] as const)('%s never resurrects a retry after a third position, even if its target returns', async family => {
  const h = fixture(family);
  try {
    h.stage(); followUp(h, family, 'third');
    expect(h.retry()).toBeUndefined();
    // Revisiting the old target must not reactivate the discarded proof, even through a clean Save.
    h.session.edit(clone(h.value)); expect(await h.save()).toBeNull();
    h.session.edit({ ...h.movedDraft, title: words });
    expect(h.retry()).toBeUndefined();
    await h.save(); await h.drain();
    expect(h.commands.every(command => command.kind !== 'update' || !('serviceOrderPlacement' in command)
      && !('serviceOrderStepPlacement' in command) && !('outlinePointPlacement' in command))).toBe(true);
    expect(wire(h)).toEqual([['title', { rank: 'rank', step: 'steps', outline: 'outline' }[family]]]);
    expect(await h.server()).toMatchObject({ title: words });
  } finally { h.stop(); }
});

it.each(['remove', 'add'] as const)('%s of a step drops the retry and ordinary Save delivers or asks', async edit => {
  const h = fixture('step');
  try {
    h.stage(); followUp(h, 'step', edit); editWords(h);
    expect(h.retry()).toBeUndefined();
    const intended = h.session.checkpoint().draft;
    await h.save(); await h.drain();
    expect(wire(h)).toEqual([['title', 'steps']]);
    expect(h.commands[0]).not.toHaveProperty('serviceOrderStepPlacement');
    const requests = await h.queue.list();
    if (requests.every(request => request.state === 'acknowledged')) {
      expect(await h.server()).toMatchObject({ title: words, steps: intended?.steps });
      expect(h.session.checkpoint()).toMatchObject({ dirty: false, draft: { title: words } });
    } else expect(requests.some(request => request.state === 'conflict' || request.state === 'refused')).toBe(true);
  } finally { h.stop(); }
});

it.each(['rank', 'step', 'outline'] as const)('%s words and undo after retry survive the closing Save with its exact checkpoint', async family => {
  const failures: string[] = [];
  for (const undo of [false, true]) {
    const h = fixture(family, true);
    try {
      h.stage();
      if (undo) h.session.edit(clone(h.value));
      editWords(h);
      const request = await h.saveClosing();
      expect(h.closing()?.checkpoint.pending[request!.id].value?.title).toBe(words);
      expect(h.closing()?.checkpoint.editGeneration).toBe(request?.editGeneration);
      const stored = await createIndexedDbCheckpoints().read('owner', 'editor');
      expect(stored?.checkpoint).toMatchObject({ draft: h.closing()?.checkpoint.draft,
        pending: h.closing()?.checkpoint.pending, editGeneration: request!.editGeneration });
      h.detach(); await h.drain();
      // The durable queue completes without the editor; replay its answer on the closing capture.
      const closed = DataSession.restore(stored!.checkpoint);
      for (const saved of await h.queue.list()) closed.applyCommit(saved);
      expect(wire(h)).toEqual(undo ? [['title']] : [[{ rank: 'rank', step: 'steps', outline: 'outline' }[family]], ['title']]);
      expect(await h.server()).toMatchObject({ title: words });
      expect(closed.checkpoint()).toMatchObject({ dirty: false, draft: { title: words }, pending: {}, conflicts: [] });
    } catch (error) { failures.push(`${family}${undo ? '-undo' : ''}: ${String(error)}`); }
    finally { h.stop(); }
  }
  expect(failures).toEqual([]);
});

const sequences: Edit[][] = [...edits.map(edit => [edit]), ...edits.flatMap(first => edits.map(second => [first, second]))];
function assertWireIntent(h: Harness, family: Family, intended: DocumentData | null) {
  for (const command of h.commands) {
    if (command.kind !== 'update') continue;
    if (command.serviceOrderPlacement) expect(intended?.rank).toBe(4);
    if (command.serviceOrderStepPlacement) {
      const target = projectServiceOrderStep(points, 'a', command.serviceOrderStepPlacement.destination)!;
      expect(order('step', intended)).toEqual(target.map(row => row.id));
    }
    if (command.outlinePointPlacement) {
      const target = projectOutlinePoint(h.value.outline as unknown as SermonOutline, 'a', command.outlinePointPlacement.destination)!;
      expect(order('outline', intended)).toEqual(outlinePointOrder(target));
    }
  }
}

it.each(['rank', 'step', 'outline'] as const)('%s sequence invariant: 30 one- and two-edit histories after keep mine', async family => {
  const failures: { sequence: Edit[]; reason: string }[] = [];
  for (const sequence of sequences) {
    const h = fixture(family);
    try {
      h.stage(); sequence.forEach(edit => followUp(h, family, edit));
      const intended = h.session.checkpoint().draft;
      await h.save(); await h.drain();
      const state = h.session.checkpoint(), server = await h.server();
      const refused = (await h.queue.list()).some(request => request.state === 'refused');
      if (!refused && !state.dirty && !state.conflicts.length) {
        const touched = family === 'outline' ? ['title', 'outline'] : ['title', 'steps', ...(family === 'rank' ? ['rank'] : [])];
        for (const field of touched) {
          expect(state.draft?.[field]).toEqual(server?.[field]);
          // The rank placement computes its numeric rank on the server, between the named neighbours.
          if (field !== 'rank' || intended?.rank !== 4) expect(state.draft?.[field]).toEqual(intended?.[field]);
        }
      }
      assertWireIntent(h, family, intended);
    } catch (error) { failures.push({ sequence, reason: String(error) }); }
    finally { h.stop(); }
  }
  process.stdout.write('SEQUENCES ' + JSON.stringify({ family, ran: sequences.length, red: failures.length, sequences: failures.map(failure => failure.sequence) }) + '\n');
  expect(failures).toEqual([]);
});


// The predecessor's ACK can include a deletion independently accepted from another device.
async function missingWorkingHistory(family: 'step' | 'outline', missing: 'b' | 'a', withWords: boolean) {
  const iso = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-11-12T00:00:00.000Z');
  const h = fixture(family);
  try {
    h.session.edit({ ...h.value, title: 'Predecessor title' });
    const predecessor = await h.save();
    h.stage();
    if (withWords) editWords(h);
    const request = await h.save();
    expect(request?.predecessor).toBe(predecessor?.id);
    h.onSend(() => {
      if (h.commands.length) return;
      const raw = h.db.documents.get(h.snapshot.resource.collection + '/doc')!;
      const rows = points.filter(row => row.id !== missing);
      h.db.documents.set(h.snapshot.resource.collection + '/doc', { ...raw,
        ...(family === 'step' ? { steps: rows } : { outline: { introduction: [], main: rows, conclusion: [] } }) });
    });
    await h.drain();
    const saved = (await h.queue.list()).find(saved => saved.id === request!.id)!;
    expect(h.commands).toHaveLength(2);
    expect(h.commands[1]).toHaveProperty(family === 'step' ? 'serviceOrderStepPlacement' : 'outlinePointPlacement',
      family === 'step' ? request!.serviceOrderStepPlacement!.placement : request!.outlinePointPlacement!.placement);
    expect(saved.state).toBe('conflict');
    expect(saved.result?.kind).toBe('conflict');
    expect(saved.submitted?.title).toBe('Predecessor title');
    expect((await h.server())?.title).toBe('Predecessor title');
    // IDs are generated locally; normalize them so the exact same history can be compared on main.
    const normalized = JSON.parse(JSON.stringify({ wire: h.commands, answer: saved.result, server: await h.server(), session: h.session.checkpoint() })
      .replace(/retry-words-\d+/g, id => id === predecessor!.id ? 'predecessor' : 'placement'));
    process.stdout.write('MISSING ' + JSON.stringify({ family, missing, withWords, outcome: normalized }) + '\n');
    return normalized;
  } finally { h.stop(); iso.mockRestore(); }
}

it.each(['step', 'outline'] as const)('%s sends a captured move after its predecessor ACK loses a destination neighbour', async family => {
  await missingWorkingHistory(family, 'b', true);
});
it.each(['step', 'outline'] as const)('%s sends a captured move after its predecessor ACK loses the moved element', async family => {
  await missingWorkingHistory(family, 'a', true);
});
it.each(['step', 'outline'] as const)('%s missing working rows without words matches the original history', async family => {
  await missingWorkingHistory(family, 'b', false);
  await missingWorkingHistory(family, 'a', false);
});

type Door = 'restore' | 'acknowledge' | 'rollback' | 'observe' | 'keepLocal' | 'acceptRemote' | 'acceptRemoteAtChoice' | 'dropRefused' | 'settleDecided';
const doors: Door[] = ['restore', 'acknowledge', 'rollback', 'observe', 'keepLocal', 'acceptRemote', 'acceptRemoteAtChoice', 'dropRefused', 'settleDecided'];
const retryOf = (state: SessionCheckpoint) => state.serviceOrderPlacementRetry ?? state.serviceOrderStepPlacementRetry ?? state.outlinePointPlacementRetry;

it.each((['rank', 'step', 'outline'] as const).flatMap(family => doors.map(door => ({ family, door,
  evidence: ['restore', 'acknowledge', 'rollback'].includes(door) ? 'regression proof' : 'existing behaviour control' }))))(
  '$evidence: $family retires a placement retry when $door replaces its exact target', async ({ family, door }) => {
    const h = fixture(family);
    try {
      h.stage();
      const staged = h.session.checkpoint();
      const changed = { ...h.snapshot, metadata: { ...h.snapshot.metadata!, revision: 2 } };
      let session = h.session;
      if (door === 'restore') session = DataSession.restore({ ...staged, draft: clone(h.value) });
      else if (door === 'acknowledge') {
        // An earlier Save captured this order; its answer need not have the same order.
        session.registerCommit('earlier', 0, staged.draft);
        session.accept({ kind: 'acknowledged', operationId: 'earlier', snapshot: changed });
      } else if (door === 'rollback') {
        // Cancel a saved action whose target the retry currently shares.
        const action = await h.save();
        h.stage();
        session.applyCommit({ ...action!, state: 'cancelled', cancelledByAction: true });
      } else if (door === 'observe') {
        // A move can settle to a clean draft without consuming an independently staged retry.
        session.registerCommit('earlier', 0, staged.draft);
        session.accept({ kind: 'acknowledged', operationId: 'earlier', snapshot: { ...changed, value: staged.draft } });
        session.observe({ ...changed, metadata: { ...changed.metadata!, revision: 3 } }, { source: 'server' });
      } else {
        session.observe(changed, { source: 'server' });
        if (door === 'keepLocal') session.keepLocal();
        if (door === 'acceptRemote') session.acceptRemote();
        if (door === 'acceptRemoteAtChoice') session.acceptRemote(staged.draft);
        if (door === 'dropRefused') session.dropRefused(staged.draft);
        if (door === 'settleDecided') {
          const saved = await h.save();
          h.stage();
          session.applyCommit({ ...saved!, state: 'cancelled', cancelledByChoice: true });
        }
      }
      const final = session.checkpoint();
      // Keep Local may retain the order; its explicit choice still retires the old proof.
      if (door !== 'keepLocal') expect(order(family, final.draft)).toEqual(order(family, h.value));
      expect(retryOf(final)).toBeUndefined();
    } finally { h.stop(); }
  });

it.each(['rank', 'step', 'outline'] as const)('%s retains its retry through restoration and an ACK that changes only sibling words', family => {
  const h = fixture(family);
  try {
    h.stage();
    const session = DataSession.restore(h.session.checkpoint());
    session.registerCommit('earlier', 0, h.value);
    session.accept({ kind: 'acknowledged', operationId: 'earlier', snapshot: { ...h.snapshot,
      metadata: { ...h.snapshot.metadata!, revision: 2 }, value: { ...h.value, title: 'Remote title' } } });
    expect(retryOf(session.checkpoint())).toEqual(h.retry());
    expect(session.checkpoint().draft?.title).toBe('Remote title');
  } finally { h.stop(); }
});


it.each(['step', 'outline'] as const)('%s acknowledges a captured move but loses sibling words and leaves a dirty draft when a missing neighbour returns', async family => {
  // Known loss and dirty remainder: BUG-20261113-placement-after-predecessor-drops-sibling-words.
  const h = fixture(family);
  try {
    h.session.edit({ ...h.value, title: 'Predecessor title' });
    await h.save();
    h.stage(); editWords(h);
    const action = clone(h.action);
    if (action.kind === 'service-order-step-placement' || action.kind === 'outline-point-placement') action.move.placement.observedRevision = 2;
    const request = await h.save({ action });
    h.onSend(() => {
      const raw = h.db.documents.get(h.snapshot.resource.collection + '/doc')!;
      const rows = h.commands.length === 0 ? points.filter(row => row.id !== 'b') : points;
      h.db.documents.set(h.snapshot.resource.collection + '/doc', { ...raw,
        ...(family === 'step' ? { steps: rows } : { outline: { introduction: [], main: rows, conclusion: [] } }) });
    });
    await h.drain();
    expect(wire(h)).toEqual([['title'], [family === 'step' ? 'steps' : 'outline']]);
    expect(h.commands[1]).toHaveProperty(family === 'step' ? 'serviceOrderStepPlacement' : 'outlinePointPlacement', action.move.placement);
    const requests = await h.queue.list();
    expect(requests.map(request => request.state)).toEqual(['acknowledged', 'acknowledged']);
    expect(requests.find(saved => saved.id === request!.id)?.result?.kind).toBe('acknowledged');
    expect(h.session.checkpoint()).toMatchObject({ pending: {}, conflicts: [] });
    process.stdout.write('DELIVERY ' + JSON.stringify({ family, wire: wire(h), server: await h.server(), session: h.session.checkpoint() }) + '\n');
  } finally { h.stop(); }
});
