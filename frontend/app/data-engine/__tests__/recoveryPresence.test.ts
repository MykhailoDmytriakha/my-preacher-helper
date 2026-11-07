import { CollectionReader } from '../collections';
import { createMemoryCommitStore } from '../commits';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { selectRecoverableCheckpoints, recoveryCheckpointId } from '../recovery.client';
import type { MembershipScopeRecord } from '../membershipScope';
import type { MembershipScopeStore } from '../membershipScopes.client';
import type { ManualScopeStore, ManualStorageRecord, StoredManualScope } from '../manualScopes.client';
import type { CheckpointRecoveryStore, EditorRecord } from '../controller';
import type { EngineTransport, ResourceRef, ResourceSnapshot } from '../types';
import type { RecoveryPresenceKind, RecoveryPresencePort } from '../recoveryPresence';

const owner = 'presence-owner';
const noteRef: ResourceRef = { collection: 'studyNotes', id: 'presence-note' };
const sermonRef: ResourceRef = { collection: 'sermons', id: 'presence-sermon' };
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const key = (value: ResourceRef) => JSON.stringify([value.collection, value.id]);
const resourceSnapshot = (resource: ResourceRef): ResourceSnapshot => ({
  resource,
  value: resource.collection === 'studyNotes'
    ? { userId: owner, title: 'Study note', content: 'Saved words', tags: [], scriptureRefs: [], isDraft: false, createdAt: '2026-11-01', updatedAt: '2026-11-01' }
    : resource.collection === 'sermons'
      ? { userId: owner, title: 'Sermon', verse: 'John 3:16', date: '2026-11-01', createdAt: '2026-11-01', updatedAt: '2026-11-01', thoughts: [], outline: { introduction: [], main: [], conclusion: [] } }
      : { userId: owner, title: resource.id, theme: 'Presence', bookOrTopic: 'John', status: 'active', createdAt: '2026-11-01', updatedAt: '2026-11-01', items: [], sermonIds: [], seriesKind: 'sermon' },
  metadata: { protocol: 1, generation: `generation-${resource.id}`, revision: 1, deleted: false },
});

class MemoryRecoveryPresence implements RecoveryPresencePort {
  private readonly active = new Map<string, number>();
  private readonly answers = new Map<string, boolean | null | Error>();
  private heldGate: { promise: Promise<boolean | null>; resolve(value: boolean | null): void } | null = null;
  heldCalls = 0;
  private token(ownerId: string, kind: RecoveryPresenceKind, id: string) { return JSON.stringify([ownerId, kind, id]); }
  hold(ownerId: string, kind: RecoveryPresenceKind, id: string): () => void {
    const token = this.token(ownerId, kind, id);
    this.active.set(token, (this.active.get(token) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.active.get(token) ?? 0;
      if (count <= 1) this.active.delete(token); else this.active.set(token, count - 1);
    };
  }
  answer(ownerId: string, kind: RecoveryPresenceKind, id: string, value: boolean | null | Error) {
    this.answers.set(this.token(ownerId, kind, id), value);
  }
  deferNextHeld() {
    let resolve!: (value: boolean | null) => void;
    const promise = new Promise<boolean | null>(done => { resolve = done; });
    this.heldGate = { promise, resolve };
    return { resolve };
  }
  async held(ownerId: string, kind: RecoveryPresenceKind, id: string): Promise<boolean | null> {
    this.heldCalls += 1;
    if (this.heldGate) {
      const gate = this.heldGate;
      this.heldGate = null;
      return gate.promise;
    }
    const token = this.token(ownerId, kind, id), answer = this.answers.get(token);
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) return answer;
    return (this.active.get(token) ?? 0) > 0 ? true : null;
  }
}

