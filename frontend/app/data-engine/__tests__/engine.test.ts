import { patchPreachDate, preparePreachDate, PREACH_DATE_SELECTION } from '@/components/calendar/preachDateForm';
import { sermonMetadataPatch, SERMON_METADATA_SELECTION } from '@/components/sermon/sermonMetadataForm';
import { movePoint, outlinePointGap, outlinePointOrder, projectOutlinePoint } from '@/utils/outlineDnd';
import { scratchNoteAt } from '@/utils/scratchPlacement';
import { addSermonThought, deleteSermonThought, patchSermonThought } from '@/utils/sermonThoughtEdits';

import { DataEngine, canReplaceSnapshot, type SnapshotStore } from '../engine';
import { createMemoryCommitStore } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { installStorageHarness } from './storageHarness';
import { editorIdentity } from '../editorIdentity';
import { AddressedFailures, PausedReadFailure } from '../failures';
import { readField } from '../fieldValues';
import { ResourceObserver, type SnapshotEvent } from '../observer';
import { readOutlinePointPlacementComparison } from '../outlinePointPlacement';
import { applyCommand } from '../protocol';
import { commitRowKey } from '../retention.client';
import { DataEngineRuntime } from '../runtime';
import { readThoughtPlacementComparison } from '../rowConflictDetails';
import { orderRowDetails } from '../rowDetailOrder.server';
import { alignThoughtLockRepresentation, THOUGHT_LOCK_POLICY } from '../thoughtLockAction';
import { readSermonPlanModeComparison, readSermonPreparationConfirmation } from '../sermonFieldChoice';
import { sermonThoughtPlacementDraft } from '../sermonThoughtPlacementRecovery';
import { DataSession } from '../session';
import { planDataCommand } from '../serverRelations';
import { describeManualSync, describeSync } from '../status';
import { redeliveryDelay } from '../unanswered';

import type { ManualScopeStore, ManualStorageRecord } from '../manualScopes.client';
import type { CheckpointStore, EditorRecord } from '../controller';
import type { PreachDate, Sermon, SermonOutline } from '@/models/models';
import type { DocumentData, EngineTransport, JournalEntry, JournalStore, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const resource = { collection: 'studyNotes', id: 'note' };
const initial = (revision = 1, content = 'base'): ResourceSnapshot => ({
  resource, value: { userId: 'owner', title: 'Title', content, tags: [], scriptureRefs: [], isDraft: false, createdAt: '2026-09-12', updatedAt: '2026-09-12' },
  metadata: { protocol: 1, generation: 'generation', revision, deleted: false },
});
const absent = (ref = resource): ResourceSnapshot => ({ resource: ref, value: null, metadata: null });
const keyOf = (owner: string, ref: ResourceRef) => JSON.stringify([owner, ref.collection, ref.id]);
const drainMicrotasks = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};

function setup({ cached = true, online = true, nativeChoice = false } = {}) {
  const storage = nativeChoice ? installStorageHarness() : undefined;
  let sequence = 0;
  const records = new Map<string, EditorRecord>();
  const entries = new Map<string, JournalEntry>();
  const cache = new Map<string, ResourceSnapshot>();
  const server = new Map<string, ResourceSnapshot>([[keyOf('owner', resource), initial()]]);
  if (cached) cache.set(keyOf('owner', resource), initial());
  const checkpoints: CheckpointStore = nativeChoice ? createIndexedDbCheckpoints() : {
    read: jest.fn(async (owner, id) => {
      const value = records.get(JSON.stringify([owner, id])); return value && copy(value);
    }),
    put: jest.fn(async record => { records.set(JSON.stringify([record.owner, record.editorId]), copy(record)); }),
  };
  const snapshots: SnapshotStore = {
    read: jest.fn(async (owner, ref) => { const value = cache.get(keyOf(owner, ref)); return value && copy(value); }),
    put: jest.fn(async (owner, value) => { cache.set(keyOf(owner, value.resource), copy(value)); }),
  };
  const journal: JournalStore = {
    list: jest.fn(async owner => copy([...entries.values()].filter(entry => entry.command.owner === owner))),
    put: jest.fn(async entry => { entries.set(JSON.stringify([entry.command.owner, entry.command.operationId]), copy(entry)); }),
    remove: jest.fn(async (owner, id) => { entries.delete(JSON.stringify([owner, id])); }),
  };
  const transport: EngineTransport = {
    read: jest.fn(async (owner, ref) => copy(server.get(keyOf(owner, ref)) ?? absent(ref))),
    send: jest.fn(async command => {
      const result = applyCommand(command, server.get(keyOf(command.owner, command.resource)) ?? absent(command.resource));
      if (result.kind === 'acknowledged') server.set(keyOf(command.owner, command.resource), copy(result.snapshot));
      return result;
    }),
  };
  const callbacks: { next: (event: SnapshotEvent) => void; stop: jest.Mock }[] = [];
  const source = { listen: jest.fn((_owner, _resource, next) => {
    const stop = jest.fn(); callbacks.push({ next, stop }); return stop;
  }) };
  const runtime = new DataEngineRuntime({ journal, transport });
  const observer = new ResourceObserver({ source, transport });
  const onError = jest.fn();
  const commits = nativeChoice ? createIndexedDbCommitStore() : createMemoryCommitStore();
  const manualRows = new Map<string, ManualStorageRecord>();
  const manualScopes: ManualScopeStore = {
    read: jest.fn(async (owner, id) => { const row = manualRows.get(JSON.stringify([owner, id])); return row && copy(row); }),
    list: jest.fn(async (owner, ref) => copy([...manualRows.values()].filter((row): row is import('../manualScopes.client').StoredManualScope => row.owner === owner && Boolean(row.record) && (!ref || row.record!.resource.collection === ref.collection && row.record!.resource.id === ref.id)))),
    create: jest.fn(async row => { const key = JSON.stringify([row.owner, row.scopeId]); if (manualRows.has(key)) throw new Error('occupied'); manualRows.set(key, copy(row)); }),
    put: jest.fn(async row => { manualRows.set(JSON.stringify([row.owner, row.scopeId]), copy(row)); }),
    compact: jest.fn(async () => undefined),
  };
  const engine = new DataEngine({ runtime, observer, transport, checkpoints, snapshots, commits, manualScopes, operationId: () => `operation-${++sequence}`, onError });
  engine.setOnline(online); engine.setOwner('owner');
  const next = (snapshot: ResourceSnapshot, source: 'server' | 'cache' = 'server') => callbacks[callbacks.length - 1].next({ snapshot, source });
  return { engine, observer, runtime, transport, journal, entries, checkpoints, records, snapshots, cache, server, source, callbacks, next, onError, commits, manualScopes, manualRows, storage };
}

