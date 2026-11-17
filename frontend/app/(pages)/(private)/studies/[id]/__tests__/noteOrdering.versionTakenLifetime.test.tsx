import { act, fireEvent, screen } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { stand, md, stored, insert, pulse, finish, runHistory, openNotice, chooseNotice,
  hasGlobalNotice, hasNoteQuestion } from '@test-utils/noteOrdering';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { captureRecoveryChoice } from '@/data-engine/recoveryChoice';

// Held delivery/capture is intentional; the world's quiescence check cannot run in these gaps.
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
  expect(hasGlobalNotice()).toBe(true);
  return md();
}
it.each(['keep', 'take', 'take-returned-base'] as const)('delayed collection after version choice %s', async choice => {
  const local = await refused();
  if (choice === 'take-returned-base') await phone('Original paragraph.\n\nSecond paragraph.');
  const remote = await stored();
  stand.holdCollection();
  await chooseNotice(choice === 'keep' ? 'keep' : 'take');
  expect(md()).toBe(local);
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

it.each(['mine', 'theirs'] as const)('refusal and next choice without a page render %s', async choice => {
  const local = await refused();
  const sends = jest.mocked(stand.laptop.transport.send), deliver = sends.getMockImplementation()!;
  let releaseDelivery!: () => void;
  const deliveryGate = new Promise<void>(resolve => { releaseDelivery = resolve; });
  let delivered = false;
  sends.mockImplementation(async command => { delivered = true; await deliveryGate; return deliver(command); });
  await openNotice();
  fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
  await drain();
  expect(delivered).toBe(true);
  await phone('Thirdword');
  const engine = stand.laptop.engine, open = engine.openEditor.bind(engine);
  let releaseCapture!: () => void;
  const captureGate = new Promise<void>(resolve => { releaseCapture = resolve; });
  let entered = false;
  const spy = jest.spyOn(engine, 'openEditor').mockImplementation(async (...args) => {
    const editor = await open(...args), save = editor.save.bind(editor);
    editor.save = async () => { entered = true; await captureGate; return save(); };
    return editor;
  });
  let resolving: Promise<number> | undefined;
  try {
    await act(async () => {
      const renderBefore = stand.autosave;
      releaseDelivery();
      await pulse();
      const waiting = await engine.listRecoverable(noteRef);
      expect(waiting.length).toBeGreaterThan(0);
      expect(stand.autosave).toBe(renderBefore);
      resolving = stand.actions.resolve(noteRef, choice, captureRecoveryChoice(waiting.map(copy => copy.record)));
      if (choice === 'theirs') await resolving;
      await pulse();
      expect(stand.autosave).toBe(renderBefore);
    });
    await drain();
    const gap = md();
    expect(gap).toBe(choice === 'mine' ? local : 'Thirdword');
    if (choice === 'mine') expect(entered).toBe(true);
  } finally {
    releaseCapture();
    if (resolving) await act(async () => { await resolving; });
    sends.mockImplementation(deliver);
    spy.mockRestore();
    await drain();
  }
  expect(md()).toBe(choice === 'mine' ? local : 'Thirdword');
  expect(await stored()).toBe(md());
  expect(stand.versionTaken).toHaveBeenCalledTimes(Number(choice === 'theirs'));
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe((choice === 'mine' ? local : 'Thirdword') + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);

it('actual second Keep button with coalesced collection notifications preserves local words', async () => {
  const local = await refused();
  const sends = jest.mocked(stand.laptop.transport.send), deliver = sends.getMockImplementation()!;
  let releaseDelivery!: () => void;
  const deliveryGate = new Promise<void>(resolve => { releaseDelivery = resolve; });
  sends.mockImplementation(async command => { await deliveryGate; return deliver(command); });
  await openNotice();
  fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
  await drain();
  await phone('Thirdword');
  stand.holdCollection();
  const beforeRefusal = stand.renderCount;
  releaseDelivery();
  await drain();
  const afterRefusal = stand.renderCount;
  expect(hasGlobalNotice()).toBe(true);
  expect((await stand.laptop.engine.listRecoverable(noteRef)).length).toBeGreaterThan(0);
  const engine = stand.laptop.engine, open = engine.openEditor.bind(engine);
  let releaseCapture!: () => void;
  const captureGate = new Promise<void>(resolve => { releaseCapture = resolve; });
  let entered = false;
  const spy = jest.spyOn(engine, 'openEditor').mockImplementation(async (...args) => {
    const editor = await open(...args), save = editor.save.bind(editor);
    editor.save = async () => { entered = true; await captureGate; return save(); };
    return editor;
  });
  try {
    await openNotice();
    const beforeChoice = stand.renderCount;
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    await drain();
    expect(entered).toBe(true);
    await act(async () => { stand.releaseCollection(); });
    await drain();
    expect(afterRefusal).toBe(beforeRefusal);
    expect(beforeChoice).toBe(beforeRefusal);
    expect(md()).toBe(local);
  } finally {
    releaseCapture();
    await drain();
    sends.mockImplementation(deliver);
    spy.mockRestore();
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
    await openNotice();
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
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
