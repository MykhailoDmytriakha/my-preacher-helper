import { stand, start, original, insert, settle, finish, hasNoteQuestion, chooseNotice } from '@test-utils/noteOrdering';
import { act } from '@testing-library/react';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { noteRef } from '@test-utils/deviceWorld';

it.each([0, 1])('keeps the receipt and asks about remaining unsaved typing after transcript and Undo at %i ms', async delay => {
  await start();
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  await finish();
  expect((await stand.world.snapshot(noteRef)).value!.recordingSourceIds).toContain('source-1');

  act(() => insert(' Unsubmittedword'));
  await settle();
  const before = await stand.world.snapshot(noteRef);
  expect((await processCommand('owner', {
    protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'), resource: noteRef,
    generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, { ...before.value!, content: original + '\n\nArrivedword', title: 'Remote title' }),
  })).kind).toBe('acknowledged');
  // Leave arrival adoption pending so the public delivery and Undo can share its task.
  await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
  setTimeout(() => {
    void stand.voice.onText('Dictatedword', 'source-1');
    stand.editor.commands.undo();
  }, delay);
  for (let turn = 0; turn < 40; turn++) {
    await stand.world.settle();
    jest.advanceTimersByTime(1);
  }
  await finish();

  expect(stand.autosave.dictationSourceIds).toEqual(['source-1']);
  expect(stand.autosave.content).toContain('Unsubmittedword');
  expect(stand.autosave.content).not.toContain('Dictatedword');
  expect(hasNoteQuestion()).toBe(true);
  await chooseNotice('keep');
  expect(hasNoteQuestion()).toBe(false);
  expect((await stand.world.snapshot(noteRef)).value!.dictationSourceIds).toEqual(['source-1']);
  expect((await stand.world.snapshot(noteRef)).value!.content).toContain('Unsubmittedword');
});

it.each([0, 1])('adopts the arrival and stores a pending receipt after transcript and two Undos at %i ms', async delay => {
  await start();
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  await finish();
  act(() => insert(' Unsubmittedword')); await settle();
  const before = await stand.world.snapshot(noteRef);
  expect((await processCommand('owner', {
    protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'), resource: noteRef,
    generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, { ...before.value!, content: original + '\n\nArrivedword', title: 'Remote title' }),
  })).kind).toBe('acknowledged');
  await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
  setTimeout(() => {
    void stand.voice.onText('Dictatedword', 'source-1');
    expect(stand.editor.commands.undo()).toBe(true);
    expect(stand.editor.commands.undo()).toBe(true);
  }, delay);
  for (let turn = 0; turn < 40; turn++) { await stand.world.settle(); jest.advanceTimersByTime(1); }
  await finish();
  expect(hasNoteQuestion()).toBe(false);
  expect(stand.autosave.content).toBe(original + '\n\nArrivedword');
  const saved = (await stand.world.snapshot(noteRef)).value!;
  expect(saved.content).toBe(original + '\n\nArrivedword');
  expect(saved.title).toBe('Remote title');
  expect(saved.dictationSourceIds).toEqual(['source-1']);
  expect(stand.autosave.dictationSourceIds).toEqual(['source-1']);
});
