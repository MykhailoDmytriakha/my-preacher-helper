import { stand, start, original, insert, settle, finish, hasNoteQuestion } from '@test-utils/noteOrdering';
import { act } from '@testing-library/react';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { noteRef } from '@test-utils/deviceWorld';

it.each([0, 1])('retains a persisted source dictation receipt after transcript and Undo at %i ms', async delay => {
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

  expect({
    pageReceipt: stand.autosave.dictationSourceIds,
    storedReceipt: (await stand.world.snapshot(noteRef)).value!.dictationSourceIds,
    question: hasNoteQuestion(),
    notices: stand.notices,
  }).toEqual({ pageReceipt: ['source-1'], storedReceipt: ['source-1'], question: false, notices: [] });
});
