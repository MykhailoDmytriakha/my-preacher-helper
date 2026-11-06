import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';
import { orderCommitRequests } from '../commits';
import { reconcileRecoveryRecord } from '../recovery.client';

import type { ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const resource: ResourceRef = { collection: 'sermons', id: 'choice-checkpoint-write' };
const initial: ResourceSnapshot = {
  resource,
  value: { userId: owner, title: 'Saved before edit', scratch: [], rev: { core: 1 } },
  metadata: { protocol: 1, generation: 'initial-generation', revision: 1, deleted: false },
};

it('reconciles the local text after a Keep Local checkpoint write aborts', async () => {
  const h = documentEngineHarness(initial);
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false);
  engine.setOwner(owner);
  const editorId = browser.editorId(resource);
  const editor = await engine.openEditor(resource, editorId);
  const localText = 'my held words';
  const remoteText = 'remote words';

  try {
    await editor.commit(value => ({ ...value, title: localText }));
    h.silentRemote({ title: remoteText });
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();

    expect(editor.getState().result?.kind).toBe('conflict');
    const requestsBeforeChoice = await h.commits.list(owner);
    const request = requestsBeforeChoice.find(item => item.editorId === editorId);
    expect(request).toMatchObject({ state: 'conflict', value: { title: localText } });
    if (!request) throw new Error('The exact local conflict request was not stored');
    const beforeCheckpoint = await h.checkpoints.read(owner, editorId);
    expect(beforeCheckpoint?.checkpoint.draft).toMatchObject({ title: localText });
    if (!beforeCheckpoint) throw new Error('The exact pre-choice checkpoint was not stored');

    let checkpointFaults = 0;
    h.storage.writeFailureFor = (key, value) => {
      const exactChoiceCheckpoint = Array.isArray(key) && key[0] === 'checkpoint'
        && key[1] === owner && key[2] === editorId
        && value !== undefined && typeof value === 'object' && value !== null
        && 'completedCommits' in value
        && Array.isArray(value.completedCommits) && value.completedCommits.includes(request.id);
      if (exactChoiceCheckpoint) checkpointFaults += 1;
      return exactChoiceCheckpoint;
    };
    let choiceError: unknown;
    try { await editor.keepLocal(); } catch (error) { choiceError = error; }

    // Do not let a still-mounted controller persist its in-memory choice after this storage fault.
    h.storage.writeFailureFor = undefined;
    browser.dispose();

    expect(checkpointFaults).toBeGreaterThan(0);
    expect(choiceError).toMatchObject({ message: 'disk full' });
    const diskCheckpoint = await h.checkpoints.read(owner, editorId);
    expect(diskCheckpoint?.checkpoint.draft).toMatchObject({ title: localText });
    const durableRequests = await h.commits.list(owner);
    const durableRequest = durableRequests.find(item => item.id === request.id);
    expect(durableRequest?.value).toMatchObject({ title: localText });

    const projected = reconcileRecoveryRecord(diskCheckpoint!, orderCommitRequests(durableRequests));
    expect(projected.checkpoint.draft).toMatchObject({ title: localText });
    expect(projected.checkpoint.draft?.title).not.toBe(remoteText);
  } finally {
    h.storage.writeFailureFor = undefined;
    browser.dispose();
  }
});

const remoteSibling = ['remote sibling'];

async function prepareChoiceConflict(localText: string, remoteText: string) {
  const snapshot: ResourceSnapshot = {
    resource,
    value: { userId: owner, title: 'Saved before edit', scratch: ['original sibling'], rev: { core: 1 } },
    metadata: { protocol: 1, generation: 'choice-generation', revision: 1, deleted: false },
  };
  const h = documentEngineHarness(snapshot);
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false);
  engine.setOwner(owner);
  const editorId = browser.editorId(resource);
  const editor = await engine.openEditor(resource, editorId);
  await editor.commit(value => ({ ...value, title: localText }));
  h.silentRemote({ title: remoteText, scratch: remoteSibling });
  engine.setOnline(true);
  await engine.retry();
  await settleEngine();
  if (editor.getState().result?.kind !== 'conflict') throw new Error('Expected a real terminal conflict before choice');
  const request = (await h.commits.list(owner)).find(item => item.editorId === editorId);
  if (!request || request.state !== 'conflict' || request.value?.title !== localText) {
    throw new Error('The exact immutable local conflict request was not stored');
  }
  const checkpoint = await h.checkpoints.read(owner, editorId);
  if (!checkpoint || checkpoint.checkpoint.draft?.title !== localText) throw new Error('The conflict checkpoint did not retain local words');
  return { h, browser, engine, editor, editorId, request, checkpoint, localText, remoteText };
}

