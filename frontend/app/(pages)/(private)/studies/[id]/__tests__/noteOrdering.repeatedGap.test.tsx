import { act, fireEvent, screen } from '@testing-library/react';
import { noteRef, noteValue } from '@test-utils/deviceWorld';
import { stand, md, stored, insert, pulse, finish, runHistory, openNotice, chooseNotice,
  hasGlobalNotice, hasInlineQuestion, hasNoteQuestion } from '@test-utils/noteOrdering';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { captureRecoveryChoice } from '@/data-engine/recoveryChoice';
import type { ResourceRef } from '@/data-engine/types';

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
async function refuseReplacement(remote: string) {
  const sends = jest.mocked(stand.laptop.transport.send);
  const deliver = sends.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  sends.mockImplementation(async command => { entered = true; await gate; return deliver(command); });
  try {
    await openNotice();
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    await drain();
    expect(entered).toBe(true);
    await phone(remote);
  } finally {
    release();
    await drain();
    sends.mockImplementation(deliver);
  }
  expect(hasGlobalNotice()).toBe(true);
}

// Permanent U121-01: use the actual buttons for both choices, not an invented completion event.
it.each([false, true])('second keep after replacement refusal protects every gap transaction (typing=%s)', async typing => {
  const local = await refused();
  const sends = jest.mocked(stand.laptop.transport.send);
  const sendsBefore = sends.mock.calls.length;
  const shown = [md()];
  const observe = () => { shown.push(md()); };
  stand.editor.on('transaction', observe);
  await refuseReplacement('Thirdword');
  const afterRefusal = md();
  const engine = stand.laptop.engine;
  const open = engine.openEditor.bind(engine);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  const spy = jest.spyOn(engine, 'openEditor').mockImplementation(async (...args) => {
    const editor = await open(...args), save = editor.save.bind(editor);
    editor.save = async () => { entered = true; await gate; return save(); };
    return editor;
  });
  let gap: string, typedGap: string, gapSends: number;
  let gapStored: Awaited<ReturnType<typeof stored>>;
  try {
    await openNotice();
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    await drain();
    expect(entered).toBe(true);
    gap = md();
    if (typing) { act(() => insert(' Newergapword')); await drain(); }
    typedGap = md();
    gapStored = await stored();
    gapSends = sends.mock.calls.length;
  } finally {
    release();
    await drain();
    spy.mockRestore();
    stand.editor.off('transaction', observe);
  }
  const expected = local + (typing ? ' Newergapword' : '');
  expect({ afterRefusal, gap, typedGap, final: md() }).toEqual({ afterRefusal: local, gap: local, typedGap: expected, final: expected });
  expect(shown.every(value => value === local || (typing && value === expected))).toBe(true);
  expect(stand.autosave.content).toBe(expected);
  expect(gapStored).toBe('Thirdword');
  expect(gapSends).toBe(sendsBefore + 1);
  expect(await stored()).toBe(local);
  // Exactly the two explicit replacements: no save of a new word over the rejected version.
  expect(sends).toHaveBeenCalledTimes(sendsBefore + 2);
  expect(sends).toHaveBeenCalledTimes(3);
  expect(sends.mock.calls.some(([command]) => JSON.stringify(command).includes('Newergapword'))).toBe(false);
  if (typing) expect(hasInlineQuestion()).toBe(true);
  else {
    expect(await stored()).toBe(md());
    expect(stand.versionTaken).not.toHaveBeenCalled();
    expect(hasNoteQuestion()).toBe(false);
    act(() => insert(' Nextword'));
    await finish();
    expect(md()).toBe(local + ' Nextword');
    expect(await stored()).toBe(md());
    expect(hasNoteQuestion()).toBe(false);
  }
}, 60000);

it('three keep mine replacements are each refused before a final keep', async () => {
  const local = await refused();
  const shown = [md()];
  const observe = () => { shown.push(md()); };
  stand.editor.on('transaction', observe);
  for (let round = 1; round <= 3; round++) {
    await refuseReplacement(`Remote${round}word`);
    expect(md()).toBe(local);
    expect(await stored()).toBe(`Remote${round}word`);
    expect((await stand.laptop.engine.listRecoverable(noteRef)).length).toBeGreaterThan(0);
  }
  await chooseNotice('keep');
  stand.editor.off('transaction', observe);
  expect(shown.every(value => value === local)).toBe(true);
  expect(md()).toBe(local);
  expect(await stored()).toBe(local);
  expect(await stored()).toBe(md());
  expect(stand.versionTaken).not.toHaveBeenCalled();
  expect(hasNoteQuestion()).toBe(false);
  expect(stand.laptop.transport.send).toHaveBeenCalledTimes(5);
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe(local + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);

it('take the other version after a refused keep adopts it and saves the next word', async () => {
  const local = await refused();
  await refuseReplacement('Thirdword');
  expect(md()).toBe(local);
  await chooseNotice('take');
  expect(md()).toBe('Thirdword');
  expect(stand.autosave.baselineRef.current?.content).toBe('Thirdword');
  expect(stand.confirmed?.content).toBe('Thirdword');
  expect(hasNoteQuestion()).toBe(false);
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe('Thirdword Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
  expect(stand.laptop.transport.send).toHaveBeenCalledTimes(3);
}, 60000);

it('two notes with waiting choices settle in the opposite order without cross-note adoption', async () => {
  const localX = await refused();
  const other: ResourceRef = { collection: 'studyNotes', id: 'note-y' };
  await stand.world.seed(other, { ...noteValue(), title: 'Other note', type: 'note', content: 'Other original' });
  await act(async () => { await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes')); });
  await stand.remount(other.id);
  const sends = jest.mocked(stand.laptop.transport.send), deliver = sends.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  sends.mockImplementation(async command => { entered = true; await gate; return deliver(command); });
  try {
    act(() => insert(' Yword'));
    await drain();
    expect(entered).toBe(true);
    await phone('Other remote', other);
  } finally {
    release(); await drain(); sends.mockImplementation(deliver);
  }
  const waitingX = await stand.laptop.engine.listRecoverable(noteRef);
  const waitingY = await stand.laptop.engine.listRecoverable(other);
  expect(waitingX.length).toBeGreaterThan(0);
  expect(waitingY.length).toBeGreaterThan(0);
  expect(md()).toBe('Other original Yword');
  // The dock presents one entry at a time. Select Y explicitly through its same public resolver.
  const scopeY = captureRecoveryChoice(waitingY.map(copy => copy.record));
  await act(async () => { await stand.actions.resolve(other, 'theirs', scopeY); });
  await finish();
  expect(md()).toBe('Other remote');
  expect(stand.confirmed?.content).toBe('Other remote');
  expect(await stand.laptop.engine.listRecoverable(other)).toHaveLength(0);
  expect((await stand.laptop.engine.listRecoverable(noteRef)).length).toBeGreaterThan(0);
  await stand.remount(noteRef.id);
  await finish();
  expect(md()).toBe(localX);
  await chooseNotice('keep');
  expect(md()).toBe(localX);
  expect(await stored()).toBe(localX);
  expect((await stand.world.snapshot(other)).value!.content).toBe('Other remote');
  expect(await stand.laptop.engine.listRecoverable()).toHaveLength(0);
  expect(hasNoteQuestion()).toBe(false);
  expect(sends).toHaveBeenCalledTimes(3);
}, 60000);