describe('DataEngine composition', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it.each(['title', 'type', 'unchanged title'] as const)('keeps the original reference time alongside %s', async field => {
    const s = setup({ nativeChoice: true });
    const reference = { id: 'john', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const seen = { generation: 'generation', revision: 2 };
    const opening = { ...initial(seen.revision), value: { ...initial().value, type: 'note', scriptureRefs: [reference] } };
    s.cache.set(keyOf('owner', resource), opening);
    s.server.set(keyOf('owner', resource), opening);
    const editor = await s.engine.openEditor(resource, 'timed-reference-and-note-field');
    try {
      const time = { earliestMs: 1_800_000_000_110, latestMs: 1_800_000_000_120 };
      const referenceEvidence = { times: { john: time } };
      await editor.commit(current => ({ ...current, scriptureRefs: [],
        ...(field === 'title' && { title: 'Later title' }), ...(field === 'type' && { type: 'question' }),
      }), field === 'type'
        ? { kind: 'study-note-type', type: { seen: { ...seen, type: 'note' }, time }, referenceEvidence }
        : { kind: 'study-note-title', title: { seen: { ...seen, title: 'Title' }, time }, referenceEvidence });
      await drainMicrotasks();
      expect(s.transport.send).toHaveBeenCalledWith(expect.objectContaining({ studyNoteReferenceTimes: { john: time } }));
    } finally {
      editor.close();
      s.engine.setOwner(null);
    }
  });

  it.each(['open', 'close', 'retry'])('durably queues unsaved point words before two rapid exact outline moves (%s)', async mode => {
    const s = setup({ online: false, nativeChoice: true });
    try {
      const resource = { collection: 'sermons', id: 'qa-outline-rapid-moves' };
      const point = { id: 'point', text: 'Opening words' };
      const outline: SermonOutline = { introduction: [], main: [point], conclusion: [] };
      const baseline: ResourceSnapshot = {
        resource, value: { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-09',
          thoughts: [], outline: outline as unknown as DocumentData },
        metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
      };
      s.server.set(keyOf('owner', resource), baseline);
      s.cache.set(keyOf('owner', resource), baseline);
      const editor = await s.engine.openEditor(resource, 'outline-writer');
      const written = { ...outline, main: [{ ...point, text: 'Words written just before the drag' }] };
      const first = movePoint(written, point.id, 'introduction', 0);
      const second = movePoint(first, point.id, 'conclusion', 0);
      await editor.edit({ ...baseline.value!, outline: written as unknown as DocumentData });
      const move = (before: SermonOutline, after: SermonOutline, at: number) =>
        editor.commit(value => ({ ...value, outline: after as unknown as DocumentData }), { kind: 'outline-point-placement',
          move: { generation: 'sermon-generation', before: outlinePointOrder(before), after: outlinePointOrder(after),
            placement: { pointId: point.id, opening: outlinePointGap(before, point.id)!, destination: outlinePointGap(after, point.id)!,
              observedRevision: 1, time: { earliestMs: at, latestMs: at + 1 } } },
        });
      let held = false;
      if (mode === 'close') s.storage!.holdCompletionAfterCommit = (rows, mode) => {
        if (held || mode !== 'readwrite') return false;
        held = [...rows.values()].some(row => {
          const saved = row as { id?: string; editorId?: string; editGeneration?: number };
          return saved?.id !== undefined && saved.editorId === 'outline-writer' && saved.editGeneration === 1;
        });
        return held;
      };
      if (mode === 'retry') s.storage!.writeFailure = true;
      const saves = Promise.allSettled([move(written, first, 100), move(first, second, 200)]);
      if (mode === 'close') {
        await drainMicrotasks();
        expect(held).toBe(true);
        editor.close({ flush: true });
        s.storage!.finishCompletion();
      }
      const settled = await saves;
      if (mode === 'open') expect(settled.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
      if (mode === 'retry') {
        expect(settled.map(result => result.status)).toEqual(['rejected', 'rejected']);
        expect(await s.commits.list('owner')).toEqual([]);
        s.storage!.writeFailure = false;
      }
      await s.engine.retry(resource);
      const records = await s.commits.list('owner');
      expect(records).toHaveLength(3);
      expect(records[0]).toMatchObject({ predecessor: null, value: { outline: written } });
      expect(records[0].outlinePointPlacement).toBeUndefined();
      expect(records[1]).toMatchObject({ predecessor: records[0].id, value: { outline: first },
        outlinePointPlacement: { placement: { time: { earliestMs: 100 } } } });
      expect(records[2]).toMatchObject({ predecessor: records[1].id, value: { outline: second },
        outlinePointPlacement: { placement: { predecessorOperationId: records[1].id, time: { earliestMs: 200 } } } });
    } finally { s.engine.dispose(); }
  });

  it.each([
    { scenario: 'another point move and a text save', unproven: false },
    { scenario: 'an untracked point move', unproven: true },
  ])('finds the preceding outline move only through proven order transitions: $scenario', async ({ unproven }) => {
    const s = setup({ online: false, nativeChoice: true });
    try {
      const resource = { collection: 'sermons', id: 'interleaved-outline' };
      const key = keyOf('owner', resource);
      const outline: SermonOutline = { introduction: [], main: [
        { id: 'point', text: 'Opening' }, { id: 'other', text: 'Neighbor' }, { id: 'anchor', text: 'Remaining' },
      ], conclusion: [] };
      const baseline: ResourceSnapshot = {
        resource, value: { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-09',
          thoughts: [], outline: outline as unknown as DocumentData },
        metadata: { protocol: 1, generation: 'generation', revision: 1, deleted: false },
      };
      s.server.set(key, baseline);
      s.cache.set(key, baseline);
      const editor = await s.engine.openEditor(resource, 'outline-writer');
      const drag = (before: SermonOutline, after: SermonOutline, pointId: string) =>
        editor.commit(value => ({ ...value, outline: after as unknown as DocumentData }), { kind: 'outline-point-placement',
          move: { generation: 'generation', before: outlinePointOrder(before), after: outlinePointOrder(after),
            placement: { pointId, opening: outlinePointGap(before, pointId)!, destination: outlinePointGap(after, pointId)!,
              observedRevision: 1, time: null } },
        });
      const first = movePoint(outline, 'point', 'introduction', 0);
      await drag(outline, first, 'point');
      const middle = movePoint(first, 'other', 'conclusion', 0);
      if (!unproven) await drag(first, middle, 'other');
      const words = { ...middle, main: [{ ...middle.main[0], text: 'Updated words' }] };
      await editor.edit({ ...baseline.value!, outline: words as unknown as DocumentData });
      await editor.save();
      await drag(words, movePoint(words, 'point', 'main', 1), 'point');
      const records = await s.commits.list('owner');
      expect(records.map(record => record.outlinePointPlacement?.placement.pointId)).toEqual(unproven
        ? ['point', undefined, 'point'] : ['point', 'other', undefined, 'point']);
      expect(records.at(-1)?.outlinePointPlacement?.placement.predecessorOperationId).toBe(unproven ? undefined : records[0].id);
    } finally { s.engine.dispose(); }
  });

  it.each([{ ordinaryCount: 1, intervening: false }, { ordinaryCount: 2, intervening: false }, { ordinaryCount: 2, intervening: true }])
  ('moves a legacy outline after $ordinaryCount own revisions if uninterrupted (intervening: $intervening)', async ({ ordinaryCount, intervening }) => {
    const s = setup({ online: false, nativeChoice: true });
    try {
      const resource = { collection: 'sermons', id: 'qa-legacy-outline' };
      const key = keyOf('owner', resource);
      const outline: SermonOutline = { introduction: [], main: [{ id: 'point', text: 'Opening words' }], conclusion: [] };
      const written: SermonOutline = { ...outline, main: [{ id: 'point', text: 'Saved words' }] };
      const placed = movePoint(written, 'point', 'introduction', 0);
      const baseline: ResourceSnapshot = { resource, value: { userId: 'owner', title: 'Legacy sermon', verse: 'John 1:1',
        date: '2026-11-09', thoughts: [], outline: outline as unknown as DocumentData }, metadata: null };
      s.server.set(key, baseline);
      s.cache.set(key, baseline);
      const editor = await s.engine.openEditor(resource, 'legacy-outline');
      if (ordinaryCount > 1) {
        const first = { ...outline, main: [{ id: 'point', text: 'First edit' }] };
        await editor.edit({ ...baseline.value!, outline: first as unknown as DocumentData });
        await editor.save();
      }
      await editor.edit({ ...baseline.value!, outline: written as unknown as DocumentData });
      await editor.commit(current => ({ ...current, outline: placed as unknown as DocumentData }), { kind: 'outline-point-placement',
        move: { generation: null, before: outlinePointOrder(written), after: outlinePointOrder(placed),
          placement: { pointId: 'point', opening: outlinePointGap(written, 'point')!, destination: outlinePointGap(placed, 'point')!,
            observedRevision: 0, time: null } },
      });
      let ordinary = 0;
      jest.mocked(s.transport.send).mockImplementation(async command => {
        const plan = await planDataCommand(command, s.server.get(key)!, {
          get: async () => s.server.get(key)!, list: async () => [],
        });
        for (const snapshot of plan.writes) s.server.set(key, snapshot);
        if (intervening && command.kind === 'update' && !command.outlinePointPlacement && ++ordinary === 1
          && plan.result.kind === 'acknowledged') {
          const accepted = plan.result.snapshot;
          s.server.set(key, { ...accepted, value: { ...accepted.value!, title: 'Independent title' },
            metadata: { ...accepted.metadata!, revision: 2, operationId: 'other-device' } });
        }
        return plan.result;
      });
      s.engine.setOnline(true); await s.engine.retry(resource); await drainMicrotasks();
      expect(s.transport.send).toHaveBeenCalledTimes(ordinaryCount + 1);
      expect(jest.mocked(s.transport.send).mock.calls.at(-1)?.[0]).toMatchObject({
        outlinePointPlacement: { observedRevision: intervening ? 0 : ordinaryCount },
      });
      if (intervening) {
        expect((await s.commits.list('owner')).at(-1)?.state).toBe('conflict');
        expect(s.server.get(key)?.value).toMatchObject({ title: 'Independent title', outline: written });
      } else {
        expect((await s.commits.list('owner')).every(record => record.state === 'acknowledged')).toBe(true);
        expect(s.server.get(key)?.value?.outline).toEqual(placed);
      }
    } finally { s.engine.dispose(); }
  });

  it.each(['local', 'remote', 'newer-remote'] as const)('keeps an independently saved verse when choosing the %s point position', async choice => {
    const s = setup({ online: false, nativeChoice: true });
    try {
      const resource = { collection: 'sermons', id: 'qa-outline-choice-rebase' };
      const key = keyOf('owner', resource);
      const point = { id: 'point', text: 'Keep these words' };
      const outline: SermonOutline = { introduction: [], main: [point], conclusion: [] };
      const phone = movePoint(outline, point.id, 'introduction', 0);
      const desktop = movePoint(outline, point.id, 'conclusion', 0);
      const baseline: ResourceSnapshot = {
        resource, value: { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-09',
          thoughts: [], outline: outline as unknown as DocumentData },
        metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
      };
      s.server.set(key, baseline);
      s.cache.set(key, baseline);
      const editor = await s.engine.openEditor(resource, 'outline-choice');
      await editor.edit({ ...baseline.value!, title: 'Independent local title' });
      await editor.commit(value => ({ ...value, outline: phone as unknown as DocumentData }), { kind: 'outline-point-placement',
        move: { generation: 'sermon-generation', before: outlinePointOrder(outline), after: outlinePointOrder(phone),
          placement: { pointId: point.id, opening: outlinePointGap(outline, point.id)!, destination: outlinePointGap(phone, point.id)!,
            observedRevision: 1, time: null } },
      });
      s.server.set(key, { ...baseline, value: { ...baseline.value!, verse: 'Luke 1:1', outline: desktop as unknown as DocumentData },
        metadata: { ...baseline.metadata!, revision: 2, operationId: 'desktop-operation' } });
      let firstMove = true;
      jest.mocked(s.transport.send).mockImplementation(async command => {
        const stored = s.server.get(key)!;
        if (command.kind !== 'update' || !command.outlinePointPlacement) {
          const result = applyCommand(command, stored);
          if (result.kind === 'acknowledged') s.server.set(key, result.snapshot);
          return result;
        }
        const move = command.outlinePointPlacement;
        if (firstMove) {
          firstMove = false;
          return { kind: 'conflict', operationId: command.operationId, snapshot: stored,
            conflicts: [{ path: ['outline', 'id:' + point.id, 'position'],
              base: { exists: true, value: move.opening }, mine: { exists: true, value: move.destination },
              theirs: { exists: true, value: outlinePointGap(desktop, point.id)! } }] };
        }
        const positioned = projectOutlinePoint(stored.value?.outline as unknown as SermonOutline, point.id, move.destination)!;
        const snapshot = { ...stored, value: { ...stored.value!, outline: positioned as unknown as DocumentData },
          metadata: { ...stored.metadata!, revision: stored.metadata!.revision + 1, operationId: command.operationId } };
        s.server.set(key, snapshot);
        return { kind: 'acknowledged', operationId: command.operationId, snapshot };
      });
      s.engine.setOnline(true); await s.engine.retry(resource); await drainMicrotasks();
      if (choice === 'newer-remote') {
        const stored = s.server.get(key)!;
        const refreshed = { ...stored, value: { ...stored.value!, outline: outline as unknown as DocumentData },
          metadata: { ...stored.metadata!, revision: stored.metadata!.revision + 1, operationId: 'desktop-later' } };
        s.server.set(key, refreshed);
        s.next(refreshed);
        await drainMicrotasks();
      }
      const checkpoint = editor.getState().checkpoint;
      expect(checkpoint.draft?.verse).toBe('Luke 1:1');
      expect(checkpoint.conflicts).toMatchObject([{ path: ['outline', 'id:' + point.id, 'position'] }]);
      expect(readOutlinePointPlacementComparison(checkpoint)?.saved?.section).toBe(choice === 'newer-remote' ? 'main' : 'conclusion');
      if (choice === 'local') {
        const time = { earliestMs: 1000, latestMs: 1001 };
        await editor.keepLocal(undefined, checkpoint, time);
        await s.engine.retry(resource);
        expect(jest.mocked(s.transport.send).mock.calls.at(-1)?.[0]).toMatchObject({ outlinePointPlacement: { time } });
      } else await editor.acceptRemote(undefined, checkpoint);
      await s.engine.retry(resource); await drainMicrotasks();
      expect(editor.getState().checkpoint.conflicts).toEqual([]);
      expect(s.server.get(key)?.value).toMatchObject({ title: 'Independent local title', verse: 'Luke 1:1',
        outline: choice === 'local' ? phone : choice === 'newer-remote' ? outline : desktop });
    } finally { s.engine.dispose(); }
  });

  it.each(['studyMaterials', 'series'].flatMap(collection => ['local', 'remote'].map(choice => [collection, choice])))
    ('resolves acknowledged %s relation rebase with the %s choice without losing membership', async (collection, choice) => {
    const s = setup({ online: false, nativeChoice: true });
    const primary: ResourceSnapshot = { resource: { collection, id: 'qa-ack-rebase-document' },
      value: { userId: 'owner', title: 'Old title', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
        ...(collection === 'series' ? { theme: 'QA series', bookOrTopic: 'James', status: 'active', items: [], sermonIds: [], seriesKind: 'sermon' } : { type: 'study', noteIds: [] }) },
      metadata: { protocol: 1, generation: 'primary-generation', revision: 1, deleted: false } };
    const member: ResourceSnapshot = { resource: { collection: collection === 'series' ? 'sermons' : 'studyNotes', id: 'qa-ack-rebase-member' },
      value: { userId: 'owner', title: 'QA linked member', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
        ...(collection === 'series' ? { verse: 'James 1:5', date: '2026-10-16', thoughts: [], outline: { introduction: [], main: [], conclusion: [] } }
          : { content: 'Note', tags: [], scriptureRefs: [], isDraft: true, materialIds: [] }) },
      metadata: { protocol: 1, generation: 'member-generation', revision: 1, deleted: false } };
    for (const snapshot of [primary, member]) {
      s.server.set(keyOf('owner', snapshot.resource), copy(snapshot));
      s.cache.set(keyOf('owner', snapshot.resource), copy(snapshot));
    }
    let changedRemotely = false;
    jest.mocked(s.transport.send).mockImplementation(async command => {
      if (!changedRemotely) { changedRemotely = true; s.server.set(keyOf('owner', primary.resource), { ...primary,
        value: { ...primary.value, title: 'Remote title' }, metadata: { ...primary.metadata!, revision: 2 } }); }
      const plan = await planDataCommand(command, s.server.get(keyOf('owner', command.resource))!, {
        get: async ref => copy(s.server.get(keyOf('owner', ref))!), list: async () => [],
      });
      for (const snapshot of plan.writes) s.server.set(keyOf('owner', snapshot.resource), copy(snapshot));
      return plan.result;
    });
    const editor = await s.engine.openEditor(primary.resource, JSON.stringify(['qa-rebase', collection, primary.resource.id, 'document', 'prior']));
    try {
      await editor.commit(current => ({ ...current, title: 'My title', ...(collection === 'series'
        ? { items: [{ id: 'qa-ack-rebase-item', type: 'sermon', refId: member.resource.id, position: 1 }] } : { noteIds: [member.resource.id] }) }));
      s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
      expect((await s.commits.list('owner'))[0]).toMatchObject({ state: 'conflict', result: { kind: 'conflict' } });
      expect([...s.entries.values()].map(entry => entry.state)).toEqual(['acknowledged']);
      expect(s.server.get(keyOf('owner', primary.resource))?.value).toMatchObject({ title: 'Remote title', ...(collection === 'series' ? { sermonIds: [member.resource.id] } : { noteIds: [member.resource.id] }) });
      if (collection === 'studyMaterials') expect(s.server.get(keyOf('owner', member.resource))?.value?.materialIds).toEqual([primary.resource.id]);
      expect(describeSync(editor.getState(), editor.getObservation(), editor.getDelivery())).toMatchObject({
        phase: 'conflict', canAcceptRemote: true, canKeepLocal: true,
      });
      if (choice === 'local') { await editor.keepLocal(); await editor.save(); }
      else await editor.acceptRemote();
      await s.engine.retry(); await drainMicrotasks();
      const expected = choice === 'local' ? 'My title' : 'Remote title';
      const saved = s.server.get(keyOf('owner', primary.resource))!;
      expect(saved.value).toMatchObject({ title: expected,
        ...(collection === 'series' ? { sermonIds: [member.resource.id] } : { noteIds: [member.resource.id] }) });
      if (collection === 'studyMaterials') expect(s.server.get(keyOf('owner', member.resource))?.value?.materialIds).toEqual([primary.resource.id]);
      expect(s.transport.send).toHaveBeenCalledTimes(choice === 'local' ? 2 : 1);
      expect(s.entries.size).toBe(0);
      editor.close();
      const reopened = await s.engine.openEditor(primary.resource, JSON.stringify(['qa-rebase', collection, primary.resource.id, 'document', 'reopened']));
      expect(reopened.getState().checkpoint.draft?.title).toBe(expected);
      expect(describeSync(reopened.getState(), reopened.getObservation(), reopened.getDelivery())).toMatchObject({
        phase: 'saved', canAcceptRemote: false, canKeepLocal: false,
      });
    } finally { s.engine.dispose(); }
  });

  it.each(['mine', 'saved', 'changed'] as const)('resolves a returned plan mode with the displayed saved revision (%s)', async scenario => {
    const s = setup({ online: false, nativeChoice: true });
    const plan = { collection: 'sermons', id: 'returned-plan-mode' };
    const key = keyOf('owner', plan);
    const before: ResourceSnapshot = { ...initial(), resource: plan, value: {
      userId: 'owner', title: 'Plan mode QA', verse: 'John 3:16', date: '2026-11-20', thoughts: [], planMode: 'manual',
      planText: { opening: 'Opening words' } } };
    const saved = { ...before, metadata: { ...before.metadata!, revision: 3 },
      value: { ...before.value!, planText: { opening: 'Independently saved words' } } };
    s.server.set(key, before);
    s.cache.set(key, before);
    const editor = await s.engine.openEditor(plan, editorIdentity('test-tab', plan, 'plan', 'initial'));
    const time = { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_090 };
    const field = (value: string) => ({ exists: true, value });
    try {
      await editor.commit(draft => ({ ...draft, planMode: 'note' }));
      s.server.set(key, saved);
      jest.mocked(s.transport.send).mockImplementationOnce(async ({ operationId }) => ({
        kind: 'conflict', operationId, snapshot: saved,
        conflicts: [{ path: ['planMode'], base: field('manual'), mine: field('note'), theirs: field('manual') }],
      }));
      s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
      const shown = editor.getState().checkpoint;
      expect(shown.conflicts).toHaveLength(1);
      if (scenario === 'changed') {
        s.server.set(key, { ...saved, value: { ...saved.value, planMode: 'ai' }, metadata: { ...saved.metadata, revision: 4 } });
        await expect(editor.keepLocal(undefined, shown, time)).rejects.toMatchObject({ code: 'decision-changed' });
        expect(editor.getState().checkpoint.remoteCandidate?.value?.planMode).toBe('ai');
        expect(readSermonPlanModeComparison(editor.getState().checkpoint)?.stored).toEqual(field('ai'));
      } else if (scenario === 'mine') await editor.keepLocal(undefined, shown, time);
      else await editor.acceptRemote(undefined, shown);
      await s.engine.retry(plan); await drainMicrotasks();
      expect(s.server.get(key)?.value).toMatchObject({ planMode: scenario === 'mine' ? 'note' : scenario === 'changed' ? 'ai' : 'manual',
        planText: saved.value.planText });
      if (scenario === 'mine') expect(s.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        sermonPlanModeAction: { observedRevision: 3, time, reviewed: true },
      }));
      else expect(s.transport.send).toHaveBeenCalledTimes(1);
    } finally { s.engine.dispose(); }
  });

  it.each(['mine', 'saved', 'changed'] as const)('resolves a returned preparation confirmation without replaying its sibling (%s)', async scenario => {
    const s = setup({ online: false, nativeChoice: true });
    const sermon = { collection: 'sermons', id: 'returned-preparation-confirmation' };
    const key = keyOf('owner', sermon);
    const path = ['preparation', 'spiritual', 'readAndPrayedConfirmed'];
    const words = 'Independent goal statement';
    const preparation = (checked: boolean, other: boolean) => ({ spiritual: { readAndPrayedConfirmed: checked },
      textContext: { readWholeBookOnceConfirmed: other }, preachingGoal: { statement: words } });
    const before: ResourceSnapshot = { ...initial(), resource: sermon, value: {
      userId: 'owner', title: 'Confirmation QA', verse: 'John 3:16', date: '2026-11-20', thoughts: [],
      preparation: preparation(false, false) } };
    const stored = { ...before, metadata: { ...before.metadata!, revision: 3 },
      value: { ...before.value!, preparation: preparation(false, true) } };
    s.server.set(key, before);
    s.cache.set(key, before);
    const editor = await s.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'sermon', 'initial'));
    const time = { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_090 };
    const field = (value: boolean) => ({ exists: true, value });
    try {
      await editor.commit(draft => ({ ...draft, preparation: preparation(true, false) }));
      s.server.set(key, stored);
      jest.mocked(s.transport.send).mockImplementationOnce(async ({ operationId }) => ({
        kind: 'conflict', operationId, snapshot: stored,
        conflicts: [{ path, base: field(false), mine: field(true), theirs: field(false) }],
      }));
      s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
      const compared = editor.getState().checkpoint;
      expect(compared.conflicts).toHaveLength(1);
      if (scenario === 'changed') {
        s.server.set(key, { ...stored, metadata: { ...stored.metadata, revision: 4 },
          value: { ...stored.value, preparation: preparation(true, true) } });
        await expect(editor.keepLocal(undefined, compared, time)).rejects.toMatchObject({ code: 'decision-changed' });
      } else if (scenario === 'mine') await editor.keepLocal(undefined, compared, time);
      else await editor.acceptRemote(undefined, compared);
      await s.engine.retry(sermon); await drainMicrotasks();
      expect(s.server.get(key)?.value?.preparation).toEqual(preparation(scenario !== 'saved', true));
      if (scenario === 'mine') expect(s.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
        sermonPreparationCheckActions: { readAndPrayedConfirmed: { observedRevision: 3, time, reviewed: true } },
      }));
      else expect(s.transport.send).toHaveBeenCalledTimes(1);
    } finally { s.engine.dispose(); }
  });

  it('preserves terminal choices for a restored checkpoint with a legacy prepared command', async () => {
    const s = setup({ online: false }), session = new DataSession(initial());
    session.edit({ ...initial().value, content: 'Legacy words' });
    const prepared = session.prepare('legacy-operation', 'owner')!;
    const editorId = JSON.stringify(['qa-legacy', resource.collection, resource.id, 'document', 'prior']);
    s.records.set(JSON.stringify(['owner', editorId]), { owner: 'owner', editorId, checkpoint: session.checkpoint(), prepared, unfinalized: [] });
    const remote = initial(2, 'Remote words');
    jest.mocked(s.transport.send).mockResolvedValue({ kind: 'conflict', operationId: prepared.operationId, snapshot: remote,
      conflicts: [{ path: ['content'], base: { exists: true, value: 'base' }, mine: { exists: true, value: 'Legacy words' }, theirs: { exists: true, value: 'Remote words' } }] });
    const editor = await s.engine.openEditor(resource, editorId);
    try {
      s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
      expect(editor.getDelivery().map(entry => entry.state)).toEqual(['conflict']);
      expect(describeSync(editor.getState(), editor.getObservation(), editor.getDelivery())).toMatchObject({
        phase: 'conflict', canAcceptRemote: true, canKeepLocal: true,
      });
    } finally { s.engine.dispose(); }
  });

  it('finishes an already invoked manual Save after its page closes', async () => {
    const s = setup();
    const editor = await s.engine.openEditor(resource, 'manual-close');
    const form = editor.form('content', [['content']]);
    await form.begin(); await form.update(value => ({ ...value, content: 'Saved before leaving' }));
    const saving = form.save().catch(error => error);
    editor.close();
    await saving; await s.engine.retry(); await drainMicrotasks();
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('Saved before leaving');
    expect(() => form.save()).toThrow('Manual parent editor changed');
    s.engine.dispose();
  });

  it('does not start a manual Save for an account that has changed', async () => {
    const s = setup({ online: false });
    const editor = await s.engine.openEditor(resource, 'manual-owner');
    const form = editor.form('content', [['content']]);
    await form.begin(); await form.update(value => ({ ...value, content: 'Old owner stage' }));
    const saving = form.save().catch(error => error);
    s.engine.setOwner('other');
    await saving; await drainMicrotasks();
    expect(s.transport.send).not.toHaveBeenCalled();
    expect(await s.commits.list('other')).toEqual([]);
    s.engine.dispose();
  });


  it('chains rapid commits behind saves registered after capture', async () => {
    const s = setup({ online: false });
    const editor = await s.engine.openEditor(resource, 'continuous');
    s.engine.setVisible(false);
    const gate = deferred<void>();
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementationOnce(command => gate.promise.then(() => send(command)));
    const settle = async () => { for (let i = 0; i < 8; i += 1) await drainMicrotasks(); };
    s.engine.setOnline(true);
    const first = editor.commit(current => ({ ...current, content: 'A' }));
    await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    const second = editor.commit(current => ({ ...current, content: `${current!.content}B` }));
    const third = editor.commit(current => ({ ...current, content: `${current!.content}C` }));
    await settle();
    gate.resolve();
    await Promise.all([first, second, third]);
    await s.engine.retry(); await settle();
    const requests = await s.commits.list('owner');
    const checkpoint = editor.getState().checkpoint;
    s.engine.dispose();
    expect(requests.map(request => request.state)).toEqual(['acknowledged', 'acknowledged', 'acknowledged']);
    expect(requests.map(request => request.predecessor)).toEqual([null, requests[0].id, requests[1].id]);
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('ABC');
    expect(checkpoint.conflicts).toEqual([]);
  });

  it('keeps a direct save behind an adopted manual request at the same generation', async () => {
    const s = setup({ online: false });
    try {
      const editor = await s.engine.openEditor(resource, 'manual-page-hide');
      const form = editor.form('content', [['content']]);
      await form.begin();
      await form.update(value => ({ ...value, content: 'Saved before hiding' }));
      await form.save();
      const manual = (await s.commits.list('owner'))[0];
      const checkpoint = editor.getState().checkpoint;
      expect(checkpoint.pending[manual.id].generation).toBe(checkpoint.editGeneration);
      // The public direct save is also used by the page-hide flush.
      await editor.save();
      const requests = await s.commits.list('owner');
      expect(requests.filter(request => request.predecessor === null)).toHaveLength(1);
      await editor.save();
      expect(await s.commits.list('owner')).toEqual(requests);
      s.engine.setOnline(true);
      await s.engine.retry(); await drainMicrotasks();
      expect((await s.commits.list('owner')).every(request => request.state === 'acknowledged')).toBe(true);
      expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('Saved before hiding');
      expect(editor.getState().checkpoint.conflicts).toEqual([]);
    } finally { s.engine.dispose(); }
  });

  it('keeps later parent edits behind its richer same-generation capture after a manual save', async () => {
    const s = setup({ online: false });
    try {
      const editor = await s.engine.openEditor(resource, 'manual-parent-title');
      await editor.edit({ ...editor.getState().checkpoint.draft, title: 'First parent title' });
      const form = editor.form('content', [['content']]);
      await form.begin();
      await form.update(value => ({ ...value, content: 'Saved form words' }));
      await form.save();
      expect((await s.commits.list('owner'))[0].value?.title).toBe('Title');
      expect(editor.getState().checkpoint.draft?.title).toBe('First parent title');
      await editor.save();
      await editor.edit({ ...editor.getState().checkpoint.draft, title: 'Latest parent title' });
      await editor.save();
      s.engine.setOnline(true);
      await s.engine.retry(); await drainMicrotasks();
      expect((await s.commits.list('owner')).map(request => request.state)).toEqual(['acknowledged', 'acknowledged', 'acknowledged']);
      expect(s.server.get(keyOf('owner', resource))?.value).toMatchObject({ title: 'Latest parent title', content: 'Saved form words' });
      expect(editor.getState().checkpoint.conflicts).toEqual([]);
    } finally { s.engine.dispose(); }
  });

  it('pins pristine manual baseline and preserves the conflict when remote changes before typing', async () => {
    const s = setup({ online: false, nativeChoice: true }); const editor = await s.engine.openEditor(resource, 'manual');
    const form = editor.form('title', [['title']]); await form.begin();
    s.next({ ...initial(2), value: { ...initial().value, title: 'Other device' } }); await drainMicrotasks();
    await form.update(value => ({ ...value, title: 'Mine' }));
    expect(editor.getState().checkpoint.draft?.title).toBe('Other device');
    s.server.set(keyOf('owner', resource), { ...initial(2), value: { ...initial().value, title: 'Other device' } });
    await form.save(); expect(editor.getState().checkpoint.draft?.title).toBe('Mine');
    s.engine.setOnline(true); await s.engine.retry();
    expect((await s.commits.list('owner'))[0].state).toBe('conflict');
    expect(editor.getState().result?.kind).toBe('conflict');
    expect(s.server.get(keyOf('owner', resource))?.value?.title).toBe('Other device');
    await editor.acceptRemote();
    expect(editor.getState().checkpoint.draft?.title).toBe('Other device');
    expect(Object.keys(editor.getState().checkpoint.pending)).toEqual([]);
    expect((await s.commits.list('owner')).every(request => request.state === 'cancelled')).toBe(true);
    s.engine.dispose();
  });

  it('refuses form conflict resolution while either its own or unrelated unsent input needs a decision', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'manual');
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(value => ({ ...value, title: 'Unsent form' }));
    await expect(form.resolve('remote')).rejects.toThrow('unsent form');
    expect(form.getState()?.value.title).toBe('Unsent form');
    await form.cancel(); await form.begin();
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Unsent sibling' });
    await expect(form.resolve('local')).rejects.toThrow('other document changes');
    expect(editor.getState().checkpoint.draft?.content).toBe('Unsent sibling');
    expect(form.getState()?.record.active).toBe(true);
    expect(await s.commits.list('owner')).toEqual([]); s.engine.dispose();
  });

  it('preserves amended manual input when journal retirement fails, and recovers it in a new editor', async () => {
    const s = setup({ nativeChoice: true }); const editor = await s.engine.openEditor(resource, 'repair');
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(value => ({ ...value, title: 'Mine' }));
    s.server.set(keyOf('owner', resource), { ...initial(), value: { ...initial().value!, title: 'Theirs' } });
    await form.save(); await s.engine.retry(); await drainMicrotasks();
    await form.begin(); await form.update(value => ({ ...value, title: 'Corrected mine' }));
    await expect(form.save()).rejects.toThrow('Resolve the failed delivery');
    const count = (await s.commits.list('owner')).length;
    jest.mocked(s.journal.remove).mockRejectedValue(new Error('Journal disk failure'));
    await expect(form.resolve('local')).rejects.toThrow('Journal disk failure');
    jest.mocked(s.journal.remove).mockImplementation(async (recordOwner, id) => { s.entries.delete(JSON.stringify([recordOwner, id])); });
    expect(form.getState()).toMatchObject({ value: { title: 'Corrected mine' }, dirty: true, durable: true, record: { active: false } });
    expect((await s.commits.list('owner'))).toHaveLength(count);
    editor.close({ flush: false });
    const reopened = await s.engine.openEditor(resource, 'repair-reopened');
    const recovered = reopened.form('title', [['title']]); await recovered.begin();
    const choices = await recovered.listRecoverable();
    expect(choices).toHaveLength(1); await recovered.recover(choices[0].scopeId);
    expect(recovered.getState()).toMatchObject({ value: { title: 'Corrected mine' }, dirty: true, record: { active: true } });
    expect(s.server.get(keyOf('owner', resource))!.value!.title).toBe('Theirs'); s.engine.dispose();
  });

  /** Codex (refute-leave-conflict): storage refusing the last checkpoint at once must not escape the screen's cleanup. */
  it('reports a storage refusal of the last checkpoint instead of throwing out of close', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'leaving');
    const refusal = new Error('Storage refused at once');
    void editor.edit({ ...initial().value!, content: 'last words' }).catch(() => undefined);
    jest.mocked(s.checkpoints.put).mockImplementationOnce(() => { throw refusal; });
    expect(() => editor.close({ flush: false })).not.toThrow();
    await drainMicrotasks();
    expect(s.onError).toHaveBeenCalledWith(refusal, resource);
    s.engine.dispose();
  });

  it('saves title B then D offline while unrelated unsaved content stays outside both requests', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'manual');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'unsaved scratch C' });
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(value => ({ ...value, title: 'B' }));
    expect(editor.getState().checkpoint.draft?.title).toBe('Title');
    expect((await s.commits.list('owner'))).toEqual([]);
    await form.save(); expect(form.getState()?.record.active).toBe(false);
    expect(editor.getState().checkpoint.draft).toMatchObject({ title: 'B', content: 'unsaved scratch C' });
    await form.begin(); expect(form.getState()?.value.title).toBe('B');
    await form.save(value => ({ ...value, title: 'D' }));
    const requests = await s.commits.list('owner');
    expect(requests).toHaveLength(2);
    expect(requests[0].value).toMatchObject({ title: 'B', content: 'base' });
    expect(requests[1]).toMatchObject({ predecessor: requests[0].id, value: { title: 'D', content: 'base' } });
    expect(Object.keys(editor.getState().checkpoint.pending)).toEqual(requests.map(request => request.id));
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    s.engine.setOnline(true); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value).toMatchObject({ title: 'D', content: 'base' });
    expect(editor.getState().checkpoint.draft).toMatchObject({ title: 'D', content: 'unsaved scratch C' });
    expect(editor.getState().checkpoint.dirty).toBe(true);
    await editor.save(); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('unsaved scratch C');
    expect(s.onError).not.toHaveBeenCalled(); s.engine.dispose();
  });

  it('requires the same action slot for both recovery discovery and direct recovery', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'old');
    const source = editor.form('mark', [['title']]); await source.begin();
    await source.update(value => ({ ...value, title: 'Mark draft' }));
    const sourceId = source.getState()!.record.scopeId; editor.close();
    const next = await s.engine.openEditor(resource, 'next');
    const different = next.form('unmark', [['title']]); await different.begin();
    expect(await different.listRecoverable()).toEqual([]);
    await expect(different.recover(sourceId)).rejects.toThrow('Manual recovery selection mismatch');
    const same = next.form('mark', [['title']]); await same.begin();
    expect(await same.listRecoverable()).toHaveLength(1);
    await same.recover(sourceId); expect(same.getState()!.value.title).toBe('Mark draft');
    s.engine.dispose();
  });

  it('recovers stage-only forms explicitly and owner fences old actions', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'first-tab');
    const form = editor.form('title', [['title']]); await form.begin(); await form.update(value => ({ ...value, title: 'recover me' }));
    const source = form.getState()!.record.scopeId; editor.dispose();
    const second = await s.engine.openEditor(resource, 'second-tab'); const restored = second.form('title', [['title']]);
    expect(restored.getState()).toBeNull(); expect(await restored.listRecoverable()).toHaveLength(1);
    await restored.recover(source);
    expect(restored.getState()?.value.title).toBe('recover me'); expect(restored.getState()?.record.scopeId).not.toBe(source);
    expect(second.getState().checkpoint.draft?.title).toBe('Title'); expect(await s.commits.list('owner')).toEqual([]);
    expect(s.manualRows.size).toBe(2);
    s.engine.setOwner('other'); expect(() => restored.save()).toThrow();
    expect(await s.commits.list('owner')).toEqual([]); s.engine.dispose();
  });

  it('refreshes the requested document on explicit retry without adding reads to background retries', async () => {
    const s = setup();
    const editor = await s.engine.openEditor(resource, 'retry-read');
    await drainMicrotasks();
    const refresh = jest.spyOn(s.observer, 'refresh');
    s.server.set(keyOf('owner', resource), initial(2, 'Fresh after a read failure'));
    await s.engine.retry();
    expect(refresh).not.toHaveBeenCalled();
    await s.engine.retry(resource);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(resource);
    expect(editor.getState().checkpoint.draft?.content).toBe('Fresh after a read failure');
    s.engine.dispose();
    await s.engine.retry(resource);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads a cached document offline and treats a cached tombstone as a real result', async () => {
    const s = setup({ online: false });
    const first = await s.engine.read(resource);
    expect(first).toEqual(initial());
    first.value!.content = 'caller mutation';
    expect((await s.engine.read(resource)).value?.content).toBe('base');
    s.cache.set(keyOf('owner', resource), { ...initial(2), value: null, metadata: { ...initial(2).metadata!, deleted: true } });
    expect((await s.engine.read(resource)).value).toBeNull();
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('distinguishes an unavailable offline cache from authenticated server absence', async () => {
    const s = setup({ cached: false, online: false });
    await expect(s.engine.read(resource)).rejects.toThrow('local cache');
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.setOnline(true); s.server.clear();
    expect(await s.engine.read(resource)).toEqual(absent());
    expect(s.cache.get(keyOf('owner', resource))).toEqual(absent());
    s.engine.dispose();
  });

  it('deduplicates cache misses and caches the server response before returning it', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const first = s.engine.read(resource); const second = s.engine.read(resource);
    await drainMicrotasks(); expect(s.transport.read).toHaveBeenCalledTimes(1);
    response.resolve(initial());
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(initial()); expect(b).toEqual(initial()); expect(a).not.toBe(b);
    expect(s.cache.get(keyOf('owner', resource))).toEqual(initial());
    s.engine.dispose();
  });

  it('persists an offline draft, queues its save, and restores it after editor disposal', async () => {
    const s = setup({ online: false });
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'offline work' });
    await editor.save(); await drainMicrotasks();
    expect((await s.engine.listPending())[0]).toMatchObject({ state: 'queued', command: { kind: 'update' } });
    expect(s.transport.send).not.toHaveBeenCalled();
    editor.dispose();
    const restored = await s.engine.openEditor(resource, 'tab');
    expect(restored.getState()).toMatchObject({ durable: true, checkpoint: { dirty: true, draft: { content: 'offline work' } } });
    expect(s.entries.size).toBe(1);
    s.engine.setOnline(true); await s.engine.retry();
    expect(restored.getState().checkpoint.dirty).toBe(false);
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('offline work');
    expect(s.cache.get(keyOf('owner', resource))?.value?.content).toBe('offline work');
    expect(s.entries.size).toBe(0);
    s.engine.dispose();
  });

  /** Review of BUG-20261003-background-failure-without-address: a hanging repair must not hold a failed retry. */
  it('ends a retry at the first editor that cannot repair, without waiting for one that hangs', async () => {
    const s = setup({ online: false });
    try {
      const first = await s.engine.openEditor(resource, 'tab'), second = await s.engine.openEditor(resource, 'tab2');
      jest.mocked(s.checkpoints.put).mockRejectedValueOnce(new Error('disk')).mockRejectedValueOnce(new Error('disk'));
      await expect(first.edit({ ...first.getState().checkpoint.draft, content: 'first' })).rejects.toThrow('disk');
      await expect(second.edit({ ...second.getState().checkpoint.draft, content: 'second' })).rejects.toThrow('disk');
      jest.mocked(s.checkpoints.put).mockRejectedValueOnce(new Error('still failing')).mockImplementationOnce(() => new Promise(() => undefined));
      let settled: unknown = 'pending';
      void s.engine.retry().then(() => { settled = 'resolved'; }, (failure: unknown) => { settled = failure; });
      await drainMicrotasks();
      expect(settled).toBeInstanceOf(AddressedFailures);
      expect((settled as AddressedFailures).failures).toEqual([{ error: new Error('still failing'), about: resource }]);
    } finally { s.engine.dispose(); }
  });

  it('retries a failed draft checkpoint offline without requiring another keystroke', async () => {
    const s = setup({ online: false });
    try {
      const editor = await s.engine.openEditor(resource, 'tab');
      jest.mocked(s.checkpoints.put).mockRejectedValueOnce(new Error('temporary disk failure'));
      await expect(editor.edit({ ...editor.getState().checkpoint.draft, content: 'retain this draft' })).rejects.toThrow('temporary disk failure');
      expect(editor.getState().durable).toBe(false);
      await s.engine.retry();
      expect(editor.getState()).toMatchObject({ durable: true, checkpoint: { dirty: true, draft: { content: 'retain this draft' } } });
      expect([...s.records.values()][0].checkpoint.draft?.content).toBe('retain this draft');
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { s.engine.dispose(); }
  });

  it.each([false, true])('retries a prepared command after journal failure with later typing=%s', async laterTyping => {
    const s = setup({ online: false });
    try {
      const editor = await s.engine.openEditor(resource, 'tab');
      await editor.edit({ ...editor.getState().checkpoint.draft, content: 'retained command' });
      jest.mocked(s.journal.put).mockRejectedValueOnce(new Error('temporary journal failure'));
      await editor.save(); await drainMicrotasks();
      const prepared = (await s.commits.list('owner'))[0].command;
      expect(prepared?.operationId).toBe('operation-1');
      // Preparing this document's delivery failed: said about this document on every road that
      // reports it — preparation and background delivery (BUG-20261003-background-failure-without-address).
      expect(s.onError).toHaveBeenCalledWith(new Error('temporary journal failure'), resource);
      expect(s.onError.mock.calls.every(([, about]) => JSON.stringify(about) === JSON.stringify(resource))).toBe(true);
      if (laterTyping) {
        await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Typed after the journal failed' });
        expect(editor.getState().durable).toBe(true);
      }
      s.engine.setOnline(true);
      await s.engine.retry();
      expect(s.transport.send).toHaveBeenCalledTimes(1);
      expect(s.transport.send).toHaveBeenCalledWith(prepared);
      expect(editor.getState()).toMatchObject({ durable: true, checkpoint: { dirty: laterTyping, pending: {} } });
      expect(editor.getState().checkpoint.draft?.content).toBe(laterTyping ? 'Typed after the journal failed' : 'retained command');
      expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('retained command');
    } finally { s.engine.dispose(); }
  });

  it('notifies saved-work readers after a durable request answer and stops after unsubscribe', async () => {
    const s = setup({ online: false, nativeChoice: true }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Retained words' }); await editor.save();
    const reads: ReturnType<typeof s.commits.list>[] = [];
    const listener = jest.fn(() => { reads.push(s.commits.list('owner')); });
    const stop = s.engine.subscribeSavedWork(listener);
    s.engine.subscribeSavedWork(() => { throw new Error('Rendering failed'); });
    s.server.set(keyOf('owner', resource), initial(2, 'Stored words'));
    s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect((await Promise.all(reads)).some(requests => requests.some(request => request.state === 'conflict'
      && request.result?.kind === 'conflict' && request.result.snapshot.value?.content === 'Stored words'))).toBe(true);
    expect(editor.getState().checkpoint.draft?.content).toBe('Retained words');
    expect(s.onError).not.toHaveBeenCalled();
    stop(); listener.mockClear();
    await editor.acceptRemote(); await drainMicrotasks();
    expect(listener).not.toHaveBeenCalled();
    s.engine.dispose();
    expect(() => s.engine.subscribeSavedWork(jest.fn())).toThrow('disposed');
  });

  it('does not publish another account\'s late request answer to saved-work readers', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Owned words' }); await editor.save();
    const answer = deferred<Awaited<ReturnType<EngineTransport['send']>>>();
    jest.mocked(s.transport.send).mockReturnValue(answer.promise);
    const listener = jest.fn(); const stop = s.engine.subscribeSavedWork(listener);
    s.engine.setOnline(true); await drainMicrotasks();
    const command = jest.mocked(s.transport.send).mock.calls[0][0];
    expect(command.owner).toBe('owner');
    s.engine.setOwner('other'); await drainMicrotasks(); listener.mockClear();
    answer.resolve(applyCommand(command, initial())); await drainMicrotasks(); await drainMicrotasks();
    expect(listener).not.toHaveBeenCalled();
    expect(s.engine.getPending()).toEqual([]);
    stop(); s.engine.dispose();
  });

  it('publishes queued delivery only to its owning editor and not to another editor of the same resource', async () => {
    const s = setup({ online: false });
    const first = await s.engine.openEditor(resource, 'first');
    const second = await s.engine.openEditor(resource, 'second');
    const pendingListener = jest.fn(); const unsubscribe = s.engine.subscribePending(pendingListener);
    s.engine.subscribePending(() => { throw new Error('Rendering failed'); });
    const firstListener = jest.fn(); const secondListener = jest.fn();
    first.subscribe(firstListener); second.subscribe(secondListener);
    await first.edit({ ...first.getState().checkpoint.draft, content: 'queued' });
    firstListener.mockClear(); secondListener.mockClear();
    await first.save(); await drainMicrotasks();
    expect(s.engine.getPending()).toEqual(await s.engine.listPending());
    expect(first.getDelivery()).toMatchObject([{ state: 'queued', command: { operationId: 'operation-1' } }]);
    expect(second.getDelivery()).toEqual([]);
    expect(firstListener).toHaveBeenCalled(); expect(secondListener).not.toHaveBeenCalled();
    expect(pendingListener).toHaveBeenCalled();
    const detached = s.engine.getPending(); detached[0].state = 'refused';
    expect(s.engine.getPending()[0].state).toBe('queued');
    const detachedDelivery = first.getDelivery(); detachedDelivery[0].command.operationId = 'tampered';
    expect(first.getDelivery()[0].command.operationId).toBe('operation-1');
    unsubscribe(); s.engine.dispose();
    expect(() => first.getDelivery()).toThrow();
    expect(() => s.engine.subscribePending(jest.fn())).toThrow('disposed');
  });

  it('publishes an unknown result and clears pending delivery after acknowledged recovery', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockRejectedValue(new Error('Response lost'));
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'recover' }); await editor.save();
    const states: string[] = []; editor.subscribe(() => states.push(editor.getDelivery()[0]?.state ?? 'empty'));
    s.engine.setOnline(true); await s.engine.retry();
    expect(s.engine.getPending()[0].state).toBe('unknown');
    expect(editor.getDelivery()[0].state).toBe('unknown');
    expect(states).toContain('unknown');
    jest.mocked(s.transport.send).mockImplementation(send);
    await s.engine.retry(); await drainMicrotasks();
    expect(s.engine.getPending()).toEqual([]); expect(editor.getDelivery()).toEqual([]);
    expect(states).toContain('empty');
    s.engine.dispose();
  });

  // The owner, 2026-10-17: on a weak signal a mark's send ran out of time and waited for the next edit,
  // a return to the tab or the network coming back. It is sent again by itself, after a pause.
  it('sends an unanswered delivery again by itself after a pause, and not while offline', async () => {
    const settle = async () => { for (let i = 0; i < 8; i += 1) await drainMicrotasks(); };
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockRejectedValue(new Error('Request expired'));
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'weak signal' }); await editor.save();
    s.engine.setOnline(true); await settle();
    expect(s.engine.getPending()[0].state).toBe('unknown');
    const tried = jest.mocked(s.transport.send).mock.calls.length;
    // Offline, the pause passes and nothing is sent.
    s.engine.setOnline(false);
    await jest.advanceTimersByTimeAsync(redeliveryDelay(s.engine.getPending()[0].attempts)); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(tried);
    // Back online the engine sends at once; still unanswered, it waits its pause and sends again by itself.
    s.engine.setOnline(true); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(tried + 1);
    expect(s.engine.getPending()[0].state).toBe('unknown');
    jest.mocked(s.transport.send).mockImplementation(send);
    const pause = redeliveryDelay(s.engine.getPending()[0].attempts);
    await jest.advanceTimersByTimeAsync(pause - 1); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(tried + 1);
    await jest.advanceTimersByTimeAsync(1); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(tried + 2);
    expect(s.engine.getPending()).toEqual([]); expect(editor.getDelivery()).toEqual([]);
    s.engine.dispose();
  });

  it('publishes a terminal refusal and clears it only after explicit recovery', async () => {
    const s = setup({ online: false, nativeChoice: true }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' }); await editor.save();
    jest.mocked(s.transport.send).mockResolvedValue({ kind: 'refused', operationId: 'operation-1', code: 'permission-denied' });
    const listener = jest.fn(); editor.subscribe(listener);
    s.engine.setOnline(true); await s.engine.retry();
    expect(editor.getDelivery()).toMatchObject([{ state: 'refused', result: { code: 'permission-denied' } }]);
    expect(s.engine.getPending()[0].state).toBe('refused'); expect(listener).toHaveBeenCalled();
    await editor.acceptRemote();
    expect(s.engine.getPending()).toEqual([]); expect(editor.getDelivery()).toEqual([]);
    s.engine.dispose();
  });

  it.each([
    { saves: 1, side: 'mine' },
    { saves: 2, side: 'mine' },
    { saves: 3, side: 'stored' },
    { saves: 2, side: 'competing-intent' },
    { saves: 2, side: 'unverified-intent' },
    { saves: 2, side: 'captured-intent-proof' },
    { saves: 2, side: 'amended-intent' },
    { saves: 2, side: 'captured-point-proof' },
    { saves: 2, side: 'unverified-other-point' },
  ] as const)('reviews the later unreadable point after retiring a refusal ($saves saves, $side)', async ({ saves, side }) => {
    const s = setup({ online: false, nativeChoice: true });
    const ref = { collection: 'sermons', id: 'two-stage-refusal' };
    const sibling = { id: 'sibling', title: 'Opening neighbor' };
    const point = { id: 'added', title: '', children: [] };
    const value = (nodes: DocumentData[], authorIntent = 'Another field') => ({ userId: 'owner', title: 'Sermon', thoughts: [],
      preparation: { exegeticalPlan: nodes, authorIntent } });
    const opening = { ...initial(), resource: ref, value: value([sibling]) };
    const otherPointEdit = side === 'captured-point-proof' || side === 'unverified-other-point';
    const amendedIntent = side === 'amended-intent';
    const capturedIntent = side === 'captured-intent-proof' || amendedIntent;
    const unknownIntent = side === 'competing-intent' || side === 'unverified-intent';
    const preparationEdit = capturedIntent || unknownIntent;
    const savedIntent = side === 'competing-intent' ? 'Author words on the other device' : 'Another field';
    const actionTime = { earliestMs: 3000, latestMs: 3010 };
    const newNeighbor = otherPointEdit ? sibling : { ...sibling, title: 'Newer neighbor' };
    const stored = { ...opening, value: value([newNeighbor], savedIntent),
      metadata: { ...opening.metadata!, revision: 2, operationId: 'desktop' } };
    s.cache.set(keyOf('owner', ref), opening);
    s.server.set(keyOf('owner', ref), opening);
    const editorId = editorIdentity('phone', ref, 'core', 'earlier');
    try {
      const editor = await s.engine.openEditor(ref, editorId);
      const queued = value([sibling, point]);
      await editor.edit(queued);
      await editor.save();
      let authorIntent = 'Another field';
      const independentIntent = preparationEdit || otherPointEdit;
      for (let index = 1; index < saves; index += 1) {
        if (independentIntent && !otherPointEdit) authorIntent = 'Independent words from Save ' + (index + 1);
        if (capturedIntent) {
          const words = authorIntent;
          await editor.commit(() => value([sibling, point], words), { kind: 'document-metadata', time: actionTime });
          const captured = (await s.commits.list('owner')).at(-1);
          expect(captured?.sermonPreparationTextActions).toEqual({
            authorIntent: { before: { exists: true, value: 'Another field' }, after: { exists: true, value: words },
              observedRevision: 1, time: actionTime },
          });
          continue;
        }
        if (side === 'captured-point-proof') {
          await editor.edit(value([{ ...sibling, title: 'Existing point edited offline' }, point], authorIntent),
            undefined, { field: 'exegetical-point', nodeId: sibling.id, intent: 'title', time: { earliestMs: 3000, latestMs: 3010 } });
        } else if (independentIntent) await editor.edit(value([otherPointEdit ? { ...sibling, title: 'Existing point edited offline' } : sibling, point], authorIntent));
        else await editor.edit(value([sibling, { ...point, title: 'Earlier captured point title ' + index }]));
        await editor.save();
        if (!independentIntent) {
          // The old checkpoint is recovered with the proof already owned by the queued Save.
          const captured = (await s.commits.list('owner')).at(-1)!;
          s.storage!.rows.set(JSON.stringify(commitRowKey(captured)), { ...captured,
            exegeticalPlanActions: [{ nodeId: point.id, kind: 'title', observedRevision: 1, time: { earliestMs: 3000, latestMs: 3010 } }] });
        }
      }
      expect(Object.keys(editor.getState().checkpoint.pending)).toHaveLength(saves);
      const existing = otherPointEdit ? { ...sibling, title: 'Existing point edited offline' } : sibling;
      const draft = value([existing, { ...point, title: 'Written after Save' }], authorIntent);
      await editor.edit(draft, undefined, { field: 'exegetical-point', nodeId: point.id, intent: 'title', time: null });
      const record = await s.checkpoints.read('owner', editorId);
      expect(record).toBeDefined();
      await s.checkpoints.put({ ...record!, checkpoint: { ...record!.checkpoint, exegeticalPointDrafts: undefined,
        unreadableExegeticalProofs: [{ nodeId: point.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true }] } });
      editor.dispose();
      const send = jest.mocked(s.transport.send).getMockImplementation()!;
      jest.mocked(s.transport.send).mockImplementationOnce(async command => ({
        kind: 'refused', operationId: command.operationId, code: 'decision-changed',
      }));
      s.engine.setOnline(true);
      await s.engine.retry();
      s.server.set(keyOf('owner', ref), stored);
      const source = (await s.engine.listRecoverable(ref)).find(copy => copy.answer === 'refused' && copy.record.checkpoint.unreadableExegeticalProofs?.length);
      expect(source).toBeDefined();
      const reopened = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'review'), source!.id);
      const openingReview = reopened.getState().checkpoint;
      if (side === 'captured-point-proof' || capturedIntent) {
        // An interrupted split must leave both original requests available for retry.
        s.storage!.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint'
          && String(key[2]).startsWith('["manual-choice-recovery",');
        try {
          await expect(reopened.acceptRemote(undefined, openingReview)).rejects.toThrow();
        } finally { s.storage!.writeFailureFor = undefined; }
        expect(reopened.getState().checkpoint.pending).toEqual(openingReview.pending);
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
        expect(s.transport.send).toHaveBeenCalledTimes(1);
      }
      await reopened.acceptRemote(undefined, saves > 1 ? openingReview : undefined);
      const reviewed = reopened.getState().checkpoint;
      expect(reviewed.pending).toEqual({});
      expect(reviewed.conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan', 'id:added']]);
      const reviewedIntent = preparationEdit ? savedIntent : authorIntent;
      expect(reviewed.draft?.preparation).toMatchObject({ authorIntent: reviewedIntent,
        exegeticalPlan: expect.arrayContaining([{ ...point, title: 'Written after Save' }]) });
      expect(s.transport.send).toHaveBeenCalledTimes(1);
      if (otherPointEdit) {
        expect(reviewed.draft?.preparation).toMatchObject({ exegeticalPlan: expect.arrayContaining([sibling]) });
        const copies = await s.engine.listRecoveryChoices(ref, true);
        expect(copies).toHaveLength(1);
        expect(copies[0].record.checkpoint.draft?.preparation).toMatchObject({ exegeticalPlan: [existing] });
        if (side === 'captured-point-proof') expect(copies[0].record.checkpoint.exegeticalPointDrafts).toMatchObject(
          [{ nodeId: sibling.id, observedRevision: 1, time: { earliestMs: 3000, latestMs: 3010 } }]);
      }
      const keepNewest = side === 'mine' || side === 'captured-point-proof';
      if (keepNewest) await reopened.keepLocal(undefined, reviewed);
      else await reopened.acceptRemote(undefined, reviewed);
      jest.mocked(s.transport.send).mockImplementation(send);
      await reopened.save();
      await s.engine.retry();
      const accepted = s.server.get(keyOf('owner', ref));
      const settled = keepNewest ? [newNeighbor, { ...point, title: 'Written after Save' }] : [newNeighbor];
      expect(accepted?.value?.preparation).toEqual(value(settled, reviewedIntent).preparation);
      if (preparationEdit) {
        const choices = await s.engine.listRecoveryChoices(ref, true);
        expect(choices).toHaveLength(1);
        expect(choices[0].record.checkpoint.draft?.preparation).toMatchObject({ authorIntent, exegeticalPlan: [sibling] });
        const continuation = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'independent-intent'), choices[0].id);
        if (amendedIntent) {
          authorIntent = 'Prepared text amended after recovery';
          await continuation.edit(value([sibling], authorIntent));
        }
        if (unknownIntent || amendedIntent) {
          const comparison = continuation.getState().checkpoint;
          expect(comparison.conflicts).toMatchObject([{ path: ['preparation', 'authorIntent'],
            mine: { value: authorIntent }, theirs: { value: savedIntent } }]);
          await expect(continuation.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
          expect(s.transport.send).toHaveBeenCalledTimes(1);
          if (side === 'competing-intent') {
            await continuation.acceptRemote(undefined, comparison);
            await s.engine.retry();
            expect(s.transport.send).toHaveBeenCalledTimes(1);
            expect(s.server.get(keyOf('owner', ref))?.value?.preparation).toEqual(value(settled, savedIntent).preparation);
          } else {
            const advanced = { ...accepted!, metadata: { ...accepted!.metadata!, revision: 3, operationId: 'next-desktop' } };
            s.server.set(keyOf('owner', ref), advanced);
            const choiceTime = { earliestMs: 6000, latestMs: 6010 };
            await expect(continuation.keepLocal(undefined, comparison, choiceTime)).rejects.toMatchObject({ code: 'decision-changed' });
            expect(s.transport.send).toHaveBeenCalledTimes(1);
            await continuation.keepLocal(undefined, continuation.getState().checkpoint, choiceTime);
            await s.engine.retry();
            expect(jest.mocked(s.transport.send).mock.calls[1]?.[0]).toMatchObject({
              sermonPreparationTextActions: { authorIntent: { observedRevision: 3, time: choiceTime } },
            });
            expect(s.server.get(keyOf('owner', ref))?.value?.preparation).toEqual(value(settled, authorIntent).preparation);
          }
        } else {
          await continuation.save();
          await s.engine.retry();
          const writes = jest.mocked(s.transport.send).mock.calls.map(([command]) => command);
          expect(writes).toHaveLength(2);
          expect(writes[1]).toMatchObject({
            sermonPreparationTextActions: {
              authorIntent: { observedRevision: 1, time: actionTime },
            },
          });
          expect(writes[1]).toMatchObject({ kind: 'update', changes: [{ path: ['preparation'],
            before: { value: value([sibling], reviewedIntent).preparation },
            after: { value: value([sibling], authorIntent).preparation } }] });
          expect(s.server.get(keyOf('owner', ref))?.value?.preparation).toEqual(value(settled, authorIntent).preparation);
        }
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      }
      if (otherPointEdit) {
        const [copy] = await s.engine.listRecoveryChoices(ref, true);
        const continuation = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'independent-point'), copy.id);
        if (side === 'captured-point-proof') {
          await continuation.save();
          await s.engine.retry();
          const writes = jest.mocked(s.transport.send).mock.calls.map(([command]) => command);
          expect(writes).toHaveLength(3);
          expect(writes[2]).toMatchObject({ exegeticalPlanActions: [
            { nodeId: sibling.id, observedRevision: 1, time: { earliestMs: 3000, latestMs: 3010 } },
          ] });
          expect(s.server.get(keyOf('owner', ref))?.value?.preparation).toEqual(value([existing, settled[1]], authorIntent).preparation);
        } else {
          const other = continuation.getState().checkpoint;
          expect(other.conflicts).toMatchObject([{ path: ['preparation', 'exegeticalPlan', 'id:sibling'],
            mine: { value: { title: 'Existing point edited offline' } }, theirs: { value: { title: sibling.title } } }]);
          await continuation.acceptRemote(undefined, other);
          await s.engine.retry();
          expect(s.transport.send).toHaveBeenCalledTimes(1);
        }
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      }
    } finally { s.engine.dispose(); }
  });

  it.each(['separate', 'nested', 'uncovered'] as const)('recovers several independent preparation edits after a refused point Save (%s)', async scope => {
    const s = setup({ online: false, nativeChoice: true });
    const ref = { collection: 'sermons', id: 'mixed-preparation-refusal' };
    const first = { id: 'preparation:authorIntent', title: 'Opening first point', children: [] };
    const second = { id: 'other-point', title: 'Opening second point', children: [] };
    const added = { id: 'new-point', title: '', children: [] };
    const newest = { ...added, title: 'Newest title for the new point' };
    const plan = (parent: typeof first, child: typeof second, extra?: typeof added) => [
      ...(scope === 'nested' ? [{ ...parent, children: [child] }] : [parent, child]),
      ...(extra ? [extra] : []),
    ];
    const firstEdit = { ...first, title: 'First point edited on phone' };
    const secondEdit = { ...second, title: 'Second point edited on phone' };
    const savedSecond = { ...second, title: 'Second point edited on desktop' };
    const openingWords = 'Opening author words', authorWords = 'Author words edited on phone';
    const openingValue = { userId: 'owner', title: 'Sermon', thoughts: [], preparation: {
      authorIntent: openingWords, exegeticalPlan: plan(first, second),
    } };
    const opening = { ...initial(), resource: ref, value: openingValue };
    const saved = { ...opening, value: { ...openingValue, preparation: {
      ...openingValue.preparation, exegeticalPlan: plan(first, savedSecond),
    } }, metadata: { ...opening.metadata!, revision: 2, operationId: 'desktop' } };
    const authorTime = { earliestMs: 3000, latestMs: 3010 };
    const pointTime = { earliestMs: 4000, latestMs: 4010 };
    const editorId = editorIdentity('phone', ref, 'core', 'earlier');
    s.cache.set(keyOf('owner', ref), opening);
    s.server.set(keyOf('owner', ref), opening);

    try {
      const editor = await s.engine.openEditor(ref, editorId);
      const firstSave = { ...openingValue, preparation: { ...openingValue.preparation, exegeticalPlan: plan(first, second, added) } };
      await editor.edit(firstSave);
      await editor.save();
      await editor.commit(() => ({ ...firstSave, preparation: { ...firstSave.preparation, authorIntent: authorWords } }),
        { kind: 'document-metadata', time: authorTime });
      await editor.edit({ ...firstSave, preparation: { ...firstSave.preparation, authorIntent: authorWords,
        exegeticalPlan: plan(firstEdit, second, added) } }, undefined,
      { field: 'exegetical-point', nodeId: first.id, intent: 'title', time: pointTime });
      await editor.save();
      const latestSave = { ...firstSave, ...(scope === 'uncovered' && { isPreached: true }), preparation: {
        authorIntent: authorWords, exegeticalPlan: plan(firstEdit, secondEdit, added), textContext: { contextNotes: 'Local context without a readable observation' },
      } };
      await editor.edit(latestSave);
      await editor.save();
      await editor.edit({ ...latestSave, preparation: { ...latestSave.preparation, exegeticalPlan: plan(firstEdit, secondEdit, newest) } });
      const record = (await s.checkpoints.read('owner', editorId))!;
      await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, exegeticalPointDrafts: undefined,
        unreadableExegeticalProofs: [{ nodeId: added.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true }] } });
      editor.dispose();
      const send = jest.mocked(s.transport.send).getMockImplementation()!;
      jest.mocked(s.transport.send).mockImplementationOnce(async command => ({
        kind: 'refused', operationId: command.operationId, code: 'decision-changed',
      }));
      s.engine.setOnline(true);
      await s.engine.retry();
      s.server.set(keyOf('owner', ref), saved);

      const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
      expect(source).toBeDefined();
      const reopened = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'review'), source.id);
      const shown = reopened.getState().checkpoint;
      if (scope === 'uncovered') {
        await expect(reopened.acceptRemote(undefined, shown)).rejects.toMatchObject({ code: 'other-changes-first' });
        expect(reopened.getState().checkpoint.pending).toEqual(shown.pending);
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
        expect(s.transport.send).toHaveBeenCalledTimes(1);
        return;
      }
      s.storage!.writeFailureFor = key => Array.isArray(key) && key[0] === 'checkpoint' && String(key[2]).includes(second.id);
      try {
        await expect(reopened.acceptRemote(undefined, shown)).rejects.toThrow();
      } finally { s.storage!.writeFailureFor = undefined; }
      expect(reopened.getState().checkpoint.pending).toEqual(shown.pending);
      expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);

      await reopened.acceptRemote(undefined, shown);
      const primary = reopened.getState().checkpoint;
      expect(primary.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:' + added.id]]);
      expect(primary.draft?.preparation).toEqual({ authorIntent: openingWords, exegeticalPlan: plan(first, savedSecond, newest) });
      const copies = await s.engine.listRecoveryChoices(ref, true);
      expect(new Set(copies.map(({ id }) => id)).size).toBe(4);
      const find = (match: (checkpoint: EditorRecord['checkpoint']) => boolean) => {
        const item = copies.find(({ record: copy }) => match(copy.checkpoint));
        expect(item).toBeDefined();
        return item!.id;
      };
      const authorId = find(cp => cp.sermonTextRetry?.field === 'authorIntent');
      const contextId = find(cp => cp.unreadableScalarProof?.includes('contextNotes') === true);
      const firstId = find(cp => cp.exegeticalPointDrafts?.[0].nodeId === first.id);
      const secondId = find(cp => cp.unreadableExegeticalProofs?.[0].nodeId === second.id);
      expect(s.transport.send).toHaveBeenCalledTimes(1);

      jest.mocked(s.transport.send).mockImplementation(send);
      await reopened.keepLocal(undefined, primary);
      await reopened.save();
      await s.engine.retry();
      const recover = (slot: string, id: string) => s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', slot), id);
      const context = await recover('context', contextId);
      const contextChoice = context.getState().checkpoint;
      expect(contextChoice.conflicts).toMatchObject([{ path: ['preparation', 'textContext', 'contextNotes'], theirs: { exists: false } }]);
      const secondPoint = await recover('second', secondId);
      const secondChoice = secondPoint.getState().checkpoint;
      expect(secondChoice.unreadableExegeticalProofs).toMatchObject([{ ancestors: scope === 'nested' ? [first.id] : [] }]);
      expect(secondChoice.conflicts).toMatchObject([{ path: ['preparation', 'exegeticalPlan', 'id:' + second.id],
        mine: { value: { title: secondEdit.title } }, theirs: { value: { title: savedSecond.title } } }]);
      await secondPoint.acceptRemote(undefined, secondChoice);
      expect(s.transport.send).toHaveBeenCalledTimes(2);

      const author = await recover('author', authorId);
      await author.save();
      await s.engine.retry();
      const firstPoint = await recover('first', firstId);
      await firstPoint.save();
      await s.engine.retry();
      const contextTime = { earliestMs: 6000, latestMs: 6010 };
      await expect(context.keepLocal(undefined, contextChoice, contextTime)).rejects.toMatchObject({ code: 'decision-changed' });
      await context.keepLocal(undefined, context.getState().checkpoint, contextTime);
      await s.engine.retry();

      const commands = jest.mocked(s.transport.send).mock.calls.map(([command]) => command);
      expect(commands).toHaveLength(5);
      expect(commands[2]).toMatchObject({ sermonPreparationTextActions: { authorIntent: { observedRevision: 1, time: authorTime } } });
      expect(commands[3]).toMatchObject({ exegeticalPlanActions: [{ nodeId: first.id, observedRevision: 1, time: pointTime }] });
      expect(commands[4]).toMatchObject({ sermonPreparationTextActions: { contextNotes: { time: contextTime } } });
      expect(s.server.get(keyOf('owner', ref))?.value?.preparation).toEqual({
        authorIntent: authorWords, exegeticalPlan: plan(firstEdit, savedSecond, newest),
        textContext: { contextNotes: 'Local context without a readable observation' },
      });
      expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
    } finally { s.engine.dispose(); }
  });

  it.each([
    ['title', true], ['verse', true], ['title', false], ['verse', false],
  ] as const)('recovers an independent sermon %s after a refused point Save (proof: %s)', async (field, hasProof) => {
    const s = setup({ online: false, nativeChoice: true });
    const ref = { collection: 'sermons', id: 'header-after-refusal' };
    const openingWords = { title: 'Opening sermon title', verse: 'John 3:16' };
    const storedWords = hasProof ? openingWords[field] : { title: 'Title on the desktop', verse: 'Luke 4:18' }[field];
    const privateWords = { title: 'Title written on the phone', verse: 'John 3:17' }[field];
    const sibling = { id: 'sibling', title: 'Opening existing point', children: [] };
    const point = { id: 'added', title: '', children: [] };
    const newest = { ...point, title: 'Title written after Save' };
    const openingValue = { userId: 'owner', ...openingWords, thoughts: [], preparation: { exegeticalPlan: [sibling] } };
    const opening = { ...initial(), resource: ref, value: openingValue };
    const stored = { ...opening,
      value: { ...openingValue, [field]: storedWords, preparation: { exegeticalPlan: [{ ...sibling, title: 'Saved existing point' }] } },
      metadata: { ...opening.metadata!, revision: 2, operationId: 'newer-desktop' },
    };
    const actionTime = { earliestMs: 3000, latestMs: 3010 };
    const editorId = editorIdentity('phone', ref, 'core', 'earlier');
    const action = field === 'title' ? 'sermonTitleAction' : 'sermonVerseAction';
    s.cache.set(keyOf('owner', ref), opening);
    s.server.set(keyOf('owner', ref), opening);

    try {
      const editor = await s.engine.openEditor(ref, editorId);
      const submitted = { ...openingValue, preparation: { exegeticalPlan: [sibling, point] } };
      await editor.edit(submitted);
      await editor.save();
      const later = { ...submitted, [field]: privateWords };
      if (hasProof) {
        await editor.commit(() => later, { kind: 'document-metadata', time: actionTime });
        expect((await s.commits.list('owner')).at(-1)?.[action]).toMatchObject({ before: openingWords[field],
          after: privateWords, observedRevision: 1, time: actionTime });
      } else {
        await editor.edit(later);
        await editor.save();
      }
      await editor.edit({ ...later, preparation: { exegeticalPlan: [sibling, newest] } });
      const record = (await s.checkpoints.read('owner', editorId))!;
      await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint,
        unreadableExegeticalProofs: [{ nodeId: point.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true }] } });
      editor.dispose();
      const send = jest.mocked(s.transport.send).getMockImplementation()!;
      jest.mocked(s.transport.send).mockImplementationOnce(async command => ({
        kind: 'refused', operationId: command.operationId, code: 'decision-changed',
      }));
      s.engine.setOnline(true);
      await s.engine.retry();
      s.server.set(keyOf('owner', ref), stored);

      const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
      const editorAfter = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'review'), source.id);
      await editorAfter.acceptRemote(undefined, editorAfter.getState().checkpoint);
      const primary = editorAfter.getState().checkpoint;
      expect(primary.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:added']]);
      expect(primary.draft?.[field]).toBe(storedWords);
      expect(s.transport.send).toHaveBeenCalledTimes(1);
      const choices = await s.engine.listRecoveryChoices(ref, true);
      expect(choices).toHaveLength(1);
      expect(choices[0].record.checkpoint.draft).toMatchObject({ [field]: privateWords, preparation: openingValue.preparation });

      jest.mocked(s.transport.send).mockImplementation(send);
      await editorAfter.keepLocal(undefined, primary);
      await editorAfter.save();
      await s.engine.retry();
      let header = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'header'), choices[0].id);
      // An older bundle only scans the ordinary and reminder checkpoint ranges.
      const headerRows = [...s.storage!.rows.keys()].map(key => JSON.parse(key)).filter(key => key[0] === 'sermon-header-choice-checkpoint');
      expect(headerRows).toHaveLength(2);
      expect(headerRows).toContainEqual(['sermon-header-choice-checkpoint', 'owner', choices[0].record.editorId]);
      let alternativeId: string | undefined;
      if (field === 'title' && hasProof) {
        const alternative = (await header.holdDraftAlternative(value => ({ ...value, title: 'Further title kept on the phone' })))!;
        expect(s.storage!.rows.has(JSON.stringify(['sermon-header-choice-checkpoint', 'owner', alternative.record.editorId]))).toBe(true);
        expect((await s.engine.listRecoveryChoices(ref, true)).map(({ id }) => id)).toContain(alternative.id);
        expect(alternative.record.checkpoint.unreadableScalarProof).toEqual(['title']);
        alternativeId = alternative.id;
      }
      if (field === 'verse' && !hasProof) {
        header.dispose();
        const closed = await s.engine.listRecoveryChoices(ref, true);
        expect(closed).toHaveLength(1);
        expect(closed[0].id).not.toBe(choices[0].id);
        header = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'header-after-close'), closed[0].id);
      }
      const useOwn = hasProof || field === 'title';
      const choiceTime = { earliestMs: 6000, latestMs: 6010 };
      if (hasProof) await header.save();
      else {
        const compared = header.getState().checkpoint;
        expect(compared.conflicts).toMatchObject([{ path: [field], mine: { value: privateWords }, theirs: { value: storedWords } }]);
        await expect(header.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
        expect(s.transport.send).toHaveBeenCalledTimes(2);
        if (useOwn) await header.keepLocal(undefined, compared, choiceTime);
        else await header.acceptRemote(undefined, compared);
      }
      await s.engine.retry();
      const commands = jest.mocked(s.transport.send).mock.calls.map(([command]) => command);
      expect(commands).toHaveLength(useOwn ? 3 : 2);
      if (useOwn) expect(commands[2]).toMatchObject({ [action]: {
        observedRevision: hasProof ? 1 : 3, time: hasProof ? actionTime : choiceTime,
      } });
      expect(s.server.get(keyOf('owner', ref))?.value).toMatchObject({ [field]: useOwn ? privateWords : storedWords,
        preparation: { exegeticalPlan: [{ ...sibling, title: 'Saved existing point' }, newest] } });
      expect((await s.engine.listRecoveryChoices(ref, true)).map(({ id }) => id)).toEqual(alternativeId ? [alternativeId] : []);
    } finally { s.engine.dispose(); }
  });

  it.each(['proven', 'own', 'saved', 'named-date', 'removed-date', 'replaced-date', 'same-church', 'missing-fill', 'date-action'] as const)(
    'recovers a sermon church with its inferred calendar fill after a refused point Save (%s)', async mode => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'church-after-point-refusal' };
      const original = { id: 'opening', name: 'Opening church', city: 'Opening city' };
      const phone = { id: 'phone', name: 'Church chosen on the phone', city: 'Phone city' };
      const desktop = { id: 'desktop', name: 'Church chosen on the desktop', city: 'Desktop city' };
      const named = { id: 'calendar', name: 'Church named on the date', city: 'Calendar city' };
      const unspecified = { id: 'church-unspecified', name: 'Church not specified', city: '' };
      const row = { id: 'planned', date: '2026-12-14', status: 'planned', church: unspecified, notes: 'Opening note', createdAt: '2026-11-08' };
      const savedRow = { ...row, notes: 'The latest calendar note', church: mode === 'named-date' ? named : unspecified,
        ...(mode === 'replaced-date' && { createdAt: '2026-11-24' }),
      };
      const fill = { rowId: row.id, rowCreatedAt: row.createdAt, church: phone };
      const other = { ...row, id: 'other', date: '2026-12-20', church: named };
      const storedDates = mode === 'removed-date' ? [other] : [savedRow, other];
      const added = { id: 'point', title: '', children: [] };
      const newest = { ...added, title: 'Newest local point title' };
      const openingValue = { userId: 'owner', title: 'Sermon', verse: 'John 3:16', church: original,
        thoughts: [], preparation: { exegeticalPlan: [] }, preachDates: [row, other] };
      const opening = { ...initial(), resource: ref, value: openingValue };
      const storedChurch = mode === 'proven' ? original : mode === 'same-church' ? phone : desktop;
      const latest = { ...opening, value: { ...openingValue, church: storedChurch, preachDates: storedDates },
        metadata: { ...opening.metadata!, revision: 2, operationId: 'desktop' } };
      const actionTime = { earliestMs: 3000, latestMs: 3010 };
      const choiceTime = { earliestMs: 5000, latestMs: 5010 };
      const editorId = editorIdentity('phone', ref, 'core', 'first');
      s.server.set(keyOf('owner', ref), opening);
      s.cache.set(keyOf('owner', ref), opening);
      try {
        const editor = await s.engine.openEditor(ref, editorId);
        const first = { ...openingValue, preparation: { exegeticalPlan: [added] } };
        await editor.edit(first);
        await editor.save();
        const later = { ...first, church: phone, preachDates: [
          { ...row, church: phone, ...(mode === 'date-action' && { date: '2026-12-16' }) }, other,
        ] };
        await editor.commit(() => later, { kind: 'document-metadata', time: actionTime });
        const request = (await s.commits.list('owner')).at(-1)!;
        expect(request).toMatchObject({ sermonChurchAction: { before: { exists: true, value: original },
          after: { exists: true, value: phone }, observedRevision: 1, time: actionTime }, sermonChurchFill: fill });
        if (mode !== 'proven') {
          // An older Save can have retained just the inferred date witness.
          s.storage!.rows.set(JSON.stringify(commitRowKey(request)), { ...request,
            sermonChurchAction: undefined, ...(mode === 'missing-fill' && { sermonChurchFill: undefined }),
          });
        }
        await editor.edit({ ...later, preparation: { exegeticalPlan: [newest] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint,
          unreadableExegeticalProofs: [{ nodeId: added.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true }] } });
        editor.dispose();
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementationOnce(async command => ({
          kind: 'refused', operationId: command.operationId, code: 'decision-changed',
        }));
        s.engine.setOnline(true);
        await s.engine.retry();
        s.server.set(keyOf('owner', ref), latest);
        const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
        const point = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'point'), source.id);
        const before = point.getState().checkpoint;
        if (mode === 'missing-fill' || mode === 'date-action') {
          await expect(point.acceptRemote(undefined, before)).rejects.toMatchObject({ code: 'other-changes-first' });
          expect(point.getState().checkpoint.pending).toEqual(before.pending);
          expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
          expect(s.transport.send).toHaveBeenCalledTimes(1);
          return;
        }
        await point.acceptRemote(undefined, before);
        const primary = point.getState().checkpoint;
        expect(primary.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        expect(primary.draft).toMatchObject({ church: latest.value.church, preachDates: storedDates });
        const choices = await s.engine.listRecoveryChoices(ref, true);
        expect(choices).toHaveLength(1);
        expect(choices[0].record.checkpoint.draft).toMatchObject({ church: phone, preachDates: [{ ...row, church: phone }, other] });

        jest.mocked(s.transport.send).mockImplementation(send);
        await point.keepLocal(undefined, primary);
        await point.save();
        await s.engine.retry();
        const choice = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'core', 'church'), choices[0].id);
        if (mode === 'proven') await choice.save();
        else {
          const compared = choice.getState().checkpoint;
          expect(compared.conflicts).toMatchObject([{ path: ['church'], mine: { value: phone }, theirs: { value: storedChurch } }]);
          await expect(choice.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
          if (mode === 'saved') await choice.acceptRemote(undefined, compared);
          else await choice.keepLocal(undefined, compared, choiceTime);
        }
        await s.engine.retry();
        const commands = jest.mocked(s.transport.send).mock.calls.map(([command]) => command);
        expect(commands).toHaveLength(mode === 'saved' ? 2 : 3);
        if (mode !== 'saved' && mode !== 'same-church') expect(commands[2]).toMatchObject({ sermonChurchAction: {
          observedRevision: mode === 'proven' ? 1 : 3, time: mode === 'proven' ? actionTime : choiceTime,
        } });
        if (mode === 'same-church') expect(commands[2]).not.toHaveProperty('sermonChurchAction');
        const fillsDate = mode === 'own' || mode === 'proven' || mode === 'same-church';
        if (fillsDate) expect(commands[2]).toMatchObject({ sermonChurchFill: fill });
        else if (mode !== 'saved') expect(commands[2]).not.toHaveProperty('sermonChurchFill');
        expect(s.server.get(keyOf('owner', ref))?.value).toMatchObject({
          church: mode === 'saved' ? desktop : phone, preparation: { exegeticalPlan: [newest] },
          preachDates: fillsDate ? [{ ...savedRow, church: phone }, other] : storedDates,
        });
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      } finally { s.engine.dispose(); }
    },
  );

  it.each(['proven', 'own', 'saved', 'reversed', 'already-saved', 'matched-after-open', 'rechecked', 'hold-neighbor'] as const)('recovers two preparation confirmations separately after a refused point Save (%s)', async mode => {
    const s = setup({ online: false, nativeChoice: true });
    const ref = { collection: 'sermons', id: 'confirmation-after-refusal' };
    const key = keyOf('owner', ref);
    const point = { id: 'point', title: '', children: [] };
    const latestPoint = { ...point, title: 'Latest point title' };
    const openingPreparation = { exegeticalPlan: [], spiritual: { readAndPrayedConfirmed: false },
      ...(mode === 'rechecked' && { textContext: { readWholeBookOnceConfirmed: false } }) };
    const before: ResourceSnapshot = { ...initial(), resource: ref, value: { userId: 'owner', title: 'Sermon', verse: 'John 3:16',
      thoughts: [], preparation: openingPreparation } };
    const savedRead = mode === 'already-saved' || mode === 'reversed';
    const saved = { ...before, metadata: { ...before.metadata!, revision: 2, operationId: 'desktop' },
      value: { ...before.value!, preparation: { exegeticalPlan: [], spiritual: { readAndPrayedConfirmed: false },
        textContext: { authorIntent: 'Words from the desktop', ...(savedRead && { readWholeBookOnceConfirmed: true }),
          ...(mode === 'rechecked' && { readWholeBookOnceConfirmed: false }) } } } };
    const firstTime = { earliestMs: 2000, latestMs: 2010 };
    const secondTime = { earliestMs: 3000, latestMs: 3010 };
    const recheckTime = { earliestMs: 5000, latestMs: 5010 };
    const choiceTime = { earliestMs: 7000, latestMs: 7010 };
    const editorId = editorIdentity('phone', ref, 'sermon', 'original');
    s.server.set(key, before);
    s.cache.set(key, before);
    try {
      const editor = await s.engine.openEditor(ref, editorId);
      const first = { ...before.value!, preparation: { ...openingPreparation, exegeticalPlan: [point] } };
      await editor.edit(first);
      await editor.save();
      const prayer = { ...first.preparation, spiritual: { readAndPrayedConfirmed: true } };
      await editor.commit(current => ({ ...current, preparation: prayer }), {
        kind: 'sermon-preparation-check', field: 'readAndPrayedConfirmed', time: firstTime,
      });
      const read = { ...prayer, textContext: { readWholeBookOnceConfirmed: true } };
      await editor.commit(current => ({ ...current, preparation: read }), {
        kind: 'sermon-preparation-check', field: 'readWholeBookOnceConfirmed', time: secondTime,
      });
      const readWholeBookOnceConfirmed = mode !== 'reversed';
      const final = { ...read, textContext: { readWholeBookOnceConfirmed } };
      if (mode === 'reversed' || mode === 'rechecked') {
        await editor.commit(current => ({ ...current, preparation: { ...final, textContext: { readWholeBookOnceConfirmed: false } } }), {
          kind: 'sermon-preparation-check', field: 'readWholeBookOnceConfirmed', time: { earliestMs: 4000, latestMs: 4010 },
        });
      }
      if (mode === 'rechecked') {
        await editor.commit(current => ({ ...current, preparation: final }), {
          kind: 'sermon-preparation-check', field: 'readWholeBookOnceConfirmed', time: recheckTime,
        });
      }
      const lastSave = (await s.commits.list('owner')).at(-1)!;
      if (mode === 'rechecked') expect(lastSave.sermonPreparationCheckActions?.readWholeBookOnceConfirmed?.predecessorOperationId).toBeDefined();
      expect(lastSave.sermonPreparationCheckActions).toMatchObject({
        readWholeBookOnceConfirmed: { observedRevision: 1, after: { exists: true, value: readWholeBookOnceConfirmed } },
      });
      if (mode !== 'proven' && mode !== 'reversed' && mode !== 'rechecked') {
        s.storage!.rows.set(JSON.stringify(commitRowKey(lastSave)), { ...lastSave, sermonPreparationCheckActions: undefined });
      }
      await editor.edit({ ...first, preparation: { ...final, exegeticalPlan: [latestPoint] } });
      const record = (await s.checkpoints.read('owner', editorId))!;
      await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, unreadableExegeticalProofs: [
        { nodeId: point.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true },
      ] } });
      editor.dispose();
      jest.mocked(s.transport.send).mockImplementationOnce(async command => ({
        kind: 'refused', operationId: command.operationId, code: 'decision-changed',
      }));
      s.engine.setOnline(true);
      await s.engine.retry();
      s.server.set(key, saved);

      const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
      const pointEditor = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'point'), source.id);
      await pointEditor.acceptRemote(undefined, pointEditor.getState().checkpoint);
      const pointComparison = pointEditor.getState().checkpoint;
      expect(pointComparison.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
      await pointEditor.keepLocal(undefined, pointComparison);
      await pointEditor.save();
      await s.engine.retry();

      const copies = await s.engine.listRecoveryChoices(ref, true);
      expect(copies).toHaveLength(mode === 'already-saved' ? 1 : 2);
      const prayerCopy = copies.find(({ record }) => readField(record.checkpoint.draft ?? {}, ['preparation', 'spiritual', 'readAndPrayedConfirmed']).value === true)!;
      const readingCopy = copies.find(({ id }) => id !== prayerCopy.id);
      const storageKeys = () => [...s.storage!.rows.keys()].map(key => JSON.parse(key));
      expect(storageKeys()).toContainEqual(['sermon-preparation-check-choice-checkpoint', 'owner', prayerCopy.record.editorId]);
      const prayerEditor = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'prayer'), prayerCopy.id);
      await prayerEditor.save();
      await s.engine.retry();
      expect(s.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({ sermonPreparationCheckActions: {
        readAndPrayedConfirmed: { observedRevision: 1, time: firstTime },
      } }));

      if (readingCopy) {
        const readingEditor = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'reading'), readingCopy.id);
        if (mode === 'hold-neighbor') {
          await readingEditor.edit({ ...readingEditor.getState().checkpoint.draft!, title: 'Independent pending title' });
          const current = readingEditor.getState().checkpoint;
          expect(readSermonPreparationConfirmation(current)).toBeUndefined();
          await expect(readingEditor.keepLocal(undefined, current, choiceTime)).rejects.toMatchObject({ code: 'decision-changed' });
          await expect(readingEditor.acceptRemote(undefined, current)).rejects.toMatchObject({ code: 'decision-changed' });
          expect(readingEditor.getState().checkpoint.draft).toMatchObject({ title: 'Independent pending title',
            preparation: { textContext: { readWholeBookOnceConfirmed: true } } });
          expect(s.transport.send).toHaveBeenCalledTimes(3);
          return;
        }
        if (mode === 'proven' || mode === 'rechecked') await readingEditor.save();
        else {
          const compared = readingEditor.getState().checkpoint;
          expect(readSermonPreparationConfirmation(compared)).toMatchObject({ field: 'readWholeBookOnceConfirmed',
            mine: { exists: true, value: readWholeBookOnceConfirmed }, stored: savedRead ? { exists: true, value: true } : { exists: false } });
          await expect(readingEditor.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
          if (mode === 'matched-after-open') {
            const snapshot = s.server.get(key)!;
            const preparation = snapshot.value?.preparation as DocumentData;
            s.server.set(key, { ...snapshot, metadata: { ...snapshot.metadata!, revision: 5 },
              value: { ...snapshot.value, preparation: { ...preparation, textContext: { authorIntent: 'Words from the desktop',
                readWholeBookOnceConfirmed: true } } } });
            await expect(readingEditor.keepLocal(undefined, compared, choiceTime)).rejects.toMatchObject({ code: 'decision-changed' });
            expect(readingEditor.getState().checkpoint).toMatchObject({ dirty: false, conflicts: [] });
          } else if (mode === 'own' || mode === 'reversed') await readingEditor.keepLocal(undefined, compared, choiceTime);
          else await readingEditor.acceptRemote(undefined, compared);
        }
      }
      await s.engine.retry();
      expect(s.server.get(key)?.value?.preparation).toEqual({
        exegeticalPlan: [latestPoint], spiritual: { readAndPrayedConfirmed: true },
        textContext: { authorIntent: 'Words from the desktop', ...(mode !== 'saved' && { readWholeBookOnceConfirmed }) },
      });
      const writesReading = mode === 'proven' || mode === 'own' || mode === 'reversed' || mode === 'rechecked';
      if (writesReading) expect(s.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({ sermonPreparationCheckActions: {
        readWholeBookOnceConfirmed: (mode === 'proven' || mode === 'rechecked') ? { observedRevision: 1, time: mode === 'rechecked' ? recheckTime : secondTime }
          : { observedRevision: 4, time: choiceTime, reviewed: true },
      } }));
      if (mode === 'rechecked') {
        const command = jest.mocked(s.transport.send).mock.calls.at(-1)?.[0];
        expect(command?.kind === 'update' && command.sermonPreparationCheckActions?.readWholeBookOnceConfirmed)
          .not.toHaveProperty('predecessorOperationId');
      }
      expect(s.transport.send).toHaveBeenCalledTimes(writesReading ? 4 : 3);
      expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
    } finally { s.engine.dispose(); }
  });

  it.each(['modal-text-and-tags', 'direct-move', 'multiple-moves', 'mixed-proof-group', 'compare-own', 'compare-saved', 'removed-destination', 'removed-thought', 'known-removed-destination', 'known-removed-thought', 'unrelated-edit'] as const)(
    'keeps the thought action available when an earlier new point Save is refused (%s)', async mode => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'thought-action-after-point' };
      const key = keyOf('owner', ref);
      const row = { id: 'thought', date: '2026-11-10T00:00:00.000Z', text: 'Opening thought', tags: [],
        outlinePointId: 'body', subPointId: null };
      const sibling = { ...row, id: 'sibling', text: 'Sibling idea' };
      const structure = { introduction: [], main: [row.id, sibling.id], conclusion: [], ambiguous: [] };
      const outline = { introduction: [{ id: 'intro', text: 'Introduction' }], main: [{ id: 'body', text: 'Body' }], conclusion: [{ id: 'closing', text: 'Closing' }] };
      const newPoint = { id: 'point', title: '', children: [] };
      const laterPoint = { ...newPoint, title: 'Full latest words of the new point' };
      const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 3:16',
        preparation: { exegeticalPlan: [] }, outline, thoughts: [row, sibling], structure, thoughtsBySection: structure };
      const original: ResourceSnapshot = { ...initial(), resource: ref, value };
      const isMove = mode !== 'modal-text-and-tags';
      const multiple = mode === 'multiple-moves' || mode === 'mixed-proof-group';
      const removedThought = mode.endsWith('removed-thought'), removedDestination = mode.endsWith('removed-destination');
      const known = mode === 'direct-move' || mode === 'unrelated-edit' || mode.startsWith('known-') || multiple;
      const keepMove = mode === 'direct-move' || mode === 'compare-own' || multiple;
      const closeInstead = mode === 'compare-own' || mode === 'compare-saved';
      const latestThought = { ...row, text: isMove ? 'Newer words from desktop' : row.text,
        outlinePointId: closeInstead ? 'closing' : 'body' };
      const latestStructure = closeInstead ? { ...structure, main: [sibling.id], conclusion: [row.id] }
        : removedThought ? { ...structure, main: [sibling.id] } : structure;
      const latest = { ...original, metadata: { ...original.metadata!, revision: 2, operationId: 'desktop' },
        value: { ...value, title: 'Edited title from desktop', thoughts: removedThought ? [sibling] : [latestThought, sibling],
          outline: removedDestination ? { ...outline, introduction: [] } : outline,
          structure: latestStructure, thoughtsBySection: latestStructure } };
      const time = { earliestMs: 3000, latestMs: 3010 };
      const editorId = editorIdentity('phone', ref, 'sermon', 'first');
      const patch = (current: DocumentData, fields: Parameters<typeof patchSermonThought>[2]) =>
        patchSermonThought(current as unknown as Sermon, row.id, fields) as unknown as DocumentData;
      s.server.set(key, original);
      s.cache.set(key, original);
      try {
        const editor = await s.engine.openEditor(ref, editorId);
        await editor.edit({ ...value, preparation: { exegeticalPlan: [newPoint] } });
        await editor.save();
        const [earlier] = await s.commits.list('owner');
        if (mode === 'modal-text-and-tags') {
          const form = editor.form('thought:' + row.id, [['thoughts', { id: row.id }], ['structure'], ['thoughtsBySection']]);
          await form.begin();
          await form.save(current => patch(current, { text: 'Edited thought', tags: ['Follow up'] }),
            { documentMetadata: { time, thoughtTextId: row.id, thoughtTagId: row.id } });
        } else {
          await editor.commit(current => {
            const moved = patch(current!, { outlinePointId: 'intro', subPointId: null });
            return mode === 'unrelated-edit'
              ? patchSermonThought(moved as unknown as Sermon, sibling.id, { text: 'Private sibling text' }) as unknown as DocumentData : moved;
          },
            { kind: 'thought-placement', rowId: row.id, time, shown: editor.getState().checkpoint });
        }
        const later = (await s.commits.list('owner')).find(request => request.id !== earlier.id)!;
        if (isMove) {
          expect(later).toMatchObject({ predecessor: earlier.id, thoughtPlacementActions: [{
            rowId: row.id, rowCreatedAt: row.date, before: { outlinePointId: 'body', subPointId: null },
            after: { outlinePointId: 'intro', subPointId: null }, time, observedRevision: 1,
          }] });
        } else {
          expect(later).toMatchObject({ predecessor: null, value: { preparation: value.preparation },
            thoughtTextActions: [{ rowId: row.id, after: 'Edited thought' }],
            thoughtTagActions: [{ rowId: row.id, tag: 'Follow up', after: true }],
          });
        }
        if (multiple) {
          const siblingTime = { earliestMs: 4000, latestMs: 4010 };
          await editor.commit(current => patchSermonThought(current as unknown as Sermon, sibling.id,
            { outlinePointId: 'intro', subPointId: null }) as unknown as DocumentData,
            { kind: 'thought-placement', rowId: sibling.id, time: siblingTime, shown: editor.getState().checkpoint });
          if (mode === 'mixed-proof-group') {
            const siblingSave = (await s.commits.list('owner')).at(-1)!;
            s.storage!.rows.set(JSON.stringify(commitRowKey(siblingSave)), { ...siblingSave, thoughtPlacementActions: undefined });
          }
        }
        if (isMove && !known) s.storage!.rows.set(JSON.stringify(commitRowKey(later)), { ...later, thoughtPlacementActions: undefined });
        await editor.edit({ ...editor.getState().checkpoint.draft!, preparation: { exegeticalPlan: [laterPoint] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, unreadableExegeticalProofs: [
          { nodeId: newPoint.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true },
        ] } });
        editor.dispose();
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementation(async command => command.operationId === earlier.id
          ? { kind: 'refused', operationId: command.operationId, code: 'decision-changed' } : send(command));
        s.server.set(key, latest);
        s.engine.setOnline(true);
        await s.engine.retry();
        const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
        const pointEditor = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'point'), source.id);
        if (mode === 'unrelated-edit' || mode === 'mixed-proof-group') {
          await expect(pointEditor.acceptRemote(undefined, pointEditor.getState().checkpoint)).rejects.toMatchObject({ code: 'other-changes-first' });
          expect(pointEditor.getState().checkpoint.draft?.thoughts).toMatchObject([{ id: row.id, outlinePointId: 'intro' }, mode === 'mixed-proof-group' ? { id: sibling.id, outlinePointId: 'intro' } : { id: sibling.id, text: 'Private sibling text' }]);
          expect(s.transport.send).toHaveBeenCalledTimes(1);
          return;
        }
        await pointEditor.acceptRemote(undefined, pointEditor.getState().checkpoint);
        const compared = pointEditor.getState().checkpoint;
        expect(compared.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        await pointEditor.keepLocal(undefined, compared);
        await pointEditor.save();
        await s.engine.retry();
        const copies = await s.engine.listRecoveryChoices(ref, true);
        if (isMove) {
          expect(copies).toHaveLength(1);
          if (multiple) expect(sermonThoughtPlacementDraft(copies[0].record.checkpoint)).toBe([row.text, sibling.text].join('\n'));
          const placementEditor = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'placement'), copies[0].id);
          if (known && !removedThought && !removedDestination) await placementEditor.save();
          else {
            const shown = placementEditor.getState().checkpoint;
            expect(readThoughtPlacementComparison(shown)).toMatchObject({ recovered: true,
              keepMineDisabled: removedDestination || removedThought,
              locations: [{ text: removedThought ? row.text : latestThought.text }] });
            await expect(placementEditor.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
            if (mode === 'compare-own') await placementEditor.keepLocal(undefined, shown, time);
            else {
              if (removedDestination || removedThought) {
                await expect(placementEditor.keepLocal(undefined, shown, time)).rejects.toMatchObject({ code: 'decision-changed' });
              }
              await placementEditor.acceptRemote(undefined, shown);
            }
          }
          await s.engine.retry();
          if (keepMove) {
            const command = jest.mocked(s.transport.send).mock.calls.at(-1)?.[0];
            expect(command?.kind === 'update' && command.thoughtPlacementActions).toMatchObject([
              { rowId: row.id, rowCreatedAt: row.date, time, observedRevision: known ? 1 : 3 },
              ...(multiple ? [{ rowId: sibling.id, rowCreatedAt: sibling.date, observedRevision: 1, time: { earliestMs: 4000, latestMs: 4010 } }] : []),
            ]);
          }
        } else expect(copies).toEqual([]);
        const saved = s.server.get(key)?.value;
        const expectedStructure = keepMove ? { introduction: multiple ? [row.id, sibling.id] : [row.id],
          main: multiple ? [] : [sibling.id], conclusion: [], ambiguous: [] } : latestStructure;
        const expectedThought = isMove ? { ...latestThought, ...(keepMove && { outlinePointId: 'intro' }) }
          : { ...row, text: 'Edited thought', tags: ['Follow up'] };
        expect(saved).toMatchObject({ title: 'Edited title from desktop', preparation: { exegeticalPlan: [laterPoint] },
          thoughts: removedThought ? [sibling] : [expectedThought, multiple ? { ...sibling, outlinePointId: 'intro' } : sibling],
          structure: expectedStructure, thoughtsBySection: expectedStructure,
        });
        expect(s.transport.send).toHaveBeenCalledTimes(!isMove || keepMove ? 3 : 2);
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      } finally { s.engine.dispose(); }
    },
  );

  it.each(['remove', 'saved-version', 'already-removed', 'replacement', 'changed-during-choice', 'replaced-before-delivery', 'edited-before-delivery', 'replaced-before-delivery-with-draft', 'edited-before-delivery-with-draft', 'mixed-edit'] as const)(
    'recovers the captured deletion after a refused exegetical point Save (%s)', async decision => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'thought-removal-after-point' };
      const key = keyOf('owner', ref);
      const row = { id: 'thought', date: '2026-11-10T00:00:00.000Z', text: 'Opening thought', tags: [] };
      const sibling = { ...row, id: 'sibling', text: 'Sibling idea' };
      const newer = { ...row, text: 'Newer thought from the desktop',
        date: decision === 'replacement' ? '2026-11-12T00:00:00.000Z' : row.date };
      const structure = { introduction: [], main: [row.id, sibling.id], conclusion: [], ambiguous: [] };
      const newPoint = { id: 'point', title: '', children: [] };
      const laterPoint = { ...newPoint, title: 'Full latest words of the new point' };
      const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 3:16',
        preparation: { exegeticalPlan: [] }, thoughts: [row, sibling], structure, thoughtsBySection: structure };
      const original: ResourceSnapshot = { ...initial(), resource: ref, value };
      const remove = (document: DocumentData) => deleteSermonThought(document as unknown as Sermon, row.id) as unknown as DocumentData;
      const latestValue: DocumentData = { ...value, title: 'Newer sermon title', thoughts: [newer, sibling] };
      const latest: ResourceSnapshot = { ...original, metadata: { ...original.metadata!, revision: 2, operationId: 'desktop' },
        value: decision === 'already-removed' ? remove(latestValue) : latestValue };
      const editorId = editorIdentity('phone', ref, 'sermon', 'first');
      s.server.set(key, original);
      s.cache.set(key, original);
      try {
        const editor = await s.engine.openEditor(ref, editorId);
        await editor.edit({ ...value, preparation: { exegeticalPlan: [newPoint] } });
        await editor.save();
        const [earlier] = await s.commits.list('owner');
        await editor.commit(current => {
          const deleted = remove(current!);
          return decision === 'mixed-edit' ? { ...deleted, thoughts: [{ ...sibling, text: 'Separate private words' }] } : deleted;
        });
        const later = (await s.commits.list('owner')).find(request => request.id !== earlier.id)!;
        expect(later).toMatchObject({ predecessor: earlier.id, value: { thoughts: [expect.objectContaining({ id: sibling.id })] } });
        await editor.edit({ ...editor.getState().checkpoint.draft!, preparation: { exegeticalPlan: [laterPoint] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, unreadableExegeticalProofs: [
          { nodeId: newPoint.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true },
        ] } });
        editor.dispose();
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementation(async command => command.operationId === earlier.id
          ? { kind: 'refused', operationId: command.operationId, code: 'decision-changed' } : send(command));
        s.server.set(key, latest);
        s.engine.setOnline(true);
        await s.engine.retry();
        const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
        const point = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'point'), source.id);
        if (decision === 'mixed-edit') {
          await expect(point.acceptRemote(undefined, point.getState().checkpoint)).rejects.toMatchObject({ code: 'other-changes-first' });
          expect(point.getState().checkpoint.draft?.thoughts).toMatchObject([{ id: sibling.id, text: 'Separate private words' }]);
          expect(s.transport.send).toHaveBeenCalledTimes(1);
          return;
        }

        await point.acceptRemote(undefined, point.getState().checkpoint);
        const shownPoint = point.getState().checkpoint;
        expect(shownPoint.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        await point.keepLocal(undefined, shownPoint);
        await point.save();
        await s.engine.retry();
        const copies = await s.engine.listRecoveryChoices(ref, true);
        const needsReview = decision !== 'already-removed' && decision !== 'replacement';
        expect(copies).toHaveLength(needsReview ? 1 : 0);
        if (needsReview) {
          const reopened = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'deletion'), copies[0].id);
          const shownDeletion = reopened.getState().checkpoint;
          expect(shownDeletion.conflicts.map(({ path }) => path)).toEqual([['thoughts', 'id:thought']]);
          expect(shownDeletion.remoteCandidate?.value?.thoughts).toMatchObject([newer, sibling]);
          await expect(reopened.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
          if (decision === 'changed-during-choice') {
            const saved = s.server.get(key)!;
            const amended = { ...newer, text: 'Latest words after reviewing' };
            s.server.set(key, { ...saved, metadata: { ...saved.metadata!, revision: saved.metadata!.revision + 1 },
              value: { ...saved.value, thoughts: [amended, sibling] } });
            await expect(reopened.keepLocal(undefined, shownDeletion)).rejects.toMatchObject({ code: 'decision-changed' });
            expect(s.server.get(key)?.value?.thoughts).toMatchObject([amended, sibling]);
            return;
          }
          if (decision.includes('-before-delivery')) {
            const newBirth = decision.startsWith('replaced');
            const withDraft = decision.endsWith('-with-draft');
            const privateTitle = 'Unsent title written while the removal was being delivered';
            const changed = { ...newer, date: newBirth ? '2026-11-13T00:00:00.000Z' : row.date,
              text: 'Changed after the last comparison' };
            jest.mocked(s.transport.send).mockImplementationOnce(async command => {
              if (withDraft) await reopened.edit({ ...reopened.getState().checkpoint.draft!, title: privateTitle });
              const saved = s.server.get(key)!;
              s.server.set(key, { ...saved, metadata: { ...saved.metadata!, revision: saved.metadata!.revision + 1 },
                value: { ...saved.value, thoughts: [changed, sibling] } });
              return send(command);
            });
            await reopened.keepLocal(undefined, shownDeletion);
            await s.engine.retry();
            expect(s.server.get(key)?.value?.thoughts).toMatchObject([changed, sibling]);
            expect(s.transport.send).toHaveBeenCalledTimes(3);
            expect((await s.commits.list('owner')).at(-1)).toMatchObject({
              result: { kind: 'conflict', conflicts: [expect.objectContaining({ path: ['thoughts', 'id:thought'] })] },
            });
            const afterRefusal = reopened.getState().checkpoint;
            expect(afterRefusal.remoteCandidate?.value?.thoughts).toMatchObject([changed, sibling]);
            if (newBirth) {
              await expect(reopened.keepLocal(undefined, afterRefusal)).rejects.toMatchObject({ code: 'decision-changed' });
              await reopened.acceptRemote(undefined, afterRefusal);
            } else await reopened.keepLocal(undefined, afterRefusal);
            await s.engine.retry();
            expect(s.server.get(key)?.value?.thoughts).toMatchObject(newBirth ? [changed, sibling] : [sibling]);
            expect(s.transport.send).toHaveBeenCalledTimes(newBirth ? 3 : 4);
            expect(s.server.get(key)?.value?.title).toBe(latestValue.title);
            if (withDraft) {
              const [tail] = await s.engine.listRecoveryChoices(ref, true);
              expect(tail?.record).toMatchObject({ retainedManualChoice: { base: { title: latestValue.title } },
                checkpoint: { draft: { title: privateTitle } } });
              const titleDraft = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'title'), tail.id);
              expect(titleDraft.getState().checkpoint.draft?.title).toBe(privateTitle);
              expect(titleDraft.getState().checkpoint.draft?.thoughts).toMatchObject(newBirth ? [changed, sibling] : [sibling]);
            }
            return;
          }
          if (decision === 'remove') await reopened.keepLocal(undefined, shownDeletion);
          else await reopened.acceptRemote(undefined, shownDeletion);
        }
        await s.engine.retry();
        const deleted = decision === 'remove' || decision === 'already-removed';
        const expected = deleted ? remove(latestValue) : latestValue;
        expect(s.server.get(key)?.value).toMatchObject({ title: expected.title, thoughts: expected.thoughts,
          preparation: { exegeticalPlan: [laterPoint] }, structure: expected.structure, thoughtsBySection: expected.thoughtsBySection });
        expect(s.transport.send).toHaveBeenCalledTimes(decision === 'remove' ? 3 : 2);
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      } finally { s.engine.dispose(); }
    },
  );

  it.each(['known', 'both-locked', 'compare-mine', 'compare-saved', 'already-matched', 'replaced', 'late-replacement', 'changed-during-choice', 'reversed', 'mixed'] as const)(
    'keeps thought locks independent after a refused exegetical point Save (%s)', async decision => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'thought-lock-after-point' };
      const key = keyOf('owner', ref);
      const row = { id: 'thought', date: '2026-11-09T00:00:00.000Z', text: 'Opening thought', tags: [] };
      const sibling = { ...row, id: 'sibling', text: 'Sibling idea' };
      const first = { id: 'point', title: '', children: [] };
      const later = { ...first, title: 'Full latest words of the point' };
      const structure = { introduction: [], main: [row.id, sibling.id], conclusion: [] };
      const known = decision === 'known' || decision === 'both-locked' || decision === 'late-replacement';
      const chosen = decision !== 'reversed';
      const newest = { ...row, text: 'Newer words from the desktop',
        date: decision === 'replaced' ? '2026-11-12T00:00:00.000Z' : row.date,
        ...(decision === 'already-matched' || decision === 'reversed' ? { isLocked: true } : {}) };
      const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 3:16',
        preparation: { exegeticalPlan: [] }, thoughts: [row, sibling], structure, thoughtsBySection: structure };
      const original: ResourceSnapshot = { ...initial(), resource: ref, value };
      const latest: ResourceSnapshot = { ...original, metadata: { ...original.metadata!, revision: 2, operationId: 'desktop' },
        value: { ...value, title: 'Newer sermon title', thoughts: [newest, sibling] } };
      const editorId = editorIdentity('phone', ref, 'sermon', 'first');
      const time = { earliestMs: 3000, latestMs: 3010 };
      const clickTime = { earliestMs: 8000, latestMs: 8010 };
      s.server.set(key, original);
      s.cache.set(key, original);
      try {
        const editor = await s.engine.openEditor(ref, editorId);
        await editor.edit({ ...value, preparation: { exegeticalPlan: [first] } });
        await editor.save();
        const [earlier] = await s.commits.list('owner');
        const ids = decision === 'both-locked' ? [row.id, sibling.id] : [row.id];
        const toggle = async (checked: boolean) => {
          const shown = editor.getState().checkpoint;
          await editor.edit({ ...shown.draft,
            thoughts: (shown.draft!.thoughts as typeof row[]).map(item => ids.includes(item.id) ? { ...item, isLocked: checked }
              : decision === 'mixed' ? { ...item, text: 'Separate private words' } : item),
          }, shown, { field: 'thought-lock', rowIds: ids, time });
          await editor.save();
        };
        await toggle(true);
        if (decision === 'reversed') await toggle(false);
        const commands = await s.commits.list('owner');
        expect(commands[1]).toMatchObject({ predecessor: earlier.id, thoughtLockActions: ids.map(rowId => ({
          rowId, rowCreatedAt: row.date, before: false, after: true, observedRevision: 1, time,
        })) });
        if (!known) {
          const command = commands.at(-1)!;
          s.storage!.rows.set(JSON.stringify(commitRowKey(command)), { ...command, thoughtLockActions: undefined });
        }
        await editor.edit({ ...editor.getState().checkpoint.draft!, preparation: { exegeticalPlan: [later] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, unreadableExegeticalProofs: [
          { nodeId: first.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true },
        ] } });
        editor.dispose();
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementation(async command => {
          if (command.operationId === earlier.id) return { kind: 'refused', operationId: command.operationId, code: 'decision-changed' };
          if (command.kind !== 'update' || !command.thoughtLockActions?.length) return send(command);
          const stored = s.server.get(key)!;
          const ordered = orderRowDetails(command, stored, stored.metadata, 10_000, THOUGHT_LOCK_POLICY);
          if (ordered.uncertain.length) {
            return { kind: 'conflict', operationId: command.operationId, snapshot: stored, conflicts: ordered.uncertain };
          }
          return send(alignThoughtLockRepresentation(ordered.command, stored));
        });
        s.server.set(key, latest);
        s.engine.setOnline(true);
        await s.engine.retry();
        const source = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
        const point = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'point'), source.id);
        if (decision === 'mixed') {
          await expect(point.acceptRemote(undefined, point.getState().checkpoint)).rejects.toMatchObject({ code: 'other-changes-first' });
          expect(point.getState().checkpoint.draft?.thoughts).toMatchObject([{ id: row.id, isLocked: true }, { id: sibling.id, text: 'Separate private words' }]);
          return;
        }
        await point.acceptRemote(undefined, point.getState().checkpoint);
        const shown = point.getState().checkpoint;
        expect(shown.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        await point.keepLocal(undefined, shown);
        await point.save();
        await s.engine.retry();
        const copies = await s.engine.listRecoveryChoices(ref, true);
        const noCopy = decision === 'already-matched' || decision === 'replaced';
        expect(copies).toHaveLength(noCopy ? 0 : ids.length);
        if (decision === 'late-replacement') {
          const current = s.server.get(key)!;
          const replacement = { ...newest, date: '2026-11-12T00:00:00.000Z', text: 'Replacement after the point decision' };
          s.server.set(key, { ...current, metadata: { ...current.metadata!, revision: current.metadata!.revision + 1 },
            value: { ...current.value, thoughts: [replacement, sibling] } });
          await expect(s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'changed-lock'), copies[0].id))
            .rejects.toMatchObject({ code: 'draft-done' });
          expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
          expect(s.server.get(key)?.value?.thoughts).toMatchObject([replacement, sibling]);
          expect(s.transport.send).toHaveBeenCalledTimes(2);
          return;
        }
        for (let index = 0; index < copies.length; index += 1) {
          const editor = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'lock-' + index), copies[index].id);
          const checkpoint = editor.getState().checkpoint;
          if (known) await editor.save();
          else {
            expect(checkpoint.conflicts.map(({ path }) => path)).toEqual([['thoughts', 'id:thought', 'isLocked']]);
            expect(checkpoint.remoteCandidate?.value?.thoughts).toMatchObject([newest, sibling]);
            await expect(editor.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
            if (decision === 'changed-during-choice') {
              const current = s.server.get(key)!;
              const edited = { ...newest, text: 'Text typed while comparing the thought' };
              s.server.set(key, { ...current, metadata: { ...current.metadata!, revision: current.metadata!.revision + 1 },
                value: { ...current.value, thoughts: [edited, sibling] } });
              await expect(editor.keepLocal(undefined, checkpoint, clickTime)).rejects.toMatchObject({ code: 'decision-changed' });
              expect(editor.getState().checkpoint.remoteCandidate?.value?.thoughts).toMatchObject([edited, sibling]);
              expect(s.transport.send).toHaveBeenCalledTimes(2);
              return;
            }
            if (decision === 'compare-saved') await editor.acceptRemote(undefined, checkpoint);
            else await editor.keepLocal(undefined, checkpoint, clickTime);
          }
          await s.engine.retry();
          editor.dispose();
        }
        const changed = !noCopy && decision !== 'compare-saved';
        expect(s.server.get(key)?.value).toMatchObject({
          title: 'Newer sermon title', preparation: { exegeticalPlan: [later] }, structure, thoughtsBySection: structure,
          thoughts: [changed ? { ...newest, isLocked: chosen } : newest, decision === 'both-locked' ? { ...sibling, isLocked: true } : sibling],
        });
        const writes = jest.mocked(s.transport.send).mock.calls.slice(2).map(([command]) =>
          command.kind === 'update' ? command.thoughtLockActions?.[0] : null);
        expect(writes).toHaveLength(changed ? ids.length : 0);
        if (changed) expect(writes).toEqual(expect.arrayContaining(ids.map(rowId => expect.objectContaining({
          rowId, time: known ? time : clickTime, observedRevision: known ? 1 : 3,
        }))));
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      } finally { s.engine.dispose(); }
    },
  );

  it.each([
    'append', 'several', 'already-stored', 'moved-point', 'removed-point', 'late-move',
    'late-already-stored', 'reused-id', 'late-reused-id', 'late-reused-id-and-append', 'fork-move-known', 'fork-new-words', 'fork-keep-my-words', 'mixed',
  ] as const)(
    'retains a placed sketch after a refused exegetical point Save (%s)', async mode => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'placed-sketch-after-point' };
      const key = keyOf('owner', ref);
      const first = { id: 'point', title: '', children: [] };
      const later = { ...first, title: 'Full latest words of the point' };
      const body = { id: 'body', text: 'Body' };
      const outline = { introduction: [], main: [body], conclusion: [] };
      const timestamp = '2026-11-09T00:00:00.000Z';
      const place = { section: 'main', pointId: 'body', subPointId: null } as const;
      const sketch = scratchNoteAt(place, { id: 'new-sketch', createdAt: timestamp, text: 'New words by the body point' });
      const neighbor = scratchNoteAt(place, { id: 'older', createdAt: timestamp, text: 'Existing sketch' });
      const following = scratchNoteAt(place, { id: 'next-sketch', createdAt: timestamp, text: 'Second independent sketch' });
      const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 3:16', outline,
        preparation: { exegeticalPlan: [] }, thoughts: [], scratch: [neighbor] as unknown as DocumentData[] };
      const original: ResourceSnapshot = { ...initial(), resource: ref, value };
      const movedOutline = { ...outline, main: [], conclusion: [body] };
      const savedOutline = mode === 'moved-point' ? movedOutline : mode === 'removed-point' ? { ...outline, main: [] } : outline;
      const removedPlace = { ...place, pointId: null };
      const movedPlace = { ...place, section: 'conclusion' } as const;
      const saveNeighbor = (target: typeof place | typeof removedPlace | typeof movedPlace) => scratchNoteAt(target, {
        id: neighbor.id, createdAt: neighbor.createdAt, text: 'Existing sketch edited on the desktop',
      });
      const savedNeighbor = saveNeighbor(mode === 'moved-point' ? movedPlace : mode === 'removed-point' ? removedPlace : place);
      const savedSketch = { ...sketch, text: 'The same sketch with newer words' };
      const replacement = { ...savedSketch, createdAt: '2026-11-25T00:00:00.000Z', text: 'A different sketch with the same ID' };
      const latest: ResourceSnapshot = { ...original, metadata: { ...original.metadata!, revision: 2, operationId: 'desktop' },
        value: { ...value, title: 'Newer sermon title', outline: savedOutline,
          scratch: (mode === 'already-stored' ? [savedNeighbor, savedSketch]
            : mode === 'reused-id' ? [savedNeighbor, replacement] : [savedNeighbor]) as unknown as DocumentData[] } };
      const editorId = editorIdentity('phone', ref, 'sermon', 'first');
      const several = mode === 'several' || mode === 'late-reused-id-and-append';
      const collision = mode === 'reused-id' || mode === 'late-reused-id' || mode === 'late-reused-id-and-append';
      s.server.set(key, original);
      s.cache.set(key, original);
      try {
        const editor = await s.engine.openEditor(ref, editorId);
        await editor.edit({ ...value, preparation: { exegeticalPlan: [first] } });
        await editor.save();
        const [earlier] = await s.commits.list('owner');
        const editSketches = async (scratch: readonly unknown[]) => {
          await editor.edit({ ...editor.getState().checkpoint.draft!, scratch: scratch as DocumentData[] });
          await editor.save();
        };
        await editSketches([mode === 'mixed' ? { ...neighbor, text: 'A separate replacement' } : neighbor, sketch]);
        if (several) await editSketches([neighbor, sketch, following]);
        const [root, ...tail] = await s.commits.list('owner');
        expect(root.id).toBe(earlier.id);
        expect(tail[0].predecessor).toBe(earlier.id);
        await editor.edit({ ...editor.getState().checkpoint.draft!, preparation: { exegeticalPlan: [later] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, unreadableExegeticalProofs: [
          { nodeId: first.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true },
        ] } });
        editor.dispose();
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementation(async command => command.operationId === earlier.id
          ? { kind: 'refused', operationId: command.operationId, code: 'decision-changed' } : send(command));
        s.server.set(key, latest);
        s.engine.setOnline(true);
        await s.engine.retry();

        const held = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
        const point = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'point'), held.id);
        if (mode === 'mixed') {
          await expect(point.acceptRemote(undefined, point.getState().checkpoint)).rejects.toMatchObject({ code: 'other-changes-first' });
          expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
          expect(s.transport.send).toHaveBeenCalledTimes(1);
          return;
        }
        await point.acceptRemote(undefined, point.getState().checkpoint);
        const compared = point.getState().checkpoint;
        expect(compared.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        await point.keepLocal(undefined, compared);
        await point.save();
        await s.engine.retry();
        const copies = await s.engine.listRecoveryChoices(ref, true);
        const keepMyWords = mode === 'fork-keep-my-words';
        const hasNewWords = mode === 'fork-new-words' || keepMyWords;
        const moveLate = mode === 'late-move' || mode === 'fork-move-known' || keepMyWords;
        const reopenFork = mode === 'fork-move-known' || hasNewWords;
        const added = scratchNoteAt(mode === 'moved-point' || moveLate ? movedPlace : mode === 'removed-point' ? removedPlace : place,
          { id: sketch.id, text: sketch.text, createdAt: sketch.createdAt });
        const neighborAtRecovery = moveLate ? saveNeighbor(movedPlace) : savedNeighbor;
        const outlineAtRecovery = moveLate ? movedOutline : savedOutline;
        const alreadyDelivered = mode === 'already-stored' || mode === 'late-already-stored' || mode === 'fork-new-words';
        const reopenedText = 'More words typed after opening the recovered sketch';
        const storedWithNewPlace = { ...savedSketch, section: 'conclusion' };
        const expected = [neighborAtRecovery, keepMyWords ? { ...storedWithNewPlace, text: reopenedText }
          : alreadyDelivered ? savedSketch : collision ? replacement : added, ...(several ? [following] : [])];
        expect(copies).toHaveLength(mode === 'already-stored' ? 0 : 1);
        let recoveryId = copies[0]?.id;
        if (reopenFork) {
          const fork = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'first-sketch-opening'), recoveryId!);
          if (hasNewWords) await fork.edit({ ...fork.getState().checkpoint.draft!,
            scratch: [savedNeighbor, { ...sketch, text: reopenedText }] as unknown as DocumentData[] });
          fork.dispose();
          const [source] = await s.engine.listRecoveryChoices(ref, true);
          recoveryId = source.id;
          expect(source.record.editorId).toContain('first-sketch-opening');
        }
        if (moveLate || mode === 'late-already-stored' || mode === 'late-reused-id' || mode === 'late-reused-id-and-append' || mode === 'fork-new-words') {
          const stored = s.server.get(key)!;
          const freshScratch = keepMyWords ? [neighborAtRecovery, storedWithNewPlace]
            : moveLate ? [neighborAtRecovery] : expected.slice(0, 2);
          const fresh: ResourceSnapshot = { ...stored, metadata: { ...stored.metadata!, revision: stored.metadata!.revision + 1, operationId: 'late-desktop' },
            value: { ...stored.value, outline: outlineAtRecovery, scratch: freshScratch as unknown as DocumentData[] } };
          s.server.set(key, fresh);
          if (mode === 'fork-move-known') {
            const source = (await s.engine.listRecoveryChoices(ref, true))[0].record;
            await s.checkpoints.put({ ...source, checkpoint: { ...source.checkpoint, remoteCandidate: fresh } });
          }
        }
        if (recoveryId) {
          const recovery = s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'sketch'), recoveryId);
          if (mode === 'late-already-stored') {
            await expect(recovery).rejects.toMatchObject({ code: 'draft-done' });
          } else {
            const draft = await recovery;
            if (collision || hasNewWords) {
              const unsaved = hasNewWords ? { ...sketch, text: reopenedText } : sketch;
              const shown = draft.getState();
              expect(shown.checkpoint.draft?.scratch).toEqual([mode === 'reused-id' ? neighbor : savedNeighbor, unsaved, ...(several ? [following] : [])]);
              expect(shown.checkpoint.remoteCandidate?.value?.scratch).toEqual(keepMyWords
                ? [neighborAtRecovery, storedWithNewPlace] : expected.slice(0, 2));
              const status = describeSync(shown, draft.getObservation(), draft.getDelivery());
              expect(status).toMatchObject({ phase: 'conflict', canSave: false, canKeepLocal: !collision });
              expect(s.transport.send).toHaveBeenCalledTimes(2);
              if (keepMyWords) await draft.keepLocal(undefined, shown.checkpoint);
              else await draft.acceptRemote(undefined, shown.checkpoint);
              if (several || keepMyWords) {
                expect(draft.getState().checkpoint.draft?.scratch).toEqual(expected);
                await draft.save();
                await s.engine.retry();
              }
            } else {
              expect(draft.getState().checkpoint.draft?.scratch).toEqual(expected);
              await draft.save();
              await s.engine.retry();
            }
          }
        }
        expect(s.server.get(key)?.value?.scratch).toEqual(expected);
        expect(s.server.get(key)?.value).toMatchObject({
          title: 'Newer sermon title', preparation: { exegeticalPlan: [later] }, outline: outlineAtRecovery,
        });
        expect(s.transport.send).toHaveBeenCalledTimes(alreadyDelivered || (collision && !several) ? 2 : 3);
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      } finally { s.engine.dispose(); }
    },
  );

  it.each(['while-queued', 'after-refusal', 'same-field', 'mixed-refusal'] as const)(
    'isolates the thought form from the earlier point Save (%s)', async timing => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'thought-form-after-point' };
      const key = keyOf('owner', ref);
      const first = { id: 'point', title: '', children: [] };
      const later = { ...first, title: 'Full latest words of the point' };
      const thought = { id: 'added', date: '2026-11-09T00:00:00.000Z', text: 'New thought for the conclusion', tags: [] };
      const existing = { id: 'existing', date: thought.date, text: 'Existing thought', tags: [] };
      const structure = { introduction: [], main: [existing.id], conclusion: [], ambiguous: [] };
      const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 3:16',
        preparation: { exegeticalPlan: [] }, thoughts: [existing], structure, thoughtsBySection: structure };
      const original: ResourceSnapshot = { ...initial(), resource: ref, value };
      const latest: ResourceSnapshot = { ...original, metadata: { ...original.metadata!, revision: 2, operationId: 'desktop' },
        value: { ...value, title: 'Newer sermon title' } };
      const editorId = editorIdentity('phone', ref, 'sermon', 'first');
      const independent = timing === 'after-refusal' || timing === 'while-queued';
      s.server.set(key, original);
      s.cache.set(key, original);
      try {
        const editor = await s.engine.openEditor(ref, editorId);
        await editor.edit({ ...value, preparation: { exegeticalPlan: [first] },
          ...(timing === 'mixed-refusal' && { thoughts: [{ ...existing, text: 'Mixed private edit' }] }) });
        await editor.save();
        const [earlier] = await s.commits.list('owner');
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementation(async command => command.operationId === earlier.id
          ? { kind: 'refused', operationId: command.operationId, code: 'decision-changed' } : send(command));
        s.server.set(key, latest);
        if (timing !== 'while-queued') {
          s.engine.setOnline(true);
          await s.engine.retry();
          expect((await s.commits.list('owner'))[0]).toMatchObject({ id: earlier.id, state: 'refused' });
        }
        const form = timing === 'same-field' ? editor.form('point-field', [['preparation', 'exegeticalPlan']])
          : editor.form('thought-create:' + thought.id, [['thoughts'], ['structure'], ['thoughtsBySection']]);
        await form.begin();
        await form.update(current => timing === 'same-field' ? { ...current, preparation: { exegeticalPlan: [later] } }
          : addSermonThought(current as unknown as Sermon, thought, 'conclusion') as unknown as DocumentData);
        const editorState = editor.getState();
        const parent = describeSync(editorState, editor.getObservation(), editor.getDelivery());
        if (timing !== 'while-queued') expect(parent.phase).toBe('refused');
        const formStatus = describeManualSync(form.getState(), editorState, parent, null);
        expect(formStatus?.canSave).toBe(independent);
        if (!independent) {
          await expect(form.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
          expect(form.getState()?.dirty).toBe(true);
          expect(s.transport.send).toHaveBeenCalledTimes(1);
          return;
        }
        await form.save();
        const creation = (await s.commits.list('owner')).find(command => command.id !== earlier.id);
        if (creation) expect(creation.predecessor).toBeNull();
        await editor.edit({ ...editor.getState().checkpoint.draft!, preparation: { exegeticalPlan: [later] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint, unreadableExegeticalProofs: [
          { nodeId: first.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true },
        ] } });
        editor.dispose();
        s.engine.setOnline(true);
        await s.engine.retry();
        expect(s.server.get(key)?.value?.thoughts).toMatchObject([thought, existing]);
        expect(s.server.get(key)?.value?.structure).toMatchObject({ conclusion: [thought.id], main: [existing.id] });
        const held = (await s.engine.listRecoverable(ref)).find(candidate => candidate.answer === 'refused')!;
        const point = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'point'), held.id);
        await point.acceptRemote(undefined, point.getState().checkpoint);
        const compared = point.getState().checkpoint;
        expect(compared.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        await point.keepLocal(undefined, compared);
        await point.save();
        await s.engine.retry();
        expect(s.server.get(key)?.value).toMatchObject({ title: 'Newer sermon title', thoughts: [thought, existing],
          preparation: { exegeticalPlan: [later] } });
        expect(s.transport.send).toHaveBeenCalledTimes(3);
        const calls = jest.mocked(s.transport.send).mock.calls.map(([command]) => command.kind === 'update' ? command.changes.map(change => change.path[0]) : []);
        expect(calls[1]).toEqual(expect.arrayContaining(['thoughts']));
        expect(calls[1]).not.toContain('preparation');
        expect(calls[2]).not.toContain('thoughts');
        expect(await s.engine.listRecoveryChoices(ref, true)).toEqual([]);
      } finally { s.engine.dispose(); }
    },
  );

  it.each(['calendar-add', 'calendar-clear', 'metadata-assign', 'metadata-reschedule'] as const)(
    'keeps a date form Save separate from a refused exegetical point Save (%s)', async mode => {
      const s = setup({ online: false, nativeChoice: true });
      const ref = { collection: 'sermons', id: 'date-form-and-point' };
      const key = keyOf('owner', ref);
      const church = { id: 'north', name: 'North Church' };
      const row = { id: 'planned', createdAt: '2026-11-08T00:00:00.000Z', status: 'planned',
        date: mode === 'metadata-assign' ? '' : '2026-12-14', church, notes: 'Opening note' } satisfies PreachDate;
      const other = { ...row, id: 'other', date: '2026-12-20', notes: 'Other note' } satisfies PreachDate;
      const newRow = { ...row, id: 'new-date', createdAt: '2026-11-09T00:00:00.000Z', date: '2026-12-18' } satisfies PreachDate;
      const point = { id: 'point', title: '', children: [] };
      const newest = { ...point, title: 'Newest local point title' };
      const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 3:16', church, isPreached: false,
        thoughts: [], preparation: { exegeticalPlan: [] }, preachDates: [{ ...row }, { ...other }] };
      const opening: ResourceSnapshot = { ...initial(), resource: ref, value };
      const latest = { ...opening, value: { ...value, preachDates: [{ ...row, notes: 'Latest calendar note' }, { ...other }] },
        metadata: { ...opening.metadata!, revision: 2, operationId: 'desktop-note' } };
      const time = { earliestMs: 3000, latestMs: 3010 };
      const editorId = editorIdentity('phone', ref, 'sermon', 'opening');
      s.server.set(key, opening);
      s.cache.set(key, opening);

      try {
        const editor = await s.engine.openEditor(ref, editorId);
        await editor.edit({ ...value, preparation: { exegeticalPlan: [point] } });
        await editor.save();
        const pointId = (await s.commits.list('owner'))[0].id;
        if (mode === 'calendar-add') {
          const form = editor.form('preach-date:add:new', PREACH_DATE_SELECTION);
          await form.begin();
          await form.update(current => preparePreachDate(current, { kind: 'add' }, newRow));
          await form.save();
        } else if (mode === 'calendar-clear') {
          const form = editor.form('preach-date:edit:planned', PREACH_DATE_SELECTION);
          await form.begin();
          await form.update(current => patchPreachDate(current, row.id, { date: '' }));
          await form.save(undefined, { rowId: row.id, time });
        } else {
          const form = editor.form('sermon-metadata', SERMON_METADATA_SELECTION);
          await form.begin();
          await form.update(current => sermonMetadataPatch(current, { plannedDate: newRow.date }, row.id, newRow.createdAt, 'Unspecified', row));
          await form.save(undefined, { documentMetadata: { time, dateAction: { rowId: row.id, time, after: newRow.date } } });
        }
        const formRequest = (await s.commits.list('owner')).find(request => request.id !== pointId);
        expect(formRequest).toMatchObject({ predecessor: null, value: { preparation: value.preparation } });
        const proposed: string = mode === 'calendar-clear' ? '' : newRow.date;
        if (mode !== 'calendar-add') expect(formRequest?.preachDateAction).toMatchObject({
          rowId: row.id, before: row.date, after: proposed, time, observedRevision: 1,
        });
        await editor.edit({ ...editor.getState().checkpoint.draft!, preparation: { exegeticalPlan: [newest] } });
        const record = (await s.checkpoints.read('owner', editorId))!;
        await s.checkpoints.put({ ...record, checkpoint: { ...record.checkpoint,
          unreadableExegeticalProofs: [{ nodeId: point.id, kind: 'title', generation: 'generation', ancestors: [], pendingAddition: true }] } });
        editor.dispose();
        s.server.set(key, latest);
        const send = jest.mocked(s.transport.send).getMockImplementation()!;
        jest.mocked(s.transport.send).mockImplementation(async command => command.operationId === pointId
          ? { kind: 'refused', operationId: command.operationId, code: 'decision-changed' } : send(command));
        s.engine.setOnline(true);
        await s.engine.retry();

        const savedDates = mode === 'calendar-add'
          ? [{ ...row, notes: 'Latest calendar note' }, other, newRow]
          : [{ ...row, notes: 'Latest calendar note', date: proposed }, other];
        expect(s.server.get(key)?.value).toMatchObject({ preparation: value.preparation, preachDates: savedDates });
        const sources = await s.engine.listRecoverable(ref);
        const source = sources.find(candidate => candidate.answer === 'refused');
        expect(source).toBeDefined();
        const recovered = await s.engine.recoverEditor(ref, editorIdentity('phone', ref, 'sermon', 'reopened'), source!.id);
        const refused = recovered.getState().checkpoint;
        await recovered.acceptRemote(undefined, refused);
        const comparison = recovered.getState().checkpoint;
        expect(comparison.conflicts.map(({ path }) => path)).toEqual([['preparation', 'exegeticalPlan', 'id:point']]);
        await recovered.keepLocal(undefined, comparison);
        await recovered.save();
        await s.engine.retry();
        expect(s.server.get(key)?.value).toMatchObject({ preparation: { exegeticalPlan: [newest] }, preachDates: savedDates });
        expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.kind === 'update' && command.changes.map(({ path }) => path[0])))
          .toEqual([['preparation'], ['preachDates'], ['preparation']]);
      } finally { s.engine.dispose(); }
    },
  );

  it('keeps local conflict fields on explicit choice without sending until save is requested', async () => {
    const s = setup({ online: false, nativeChoice: true }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' }); await editor.save();
    s.server.set(keyOf('owner', resource), { ...initial(2, 'theirs'), value: { ...initial(2, 'theirs').value, title: 'Remote title' } });
    s.engine.setOnline(true); await s.engine.retry();
    expect(editor.getDelivery()[0].state).toBe('conflict');
    await editor.keepLocal();
    expect(editor.getDelivery()).toEqual([]); expect(s.engine.getPending()).toEqual([]);
    expect(editor.getState().checkpoint).toMatchObject({ draft: { content: 'mine', title: 'Remote title' }, dirty: true });
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    await editor.save(); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value).toMatchObject({ content: 'mine', title: 'Remote title' });
    s.engine.dispose();
  });

  it('clears pending state at account boundaries and hydrates persisted work without sending offline', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'owned' }); await editor.save();
    const snapshots: JournalEntry[][] = [];
    s.engine.subscribePending(() => snapshots.push(s.engine.getPending()));
    s.engine.setOwner('other');
    expect(s.engine.getPending()).toEqual([]); expect(snapshots[snapshots.length - 1]).toEqual([]);
    await drainMicrotasks(); expect(s.engine.getPending()).toEqual([]);
    s.engine.setOwner('owner'); await drainMicrotasks();
    expect(s.engine.getPending()).toMatchObject([{ state: 'queued', command: { owner: 'owner' } }]);
    expect(s.transport.send).not.toHaveBeenCalled();
    s.engine.dispose(); expect(s.engine.getPending()).toEqual([]);
  });

  it('does not let late initial journal hydration overwrite a newer publication', async () => {
    const s = setup({ online: false });
    s.engine.setOwner(null);
    const reading = deferred<JournalEntry[]>();
    jest.spyOn(s.runtime, 'list').mockReturnValueOnce(reading.promise);
    s.engine.setOwner('owner');
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'queued' }); await editor.save();
    reading.resolve([]); await drainMicrotasks();
    expect(s.engine.getPending()).toHaveLength(1);
    s.engine.dispose();
  });

  it('does not expose a late journal hydration belonging to the previous owner', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'queued' }); await editor.save();
    const old = s.engine.getPending();
    s.engine.setOwner(null);
    const reading = deferred<JournalEntry[]>(); jest.spyOn(s.runtime, 'list').mockReturnValueOnce(reading.promise);
    s.engine.setOwner('owner'); s.engine.setOwner('other');
    reading.resolve(old); await drainMicrotasks();
    expect(s.engine.getPending()).toEqual([]);
    s.engine.dispose();
  });

  it('refreshes only the actively observed resource after ACK and does not create a polling loop', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const refresh = jest.spyOn(s.observer, 'refresh');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'saved' }); await editor.save();
    s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledWith(resource);
    await s.engine.retry(); await drainMicrotasks(); expect(refresh).toHaveBeenCalledTimes(1);
    s.engine.setOnline(false);
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'later' }); await editor.save();
    editor.dispose(); s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1);
    s.engine.dispose();
  });

  it('avoids an extra ACK read when the listener has already proved the accepted revision', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementation(async command => {
      const result = await send(command);
      if (result.kind === 'acknowledged') s.next(result.snapshot);
      return result;
    });
    const refresh = jest.spyOn(s.observer, 'refresh');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'saved' }); await editor.save();
    s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect(editor.getObservation().readiness).toBe('server');
    expect(refresh).not.toHaveBeenCalled();
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('recovers offline from its durable checkpoint when the separate snapshot cache is unavailable', async () => {
    const s = setup({ online: false });
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'recover me' });
    editor.dispose(); await drainMicrotasks(); s.cache.clear();
    const recovered = await s.engine.openEditor(resource, 'tab');
    expect(recovered.getState().checkpoint).toMatchObject({ draft: { content: 'recover me' }, dirty: true });
    expect(s.transport.read).not.toHaveBeenCalled();
    // Said with the document it concerns (BUG-20261003-background-failure-without-address).
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'The document is not available in the local cache' }), resource);
    s.engine.dispose();
  });

  it('does not invent an empty baseline when an offline editor has neither cache nor checkpoint', async () => {
    const s = setup({ online: false, cached: false });
    // Named, so a screen reads it again once the server can be asked (BUG-20261006-hidden-tab-document-read-not-retried).
    await expect(s.engine.openEditor(resource, 'tab')).rejects.toMatchObject({ message: expect.stringContaining('local cache'), code: 'needs-connection' });
    expect(s.source.listen).not.toHaveBeenCalled();
    s.engine.dispose();
  });


  it.each(['visibility', 'network'] as const)('preserves the pause when a document read fails after %s already returned', async interruption => {
    const s = setup({ cached: false });
    const read = deferred<ResourceSnapshot>();
    const failure = Object.assign(new Error('The server could not be reached'), { code: 'unavailable' });
    jest.mocked(s.transport.read).mockReturnValueOnce(read.promise);
    const opening = s.engine.openEditor(resource, 'returning').catch(error => error);
    await drainMicrotasks();
    expect(s.transport.read).toHaveBeenCalledTimes(1);
    const toggle = interruption === 'visibility' ? s.engine.setVisible.bind(s.engine) : s.engine.setOnline.bind(s.engine);
    toggle(false);
    toggle(true);
    read.reject(failure);
    const paused = await opening;
    expect(paused).toBeInstanceOf(PausedReadFailure);
    expect(paused.cause).toBe(failure);
    const reopened = await s.engine.openEditor(resource, 'returning');
    expect(reopened.getState().checkpoint.draft?.content).toBe('base');
    expect(s.transport.send).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it.each([
    { code: 'permission-denied', hiddenThenReturned: true },
    { code: 'unavailable', hiddenThenReturned: false },
  ])('keeps a $code answer distinct from a paused opening (tab returned: $hiddenThenReturned)', async ({ code, hiddenThenReturned }) => {
    const s = setup({ cached: false });
    const read = deferred<ResourceSnapshot>();
    const failure = Object.assign(new Error('The read did not succeed'), { code });
    jest.mocked(s.transport.read).mockReturnValueOnce(read.promise);
    const opening = s.engine.openEditor(resource, 'returning').catch(error => error);
    await drainMicrotasks();
    expect(s.transport.read).toHaveBeenCalledTimes(1);
    if (hiddenThenReturned) { s.engine.setVisible(false); s.engine.setVisible(true); }
    read.reject(failure);
    expect(await opening).toBe(failure);
    expect(s.transport.read).toHaveBeenCalledTimes(1);
    s.engine.dispose();
  });

  it('calls a waiting screen once when the tab can ask the server, never while it cannot, and not after it stops waiting', async () => {
    const s = setup({ online: false });
    const waiting = jest.fn(), stopped = jest.fn();
    s.engine.onceReachable(waiting); const stop = s.engine.onceReachable(stopped); stop();
    s.engine.setVisible(false); s.engine.setOnline(true); await drainMicrotasks();
    expect(waiting).not.toHaveBeenCalled();
    s.engine.setVisible(true); s.engine.setOnline(false); s.engine.setOnline(true); await drainMicrotasks();
    expect(waiting).toHaveBeenCalledTimes(1); expect(stopped).not.toHaveBeenCalled();
    const now = jest.fn(); s.engine.onceReachable(now); await drainMicrotasks();
    expect(now).toHaveBeenCalledTimes(1);
    // Reachable when asked, gone before the call: it waits for the next time instead of firing late.
    const late = jest.fn(); s.engine.onceReachable(late); s.engine.setOnline(false); await drainMicrotasks();
    expect(late).not.toHaveBeenCalled();
    s.engine.setOnline(true); await drainMicrotasks();
    expect(late).toHaveBeenCalledTimes(1);
    const disposed = jest.fn(); s.engine.onceReachable(disposed); s.engine.dispose(); await drainMicrotasks();
    expect(disposed).not.toHaveBeenCalled();
  });
  it('saves through the controller and real runtime, then caches only its accepted projection', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    const listener = jest.fn(); const stop = editor.subscribe(listener);
    editor.subscribe(() => { throw new Error('Rendering failed'); });
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'saved work' });
    expect(s.cache.get(keyOf('owner', resource))?.value?.content).toBe('base');
    await editor.save(); await s.engine.retry();
    expect(editor.getState()).toMatchObject({ durable: true, result: { kind: 'acknowledged' }, checkpoint: { dirty: false } });
    expect(s.cache.get(keyOf('owner', resource))?.value?.content).toBe('saved work');
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled(); stop(); s.engine.dispose();
  });

  it('allows independent editors to share observation while keeping separate local drafts', async () => {
    const s = setup({ online: false });
    const first = await s.engine.openEditor(resource, 'one');
    const second = await s.engine.openEditor(resource, 'two');
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    await first.edit({ ...first.getState().checkpoint.draft, content: 'first local' });
    expect(second.getState().checkpoint.draft?.content).toBe('base');
    first.dispose(); first.dispose(); expect(s.callbacks[0].stop).not.toHaveBeenCalled();
    second.dispose(); expect(s.callbacks[0].stop).toHaveBeenCalledTimes(1);
    s.engine.dispose();
  });

  it('rejects duplicate active or concurrently opening editor identities', async () => {
    const s = setup(); const first = s.engine.openEditor(resource, 'same');
    await expect(s.engine.openEditor(resource, 'same')).rejects.toThrow('already open');
    const editor = await first;
    await expect(s.engine.createEditor({ ...resource, id: 'another' }, 'same')).rejects.toThrow('already open');
    editor.dispose(); expect(await s.engine.openEditor(resource, 'same')).toBeDefined();
    s.engine.dispose();
  });

  it('immediately cancels a pending read and releases its editor identity for another resource', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const cancellation = new AbortController();
    const old = s.engine.openEditor(resource, 'tab', { signal: cancellation.signal });
    await drainMicrotasks(); cancellation.abort();
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const other = { ...resource, id: 'other' };
    s.cache.set(keyOf('owner', other), { ...initial(), resource: other });
    const current = await s.engine.openEditor(other, 'tab');
    response.resolve(initial()); await drainMicrotasks();
    expect(current.getState().checkpoint.confirmed.resource).toEqual(other);
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    await expect(s.engine.openEditor(other, 'tab')).rejects.toThrow('already open');
    current.dispose(); s.engine.dispose();
  });

  it('allows a cancelled identity to reopen the same resource while sharing its pending read', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const cancellation = new AbortController();
    const old = s.engine.openEditor(resource, 'tab', { signal: cancellation.signal });
    await drainMicrotasks(); cancellation.abort();
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const replacement = s.engine.openEditor(resource, 'tab');
    response.resolve(initial());
    const current = await replacement; await drainMicrotasks();
    expect(s.transport.read).toHaveBeenCalledTimes(1);
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    expect(current.getState().checkpoint.confirmed).toEqual(initial());
    s.engine.dispose();
  });

  it('does not attach a controller after cancellation during checkpoint recovery', async () => {
    const s = setup(); const reading = deferred<EditorRecord | undefined>();
    jest.mocked(s.checkpoints.read).mockReturnValueOnce(reading.promise);
    const cancellation = new AbortController();
    const opening = s.engine.openEditor(resource, 'tab', { signal: cancellation.signal });
    await drainMicrotasks(); cancellation.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    const current = await s.engine.openEditor(resource, 'tab');
    reading.resolve(undefined); await drainMicrotasks();
    expect(current.getState().checkpoint.confirmed).toEqual(initial());
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    expect(s.callbacks[0].stop).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('rejects an already aborted create and removes the abort listener after successful open', async () => {
    const s = setup({ online: false }); const cancelled = new AbortController(); cancelled.abort();
    await expect(s.engine.createEditor(resource, 'new', { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.checkpoints.read).not.toHaveBeenCalled();
    const active = new AbortController();
    const remove = jest.spyOn(active.signal, 'removeEventListener');
    const editor = await s.engine.createEditor(resource, 'new', { signal: active.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    active.abort(); expect(editor.getState().checkpoint.confirmed).toEqual(absent());
    editor.dispose(); s.engine.dispose();
  });

  it('applies remote observations through the controller and preserves dirty drafts as candidates', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    s.next(initial(2, 'remote')); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft?.content).toBe('remote');
    expect(editor.getObservation()).toMatchObject({ readiness: 'server', snapshot: initial(2, 'remote') });
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' });
    s.next(initial(3, 'next remote')); await drainMicrotasks();
    expect(editor.getState().checkpoint).toMatchObject({ draft: { content: 'mine' }, remoteCandidate: { value: { content: 'next remote' } } });
    expect((await s.engine.read(resource)).value?.content).toBe('next remote');
    await editor.acceptRemote();
    expect(editor.getState().checkpoint.draft?.content).toBe('next remote');
    s.engine.dispose();
  });

  it('reconciles the opening cache before a synchronous newer legacy source event', async () => {
    const s = setup();
    const cached = { ...initial(), metadata: null, value: { ...initial().value, rev: { note: 1 } } };
    const remote = { ...cached, value: { ...cached.value, content: 'latest', rev: { note: 2 } } };
    s.cache.set(keyOf('owner', resource), cached);
    s.source.listen.mockImplementationOnce((_owner, _resource, next) => {
      next({ snapshot: remote, source: 'server' }); return jest.fn();
    });
    const editor = await s.engine.openEditor(resource, 'tab'); await drainMicrotasks();
    expect(editor.getState().checkpoint.confirmed).toEqual(remote);
    s.engine.dispose();
  });

  it('keeps a restored legacy checkpoint that is newer than the separate snapshot cache', async () => {
    const s = setup({ online: false });
    const latest = { ...initial(), metadata: null, value: { ...initial().value, content: 'latest', rev: { note: 2 } } };
    // An earlier version kept a checkpoint even for a document only read; it may be newer than the cache.
    const legacy: EditorRecord = { owner: 'owner', editorId: 'tab', checkpoint: new DataSession(latest).checkpoint(), prepared: null, unfinalized: [], completedCommits: [] };
    s.records.set(JSON.stringify(['owner', 'tab']), legacy);
    s.cache.set(keyOf('owner', resource), { ...latest, value: { ...latest.value, content: 'stale', rev: { note: 1 } } });
    const restored = await s.engine.openEditor(resource, 'tab');
    expect(restored.getState().checkpoint.confirmed).toEqual(latest);
    s.engine.dispose();
  });

  it('propagates remote deletion without turning cache absence into a deletion', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    s.next(absent(), 'cache'); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft?.content).toBe('base');
    const deleted = { ...initial(2), value: null, metadata: { ...initial(2).metadata!, deleted: true } };
    s.next(deleted); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft).toBeNull();
    expect(await s.engine.read(resource)).toEqual(deleted);
    s.engine.dispose();
  });

  it('creates explicit absent intent offline and begins observation only after creation succeeds', async () => {
    const s = setup({ online: false }); const ref = { ...resource, id: 'domain-prefix-new' };
    const editor = await s.engine.createEditor(ref, 'new');
    expect(s.transport.read).not.toHaveBeenCalled(); expect(s.source.listen).not.toHaveBeenCalled();
    await editor.edit({ ...initial().value, content: 'created' }); await editor.save(); await drainMicrotasks();
    expect((await s.engine.listPending())[0].command.kind).toBe('create');
    expect(s.cache.has(keyOf('owner', ref))).toBe(false);
    s.engine.setOnline(true); await s.engine.retry();
    expect(editor.getState().checkpoint.dirty).toBe(false);
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    expect(s.server.get(keyOf('owner', ref))?.value?.content).toBe('created');
    s.engine.dispose();
  });

  it('does not let a create collision become an update of existing server data', async () => {
    const s = setup(); const editor = await s.engine.createEditor(resource, 'new');
    expect(s.source.listen).not.toHaveBeenCalled();
    await editor.edit({ ...initial().value, content: 'new copy' }); await editor.save(); await s.engine.retry();
    expect(s.transport.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create' }));
    expect(s.server.get(keyOf('owner', resource))).toEqual(initial());
    expect(editor.getState().checkpoint.draft?.content).toBe('new copy');
    expect(editor.getState().checkpoint.dirty).toBe(true);
    s.engine.dispose();
  });

  it('fences late reads after an account change without populating another owner cache', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const read = s.engine.read(resource); await drainMicrotasks();
    s.engine.setOwner('other'); response.resolve(initial());
    await expect(read).rejects.toThrow('Account changed');
    expect(s.cache.size).toBe(0); s.engine.dispose();
  });

  it('rejects an open completed after sign-out and releases its editor reservation', async () => {
    const s = setup(); const checkpoint = deferred<EditorRecord | undefined>();
    jest.mocked(s.checkpoints.read).mockReturnValueOnce(checkpoint.promise);
    const opening = s.engine.openEditor(resource, 'tab'); await drainMicrotasks();
    s.engine.setOwner(null); checkpoint.resolve(undefined);
    await expect(opening).rejects.toThrow();
    s.engine.setOwner('owner'); expect(await s.engine.openEditor(resource, 'tab')).toBeDefined();
    s.engine.dispose();
  });

  it('disposes old editors on account changes and ignores their late subscription events', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    const listener = jest.fn(); editor.subscribe(listener);
    s.engine.setOwner('other'); s.next(initial(50, 'late'));
    await drainMicrotasks(); expect(listener).not.toHaveBeenCalled();
    expect(() => editor.getState()).toThrow('Account changed');
    expect(() => editor.edit({ content: 'wrong' })).toThrow('Account changed');
    expect(() => editor.subscribe(jest.fn())).toThrow('Account changed');
    await expect(editor.save()).rejects.toThrow('Account changed');
    await expect(editor.acceptRemote()).rejects.toThrow('Account changed');
    await expect(editor.keepLocal()).rejects.toThrow('Account changed');
    editor.dispose(); s.engine.dispose();
  });

  // A hidden page does not READ (the read budget), but its own edits still leave: the phone whose
  // screen went dark must not hold the last words from the computer (BUG-20261006-hidden-tab-holds-last-edit).
  it('delivers a save made while hidden, and still does not ask the server to read', async () => {
    const s = setup(); s.engine.setVisible(false); s.engine.setVisible(false);
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'hidden delivered' }); await editor.save();
    await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('hidden delivered');
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    await expect(s.engine.peekRemote(resource)).rejects.toThrow('The server cannot be asked right now');
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('delivers what waited offline when the network returns while the page is still hidden', async () => {
    const s = setup(); s.engine.setVisible(false); s.engine.setOnline(false);
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'back in range' }); await editor.save();
    await s.engine.retry(); expect(s.transport.send).not.toHaveBeenCalled();
    // The network's return is the trigger; nothing else asks for a retry.
    s.engine.setOnline(true); for (let i = 0; i < 10; i += 1) await drainMicrotasks();
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('back in range');
    s.engine.dispose();
  });

  it('does not broadcast a cancelled observation from a closed editor to the next form', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'old');
    await drainMicrotasks(); s.onError.mockClear();
    s.next(initial(2, 'remote'));
    editor.close();
    await drainMicrotasks();
    const next = await s.engine.openEditor(resource, 'next'); await drainMicrotasks();
    expect(next.getState().durable).toBe(true);
    expect(s.onError).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  /** BUG-20261003-background-failure-without-address: a retry gathers it, still about the same document. */
  it('keeps the document of a snapshot write that fails under a retry', async () => {
    const s = setup(); s.cache.clear();
    const disk = deferred<void>();
    jest.mocked(s.snapshots.put).mockReturnValueOnce(disk.promise);
    const reading = s.engine.read(resource).then(() => null, (failure: unknown) => failure);
    await drainMicrotasks();
    // The write is still pending when the retry starts, and fails under it.
    const retried = s.engine.retry().then(() => null, (failure: unknown) => failure);
    await drainMicrotasks();
    disk.reject(new Error('Disk full')); await drainMicrotasks();
    expect(await reading).toEqual(new Error('Disk full'));
    const failure = await retried;
    expect(failure).toBeInstanceOf(AddressedFailures);
    expect((failure as AddressedFailures).failures).toEqual([{ error: new Error('Disk full'), about: resource }]);
    // A person whose Retry failed reads the same words as before.
    expect((failure as Error).message).toBe('Disk full');
    s.engine.dispose();
  });

  it('writes no checkpoint while a document is only opened and read', async () => {
    // BUG-20261020-released-page-back-says-local-failure: each write is a transaction Safari can freeze
    // mid-flight when the page is left; reading must leave nothing in flight.
    const s = setup(); const editor = await s.engine.openEditor(resource, 'reader');
    await drainMicrotasks();
    s.next(initial(2, 'remote')); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft?.content).toBe('remote');
    expect(s.checkpoints.put).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('still reports an actual observation persistence failure after editor closure', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'old');
    await drainMicrotasks();
    // Only a document with something to keep writes on observation.
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' }); await drainMicrotasks();
    s.onError.mockClear();
    const disk = deferred<void>();
    jest.mocked(s.checkpoints.put).mockReturnValueOnce(disk.promise);
    s.next(initial(2, 'remote')); await drainMicrotasks();
    editor.close(); disk.reject(new Error('Disk full')); await drainMicrotasks();
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Disk full' }), resource);
    s.engine.dispose();
  });

  it('reports automatic failures and keeps failed persistence from becoming a send', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    await drainMicrotasks(); jest.mocked(s.checkpoints.put).mockRejectedValueOnce(new Error('Disk full'));
    await expect(editor.edit({ ...editor.getState().checkpoint.draft, content: 'unsafe' })).rejects.toThrow('Disk full');
    expect(s.transport.send).not.toHaveBeenCalled();
    expect(editor.getState().durable).toBe(false);
    jest.spyOn(s.runtime, 'drain').mockRejectedValueOnce(new Error('Journal unavailable'));
    s.engine.setOnline(false); s.engine.setOnline(true); await drainMicrotasks();
    // The whole delivery queue, about no document in particular: every waiting screen may be told.
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Journal unavailable' }));
    s.engine.dispose();
  });

  it('does not downgrade a cache that becomes newer while an HTTP request is in flight', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const reading = s.engine.read(resource); await drainMicrotasks();
    s.cache.set(keyOf('owner', resource), initial(5, 'newest'));
    response.resolve(initial(2, 'old'));
    expect(await reading).toEqual(initial(5, 'newest'));
    expect(s.cache.get(keyOf('owner', resource))).toEqual(initial(5, 'newest'));
    s.engine.dispose();
  });

  it('validates resource boundaries and isolates bad cache or server identities', async () => {
    const s = setup();
    expect(() => s.engine.read({ collection: 'secret', id: 'id' })).toThrow('Unregistered');
    expect(() => s.engine.read({ ...resource, id: '../wrong' })).toThrow('Invalid resource');
    expect(() => s.engine.read({ collection: 'users', id: 'other' })).toThrow('Owner identity');
    await expect(s.engine.openEditor(resource, '')).rejects.toThrow('identity is required');
    s.cache.set(keyOf('owner', resource), { ...initial(), resource: { ...resource, id: 'wrong' } });
    await expect(s.engine.read(resource)).rejects.toThrow('Cached snapshot identity');
    s.cache.clear(); jest.mocked(s.transport.read).mockResolvedValueOnce({ ...initial(), resource: { ...resource, id: 'wrong' } });
    await expect(s.engine.read(resource)).rejects.toThrow('Server snapshot identity');
    s.engine.setOwner(null); expect(() => s.engine.read(resource)).toThrow('Authentication');
    s.engine.dispose(); s.engine.dispose();
    s.engine.setOwner('owner'); s.engine.setVisible(false); s.engine.setOnline(false);
    expect(() => s.engine.read(resource)).toThrow('disposed');
  });

  it('keeps custom document-only engines explicit about unavailable collection APIs', () => {
    const s = setup();
    expect(() => s.engine.readCollection('studyNotes')).toThrow('not configured');
    expect(() => s.engine.watchCollection('studyNotes', jest.fn())).toThrow('not configured');
    expect(() => s.engine.refreshCollection('studyNotes')).toThrow('not configured');
    s.engine.dispose();
  });

  it('cleans up a constructed controller if observer attachment fails', async () => {
    const s = setup(); jest.spyOn(s.observer, 'watch').mockImplementationOnce(() => { throw new Error('Observer unavailable'); });
    await expect(s.engine.openEditor(resource, 'tab')).rejects.toThrow('Observer unavailable');
    const editor = await s.engine.openEditor(resource, 'tab');
    editor.dispose(); expect(() => editor.getObservation()).toThrow('no longer active');
    s.engine.dispose();
  });
});

