import { EditorController, type CheckpointRecoveryStore, type EditorRecord } from '../controller';
import { forkCheckpoint, isRecoverableCheckpoint, recoveryCheckpointId, selectRecoverableCheckpoints, validateRecoveryRecord } from '../recovery.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';

import type { EngineTransport, JournalEntry, JournalStore, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot: ResourceSnapshot = { resource, value: { userId: 'owner', content: 'base' }, metadata: { protocol: 1, generation: 'gen', revision: 1, deleted: false } };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function record(editorId = 'source', content = 'mine'): EditorRecord {
  const session = new DataSession(snapshot); session.edit({ userId: 'owner', content });
  return { owner: 'owner', editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
}
function storeWith(source = record()) {
  const records = new Map<string, EditorRecord>([[recoveryCheckpointId(source.owner, source.editorId), clone(source)]]);
  const store: CheckpointRecoveryStore = {
    read: jest.fn(async (owner, id) => { const value = records.get(recoveryCheckpointId(owner, id)); return value && clone(value); }),
    put: jest.fn(async value => { records.set(recoveryCheckpointId(value.owner, value.editorId), clone(value)); }),
    create: jest.fn(async value => {
      const key = recoveryCheckpointId(value.owner, value.editorId);
      if (records.has(key)) throw new Error('Recovery target already exists');
      records.set(key, clone(value));
    }),
    listRecoverable: jest.fn(async (owner, ref) => selectRecoverableCheckpoints([...records.entries()], owner, ref)),
  };
  return { records, store };
}

describe('Explicit checkpoint recovery', () => {
  it('bounds repeated reference races without publishing an incomplete recovery fork', async () => {
    const s = storeWith();
    jest.mocked(s.store.create).mockRejectedValue(Object.assign(new Error('reference changed'), { code: 'commit-reference-changed' }));
    await expect(forkCheckpoint(s.store, 'owner', '["owner","source"]', 'fork', resource)).rejects.toMatchObject({ code: 'commit-reference-changed' });
    expect(s.store.read).toHaveBeenCalledTimes(3); expect(s.store.create).toHaveBeenCalledTimes(3);
    expect(s.records.has('["owner","fork"]')).toBe(false);
  });
  it('discovers dirty, prepared, pending and unfinalized work with stable owner-scoped identities', () => {
    const dirty = record();
    const clean = record('clean'); clean.checkpoint.dirty = false;
    const pending = record('pending'); pending.checkpoint.dirty = false; pending.checkpoint.pending.operation = { generation: 1, value: { userId: 'owner', content: 'mine' } };
    const unfinalized = record('unfinalized'); unfinalized.checkpoint.dirty = false; unfinalized.unfinalized = ['operation'];
    const prepared = record('prepared'); const session = DataSession.restore(prepared.checkpoint); prepared.prepared = session.prepare('prepared-op', 'owner'); prepared.checkpoint = session.checkpoint(); prepared.checkpoint.dirty = false;
    const unrelated = record('another-note'); unrelated.checkpoint.confirmed.resource.id = 'another-note';
    const rows = [dirty, clean, pending, unfinalized, prepared, unrelated].map(value => [recoveryCheckpointId(value.owner, value.editorId), value] as const);
    const selected = selectRecoverableCheckpoints([...rows, ['["other","private"]', { unvalidated: 'private' }], ['bad key', {}], [17, {}]], 'owner', resource);
    expect(selected.map(value => value.record.editorId)).toEqual(['source', 'pending', 'unfinalized', 'prepared']);
    expect(selected[0].id).toBe('["owner","source"]');
    expect(selectRecoverableCheckpoints(rows, 'owner')).toHaveLength(5);
    expect(isRecoverableCheckpoint(clean)).toBe(false);
    selected[0].record.checkpoint.draft!.content = 'caller mutation';
    expect(dirty.checkpoint.draft?.content).toBe('mine');
  });

  it('forks the full record without changing the source and refuses an occupied destination', async () => {
    const source = record(); source.unfinalized = ['previous'];
    const s = storeWith(source);
    const original = clone(s.records.get('["owner","source"]'));
    const forked = await forkCheckpoint(s.store, 'owner', '["owner","source"]', 'fresh-tab', resource);
    expect(forked).toEqual({ ...source, editorId: 'fresh-tab' });
    expect(s.records.get('["owner","source"]')).toEqual(original);
    forked.checkpoint.draft!.content = 'caller mutation';
    expect(s.records.get('["owner","fresh-tab"]')?.checkpoint.draft?.content).toBe('mine');
    await expect(forkCheckpoint(s.store, 'owner', '["owner","source"]', 'fresh-tab', resource)).rejects.toThrow('already exists');
    expect(s.records.get('["owner","source"]')).toEqual(original);
  });

  it('rejects foreign, malformed, mismatched, missing and already-clean recovery sources', async () => {
    const s = storeWith();
    for (const sourceId of ['bad', '["other","source"]', '["owner","source","extra"]', '[ "owner", "source" ]']) {
      await expect(forkCheckpoint(s.store, 'owner', sourceId, 'fork', resource)).rejects.toThrow('identity');
    }
    expect(s.store.read).not.toHaveBeenCalled();
    await expect(forkCheckpoint(s.store, 'owner', '["owner","source"]', 'source', resource)).rejects.toThrow('identity');
    await expect(forkCheckpoint(s.store, 'owner', '["owner","missing"]', 'fork', resource)).rejects.toThrow('no longer exists');
    await expect(forkCheckpoint(s.store, 'owner', '["owner","source"]', 'fork', { ...resource, id: 'other' })).rejects.toThrow('identity mismatch');
    s.records.get('["owner","source"]')!.checkpoint.dirty = false;
    await expect(forkCheckpoint(s.store, 'owner', '["owner","source"]', 'fork', resource)).rejects.toThrow('no pending local work');
    expect(s.store.create).not.toHaveBeenCalled();
  });

  it('validates complete checkpoints including conflicts, pending values and command owner binding', () => {
    const source = record();
    source.checkpoint.conflicts = [{ path: ['content'], base: { exists: false }, mine: { exists: true, value: 'mine' }, theirs: { exists: true, value: 'remote' } }];
    expect(validateRecoveryRecord(source, 'owner', 'source')).toEqual(source);
    expect(() => validateRecoveryRecord(source, 'other', 'source')).toThrow('identity mismatch');
    const wrongCandidate = clone(source); wrongCandidate.checkpoint.remoteCandidate = { ...snapshot, resource: { ...resource, id: 'other' } };
    expect(() => validateRecoveryRecord(wrongCandidate, 'owner', 'source')).toThrow('identity mismatch');
    const session = DataSession.restore(source.checkpoint); session.keepLocal(); const prepared = session.prepare('operation', 'owner')!;
    const wrongCommand = { ...source, prepared: { ...prepared, owner: 'other' }, checkpoint: session.checkpoint() };
    expect(() => validateRecoveryRecord(wrongCommand, 'owner', 'source')).toThrow('Prepared checkpoint identity mismatch');
    expect(() => selectRecoverableCheckpoints([['["owner","source"]', {}]], 'owner')).toThrow();
  });

  it('rejects another account in confirmed, draft, remote and pending values and applies the canonical owner field', () => {
    for (const location of ['confirmed', 'draft', 'remote', 'pending']) {
      const source = record(); const foreign = { userId: 'other', content: 'private' };
      if (location === 'confirmed') source.checkpoint.confirmed.value = foreign;
      if (location === 'draft') source.checkpoint.draft = foreign;
      if (location === 'remote') source.checkpoint.remoteCandidate = { ...snapshot, value: foreign };
      if (location === 'pending') source.checkpoint.pending.operation = { generation: 1, value: foreign };
      expect(() => validateRecoveryRecord(source, 'owner', 'source')).toThrow('ownership mismatch');
    }
    const user = record(); user.checkpoint.confirmed.resource = { collection: 'users', id: 'owner' };
    user.checkpoint.confirmed.value = null; user.checkpoint.confirmed.metadata = null; user.checkpoint.draft = { displayName: 'Mine' };
    expect(validateRecoveryRecord(user, 'owner', 'source')).toEqual(user);
    user.checkpoint.confirmed.resource.id = 'other';
    expect(() => validateRecoveryRecord(user, 'owner', 'source')).toThrow('ownership mismatch');
    const link = record(); link.checkpoint.confirmed.resource.collection = 'studyNoteShareLinks';
    link.checkpoint.confirmed.value = { ownerId: 'owner' }; link.checkpoint.draft = { ownerId: 'owner' };
    expect(validateRecoveryRecord(link, 'owner', 'source')).toEqual(link);
    link.checkpoint.draft = { userId: 'owner' };
    expect(() => validateRecoveryRecord(link, 'owner', 'source')).toThrow('ownership mismatch');
    const removed = record(); removed.checkpoint.draft = null; removed.checkpoint.remoteCandidate = { ...snapshot, value: null, metadata: { ...snapshot.metadata!, deleted: true } };
    expect(validateRecoveryRecord(removed, 'owner', 'source')).toEqual(removed);
  });

  it('preserves omitted owner in immutable create intent, but rejects foreign owners and missing owners after deletion', () => {
    const session = new DataSession({ resource, value: null, metadata: null });
    session.edit({ content: 'new' });
    const prepared = session.prepare('create-operation', 'owner');
    const source: EditorRecord = { owner: 'owner', editorId: 'source', prepared, checkpoint: session.checkpoint(), unfinalized: [] };
    expect(validateRecoveryRecord(source, 'owner', 'source')).toEqual(source);
    expect(source.prepared).toEqual(prepared);
    const foreign = clone(source); foreign.checkpoint.draft!.userId = 'other';
    expect(() => validateRecoveryRecord(foreign, 'owner', 'source')).toThrow('ownership mismatch');
    const deleted = clone(source); deleted.checkpoint.confirmed.metadata = { ...snapshot.metadata!, deleted: true };
    expect(() => validateRecoveryRecord(deleted, 'owner', 'source')).toThrow('ownership mismatch');
  });

  it('recovers an unknown operation across restart without changing its ID or clearing later typing on ACK', async () => {
    const sourceSession = new DataSession(snapshot); sourceSession.edit({ userId: 'owner', content: 'A' });
    const prepared = sourceSession.prepare('original-operation', 'owner')!;
    sourceSession.edit({ userId: 'owner', content: 'B' });
    const source: EditorRecord = { owner: 'owner', editorId: 'previous-tab', prepared, checkpoint: sourceSession.checkpoint(), unfinalized: [] };
    const s = storeWith(source);
    const entries = new Map<string, JournalEntry>([[prepared.operationId, { command: clone(prepared), state: 'unknown', createdAt: 1, attempts: 1 }]]);
    const journal: JournalStore = {
      list: jest.fn(async owner => clone([...entries.values()].filter(entry => entry.command.owner === owner))),
      put: jest.fn(async entry => { entries.set(entry.command.operationId, clone(entry)); }),
      remove: jest.fn(async (_owner, id) => { entries.delete(id); }),
    };
    const acknowledged = { ...snapshot, value: { userId: 'owner', content: 'A' }, metadata: { ...snapshot.metadata!, revision: 2, operationId: prepared.operationId } };
    const transport: EngineTransport = { read: jest.fn(), send: jest.fn(async command => ({ kind: 'acknowledged' as const, operationId: command.operationId, snapshot: acknowledged })) };
    const runtime = new DataEngineRuntime({ journal, transport }); runtime.setOwner('owner');
    await forkCheckpoint(s.store, 'owner', recoveryCheckpointId('owner', 'previous-tab'), 'current-tab', resource);
    const editor = await EditorController.open({ owner: 'owner', editorId: 'current-tab', snapshot, store: s.store, runtime, operationId: () => 'new-operation', isCurrentOwner: owner => owner === 'owner' });
    expect(entries.get(prepared.operationId)?.command).toEqual(prepared);
    await runtime.drain(); await editor.settled();
    expect(transport.send).toHaveBeenCalledTimes(1); expect(transport.send).toHaveBeenCalledWith(prepared);
    expect(editor.getState().checkpoint).toMatchObject({ confirmed: acknowledged, draft: { content: 'B' }, dirty: true, pending: {} });
    expect(s.records.get(recoveryCheckpointId('owner', 'previous-tab'))).toEqual(source);
    expect(s.records.get(recoveryCheckpointId('owner', 'current-tab'))?.checkpoint.draft?.content).toBe('B');
    await editor.save(); expect(entries.get('new-operation')?.command).toMatchObject({ changes: [{ before: { value: 'A' }, after: { value: 'B' } }] });
    editor.dispose();
  });
});