function harness(presence?: RecoveryPresencePort) {
  const snapshots = new Map<string, ResourceSnapshot>([
    [key(noteRef), resourceSnapshot(noteRef)], [key(sermonRef), resourceSnapshot(sermonRef)],
    [key({ collection: 'series', id: 'series-a' }), { ...resourceSnapshot({ collection: 'series', id: 'series-a' }),
      value: { ...resourceSnapshot({ collection: 'series', id: 'series-a' }).value!, items: [{ id: 'sermon-presence-sermon', type: 'sermon', refId: 'presence-sermon', position: 1 }] } }],
    [key({ collection: 'series', id: 'series-b' }), resourceSnapshot({ collection: 'series', id: 'series-b' })],
  ]);
  const checkpointRows = new Map<string, EditorRecord>();
  const checkpoints: CheckpointRecoveryStore = {
    read: async (uid, id) => { const row = checkpointRows.get(recoveryCheckpointId(uid, id)); return row && clone(row); },
    put: async row => { checkpointRows.set(recoveryCheckpointId(row.owner, row.editorId), clone(row)); },
    create: async row => {
      const rowKey = recoveryCheckpointId(row.owner, row.editorId);
      if (checkpointRows.has(rowKey)) throw new Error('Recovery target already exists');
      checkpointRows.set(rowKey, clone(row));
    },
    listRecoverable: async (uid, ref) => selectRecoverableCheckpoints([...checkpointRows], uid, ref),
  };
  const manualRows = new Map<string, ManualStorageRecord>();
  const manualScopes: ManualScopeStore = {
    read: async (uid, id) => { const row = manualRows.get(JSON.stringify([uid, id])); return row && clone(row); },
    list: async (uid, ref) => [...manualRows.values()].filter((row): row is StoredManualScope => row.record !== null
      && row.owner === uid && (!ref || (row.record as { resource: ResourceRef }).resource.collection === ref.collection
        && (row.record as { resource: ResourceRef }).resource.id === ref.id)).map(clone),
    create: async row => { const rowKey = JSON.stringify([row.owner, row.scopeId]); if (manualRows.has(rowKey)) throw new Error('Manual scope already exists'); manualRows.set(rowKey, clone(row)); },
    put: async row => { manualRows.set(JSON.stringify([row.owner, row.scopeId]), clone(row)); },
    compact: async () => undefined,
  };
  const membershipRows = new Map<string, MembershipScopeRecord>();
  let persistGate: Promise<void> | null = null;
  const membershipScopes: MembershipScopeStore = {
    read: async (uid, id) => { const row = membershipRows.get(JSON.stringify([uid, id])); return row && clone(row); },
    list: async uid => [...membershipRows.values()].filter(row => row.owner === uid).map(clone),
    persist: async (record, expectedRevision) => {
      if (persistGate) { const wait = persistGate; persistGate = null; await wait; }
      const rowKey = JSON.stringify([record.owner, record.scopeId]), current = membershipRows.get(rowKey);
      if (expectedRevision === null ? Boolean(current) : !current || current.revision !== expectedRevision) throw new Error('Membership stage changed in another session');
      const saved = { ...clone(record), revision: (expectedRevision ?? -1) + 1 };
      membershipRows.set(rowKey, saved); return clone(saved);
    },
    compact: async () => undefined,
    readSaveReceipt: async () => null,
    completion: async () => null,
  };
  const commits = createMemoryCommitStore();
  const transport: EngineTransport & { list(owner: string, collection: string): Promise<{ snapshots: ResourceSnapshot[]; nextCursor: null; version: number; legacyOpen: false }>; changes(owner: string, collection: string): Promise<{ snapshots: ResourceSnapshot[]; cursor: number; version: number; hasMore: false }> } = {
    read: async (_uid, ref) => clone(snapshots.get(key(ref)) ?? { resource: ref, value: null, metadata: null }),
    send: async () => { throw new Error('This presence probe does not deliver commands'); },
    list: async (_uid, collection) => ({ snapshots: [...snapshots.values()].filter(row => row.resource.collection === collection).map(clone), nextCursor: null, version: 1, legacyOpen: false }),
    changes: async () => ({ snapshots: [], cursor: 0, version: 1, hasMore: false }),
  };
  const createEngine = () => {
    const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } });
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const snapshotStore = {
      read: async (_uid: string, ref: ResourceRef) => { const value = snapshots.get(key(ref)); return value && clone(value); },
      put: async (_uid: string, value: ResourceSnapshot) => { snapshots.set(key(value.resource), clone(value)); },
      list: async (_uid: string, collection: string) => [...snapshots.values()].filter(row => row.resource.collection === collection).map(clone),
    };
    const collections = new CollectionReader({ observer, snapshots: snapshotStore,
      transport: { list: transport.list, changes: transport.changes },
      cursors: { read: async () => ({ version: 1, initialized: true, listedWhileClosed: true, revision: 1 }), put: async (_uid, _collection, _expected, next) => ({ ...next, revision: 2 }) } });
    let operation = 0;
    const engine = new DataEngine({ runtime, observer, transport, snapshots: snapshotStore, collections, checkpoints, commits,
      manualScopes, membershipScopes, ...(presence ? { recoveryPresence: presence } : {}), operationId: () => `presence-operation-${++operation}` });
    engine.setOnline(false); engine.setOwner(owner);
    return engine;
  };
  return { createEngine, checkpoints, checkpointRows, manualScopes, manualRows, membershipScopes, membershipRows, snapshots,
    holdMembershipPersist: () => { let release!: () => void; persistGate = new Promise<void>(resolve => { release = resolve; }); return release; } };
}