describe('canReplaceSnapshot', () => {
  it('preserves generation, revision and deletion evidence and supports legacy upgrades', () => {
    expect(canReplaceSnapshot(undefined, initial())).toBe(true);
    expect(canReplaceSnapshot(initial(3), initial(2))).toBe(false);
    expect(canReplaceSnapshot(initial(), { ...initial(2), resource: { ...resource, id: 'other' } })).toBe(false);
    expect(canReplaceSnapshot(initial(), { ...initial(2), metadata: { ...initial(2).metadata!, generation: 'other' } })).toBe(false);
    expect(canReplaceSnapshot(initial(), { ...initial(), metadata: null })).toBe(false);
    const tombstone = { ...initial(2), value: null, metadata: { ...initial(2).metadata!, deleted: true } };
    expect(canReplaceSnapshot(tombstone, initial(3))).toBe(false);
    expect(canReplaceSnapshot(initial(), tombstone)).toBe(true);
    const legacy = { ...initial(), metadata: null, value: { rev: { note: 3 } } };
    expect(canReplaceSnapshot(legacy, { ...legacy, value: { rev: { note: 2 } } })).toBe(false);
    expect(canReplaceSnapshot(legacy, initial())).toBe(true);
    expect(canReplaceSnapshot(legacy, absent())).toBe(true);
    expect(canReplaceSnapshot(absent(), legacy)).toBe(true);
  });
});

