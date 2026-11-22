import { act, fireEvent, within } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { stand, md, stored, insert, pulse, finish, runHistory, chooseNotice,
  hasInlineQuestion, hasNoteQuestion } from '@test-utils/noteOrdering';
import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { DataEngine } from '@/data-engine/engine';
import { editorSlot } from '@/data-engine/editorIdentity';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';

function clickKeep() {
  const workspace = within(document.querySelector<HTMLElement>('[data-note-workspace]')!);
  fireEvent.click(workspace.getByRole('button', { name: 'dataSync.useLocalVersion' }));
}

// Held delivery is intentional; the world's quiescence check cannot run in these gaps.
async function drain() {
  for (const ms of [0, 1600, 2000, 5000, 30000]) await act(async () => { await pulse(ms); });
}
async function phone(content: string, resource = noteRef) {
  const before = await stand.world.snapshot(resource);
  expect((await processCommand('owner', {
    protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'), resource,
    generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, { ...before.value!, content }),
  })).kind).toBe('acknowledged');
  await act(async () => {
    await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
    await pulse();
  });
}
async function refused() {
  await runHistory([{ kind: 'type', word: 'Typed' }, { kind: 'timer' }, { kind: 'arriveSame', word: 'Phone' }],
    'repeated-gap', { keepMounted: true });
  expect(hasInlineQuestion()).toBe(true);
  return md();
}
it.each(['keep', 'take', 'take-returned-base'] as const)('delayed collection after version choice %s', async choice => {
  const local = await refused();
  if (choice === 'take-returned-base') await phone('Original paragraph.\n\nSecond paragraph.');
  const remote = await stored();
  stand.holdCollection();
  await chooseNotice(choice === 'keep' ? 'keep' : 'take');
  expect(md()).toBe(choice === 'keep' ? local : remote);
  await act(async () => { stand.releaseCollection(); });
  await finish();
  expect(md()).toBe(choice === 'keep' ? local : remote);
  if (choice !== 'keep') expect(stand.confirmed?.content).toBe(md());
  else {
    expect(await stored()).toBe(md());
    expect(stand.versionTaken).not.toHaveBeenCalled();
  }
  expect(hasNoteQuestion()).toBe(false);
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe((choice === 'keep' ? local : remote) + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);

// Delay only editor-to-view notifications. The mounted session and its writes stay live.
function deferSessionNotifications() {
  const open = DataEngine.prototype.openEditor;
  const waiting = new Set<() => void>();
  let paused = false;
  // The stand installs its own Jest spy on each engine instance. A plain wrapper
  // keeps that spy independent and delegates to the real asynchronous opening.
  DataEngine.prototype.openEditor = async function (resource, id, options) {
    const editor = await open.call(this, resource, id, options);
    if (resource.collection === noteRef.collection && resource.id === noteRef.id && editorSlot(id) === 'study-note') {
      const subscribe = editor.subscribe.bind(editor);
      editor.subscribe = notify => subscribe(() => {
        if (paused) waiting.add(notify);
        else notify();
      });
    }
    return editor;
  };
  return {
    pause() { paused = true; },
    resume() {
      paused = false;
      for (const notify of waiting) notify();
      waiting.clear();
      DataEngine.prototype.openEditor = open;
    },
  };
}

it.each(['mine', 'theirs'] as const)('a reviewed version cannot be chosen after a newer refusal without a page render (%s)', async choice => {
  const notifications = deferSessionNotifications();
  try {
    const local = await refused();
    const sends = jest.mocked(stand.laptop.transport.send);
    const deliver = sends.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    sends.mockImplementationOnce(async command => { entered = true; await gate; return deliver(command); });
    try {
      const session = stand.session!;
      const hiddenCandidate = session.state!.checkpoint;
      expect(hiddenCandidate.remoteCandidate?.value?.content).not.toBe('Thirdword');
      clickKeep();
      await drain();
      expect(entered).toBe(true);
      await phone('Thirdword');
      stand.holdCollection();
      notifications.pause();
      await act(async () => {
        const renders = stand.renderCount;
        release();
        await pulse();
        const waiting = await createIndexedDbCheckpoints().listRecoverable('owner', noteRef);
        expect(waiting.map(({ record: { checkpoint } }) => ({
          draft: checkpoint.draft?.content, candidate: checkpoint.remoteCandidate?.value?.content,
        }))).toContainEqual({ draft: local, candidate: 'Thirdword' });
        expect(stand.renderCount).toBe(renders);
        const staleChoice = choice === 'mine' ? session.keepLocal(hiddenCandidate) : session.acceptRemote(hiddenCandidate);
        await expect(staleChoice).rejects.toMatchObject({ code: 'decision-changed' });
        expect(stand.renderCount).toBe(renders);
        expect(md()).toBe(local);
        expect(await stored()).toBe('Thirdword');
      });
    } finally {
      release();
      await act(async () => {
        notifications.resume();
        stand.releaseCollection();
      });
      await drain();
    }
    await chooseNotice(choice === 'mine' ? 'keep' : 'take');
    const expected = choice === 'mine' ? local : 'Thirdword';
    expect(md()).toBe(expected);
    expect(await stored()).toBe(expected);
    expect(hasNoteQuestion()).toBe(false);
    act(() => insert(' Nextword'));
    await finish();
    expect(md()).toBe(expected + ' Nextword');
    expect(await stored()).toBe(md());
    expect(hasNoteQuestion()).toBe(false);
  } finally {
    await act(async () => { notifications.resume(); });
  }
}, 60000);

it('actual second Keep button with coalesced collection notifications preserves local words', async () => {
  const local = await refused();
  const sends = jest.mocked(stand.laptop.transport.send);
  const deliver = sends.getMockImplementation()!;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  let entered = false;
  sends.mockImplementationOnce(async command => { await firstGate; return deliver(command); });
  sends.mockImplementationOnce(async command => { entered = true; await secondGate; return deliver(command); });
  try {
    clickKeep();
    await drain();
    await phone('Thirdword');
    stand.holdCollection();
    releaseFirst();
    await drain();
    expect(hasInlineQuestion()).toBe(true);
    const waiting = await createIndexedDbCheckpoints().listRecoverable('owner', noteRef);
    expect(waiting.map(copy => copy.record.checkpoint.draft?.content)).toContain(local);
    clickKeep();
    await drain();
    expect(entered).toBe(true);
    expect(md()).toBe(local);
    expect(await stored()).toBe('Thirdword');
    await act(async () => { stand.releaseCollection(); });
    await drain();
    expect(md()).toBe(local);
    expect(await stored()).toBe('Thirdword');
  } finally {
    releaseFirst();
    releaseSecond();
    await act(async () => { stand.releaseCollection(); });
    await drain();
  }
  expect(md()).toBe(local);
  expect(await stored()).toBe(md());
  expect(stand.versionTaken).not.toHaveBeenCalled();
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe(local + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);

it('keep preserves the editor while replacement delivery is pending and after acceptance', async () => {
  const local = await refused();
  const sends = jest.mocked(stand.laptop.transport.send), deliver = sends.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  sends.mockImplementation(async command => { entered = true; await gate; return deliver(command); });
  try {
    clickKeep();
    await drain();
    expect(entered).toBe(true);
    expect(md()).toBe(local);
  } finally {
    release();
    await drain();
    sends.mockImplementation(deliver);
  }
  expect(md()).toBe(local);
  expect(await stored()).toBe(local);
  expect(stand.versionTaken).not.toHaveBeenCalled();
  expect(hasNoteQuestion()).toBe(false);
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe(local + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);