async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const waitForSignal = (signal: Promise<void>, message: string): Promise<void> => within(signal, message);

it.each(['local', 'remote'] as const)('preserves remote sibling fields after the positive %s choice', async choice => {
  const s = await prepareChoiceConflict('my chosen words', 'remote words');
  try {
    if (choice === 'local') {
      await s.editor.keepLocal();
      expect(s.editor.getState().checkpoint.draft).toMatchObject({ title: 'my chosen words', scratch: remoteSibling });
      await s.editor.save();
      await s.engine.retry();
      await settleEngine();
      expect(s.h.server.value).toMatchObject({ title: 'my chosen words', scratch: remoteSibling });
    } else {
      await s.editor.acceptRemote();
      await settleEngine();
      expect(s.editor.getState().checkpoint.draft).toMatchObject({ title: 'remote words', scratch: remoteSibling });
      expect(s.h.server.value).toMatchObject({ title: 'remote words', scratch: remoteSibling });
    }
  } finally { s.browser.dispose(); }
});

it.each(['local', 'remote'] as const)('allows retry after the %s choice checkpoint transaction aborts', async choice => {
  const s = await prepareChoiceConflict('my chosen words', 'remote words');
  let faults = 0;
  try {
    s.h.storage.writeFailureFor = (key, value) => {
      const exactCheckpoint = Array.isArray(key) && key[0] === 'checkpoint'
        && key[1] === owner && key[2] === s.editorId;
      const selectedChoiceWrite = choice === 'local' && exactCheckpoint && value !== undefined
        && typeof value === 'object' && value !== null && 'completedCommits' in value
        && Array.isArray(value.completedCommits) && value.completedCommits.includes(s.request.id);
      const selectedChoiceDelete = choice === 'remote' && exactCheckpoint && value === undefined;
      if (selectedChoiceWrite || selectedChoiceDelete) faults += 1;
      return selectedChoiceWrite || selectedChoiceDelete;
    };
    let firstChoiceError: unknown;
    try {
      if (choice === 'local') await s.editor.keepLocal();
      else await s.editor.acceptRemote();
    } catch (error) { firstChoiceError = error; }
    s.h.storage.writeFailureFor = undefined;
    expect(faults).toBeGreaterThan(0);
    expect(firstChoiceError).toMatchObject({ message: 'disk full' });

    const unchanged = await s.h.checkpoints.read(owner, s.editorId);
    expect(unchanged).toEqual(s.checkpoint);
    const requestAfterFailure = (await s.h.commits.list(owner)).find(item => item.id === s.request.id);
    expect(requestAfterFailure).toMatchObject({ state: 'conflict', value: { title: 'my chosen words' } });

    if (choice === 'local') await s.editor.keepLocal();
    else await s.editor.acceptRemote();
    await settleEngine();
    expect(s.editor.getState().checkpoint.draft).toMatchObject({
      title: choice === 'local' ? 'my chosen words' : 'remote words', scratch: remoteSibling,
    });
  } finally {
    s.h.storage.writeFailureFor = undefined;
    s.browser.dispose();
  }
});

it.each(['local', 'remote'] as const)('keeps later typing across native commit and delayed JS completion for the %s choice', async choice => {
  const s = await prepareChoiceConflict('my chosen words', 'remote words');
  let held = false;
  let reached!: () => void;
  const reachedCompletion = new Promise<void>(resolve => { reached = resolve; });
  try {
    s.h.storage.holdCompletionAfterCommit = (rows, mode) => {
      if (held || mode !== 'readwrite') return false;
      const cancelled = [...rows.values()].some(value => typeof value === 'object' && value !== null
        && 'id' in value && value.id === s.request.id && 'state' in value && value.state === 'cancelled');
      if (!cancelled) return false;
      held = true;
      reached();
      return true;
    };
    const choosing = choice === 'local' ? s.editor.keepLocal() : s.editor.acceptRemote();
    await waitForSignal(reachedCompletion, 'Choice did not reach the committed cancellation transaction');
    const draftBeforeTyping = s.editor.getState().checkpoint.draft;
    if (!draftBeforeTyping) throw new Error('Choice editor had no draft while the native commit completion was held');
    const lateTyping = s.editor.edit({ ...draftBeforeTyping, title: 'later typed words' });
    void lateTyping.catch(() => undefined);
    s.h.storage.holdCompletionAfterCommit = undefined;
    s.h.storage.finishCompletion();
    await choosing;
    await lateTyping;
    await settleEngine();

    expect(s.editor.getState().checkpoint.draft).toMatchObject({ title: 'later typed words', scratch: remoteSibling });
    const disk = await s.h.checkpoints.read(owner, s.editorId);
    expect(disk?.checkpoint.draft).toMatchObject({ title: 'later typed words', scratch: remoteSibling });
  } finally {
    s.h.storage.holdCompletionAfterCommit = undefined;
    if (held) s.h.storage.finishCompletion();
    s.browser.dispose();
  }
});

