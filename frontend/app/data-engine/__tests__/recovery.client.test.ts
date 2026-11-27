import { readAccountPreferenceComparison, readAccountPreferenceReview } from '../accountPreference';
import { EditorController, type CheckpointRecoveryStore, type EditorRecord } from '../controller';
import { uncapturedAutosaveFields } from '../documentFieldAction';
import { captureExegeticalPointActions } from '../exegeticalPointCapture';
import { forkCheckpoint, isRecoverableCheckpoint, recoveryCheckpointId, selectRecoverableCheckpoints, validateRecoveryRecord } from '../recovery.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';

import { takeDroppedProof } from '@test-utils/droppedEvidence';

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
    expect(forked).toEqual({ ...source, editorId: 'fresh-tab', recoverySources: [{ id: '["owner","source"]' }] });
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

  it('keeps the authored revision and clock of an exegetical point before capturing a command', () => {
    const opening: ResourceSnapshot = { ...snapshot, resource: { collection: 'sermons', id: 'sermon' },
      value: { userId: 'owner', preparation: { exegeticalPlan: [{ id: 'point', title: 'Opening' }] } } };
    const editor = new DataSession(opening);
    const time = { earliestMs: 1_000, latestMs: 1_010 };
    editor.edit({ userId: 'owner', preparation: { exegeticalPlan: [{ id: 'point', title: 'Written offline' }] } },
      editor.checkpoint(), { field: 'exegetical-point', nodeId: 'point', intent: 'title', time });
    const original = { ...record(), checkpoint: editor.checkpoint() };
    expect(original.checkpoint.exegeticalPointDrafts).toEqual([
      { nodeId: 'point', kind: 'title', generation: 'gen', observedRevision: 1, time, title: 'Written offline', ancestors: [] },
    ]);
    const restored = validateRecoveryRecord(clone(original), 'owner', 'source');
    expect(restored.checkpoint.exegeticalPointDrafts).toEqual(original.checkpoint.exegeticalPointDrafts);
    expect(captureExegeticalPointActions(restored.checkpoint, opening, undefined, [])).toEqual([
      { nodeId: 'point', kind: 'title', observedRevision: 1, time },
    ]);
  });

  it('keeps the proof of a captured group title so recovery does not submit the same edit twice', () => {
    const opening: ResourceSnapshot = { ...snapshot, resource: { collection: 'groups', id: 'group' },
      value: { userId: 'owner', title: 'Opening' } };
    const editor = new DataSession(opening);
    const draft = { userId: 'owner', title: 'Typed title' };
    const time = { earliestMs: 1_000, latestMs: 1_010 };
    editor.edit(draft, editor.checkpoint(), { field: 'title', time });
    const stamp = { before: 'Opening', after: 'Typed title', observedRevision: 1, time };
    editor.registerCommit('operation', 1, draft, undefined, { groupTitleAction: stamp });
    const original = { ...record(), checkpoint: editor.checkpoint() };
    expect(original.checkpoint.groupTitleDraft).toMatchObject({ action: stamp });
    const restored = validateRecoveryRecord(clone(original), 'owner', 'source');
    expect(restored.checkpoint.pending.operation.groupTitleAction).toEqual(stamp);
    expect(uncapturedAutosaveFields(restored.checkpoint, restored.checkpoint.confirmed, undefined, [])).toEqual({});
  });

  it('keeps pending row evidence and the conflict details that determine which field is under review', () => {
    const original = record();
    original.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    const time = { earliestMs: 1000, latestMs: 1010 };
    const action = { rowId: 'point', rowCreatedAt: 'point', before: 'Opening', after: 'Written', observedRevision: 1,
      time, predecessorOperationId: 'earlier' };
    original.checkpoint.draft = { ...original.checkpoint.draft, outline: { main: [{ id: 'point', text: 'Written' }] } };
    original.checkpoint.outlineTitleDrafts = { point: { generation: 'gen', action } };
    original.checkpoint.pending.next = { value: { userId: 'owner' }, generation: 1, outlineTitleActions: [action] };
    original.checkpoint.conflicts = [
      { path: ['outline', 'main'], base: { exists: false }, mine: { exists: true, value: 'mine' },
        theirs: { exists: true, value: 'theirs' }, code: 'outline-subpoint-placement', outlineSubpointIds: ['child'],
        orderedOutlineSubpoints: [{ id: 'neighbor', side: 'remote' }] },
    ];
    const restored = validateRecoveryRecord(clone(original), 'owner', 'source');
    expect(restored.checkpoint.outlineTitleDrafts).toEqual(original.checkpoint.outlineTitleDrafts);
    expect(restored.checkpoint.pending.next.outlineTitleActions).toEqual([action]);
    expect(restored.checkpoint.conflicts).toEqual(original.checkpoint.conflicts);
  });

  it('keeps the exact list choices when restoring a hard question comparison', () => {
    const original = record();
    original.checkpoint.confirmed.resource = { collection: 'hardQuestions', id: 'question-one' };
    const list = (value: string[]) => ({ exists: true, value });
    original.checkpoint.conflicts = [
      { path: ['alternates'], base: list(['Contested']), mine: list(['Phone']), theirs: list(['Contested', 'Computer']),
        hardQuestionListVersions: { local: list(['Computer', 'Phone']), remote: list(['Contested', 'Computer', 'Phone']), undecided: ['Contested'] } },
    ];
    const restored = validateRecoveryRecord(clone(original), 'owner', 'source');
    expect(restored.checkpoint.conflicts).toEqual(original.checkpoint.conflicts);
  });

  it.each(['groups', 'councils', 'serviceOrders'])('retains placement comparison details for %s', collection => {
    const original = record();
    original.checkpoint.confirmed.resource.collection = collection;
    original.checkpoint.serviceOrderPlacementComparison = {
      step: { id: 'step', title: 'Meeting step' },
      mine: { previous: { id: 'before', generation: null, title: 'Previous' }, next: null },
      saved: { previous: null, next: { id: 'after', generation: 'gen', title: 'Next' } },
      available: true,
    };
    const restored = validateRecoveryRecord(clone(original), 'owner', 'source');
    expect(restored.checkpoint.serviceOrderPlacementComparison).toEqual(original.checkpoint.serviceOrderPlacementComparison);
  });

  it('keeps account retries and does not accept unknown evidence as an account preference', () => {
    const source = record();
    source.checkpoint.confirmed.resource = { collection: 'users', id: 'owner' };
    source.checkpoint.accountPreferenceRetry = { field: 'reading.analysisHelp.short', time: { earliestMs: 1000, latestMs: 1010 } };
    const restored = validateRecoveryRecord(clone(source), 'owner', 'source');
    expect(restored.checkpoint.accountPreferenceRetry).toEqual(source.checkpoint.accountPreferenceRetry);
    const unreadable = validateRecoveryRecord({ ...source,
      checkpoint: { ...source.checkpoint, accountPreferenceRetry: { field: 'arbitrary', time: null } },
    }, 'owner', 'source');
    expect(unreadable.checkpoint.accountPreferenceRetry).toBeUndefined();
    expect(unreadable.checkpoint.draft).toEqual(source.checkpoint.draft);
    takeDroppedProof('accountPreferenceRetry');
  });

  it.each(['bad-clock', 'bad-field', 'bad-field-with-two-changes'] as const)('recovers a settings choice with %s without sending an unguarded write', async damage => {
    const source = record();
    const ref = { collection: 'users', id: 'owner' };
    const opening = { language: 'en', reading: { crossReferences: { mode: 'main', show: true } } };
    const draft = { ...opening, language: damage === 'bad-field-with-two-changes' ? 'uk' : 'en',
      reading: { crossReferences: { mode: 'all', show: true } } };
    const metadata = { protocol: 1 as const, generation: 'settings-gen', revision: 8, deleted: false };
    const raw = { ...source, checkpoint: { ...source.checkpoint,
      confirmed: { resource: ref, value: opening, metadata }, draft,
      accountPreferenceRetry: damage === 'bad-clock'
        ? { field: 'reading.crossReferences.mode', time: { earliestMs: 2000, latestMs: 1000 } }
        : { field: 'reading.unknownField', time: null },
    } };

    const { checkpoint } = validateRecoveryRecord(raw, 'owner', 'source');
    expect(checkpoint.draft).toEqual(draft);
    takeDroppedProof('accountPreferenceRetry');
    expect(checkpoint.accountPreferenceRetry).toBeUndefined();
    if (damage === 'bad-field-with-two-changes') {
      expect(checkpoint.conflicts.map(({ path }) => path)).toEqual([['language'], ['reading', 'crossReferences', 'mode']]);
    } else {
      expect(readAccountPreferenceComparison(checkpoint)).toMatchObject({
        field: 'reading.crossReferences.mode', mine: 'all', stored: 'main',
      });
    }
    const session = DataSession.restore(checkpoint);
    expect(session.prepare('unreviewed', 'owner')).toBeNull();
    session.acceptRemote();
    expect(session.checkpoint()).toMatchObject({ draft: opening, dirty: false, conflicts: [] });

    if (damage === 'bad-field-with-two-changes') return;
    const { store } = storeWith({ ...source, checkpoint });
    const transport: EngineTransport = { read: jest.fn(), send: jest.fn() };
    const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: jest.fn(), remove: jest.fn() } });
    runtime.setOwner('owner');
    const editor = await EditorController.open({ owner: 'owner', editorId: 'source', snapshot: checkpoint.confirmed,
      store, runtime, operationId: () => 'recovered-settings', isCurrentOwner: owner => owner === 'owner' });
    try {
      const time = { earliestMs: 3000, latestMs: 3010 };
      await editor.keepLocal(undefined, undefined, editor.captureRecoveryChoice(), time);
      expect(editor.getState().checkpoint).toMatchObject({ draft, conflicts: [],
        accountPreferenceRetry: { field: 'reading.crossReferences.mode', time } });
      expect(transport.send).not.toHaveBeenCalled();
    } finally {
      editor.dispose();
      runtime.setOwner(null);
    }
  });


  it.each([
    ['local', 'remote', 'main', false],
    ['remote', 'local', 'all', true],
    ['remote', 'remote', 'main', true],
    ['local', 'local', 'all', false],
  ] as const)('durably applies only the reviewed settings (%s, %s)', (show, mode, savedMode, savedShow) => {
    const source = record();
    const resource = { collection: 'users', id: 'owner' };
    const metadata = { protocol: 1 as const, generation: 'test-settings', revision: 8, deleted: false };
    const opening = { reading: { crossReferences: { mode: 'main', show: true, inWindow: true } } };
    const draft = { reading: { crossReferences: { mode: 'all', show: false, inWindow: true } } };
    const saved = { reading: { crossReferences: { mode: 'main', show: true, inWindow: false } } };
    const raw = {
      ...source, checkpoint: { ...source.checkpoint, confirmed: { resource, value: opening, metadata }, draft,
        remoteCandidate: { resource, value: saved, metadata: { ...metadata, revision: 9 } },
        accountPreferenceRetry: { field: 'reading.damaged', time: null } },
    };
    const { checkpoint } = validateRecoveryRecord(raw, 'owner', 'source');
    takeDroppedProof('accountPreferenceRetry');
    const session = DataSession.restore(checkpoint);
    const time = { earliestMs: 3000, latestMs: 3010 };
    expect(() => session.keepLocal()).toThrow('Choose a version for each displayed setting');
    expect(() => session.applyAccountPreferenceReview({ 'reading.crossReferences.show': show }, time))
      .toThrow('Choose a version for each displayed setting');
    expect(session.checkpoint()).toEqual(checkpoint);
    session.applyAccountPreferenceReview({ 'reading.crossReferences.show': show, 'reading.crossReferences.mode': mode }, time);
    const kept = [...(show === 'local' ? ['reading.crossReferences.show'] : []), ...(mode === 'local' ? ['reading.crossReferences.mode'] : [])];
    const after = session.checkpoint();
    expect(after.draft).toEqual({ reading: { crossReferences: { mode: savedMode, show: savedShow, inWindow: false } } });
    expect(after.dirty).toBe(Boolean(kept.length));
    expect(after.conflicts).toEqual([]);
    expect(after.unreadableScalarProof).toBeUndefined();
    const restored = validateRecoveryRecord(clone({ ...source, checkpoint: after }), 'owner', 'source').checkpoint;
    expect(restored.accountPreferenceRetry).toEqual(kept.length > 1 ? { fields: kept, time } : kept.length ? { field: kept[0], time } : undefined);
    if (kept.length > 1) {
      const broken = validateRecoveryRecord({ ...source, checkpoint: { ...after,
        accountPreferenceRetry: { fields: kept, time: { earliestMs: 3010, latestMs: 3000 } } },
      }, 'owner', 'source').checkpoint;
      takeDroppedProof('accountPreferenceRetry');
      expect(broken.unreadableScalarProof).toEqual(kept);
      expect(DataSession.restore(broken).prepare('unreviewed-damaged-batch', 'owner')).toBeNull();
    }
  });


  it('adopts settings already saved on the other device without asking or writing again', () => {
    const source = record();
    const resource = { collection: 'users', id: 'owner' };
    const metadata = { protocol: 1 as const, generation: 'test-settings', revision: 8, deleted: false };
    const opening = { reading: { crossReferences: { mode: 'main', show: true, inWindow: true } } };
    const draft = { reading: { crossReferences: { mode: 'all', show: false, inWindow: true } } };
    const saved = { reading: { crossReferences: { mode: 'all', show: false, inWindow: false } } };
    const { checkpoint } = validateRecoveryRecord({
      ...source, checkpoint: { ...source.checkpoint, confirmed: { resource, value: opening, metadata }, draft,
        remoteCandidate: { resource, value: saved, metadata: { ...metadata, revision: 9 } },
        accountPreferenceRetry: { field: 'reading.damaged', time: null } },
    }, 'owner', 'source');
    takeDroppedProof('accountPreferenceRetry');
    const session = DataSession.restore(checkpoint);
    expect(session.checkpoint()).toMatchObject({ draft: saved, dirty: false, conflicts: [], remoteCandidate: null });
    expect(session.checkpoint().unreadableScalarProof).toBeUndefined();
    expect(session.prepare('already-saved', 'owner')).toBeNull();
  });


  it.each([false, true])('shows a settings draft with an unsupported sibling and requires explicit discard (saved record deleted: %s)', deleted => {
    const source = record();
    const resource = { collection: 'users', id: 'owner' };
    const metadata = { protocol: 1 as const, generation: 'test-settings', revision: 8, deleted: false };
    const opening = { language: 'en', showAppVersion: false, displayName: 'Before' };
    const draft = { language: 'uk', showAppVersion: true, displayName: 'Draft name' };
    const saved = deleted ? null : { ...opening, displayName: 'Saved name' };
    const { checkpoint } = validateRecoveryRecord({
      ...source, checkpoint: { ...source.checkpoint, confirmed: { resource, value: opening, metadata }, draft,
        remoteCandidate: { resource, value: saved, metadata: { ...metadata, revision: 9, deleted } },
        conflicts: [{ path: ['displayName'], base: { exists: true, value: opening.displayName },
          mine: { exists: true, value: draft.displayName }, theirs: saved ? { exists: true, value: saved.displayName } : { exists: false } }],
        accountPreferenceRetry: { field: 'damaged', time: null } },
    }, 'owner', 'source');
    takeDroppedProof('accountPreferenceRetry');
    const session = DataSession.restore(checkpoint);
    expect(readAccountPreferenceReview(session.checkpoint())).toMatchObject({ kind: 'saved-only', draft, basis: { value: saved } });
    expect(() => session.applyAccountPreferenceReview({ language: 'local', showAppVersion: 'remote' }, null)).toThrow();
    expect(session.checkpoint().draft).toEqual(draft);
    expect(session.prepare('unsafe-settings-review', 'owner')).toBeNull();
    session.applyAccountPreferenceReview('saved-draft', null);
    expect(session.checkpoint()).toMatchObject({ draft: saved, conflicts: [], dirty: false });
    expect(session.prepare('settings-already-saved', 'owner')).toBeNull();
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
    expect(selectRecoverableCheckpoints([['["owner","source"]', {}]], 'owner')).toEqual([]);
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
