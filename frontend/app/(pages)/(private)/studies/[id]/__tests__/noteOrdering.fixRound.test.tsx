import { stand, start, original, md, stored, phoneSave, insert, finish } from '@test-utils/noteOrdering';
import { act, fireEvent, screen } from '@testing-library/react';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { noteRef } from '@test-utils/deviceWorld';

it.each([
  ['trailing newline', 'Original.\n', 'Original.'],
  ['strong delimiter', '__Original.__', '**Original.**'],
  ['list bullet', '* Original.', '- Original.'],
])('saves typing after a settled equivalent arrival: %s', async (_name, initial, arrival) => {
  await start(initial, true);
  const before = md();
  await phoneSave(arrival);
  expect(md()).toBe(before);
  act(() => insert(' Typedword'));
  await finish();
  expect(await stored()).toContain('Typedword');
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
});

async function arriveBeforeInput(input: () => void) {
  const before = await stand.world.snapshot(noteRef);
  expect((await processCommand('owner', {
    protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'), resource: noteRef,
    generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, { ...before.value!, content: original + '\n\nArrivedword' }),
  })).kind).toBe('acknowledged');
  await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
  setTimeout(input, 0);
  for (let turn = 0; turn < 40; turn++) {
    await stand.world.settle();
    jest.advanceTimersByTime(1);
  }
  await finish();
}

it('preserves title input scheduled before passive arrival adoption', async () => {
  await start();
  await arriveBeforeInput(() => fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Typedtitle' } }));
  expect(stand.autosave.title).toBe('Typedtitle');
  expect((await stand.world.snapshot(noteRef)).value!.title).toBe('Typedtitle');
  expect(await stored()).toContain('Arrivedword');
});

it('preserves tag input scheduled before passive arrival adoption', async () => {
  await start();
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.addTag'), { target: { value: 'Typedtag' } });
  await arriveBeforeInput(() => fireEvent.keyDown(screen.getByPlaceholderText('studiesWorkspace.addTag'), { key: 'Enter' }));
  expect(stand.autosave.tags).toContain('Typedtag');
  expect((await stand.world.snapshot(noteRef)).value!.tags).toContain('Typedtag');
});

it('preserves reference input scheduled before passive arrival adoption', async () => {
  await start();
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder'), { target: { value: 'John 3:16' } });
  await arriveBeforeInput(() => fireEvent.keyDown(screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder'), { key: 'Enter' }));
  expect(stand.autosave.scriptureRefs).toHaveLength(1);
  expect((await stand.world.snapshot(noteRef)).value!.scriptureRefs).toHaveLength(1);
});

it('preserves type input scheduled before passive arrival adoption', async () => {
  await start();
  await arriveBeforeInput(() => fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.type.question' })));
  expect(stand.autosave.type).toBe('question');
  expect((await stand.world.snapshot(noteRef)).value!.type).toBe('question');
});

it('preserves recording source delivery scheduled before passive arrival adoption', async () => {
  await start();
  await arriveBeforeInput(() => { stand.voice.onSourcePersisted?.('recording-source'); });
  expect(stand.autosave.recordingSourceIds).toContain('recording-source');
  expect((await stand.world.snapshot(noteRef)).value!.recordingSourceIds).toContain('recording-source');
});