it.each(['local', 'remote'] as const)('retains typing entered after the %s choice call but before checkpoint projection', async choice => {
  const s = await prepareChoiceConflict('my chosen words', 'remote words');
  const original = s.h.commits.compareAndSetWithCheckpoint?.bind(s.h.commits);
  if (!original) throw new Error('Native compare-and-set checkpoint capability is unavailable');
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const reachedProjection = new Promise<void>(resolve => { reached = resolve; });
  const projectionSpy = jest.spyOn(s.h.commits, 'compareAndSetWithCheckpoint').mockImplementationOnce(async (changes, project) => {
    reached();
    await held;
    return original(changes, project);
  });
  try {
    const choosing = choice === 'local' ? s.editor.keepLocal() : s.editor.acceptRemote();
    await waitForSignal(reachedProjection, 'Choice did not reach checkpoint projection');
    const draftAtTyping = s.editor.getState().checkpoint.draft;
    if (!draftAtTyping) throw new Error('Choice editor had no draft when late typing was entered');
    const lateTyping = s.editor.edit({ ...draftAtTyping, title: 'typed after choice click' });
    void lateTyping.catch(() => undefined);
    release();
    await choosing;
    await lateTyping;
    await settleEngine();

    expect(s.editor.getState().checkpoint.draft).toMatchObject({ title: 'typed after choice click', scratch: remoteSibling });
    const disk = await s.h.checkpoints.read(owner, s.editorId);
    expect(disk?.checkpoint.draft).toMatchObject({ title: 'typed after choice click', scratch: remoteSibling });
  } finally {
    release();
    projectionSpy.mockRestore();
    s.browser.dispose();
  }
});

it.each(['local', 'remote'] as const)('rejects a Save registered after native cancellation commit but before %s choice completion', async choice => {
  const s = await prepareChoiceConflict('my chosen words', 'remote words');
  let reached!: () => void;
  const reachedCompletion = new Promise<void>(resolve => { reached = resolve; });
  let held = false;
  try {
    s.h.storage.holdCompletionAfterCommit = (rows, mode) => {
      if (held || mode !== 'readwrite') return false;
      const cancelled = [...rows.values()].some(value => typeof value === 'object' && value !== null
        && 'id' in value && value.id === s.request.id && 'state' in value && value.state === 'cancelled');
      if (!cancelled) return false;
      held = true;
      reached();
      return true;
    };
    const choosing = choice === 'local' ? s.editor.keepLocal() : s.editor.acceptRemote();
    await waitForSignal(reachedCompletion, 'Choice did not commit request cancellation before delayed completion');
    const attemptedSave = s.editor.save().then(
      () => ({ kind: 'resolved' as const }),
      error => ({ kind: 'rejected' as const, error }),
    );
    s.h.storage.holdCompletionAfterCommit = undefined;
    s.h.storage.finishCompletion();
    await choosing;
    const saveOutcome = await within(attemptedSave, 'The Save registered during choice never settled');
    const captureFailedAfterChoice = s.editor.getState().captureFailed;
    const selectedTitle = choice === 'local' ? 'my chosen words' : 'remote words';
    expect(s.editor.getState().checkpoint.draft).toMatchObject({ title: selectedTitle, scratch: remoteSibling });

    const checkpointAfterChoice = await s.h.checkpoints.read(owner, s.editorId);
    if (choice === 'local') expect(checkpointAfterChoice?.checkpoint.draft).toMatchObject({ title: selectedTitle, scratch: remoteSibling });
    else expect(checkpointAfterChoice).toBeUndefined();
    const nextSave = await within(s.editor.save().then(
      () => ({ kind: 'resolved' as const }),
      error => ({ kind: 'rejected' as const, error }),
    ), 'A fresh Save after the completed choice never settled');
    expect(nextSave).toMatchObject({ kind: 'resolved' });
    expect(captureFailedAfterChoice).toBe(false);
    expect(saveOutcome).toMatchObject({ kind: 'rejected', error: { code: 'pending-delivery-first' } });
    await s.engine.retry();
    await settleEngine();
    expect(s.h.server.value).toMatchObject({ title: selectedTitle, scratch: remoteSibling });
  } finally {
    s.h.storage.holdCompletionAfterCommit = undefined;
    if (held) s.h.storage.finishCompletion();
    s.browser.dispose();
  }
});
