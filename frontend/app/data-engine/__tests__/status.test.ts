import { DataSession } from '../session';
import { ManualScope } from '../manualScope';
import { describeManualSync, describeSync } from '../status';
import type { EditorState } from '../controller';
import type { Observation } from '../observer';
import type { JournalEntry, ResourceSnapshot } from '../types';

const snapshot: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'base' }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
const observation: Observation = { snapshot, source: 'cache', readiness: 'cache', checking: false, error: false };
const state = (): EditorState => ({ checkpoint: new DataSession(snapshot).checkpoint(), durable: true, error: null, result: null });
const pending = (status: JournalEntry['state']): JournalEntry => ({ command: { protocol: 1, operationId: 'mine', owner: 'owner', resource: snapshot.resource, generation: 'g', dependsOn: [], kind: 'delete', baseline: snapshot.value! }, state: status, createdAt: 1, attempts: 1 });

describe('Shared synchronization status', () => {
  it('describes manual durability and selected-field changes independently of the parent', async () => {
    const editor = state();
    const form = ManualScope.begin({ owner: 'owner', resource: snapshot.resource, scopeId: 'form', selection: [['content']], port: {
      isCurrent: () => true, capture: () => ({ checkpoint: editor.checkpoint, provenance: [], requests: [] }),
      persist: async () => undefined, save: jest.fn(),
    } });
    await form.settled();
    const parent = describeSync(editor, observation, []);
    await form.update(value => ({ ...value, content: 'mine' }));
    expect(describeManualSync(form.getState(), editor, parent, null)).toMatchObject({ phase: 'draft', canSave: true });
    const staged = form.getState();
    expect(describeManualSync({ ...staged, durable: false }, editor, parent, 'disk full')).toMatchObject({ phase: 'localFailure', canSave: false });
    editor.checkpoint.confirmed = { ...snapshot, value: { ...snapshot.value, title: 'Unrelated' } };
    expect(describeManualSync(staged, editor, parent, null)?.hasForeignChange).toBe(false);
    editor.checkpoint.confirmed = { ...snapshot, value: { ...snapshot.value, content: 'remote' } };
    expect(describeManualSync(staged, editor, parent, null)).toMatchObject({ phase: 'remoteChanged', hasForeignChange: true });
    staged.record.predecessor = { id: 'prior', owner: 'owner', resource: snapshot.resource, value: editor.checkpoint.confirmed.value!, predecessorId: null };
    expect(describeManualSync(staged, editor, parent, null)?.hasForeignChange).toBe(false);
    editor.checkpoint.confirmed = { ...snapshot, metadata: { ...snapshot.metadata!, generation: 'recreated' } };
    expect(describeManualSync(staged, editor, parent, null)?.hasForeignChange).toBe(true);
    editor.checkpoint.confirmed = { ...snapshot, value: null, metadata: { ...snapshot.metadata!, deleted: true } };
    expect(describeManualSync(staged, editor, parent, null)).toMatchObject({ phase: 'deleted', canSave: false });
    staged.record.active = false;
    expect(describeManualSync(staged, editor, parent, null)).toBe(parent);
  });
  it('keeps save confirmation separate from current freshness', () => {
    expect(describeSync(state(), { ...observation, checking: true, error: true }, [])).toMatchObject({ phase: 'saved', freshness: 'cache', checking: true, readFailed: true, canSave: false });
  });
  it('reports local durability honestly and allows saving a durable draft', () => {
    const s = state(); s.checkpoint.dirty = true;
    expect(describeSync(s, observation, [])).toMatchObject({ phase: 'draft', canSave: true });
    s.durable = false;
    expect(describeSync(s, observation, [])).toMatchObject({ phase: 'savingLocally', canSave: false });
    s.error = 'quota';
    expect(describeSync(s, observation, []).phase).toBe('localFailure');
  });
  it.each(['queued', 'sending', 'unknown', 'blocked', 'refused', 'conflict'] as const)('exposes delivery %s without claiming server success', phase => {
    const s = state(); s.checkpoint.pending.mine = { generation: 1, value: snapshot.value }; s.checkpoint.dirty = true;
    expect(describeSync(s, observation, [pending(phase)])).toMatchObject({ phase, canSave: false });
  });
  it('suppresses the false other-device warning when our SDK echo arrives before the HTTP ACK', () => {
    const s = state(); s.checkpoint.dirty = true; s.checkpoint.pending.mine = { generation: 1, value: snapshot.value };
    s.checkpoint.remoteCandidate = { ...snapshot, metadata: { ...snapshot.metadata!, revision: 2, operationId: 'mine' } };
    expect(describeSync(s, observation, [pending('sending')])).toMatchObject({ phase: 'sending', hasForeignChange: false, canAcceptRemote: false });
    s.checkpoint.remoteCandidate.metadata!.operationId = 'other';
    expect(describeSync(s, observation, [pending('unknown')])).toMatchObject({ phase: 'remoteChanged', hasForeignChange: true, canAcceptRemote: false, canKeepLocal: false });
  });
  it('recognizes the SDK echo of an expanded relation command as its own', () => {
    const s = state(); s.checkpoint.dirty = true;
    s.checkpoint.pending.mine = { generation: 1, value: snapshot.value, operations: ['mine-1'] };
    s.checkpoint.remoteCandidate = { ...snapshot, metadata: { ...snapshot.metadata!, revision: 3, operationId: 'mine-1' } };
    expect(describeSync(s, observation, [pending('sending')])).toMatchObject({ phase: 'sending', hasForeignChange: false, canAcceptRemote: false });
  });
  it('allows one durable successor while offline and stops once its generation is queued', () => {
    const s = state(); s.checkpoint.dirty = true; s.checkpoint.editGeneration = 2;
    s.checkpoint.pending.mine = { generation: 1, value: snapshot.value };
    expect(describeSync(s, observation, [pending('unknown')])).toMatchObject({ phase: 'unknown', canSave: true, canRemove: false });
    s.checkpoint.pending.successor = { generation: 2, value: { content: 'B' } };
    expect(describeSync(s, observation, [pending('unknown')]).canSave).toBe(false);
    s.checkpoint.editGeneration = 3;
    expect(describeSync(s, observation, [pending('refused')]).canSave).toBe(false);
    s.result = { kind: 'refused', operationId: 'mine', code: 'denied' };
    expect(describeSync(s, observation, []).canSave).toBe(false);
  });
  it('requires terminal delivery before resolving a conflict and never offers to overwrite a deletion', () => {
    const s = state(); s.checkpoint.dirty = true; s.checkpoint.pending.mine = { generation: 1, value: snapshot.value };
    s.checkpoint.remoteCandidate = { ...snapshot, value: { userId: 'owner', content: 'other' } };
    s.result = { kind: 'conflict', operationId: 'mine', snapshot, conflicts: [] };
    expect(describeSync(s, observation, [pending('conflict')])).toMatchObject({ phase: 'conflict', canAcceptRemote: true, canKeepLocal: true });
    s.actionResolutionRequired = true;
    expect(describeSync(s, observation, [pending('conflict')])).toMatchObject({ canAcceptRemote: false, canKeepLocal: false });
    s.actionResolutionRequired = false;
    s.checkpoint.remoteCandidate.value = null;
    expect(describeSync(s, observation, [pending('conflict')])).toMatchObject({ canAcceptRemote: true, canKeepLocal: false, canSave: false });
    s.result = { kind: 'refused', operationId: 'mine', code: 'denied' };
    expect(describeSync(s, observation, [pending('refused')]).phase).toBe('refused');
  });
  it('shows clean confirmed deletion and unresolved rebased conflicts', () => {
    const s = state(); s.checkpoint.confirmed = { ...snapshot, value: null, metadata: { ...snapshot.metadata!, deleted: true } };
    expect(describeSync(s, observation, []).phase).toBe('deleted');
    s.checkpoint.dirty = true;
    expect(describeSync(s, observation, []).canSave).toBe(false);
    s.checkpoint.conflicts = [{ path: ['content'], base: { exists: true, value: 'base' }, mine: { exists: true, value: 'mine' }, theirs: { exists: true, value: 'theirs' } }];
    expect(describeSync(s, observation, []).phase).toBe('conflict');
  });
  it('only offers removal for a durable live document without pending commands', () => {
    const s = state(); expect(describeSync(s, observation, []).canRemove).toBe(true);
    s.preparing = true; expect(describeSync(s, observation, []).canRemove).toBe(false);
    s.preparing = false;
    s.durable = false; expect(describeSync(s, observation, []).canRemove).toBe(false);
    s.durable = true; s.checkpoint.pending.mine = { generation: 1, value: snapshot.value };
    expect(describeSync(s, observation, [pending('unknown')]).canRemove).toBe(false);
    s.checkpoint.pending = {}; s.checkpoint.confirmed.value = null;
    expect(describeSync(s, observation, []).canRemove).toBe(false);
  });

});
