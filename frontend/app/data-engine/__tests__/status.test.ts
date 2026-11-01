import { DataSession } from '../session';
import { ManualScope } from '../manualScope';
import { describeManualSync, describeSync } from '../status';
import { UNANSWERED_SAID_AFTER_ATTEMPTS } from '../unanswered';
import type { EditorState } from '../controller';
import type { Observation } from '../observer';
import type { JournalEntry, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const snapshot: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'base' }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
const observation: Observation = { snapshot, source: 'cache', readiness: 'cache', checking: false, error: false };
const state = (): EditorState => ({ checkpoint: new DataSession(snapshot).checkpoint(), durable: true, error: null, result: null });
const pending = (status: JournalEntry['state'], attempts = 1): JournalEntry => ({ command: { protocol: 1, operationId: 'mine', owner: 'owner', resource: snapshot.resource, generation: 'g', dependsOn: [], kind: 'delete', baseline: snapshot.value! }, state: status, createdAt: 1, attempts });
/** An unanswered delivery whose retries are spent: the only kind said as unknown (`unanswered.ts`). */
const spent = (status: JournalEntry['state']): JournalEntry => pending(status, status === 'unknown' ? UNANSWERED_SAID_AFTER_ATTEMPTS : 1);

describe('Shared synchronization status', () => {
  it('distinguishes a local deletion from a missing or already deleted record', () => {
    const s = state();
    expect(describeSync(s, observation, [])).toMatchObject({ deleting: false });
    s.checkpoint.draft = null;
    s.checkpoint.dirty = true;
    expect(describeSync(s, observation, [])).toMatchObject({ deleting: true });
    s.checkpoint.confirmed = { ...snapshot, value: null, metadata: { ...snapshot.metadata!, deleted: true } };
    expect(describeSync(s, observation, [])).toMatchObject({ deleting: false });
  });

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
  it.each(['queued', 'sending', 'unknown', 'conflict', 'refused'] as const)('does not let a pristine open form hide %s delivery', async phase => {
    const editor = state();
    const form = ManualScope.begin({ owner: 'owner', resource: snapshot.resource, scopeId: 'form', selection: [['content']], port: {
      isCurrent: () => true, capture: () => ({ checkpoint: editor.checkpoint, provenance: [], requests: [] }),
      persist: async () => undefined, save: jest.fn(),
    } });
    await form.settled();
    const parent = { ...describeSync(editor, observation, []), phase, canKeepLocal: phase === 'conflict', canAcceptRemote: phase === 'conflict' };
    expect(describeManualSync(form.getState(), editor, parent, null)).toMatchObject({ phase, canSave: false,
      canKeepLocal: phase === 'conflict', canAcceptRemote: phase === 'conflict' });
    await form.update(value => ({ ...value, content: 'Later unsent input' }));
    expect(describeManualSync(form.getState(), editor, parent, null)).toMatchObject({
      phase: ['conflict', 'refused'].includes(phase) ? phase : 'draft',
      canKeepLocal: phase === 'conflict', canAcceptRemote: false,
    });
  });

  it('never gives a selected-field form the parent document deletion intent', async () => {
    const editor = state();
    const form = ManualScope.begin({ owner: 'owner', resource: snapshot.resource, scopeId: 'form', selection: [['content']], port: {
      isCurrent: () => true, capture: () => ({ checkpoint: editor.checkpoint, provenance: [], requests: [] }),
      persist: async () => undefined, save: jest.fn(),
    } });
    await form.settled();
    editor.checkpoint.draft = null;
    const parent = { ...describeSync(editor, observation, []), phase: 'conflict' as const, canKeepLocal: true, canAcceptRemote: true };
    expect(describeManualSync(form.getState(), editor, parent, null)).toMatchObject({ deleting: false });
    await form.update(value => ({ ...value, content: 'Selected-field correction' }));
    expect(describeManualSync(form.getState(), editor, parent, null)).toMatchObject({ deleting: false, canKeepLocal: true });
    const inactive = form.getState();
    inactive.record.active = false;
    expect(describeManualSync(inactive, editor, parent, null)).toMatchObject({ deleting: false });
    expect(describeManualSync(null, editor, parent, null)).toMatchObject({ deleting: false });
    expect(parent.deleting).toBe(true);
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
    expect(describeSync(s, observation, [spent(phase)])).toMatchObject({ phase, canSave: false });
  });
  // The owner, 2026-10-17: a mark on a weak signal showed "The result of sending is unknown" for five
  // seconds while the engine sent it again by itself. Until its retries are spent it is still on its way.
  it('says an unanswered delivery is still on its way until its retries are spent, then unknown', () => {
    const s = state(); s.checkpoint.pending.mine = { generation: 1, value: snapshot.value }; s.checkpoint.dirty = true;
    for (let attempts = 1; attempts < UNANSWERED_SAID_AFTER_ATTEMPTS; attempts += 1) {
      expect(describeSync(s, observation, [pending('unknown', attempts)])).toMatchObject({ phase: 'sending', canSave: false });
    }
    expect(describeSync(s, observation, [pending('unknown', UNANSWERED_SAID_AFTER_ATTEMPTS)])).toMatchObject({ phase: 'unknown', canSave: false });
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
  it('offers an own-ACK candidate only for a proven request-level conflict and keeps unknown siblings protected', () => {
    const s = state();
    s.checkpoint.dirty = true;
    s.checkpoint.pending.mine = { generation: 1, value: snapshot.value, operations: ['relation'] };
    s.checkpoint.remoteCandidate = { ...snapshot, metadata: { ...snapshot.metadata!, revision: 2, operationId: 'relation' } };
    s.result = { kind: 'conflict', operationId: 'mine', snapshot: s.checkpoint.remoteCandidate, conflicts: [] };
    s.savedIntentReplaceable = true;
    expect(describeSync(s, observation, [pending('acknowledged')])).toMatchObject({
      phase: 'conflict', hasForeignChange: false, canAcceptRemote: true, canKeepLocal: true,
    });
    s.savedIntentReplaceable = false;
    expect(describeSync(s, observation, [pending('conflict')])).toMatchObject({ canAcceptRemote: false, canKeepLocal: false });
    s.savedIntentReplaceable = true; s.result = null;
    expect(describeSync(s, observation, [pending('sending')])).toMatchObject({
      phase: 'sending', hasForeignChange: false, canAcceptRemote: false, canKeepLocal: false,
    });
  });

  it('allows one durable successor while offline and stops once its generation is queued', () => {
    const s = state(); s.checkpoint.dirty = true; s.checkpoint.editGeneration = 2;
    s.checkpoint.pending.mine = { generation: 1, value: snapshot.value };
    expect(describeSync(s, observation, [spent('unknown')])).toMatchObject({ phase: 'unknown', canSave: true, canRemove: false });
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


it('offers an explicit choice for a retained stage after its saved ancestor was retired', async () => {
  const editor = state();
  const form = ManualScope.begin({ owner: 'owner', resource: snapshot.resource, scopeId: 'retired-form', selection: [['content']], port: {
    isCurrent: () => true, capture: () => ({ checkpoint: editor.checkpoint, provenance: [], requests: [] }),
    persist: async () => undefined, save: jest.fn(),
  } });
  await form.settled(); await form.update(value => ({ ...value, content: 'Retained words' }));
  const staged = { ...form.getState(), choiceRequired: true as const };
  const parent = describeSync(editor, observation, []);
  expect(describeManualSync(staged, editor, parent, null)).toMatchObject({
    phase: 'conflict', canSave: false, canKeepLocal: true, canAcceptRemote: true,
  });
  editor.checkpoint.pending = { unknown: { generation: 1, value: editor.checkpoint.draft } };
  expect(describeManualSync(staged, editor, { ...parent, phase: 'unknown' }, null)).toMatchObject({
    phase: 'conflict', canKeepLocal: false, canAcceptRemote: true,
  });
  form.dispose();
});


async function pendingCreationStatus(savedPredecessor = false) {
  const { documentEngineHarness, settleEngine } = await import('@test-utils/documentEngineHarness');
  const resource = { collection: 'sermons', id: 'pending-manual-status' };
  const h = documentEngineHarness({ resource, value: null, metadata: null });
  const browser = h.createBrowser();
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  const creator = await browser.engine.createEditor(resource, 'status-create');
  await creator.commit(() => ({ userId: 'owner', title: 'Created offline', verse: 'John 3:16', date: 'now', thoughts: [] }));
  await creator.close({ flush: false });
  const detail = await browser.engine.openEditor(resource, 'status-detail');
  const form = detail.form('title', [['title']]);
  await form.begin();
  if (savedPredecessor) {
    await form.update(value => ({ ...value, title: 'Earlier saved title' }));
    await form.save(); await form.begin();
  }
  await form.update(value => ({ ...value, title: 'Later unsent title' }));
  const editor = detail.getState(), manual = form.getState()!;
  const presence = detail.getPresence();
  const parent = describeSync(editor, { snapshot: editor.checkpoint.confirmed, source: 'cache', readiness: 'cache', checking: false, error: false }, []);
  expect(presence.kind).toBe('creating');
  expect(manual).toMatchObject({ dirty: true, durable: true, record: { baseline: { value: null, metadata: null } } });
  expect(h.transport.send).not.toHaveBeenCalled();
  return { resource, editor, manual, presence, parent, browser, detail, h, async dispose() { browser.dispose(); await settleEngine(); } };
}

it.each([false, true])('keeps a durable pending-creation stage editable with saved successor %s', async saved => {
  const s = await pendingCreationStatus(saved);
  try {
    const result = Reflect.apply(describeManualSync, null, [s.manual, s.editor, s.parent, null, s.presence]);
    expect(result).toMatchObject({ phase: 'draft', canSave: true, hasForeignChange: false });
    expect(s.manual.value.title).toBe('Later unsent title');
  } finally { await s.dispose(); }
});

it.each([false, true])('still reports a real missing remote candidate with tombstone %s as deletion', async tombstone => {
  const s = await pendingCreationStatus();
  try {
    const remote: ResourceSnapshot = { resource: s.resource, value: null,
      metadata: tombstone ? { protocol: 1, generation: 'deleted', revision: 2, deleted: true } : null };
    const editor = { ...s.editor, checkpoint: { ...s.editor.checkpoint, remoteCandidate: remote } };
    expect(Reflect.apply(describeManualSync, null, [s.manual, editor, s.parent, null, s.presence]))
      .toMatchObject({ phase: 'deleted', canSave: false, hasForeignChange: true });
  } finally { await s.dispose(); }
});

it('requires matching public creation evidence before treating absence as pending', async () => {
  const s = await pendingCreationStatus();
  try {
    expect(describeManualSync(s.manual, s.editor, s.parent, null)).toMatchObject({ phase: 'deleted', canSave: false });
    const another = { ...s.presence, snapshot: { resource: { ...s.resource, id: 'another' }, value: s.manual.value, metadata: null } };
    expect(Reflect.apply(describeManualSync, null, [s.manual, s.editor, s.parent, null, another]))
      .toMatchObject({ phase: 'deleted', canSave: false });
  } finally { await s.dispose(); }
});

it('lets an explicit recoverable choice keep its pending creation stage without claiming a deletion', async () => {
  const s = await pendingCreationStatus();
  try {
    const stage = { ...s.manual, choiceRequired: true as const };
    const parent = { ...s.parent, phase: 'conflict' as const, canKeepLocal: true, canAcceptRemote: true };
    expect(Reflect.apply(describeManualSync, null, [stage, s.editor, parent, null, s.presence]))
      .toMatchObject({ phase: 'conflict', canSave: false, canKeepLocal: true });
    const deletedEditor = { ...s.editor, checkpoint: { ...s.editor.checkpoint, remoteCandidate: {
      resource: s.resource, value: null, metadata: { protocol: 1 as const, generation: 'deleted', revision: 2, deleted: true },
    } } };
    expect(Reflect.apply(describeManualSync, null, [stage, deletedEditor, parent, null, s.presence]))
      .toMatchObject({ phase: 'conflict', canKeepLocal: false });
  } finally { await s.dispose(); }
});


it.each(['unknown', 'absent', 'deleting', 'present'] as const)('does not revive a retired creation stage from %s presence alone', async kind => {
  const s = await pendingCreationStatus();
  try {
    const presence = { kind, source: kind === 'deleting' ? 'local' : 'cache', snapshot: s.editor.checkpoint.confirmed };
    expect(Reflect.apply(describeManualSync, null, [s.manual, s.editor, s.parent, null, presence]))
      .toMatchObject({ phase: 'deleted', canSave: false });
  } finally { await s.dispose(); }
});

it('uses the authoritative creation copy while its editor checkpoint still awaits the ACK projection', async () => {
  const s = await pendingCreationStatus();
  try {
    const predecessor = s.manual.record.predecessor!;
    const accepted: ResourceSnapshot = { resource: s.resource, value: predecessor.value,
      metadata: { protocol: 1, generation: predecessor.id, revision: 1, deleted: false, operationId: predecessor.id } };
    const presence = { kind: 'present', source: 'server', snapshot: accepted };
    expect(Reflect.apply(describeManualSync, null, [s.manual, s.editor, s.parent, null, presence]))
      .toMatchObject({ phase: 'draft', canSave: true, hasForeignChange: false });
  } finally { await s.dispose(); }
});

it('preserves the unsent stage across a real creation ACK and public presence transition', async () => {
  const s = await pendingCreationStatus();
  try {
    const { settleEngine } = await import('@test-utils/documentEngineHarness');
    s.browser.engine.setOnline(true); await s.browser.engine.retry(); await settleEngine();
    const editor = s.detail.getState(), presence = s.detail.getPresence();
    expect(presence.kind).toBe('present');
    expect(editor.checkpoint.confirmed.value?.title).toBe('Created offline');
    const parent = describeSync(editor, s.detail.getObservation(), []);
    expect(Reflect.apply(describeManualSync, null, [s.detail.form('title', [['title']]).getState(), editor, parent, null, presence]))
      .toMatchObject({ phase: 'draft', canSave: true, hasForeignChange: false });
    expect(s.detail.form('title', [['title']]).getState()?.value.title).toBe('Later unsent title');
  } finally { await s.dispose(); }
});


it('does not treat a matching cached copy as proof of the creation ACK', async () => {
  const s = await pendingCreationStatus();
  try {
    const predecessor = s.manual.record.predecessor!;
    const cached: ResourceSnapshot = { resource: s.resource, value: predecessor.value,
      metadata: { protocol: 1, generation: 'cached-copy', revision: 1, deleted: false } };
    const presence = { kind: 'present', source: 'cache', snapshot: cached };
    expect(Reflect.apply(describeManualSync, null, [s.manual, s.editor, s.parent, null, presence]))
      .toMatchObject({ phase: 'deleted', canSave: false });
  } finally { await s.dispose(); }
});

it('retires creation evidence after the refused saved create is explicitly discarded', async () => {
  const s = await pendingCreationStatus();
  try {
    const { settleEngine } = await import('@test-utils/documentEngineHarness');
    jest.mocked(s.h.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    s.browser.engine.setOnline(true); await s.browser.engine.retry(); await settleEngine();
    await s.detail.acceptRemote(); await settleEngine();
    expect((await s.h.commits.list('owner')).every(request => request.state === 'cancelled')).toBe(true);
    const presence = s.detail.getPresence(), editor = s.detail.getState();
    expect(presence.kind).not.toBe('creating');
    const parent = describeSync(editor, s.detail.getObservation(), []);
    expect(Reflect.apply(describeManualSync, null, [s.manual, editor, parent, null, presence]))
      .toMatchObject({ canSave: false, canKeepLocal: false });
  } finally { await s.dispose(); }
});