const flush = async () => { for (let index = 0; index < 80; index += 1) await Promise.resolve(); };
const choiceIds = (records: Awaited<ReturnType<DataEngine['listRecoveryChoices']>>) => records.map(record => record.id);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const waitFor = async <T,>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
  for (let turn = 0; turn < 60; turn += 1) {
    const value = await read();
    if (ready(value)) return value;
    await Promise.resolve();
  }
  throw new Error('Presence probe did not reach its expected state');
};

describe('recovery presence filters choices without changing source records', () => {
  it('hides an active checkpoint in another engine, preserves raw discovery, and offers it after release', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const editor = await a.openEditor(noteRef, 'device-a');
      await editor.edit({ ...resourceSnapshot(noteRef).value!, content: 'Words kept on device A' });
      await flush();
      const sourceId = recoveryCheckpointId(owner, 'device-a');
      expect((await b.listRecoverable(noteRef)).map(row => row.id)).toContain(sourceId);
      expect(choiceIds(await b.listRecoveryChoices(noteRef))).not.toContain(sourceId);
      editor.close(); await flush();
      expect(choiceIds(await b.listRecoveryChoices(noteRef))).toContain(sourceId);
    } finally { a.dispose(); b.dispose(); }
  });

  it('keeps original and nested source aliases attached to a recovered checkpoint across close and reopen', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine(), c = h.createEngine(), d = h.createEngine();
    try {
      const original = await a.openEditor(noteRef, 'source-editor');
      await original.edit({ ...resourceSnapshot(noteRef).value!, content: 'Original source words' });
      original.close(); await flush();
      const originalId = recoveryCheckpointId(owner, 'source-editor');
      const fork = await b.recoverEditor(noteRef, 'fork-one', originalId);
      expect(fork.getState().checkpoint.draft?.content).toBe('Original source words');
      expect(choiceIds(await c.listRecoveryChoices(noteRef))).not.toContain(originalId);
      await fork.edit({ ...resourceSnapshot(noteRef).value!, content: 'Original source words plus later fork words' });
      fork.close(); await flush();
      const forkId = recoveryCheckpointId(owner, 'fork-one');
      const nested = await c.recoverEditor(noteRef, 'fork-two', forkId);
      expect(nested.getState().checkpoint.draft?.content).toBe('Original source words plus later fork words');
      expect(choiceIds(await d.listRecoveryChoices(noteRef))).not.toContain(originalId);
      expect(choiceIds(await d.listRecoveryChoices(noteRef))).not.toContain(forkId);
      expect((await h.checkpoints.read(owner, 'source-editor'))?.checkpoint.draft?.content).toBe('Original source words');
      nested.close(); await flush();
      const reopened = await a.recoverEditor(noteRef, 'fork-three', recoveryCheckpointId(owner, 'fork-two'));
      expect(reopened.getState().checkpoint.draft?.content).toBe('Original source words plus later fork words');
      expect(choiceIds(await d.listRecoveryChoices(noteRef))).not.toContain(originalId);
      expect(choiceIds(await d.listRecoveryChoices(noteRef))).not.toContain(forkId);
      expect((await h.checkpoints.read(owner, 'fork-three'))?.checkpoint.draft?.content).toBe('Original source words plus later fork words');
    } finally { a.dispose(); b.dispose(); c.dispose(); d.dispose(); }
  });

  it('hides an active manual scope from a second form and reoffers it after the source editor closes', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const firstParent = await a.openEditor(sermonRef, 'manual-parent-a');
      const first = firstParent.form('title', [['title']]);
      await first.begin(); await first.update(value => ({ ...value, title: 'Unsaved title from device A' }));
      const sourceId = JSON.stringify(['manual-parent-a', 'manual', 'title']);
      const raw = await h.manualScopes.list(owner, sermonRef);
      expect(raw.map(row => row.scopeId)).toContain(sourceId);
      const secondParent = await b.openEditor(sermonRef, 'manual-parent-b');
      const second = secondParent.form('title', [['title']]);
      expect((await second.listRecoverable()).map(row => row.scopeId)).not.toContain(sourceId);
      firstParent.close(); await flush();
      expect((await second.listRecoverable()).map(row => row.scopeId)).toContain(sourceId);
    } finally { a.dispose(); b.dispose(); }
  });

  it('keeps original and nested manual recovery sources hidden after reopening a recovered scope', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine(), c = h.createEngine(), d = h.createEngine();
    try {
      const sourceParent = await a.openEditor(sermonRef, 'manual-source-parent');
      const sourceForm = sourceParent.form('title', [['title']]);
      await sourceForm.begin(); await sourceForm.update(value => ({ ...value, title: 'Original manual words' }));
      const originalId = JSON.stringify(['manual-source-parent', 'manual', 'title']);
      sourceParent.close(); await flush();

      const firstForkParent = await b.openEditor(sermonRef, 'manual-first-fork');
      const firstFork = firstForkParent.form('title', [['title']]);
      expect((await firstFork.listRecoverable()).map(row => row.scopeId)).toContain(originalId);
      await firstFork.recover(originalId);
      expect(firstFork.getState()?.value.title).toBe('Original manual words');
      const forkId = [...h.manualRows.values()].find((row): row is StoredManualScope => row.record !== null
        && row.parentEditorId === 'manual-first-fork' && row.scopeId !== originalId)!.scopeId;
      firstForkParent.close(); await flush(); b.dispose();

      const secondForkParent = await c.openEditor(sermonRef, 'manual-second-fork');
      const secondFork = secondForkParent.form('title', [['title']]);
      expect((await secondFork.listRecoverable()).map(row => row.scopeId)).toContain(forkId);
      await secondFork.recover(forkId);
      expect(secondFork.getState()?.value.title).toBe('Original manual words');
      const observerParent = await d.openEditor(sermonRef, 'manual-observer');
      const observerForm = observerParent.form('title', [['title']]);
      const offers = (await observerForm.listRecoverable()).map(row => row.scopeId);
      expect(offers).not.toContain(originalId);
      expect(offers).not.toContain(forkId);
    } finally { a.dispose(); b.dispose(); c.dispose(); d.dispose(); }
  });

  it('filters membership choices while a stage is active without changing raw closedOnly results', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const stage = await a.beginMembership();
      await stage.update({ kind: 'assign', targetId: 'series-b', refs: [{ type: 'sermon', refId: 'presence-sermon' }] });
      const scopeId = stage.getState().record.scopeId;
      expect((await b.listMembershipRecovery()).map(row => row.scopeId)).toContain(scopeId);
      expect(await a.listMembershipRecovery({ closedOnly: true })).toEqual([]);
      expect((await b.listMembershipRecovery({ closedOnly: true })).map(row => row.scopeId)).toContain(scopeId);
      expect(await b.listMembershipRecoveryChoices()).not.toEqual(expect.arrayContaining([expect.objectContaining({ scopeId })]));
    } finally { a.dispose(); b.dispose(); }
  });

  it('rejects a stale live checkpoint recovery click without changing its source', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const source = await a.openEditor(noteRef, 'checkpoint-live-source');
      await source.edit({ ...resourceSnapshot(noteRef).value!, content: 'Live checkpoint source words' }); await flush();
      const sourceId = recoveryCheckpointId(owner, 'checkpoint-live-source');
      const before = await h.checkpoints.read(owner, 'checkpoint-live-source');
      expect(choiceIds(await b.listRecoveryChoices(noteRef))).not.toContain(sourceId);
      await expect(b.recoverEditor(noteRef, 'checkpoint-stale-target', sourceId)).rejects.toMatchObject({ code: 'draft-open' });
      expect(await h.checkpoints.read(owner, 'checkpoint-live-source')).toEqual(before);
      expect(await h.checkpoints.read(owner, 'checkpoint-stale-target')).toBeUndefined();
    } finally { a.dispose(); b.dispose(); }
  });

  it('rejects a stale live manual recovery click without changing its source', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const sourceParent = await a.openEditor(sermonRef, 'manual-live-parent');
      const sourceForm = sourceParent.form('title', [['title']]);
      await sourceForm.begin(); await sourceForm.update(value => ({ ...value, title: 'Live manual source words' }));
      const sourceId = JSON.stringify(['manual-live-parent', 'manual', 'title']);
      const before = await h.manualScopes.read(owner, sourceId);
      const targetParent = await b.openEditor(sermonRef, 'manual-stale-parent');
      const targetForm = targetParent.form('title', [['title']]);
      expect((await targetForm.listRecoverable()).map(row => row.scopeId)).not.toContain(sourceId);
      await expect(targetForm.recover(sourceId)).rejects.toMatchObject({ code: 'draft-open' });
      expect(await h.manualScopes.read(owner, sourceId)).toEqual(before);
      expect(h.manualRows.size).toBe(1);
    } finally { a.dispose(); b.dispose(); }
  });

  it('rejects a stale live membership recovery click without changing its source', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const stage = await a.beginMembership();
      await stage.update({ kind: 'assign', targetId: 'series-b', refs: [{ type: 'sermon', refId: 'presence-sermon' }] });
      const scopeId = stage.getState().record.scopeId;
      const before = await h.membershipScopes.read(owner, scopeId);
      expect(await b.listMembershipRecoveryChoices()).not.toEqual(expect.arrayContaining([expect.objectContaining({ scopeId })]));
      await expect(b.recoverMembership(scopeId)).rejects.toMatchObject({ code: 'draft-open' });
      expect(await h.membershipScopes.read(owner, scopeId)).toEqual(before);
      expect(h.membershipRows.size).toBe(1);
    } finally { a.dispose(); b.dispose(); }
  });

  it('releases a checkpoint source lease after recovery is aborted during its source read', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const source = await a.openEditor(noteRef, 'checkpoint-abort-source');
      await source.edit({ ...resourceSnapshot(noteRef).value!, content: 'Words survive aborted recovery' });
      source.close(); await flush();
      const sourceId = recoveryCheckpointId(owner, 'checkpoint-abort-source');
      const original = await h.checkpoints.read(owner, 'checkpoint-abort-source');
      const readGate = deferred<EditorRecord | undefined>(), readStarted = deferred<void>();
      const originalRead = h.checkpoints.read;
      h.checkpoints.read = async (uid, id) => {
        if (id === 'checkpoint-abort-source') { readStarted.resolve(); return readGate.promise; }
        return originalRead(uid, id);
      };
      const abort = new AbortController();
      const opening = b.recoverEditor(noteRef, 'checkpoint-abort-target', sourceId, { signal: abort.signal });
      await readStarted.promise; abort.abort();
      await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
      h.checkpoints.read = originalRead; readGate.resolve(original); await flush();
      expect(await h.checkpoints.read(owner, 'checkpoint-abort-source')).toEqual(original);
      expect(await h.checkpoints.read(owner, 'checkpoint-abort-target')).toBeUndefined();
      expect(choiceIds(await b.listRecoveryChoices(noteRef))).toContain(sourceId);
    } finally { a.dispose(); b.dispose(); }
  });

  it('holds the source lease until an aborted recovered checkpoint finishes its target initialization read', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine(), observer = h.createEngine();
    try {
      const source = await a.openEditor(noteRef, 'checkpoint-abort-after-fork-source');
      await source.edit({ ...resourceSnapshot(noteRef).value!, content: 'Source survives cancelled initialization' });
      source.close(); await flush();
      const sourceId = recoveryCheckpointId(owner, 'checkpoint-abort-after-fork-source');
      const original = await h.checkpoints.read(owner, 'checkpoint-abort-after-fork-source');
      expect(original?.checkpoint.draft?.content).toBe('Source survives cancelled initialization');

      const targetId = 'checkpoint-abort-after-fork-target';
      const targetCreated = deferred<void>(), targetReadStarted = deferred<void>(), targetReadGate = deferred<EditorRecord | undefined>();
      const originalCreate = h.checkpoints.create, originalRead = h.checkpoints.read;
      h.checkpoints.create = async row => { await originalCreate(row); if (row.editorId === targetId) targetCreated.resolve(undefined); };
      h.checkpoints.read = async (uid, id) => {
        if (id === targetId) { targetReadStarted.resolve(undefined); return targetReadGate.promise; }
        return originalRead(uid, id);
      };
      const abort = new AbortController();
      const opening = b.recoverEditor(noteRef, targetId, sourceId, { signal: abort.signal }).then(() => null, error => error as Error);
      let targetRecord: EditorRecord | undefined;
      let earlyResult: Error | null | 'pending' = 'pending';
      let sourceHiddenWhileTargetReadPending = false;
      try {
        await targetCreated.promise;
        targetRecord = await originalRead(owner, targetId);
        expect(targetRecord).toBeDefined();
        await targetReadStarted.promise;
        abort.abort();
        earlyResult = await Promise.race([opening, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 300))]);
        sourceHiddenWhileTargetReadPending = !choiceIds(await observer.listRecoveryChoices(noteRef)).includes(sourceId);
      } finally {
        h.checkpoints.create = originalCreate;
        h.checkpoints.read = originalRead;
        targetReadGate.resolve(targetRecord);
      }
      expect(earlyResult).toMatchObject({ name: 'AbortError' });
      expect(sourceHiddenWhileTargetReadPending).toBe(true);
      expect(await h.checkpoints.read(owner, 'checkpoint-abort-after-fork-source')).toEqual(original);
      await opening;
      const choicesAfterReadSettles = await waitFor(() => observer.listRecoveryChoices(noteRef), rows => rows.some(row => row.id === sourceId));
      expect(choicesAfterReadSettles.map(row => row.id)).toContain(sourceId);
      expect(await h.checkpoints.read(owner, targetId)).toBeDefined();
    } finally { a.dispose(); b.dispose(); observer.dispose(); }
  });

  it('keeps an unwritten latest checkpoint hidden until close-time repair is acknowledged locally', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), observer = h.createEngine();
    try {
      const sourceId = 'checkpoint-close-repair-source';
      const source = await a.openEditor(noteRef, sourceId);
      await source.edit({ ...resourceSnapshot(noteRef).value!, content: 'Durable old words' }); await flush();
      expect(source.getState()).toMatchObject({ durable: true, checkpoint: { draft: { content: 'Durable old words' } } });
      const sourceRecoveryId = recoveryCheckpointId(owner, sourceId);
      const originalPut = h.checkpoints.put, repairStarted = deferred<void>(), releaseRepair = deferred<void>();
      let rejectFirst = true;
      h.checkpoints.put = async row => {
        if (row.editorId === sourceId && rejectFirst) { rejectFirst = false; throw new Error('single checkpoint write failure'); }
        if (row.editorId === sourceId) { repairStarted.resolve(undefined); await releaseRepair.promise; }
        await originalPut(row);
      };
      const failure = await source.edit({ ...source.getState().checkpoint.draft!, content: 'Latest words after the failed write' }).then(() => null, error => error as Error);
      expect(failure).toMatchObject({ message: 'single checkpoint write failure' });
      expect(source.getState()).toMatchObject({ durable: false, checkpoint: { draft: { content: 'Latest words after the failed write' } } });
      source.close({ flush: false });
      let choicesWhileRepairPending: Awaited<ReturnType<DataEngine['listRecoveryChoices']>> = [];
      let diskBeforeRepair = await h.checkpoints.read(owner, sourceId);
      let repairWasReached = false;
      try {
        repairWasReached = await Promise.race([repairStarted.promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))]);
        if (repairWasReached) {
          diskBeforeRepair = await h.checkpoints.read(owner, sourceId);
          choicesWhileRepairPending = await observer.listRecoveryChoices(noteRef);
        }
      } finally {
        h.checkpoints.put = originalPut;
        releaseRepair.resolve(undefined);
      }
      expect(repairWasReached).toBe(true);
      expect(diskBeforeRepair?.checkpoint.draft?.content).toBe('Durable old words');
      expect(choicesWhileRepairPending.map(row => row.id)).not.toContain(sourceRecoveryId);
      const offeredAfterRepair = await waitFor(() => observer.listRecoveryChoices(noteRef), rows => rows.some(row => row.id === sourceRecoveryId));
      expect(offeredAfterRepair.find(row => row.id === sourceRecoveryId)?.record.checkpoint.draft?.content).toBe('Latest words after the failed write');
      expect((await h.checkpoints.read(owner, sourceId))?.checkpoint.draft?.content).toBe('Latest words after the failed write');
    } finally { a.dispose(); observer.dispose(); }
  });

  it('releases a manual source lease when target storage rejects recovery', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine(), c = h.createEngine();
    try {
      const sourceParent = await a.openEditor(sermonRef, 'manual-failure-parent');
      const sourceForm = sourceParent.form('title', [['title']]);
      await sourceForm.begin(); await sourceForm.update(value => ({ ...value, title: 'Words survive failed recovery' }));
      const sourceId = JSON.stringify(['manual-failure-parent', 'manual', 'title']);
      sourceParent.close(); await flush();
      const before = await h.manualScopes.read(owner, sourceId);
      const targetParent = await b.openEditor(sermonRef, 'manual-failure-target');
      const targetForm = targetParent.form('title', [['title']]);
      const originalCreate = h.manualScopes.create;
      h.manualScopes.create = async () => { throw new Error('manual recovery target refused'); };
      await expect(targetForm.recover(sourceId)).rejects.toThrow('manual recovery target refused');
      h.manualScopes.create = originalCreate;
      expect(await h.manualScopes.read(owner, sourceId)).toEqual(before);
      expect(h.manualRows.size).toBe(1);
      const observerParent = await c.openEditor(sermonRef, 'manual-failure-observer');
      const observerForm = observerParent.form('title', [['title']]);
      expect((await observerForm.listRecoverable()).map(row => row.scopeId)).toContain(sourceId);
    } finally { a.dispose(); b.dispose(); c.dispose(); }
  });

  it('keeps a manual source lease while target creation is pending after the target parent closes', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), sourceEngine = h.createEngine(), targetEngine = h.createEngine(), observerEngine = h.createEngine();
    try {
      const sourceParent = await sourceEngine.openEditor(sermonRef, 'manual-closing-source');
      const sourceForm = sourceParent.form('title', [['title']]);
      await sourceForm.begin(); await sourceForm.update(value => ({ ...value, title: 'Source remains while target opens' }));
      const sourceId = JSON.stringify(['manual-closing-source', 'manual', 'title']);
      sourceParent.close(); await flush();
      const sourceBefore = await h.manualScopes.read(owner, sourceId);
      expect(sourceBefore?.record?.stage[0]).toEqual({ exists: true, value: 'Source remains while target opens' });

      const targetParent = await targetEngine.openEditor(sermonRef, 'manual-closing-target');
      const targetForm = targetParent.form('title', [['title']]);
      expect((await targetForm.listRecoverable()).map(row => row.scopeId)).toContain(sourceId);
      const observerParent = await observerEngine.openEditor(sermonRef, 'manual-closing-observer');
      const observerForm = observerParent.form('title', [['title']]);
      const createStarted = deferred<void>(), releaseCreate = deferred<void>();
      const create = h.manualScopes.create;
      h.manualScopes.create = async row => { createStarted.resolve(undefined); await releaseCreate.promise; await create(row); };
      const recovery = targetForm.recover(sourceId);
      const recoveryResult = recovery.then(() => null, error => error as Error);
      const createWasReached = await Promise.race([createStarted.promise.then(() => true), recoveryResult.then(() => false)]);
      let pendingChoices: Awaited<ReturnType<typeof observerForm.listRecoverable>> = [];
      let sourceDuringPending: ManualStorageRecord | undefined;
      if (createWasReached) {
        targetParent.close(); await flush();
        pendingChoices = await observerForm.listRecoverable();
        sourceDuringPending = await h.manualScopes.read(owner, sourceId);
      }
      h.manualScopes.create = create;
      releaseCreate.resolve(undefined);
      const recoveryError = await recoveryResult;
      await flush();
      expect(createWasReached).toBe(true);
      expect(pendingChoices.map(row => row.scopeId)).not.toContain(sourceId);
      expect(sourceDuringPending).toEqual(sourceBefore);
      expect(recoveryError).toBeInstanceOf(Error);
      expect(recoveryError?.message).toMatch(/Manual (parent editor|form owner) changed/);
      expect(await h.manualScopes.read(owner, sourceId)).toEqual(sourceBefore);
      expect((await observerForm.listRecoverable()).map(row => row.scopeId)).toContain(sourceId);
    } finally { sourceEngine.dispose(); targetEngine.dispose(); observerEngine.dispose(); }
  });

  it('releases a membership source lease when the recovery store read fails', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine(), c = h.createEngine();
    try {
      const stage = await a.beginMembership();
      await stage.update({ kind: 'assign', targetId: 'series-b', refs: [{ type: 'sermon', refId: 'presence-sermon' }] });
      const scopeId = stage.getState().record.scopeId, before = await h.membershipScopes.read(owner, scopeId);
      a.releaseMembership(scopeId);
      await waitFor(() => b.listMembershipRecoveryChoices(), rows => rows.some(row => row.scopeId === scopeId));
      const originalRead = h.membershipScopes.read;
      h.membershipScopes.read = async () => { throw new Error('membership recovery read refused'); };
      await expect(b.recoverMembership(scopeId)).rejects.toThrow('membership recovery read refused');
      h.membershipScopes.read = originalRead;
      expect(await h.membershipScopes.read(owner, scopeId)).toEqual(before);
      expect((await c.listMembershipRecoveryChoices()).map(row => row.scopeId)).toContain(scopeId);
    } finally { a.dispose(); b.dispose(); c.dispose(); }
  });

  it('keeps a membership lease through delayed release settlement, then offers the settled stage', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const stage = await a.beginMembership();
      await stage.update({ kind: 'assign', targetId: 'series-b', refs: [{ type: 'sermon', refId: 'presence-sermon' }] });
      const scopeId = stage.getState().record.scopeId;
      const releasePersist = h.holdMembershipPersist();
      const update = stage.update({ kind: 'remove', refs: [{ type: 'sermon', refId: 'presence-sermon' }] });
      a.releaseMembership(scopeId);
      expect(await b.listMembershipRecoveryChoices()).not.toEqual(expect.arrayContaining([expect.objectContaining({ scopeId })]));
      releasePersist(); await update; await flush();
      const choices = await b.listMembershipRecoveryChoices();
      expect(choices.map(row => row.scopeId)).toContain(scopeId);
    } finally { a.dispose(); b.dispose(); }
  });

  it.each(['unknown', 'missing', 'rejected'] as const)('preserves a checkpoint candidate when presence is %s', async outcome => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const editor = await a.openEditor(noteRef, `source-${outcome}`);
      await editor.edit({ ...resourceSnapshot(noteRef).value!, content: `Retained words ${outcome}` });
      editor.close(); await flush();
      const id = recoveryCheckpointId(owner, `source-${outcome}`);
      if (outcome === 'rejected') presence.answer(owner, 'checkpoint', id, new Error('presence unavailable'));
      if (outcome === 'unknown') presence.answer(owner, 'checkpoint', id, null);
      expect(choiceIds(await b.listRecoveryChoices(noteRef))).toContain(id);
      expect((await h.checkpoints.read(owner, `source-${outcome}`))?.checkpoint.draft?.content).toBe(`Retained words ${outcome}`);
    } finally { a.dispose(); b.dispose(); }
  });

  it('preserves candidates when no optional presence port is configured', async () => {
    const h = harness(), a = h.createEngine(), b = h.createEngine();
    try {
      const editor = await a.openEditor(noteRef, 'source-without-port');
      await editor.edit({ ...resourceSnapshot(noteRef).value!, content: 'Words without a presence adapter' });
      editor.close(); await flush();
      expect(choiceIds(await b.listRecoveryChoices(noteRef))).toContain(recoveryCheckpointId(owner, 'source-without-port'));
    } finally { a.dispose(); b.dispose(); }
  });

  it('rejects an awaited presence query after the engine owner changes', async () => {
    const presence = new MemoryRecoveryPresence(), h = harness(presence), a = h.createEngine(), b = h.createEngine();
    try {
      const editor = await a.openEditor(noteRef, 'source-owner-change');
      await editor.edit({ ...resourceSnapshot(noteRef).value!, content: 'Owner transition words' });
      editor.close(); await flush();
      const gate = presence.deferNextHeld();
      const pending = b.listRecoveryChoices(noteRef);
      for (let turn = 0; turn < 50 && presence.heldCalls === 0; turn += 1) await Promise.resolve();
      expect(presence.heldCalls).toBeGreaterThan(0);
      b.setOwner('another-owner'); gate.resolve(true);
      await expect(pending).rejects.toThrow('Account changed');
    } finally { a.dispose(); b.dispose(); }
  });
});