it('refuses a managed proposal after its parent editor has closed', async () => {
  const s = setup(); s.engine.setOwner('owner');
  const editor = await s.engine.openEditor(resource, 'proposal-parent');
  const form = editor.form('title', [['title']]); await form.begin();
  const pending = deferred<NonNullable<ResourceSnapshot['value']>>();
  const proposing = form.propose(async () => pending.promise); await drainMicrotasks();
  await editor.close({ flush: false });
  pending.resolve({ ...initial().value!, title: 'Late result' });
  await expect(proposing).rejects.toThrow('parent editor changed');
  const recovery = await s.manualScopes.list('owner', resource);
  expect(recovery.every(row => row.record.stage[0]?.value !== 'Late result')).toBe(true);
  expect(s.transport.send).not.toHaveBeenCalled(); s.engine.dispose();
});

describe('durable share capability actions', () => {
  it('captures offline before delivery and restores the exact operation after provider replacement', async () => {
    const s = setup({ online: false });
    await s.engine.createShareLink('note', 'en');
    const [entry] = await s.runtime.list();
    expect(entry.command).toMatchObject({ relation: 'share-link-create', note: { id: 'note', generation: 'generation' }, authorLanguage: 'en' });
    expect(s.transport.send).not.toHaveBeenCalled();
    const operationId = entry.command.operationId;
    s.engine.dispose();
    const runtime = new DataEngineRuntime({ journal: s.journal, transport: s.transport });
    runtime.setOwner('owner');
    expect((await runtime.list())[0].command.operationId).toBe(operationId);
  });

  it('does not wait for an unanswered network request before returning local capture', async () => {
    const s = setup();
    const held = deferred<Awaited<ReturnType<typeof s.transport.send>>>();
    jest.mocked(s.transport.send).mockReturnValue(held.promise);
    await s.engine.createShareLink('note', 'ru');
    expect((await s.runtime.list())[0].command).toMatchObject({ relation: 'share-link-create' });
    await drainMicrotasks();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    const operationId = (await s.runtime.list())[0].command.operationId;
    s.engine.dispose();
    held.resolve({ kind: 'refused', operationId, code: 'simulated-refusal' });
    await drainMicrotasks();
  });

  it('never substitutes the current note access marker into delivery retry', async () => {
    const s = setup({ online: false });
    try {
      await s.engine.createShareLink('note', 'en');
      const old = (await s.runtime.list())[0];
      const snapshot = initial();
      const observed = { ...snapshot, metadata: { ...snapshot.metadata!, shareRevocation: 'revocation', revision: 2 } };
      s.cache.set(keyOf('owner', snapshot.resource), observed);
      await s.journal.put({ ...old, state: 'refused', result: { kind: 'refused', operationId: old.command.operationId, code: 'temporary-refusal' } });
      await s.engine.retryShareCapability(old.command.operationId);
      const retried = (await s.runtime.list())[0];
      expect(retried.command).toMatchObject({ note: { shareRevocation: null } });
      await s.journal.put({ ...retried, state: 'refused', result: {
        kind: 'refused', operationId: retried.command.operationId, code: 'share-link-review-required',
      } });
      await s.engine.retryShareCapability(retried.command.operationId);
      expect((await s.runtime.list()).map(entry => entry.command.operationId)).toEqual([retried.command.operationId]);
      await s.engine.createShareLink('note', 'en', observed, retried.command.operationId);
      const [next] = await s.runtime.list();
      expect(next.command).toMatchObject({ note: { shareRevocation: 'revocation' } });
      expect(next.command.operationId).not.toBe(retried.command.operationId);
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { s.engine.dispose(); }
  });

  it('retains an accepted command when its local snapshot projection fails, and repairs it before finalizing', async () => {
    const s = setup({ online: false });
    const ref = { collection: 'studyNoteShareLinks', id: 'existing-link' };
    const existing: ResourceSnapshot = { resource: ref, value: { ownerId: 'owner', noteId: 'note', token: 'old-token', createdAt: 'created', viewCount: 0 },
      metadata: { protocol: 1, generation: 'link-generation', revision: 1, deleted: false } };
    s.cache.set(keyOf('owner', ref), existing); s.server.set(keyOf('owner', ref), existing);
    let failProjection = true;
    jest.mocked(s.snapshots.put).mockImplementation(async (owner, snapshot) => {
      if (snapshot.resource.collection === 'studyNoteShareLinks' && snapshot.metadata?.deleted && failProjection) throw new Error('Local projection unavailable');
      s.cache.set(keyOf(owner, snapshot.resource), copy(snapshot));
    });
    jest.mocked(s.transport.send).mockImplementation(async command => {
      const before = s.server.get(keyOf(command.owner, command.resource)) ?? absent(command.resource);
      const plan = await planDataCommand(command, before, { get: async resource => s.server.get(keyOf('owner', resource)) ?? absent(resource), list: async () => [] });
      for (const snapshot of plan.writes) s.server.set(keyOf('owner', snapshot.resource), copy(snapshot));
      return plan.result;
    });
    await s.engine.revokeShareLink('existing-link');
    s.engine.setOnline(true);
    await s.engine.retry(); await drainMicrotasks();
    expect((await s.runtime.list())[0]).toMatchObject({ state: 'acknowledged', result: { snapshot: { value: null } } });
    await expect(s.engine.retry()).rejects.toThrow('Local projection unavailable');
    failProjection = false;
    await s.engine.retry(); await drainMicrotasks();
    expect(await s.runtime.list()).toEqual([]);
    expect(s.cache.get(keyOf('owner', ref))).toMatchObject({ value: null, metadata: { deleted: true } });
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    s.engine.dispose();
  });
});

it.each([false, true])('keeps a refused capability until its explicit replacement capture succeeds (capture failure: %s)', async failCapture => {
  const s = setup({ online: false });
  try {
    await s.engine.createShareLink('note', 'en');
    const old = (await s.runtime.list())[0];
    await s.journal.put({ ...old, state: 'refused', result: { kind: 'refused', operationId: old.command.operationId, code: 'temporary-refusal' } });
    const unknown = { ...old, command: { ...old.command, operationId: 'still-unanswered' }, state: 'unknown' as const };
    await s.journal.put(unknown);
    if (failCapture) {
      jest.mocked(s.journal.put).mockRejectedValueOnce(new Error('Local capture failed'));
      await expect(s.engine.retryShareCapability(old.command.operationId)).rejects.toThrow('Local capture failed');
      expect((await s.runtime.list()).find(entry => entry.command.operationId === old.command.operationId)?.state).toBe('refused');
    } else {
      await s.engine.retryShareCapability(old.command.operationId);
      const entries = await s.runtime.list();
      expect(entries.find(entry => entry.command.operationId === old.command.operationId)).toBeUndefined();
      expect(entries.some(entry => entry.command.operationId !== 'still-unanswered' && entry.state === 'queued')).toBe(true);
    }
    expect((await s.runtime.list()).find(entry => entry.command.operationId === 'still-unanswered')?.state).toBe('unknown');
    expect(s.transport.send).not.toHaveBeenCalled();
  } finally { s.engine.dispose(); }
});
