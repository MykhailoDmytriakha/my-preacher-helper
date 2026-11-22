import { act, fireEvent, screen } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { stand, start, original, md, stored, phoneSave, insert, finish, settle, hasNoteQuestion } from '@test-utils/noteOrdering';

it.each(['content', 'tags', 'title'] as const)('reconsiders the waiting newer row after an acknowledged %s edit makes the page clean', async field => {
  await start();
  let release: (() => void) | undefined;
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
    const response = await deliver(command);
    await new Promise<void>(resolve => { release = resolve; });
    return response;
  });
  if (field === 'content') act(() => insert(' Savedword'));
  else if (field === 'title') fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Local title' } });
  else {
    fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.addTag'), { target: { value: 'Localtag' } });
    fireEvent.keyDown(screen.getByPlaceholderText('studiesWorkspace.addTag'), { key: 'Enter' });
  }
  if (field !== 'tags') await settle();
  await act(async () => {
    jest.advanceTimersByTime(1600);
    for (let i = 0; i < 10000; i++) await Promise.resolve();
  });
  expect(release).toBeDefined();
  expect(stand.autosave.content).toBe(field === 'content' ? original + ' Savedword' : original);
  const target = (await stored()) + '\n\nNewerword';
  const before = await stand.world.snapshot(noteRef);
  expect((await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner',
    operationId: stand.world.id('phone'), resource: noteRef, generation: before.metadata!.generation,
    dependsOn: [], changes: diffFields(before.value!, { ...before.value!, content: target }) })).kind).toBe('acknowledged');
  // The ACK is intentionally withheld: do not call the stand's silence/quiescence assertion.
  await act(async () => {
    await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
    for (let i = 0; i < 10000; i++) await Promise.resolve();
  });
  expect(md()).not.toContain('Newerword');
  await act(async () => { release!(); });
  await finish();
  expect(md()).toBe(target);
  expect(stand.autosave.content).toBe(target);
  expect(stand.confirmed?.content).toBe(target);
  expect(hasNoteQuestion()).toBe(false);
  expect(screen.queryByText('common.saved')).toBeTruthy();
});

it('reconsiders the waiting newer row after Undo returns to the confirmed text', async () => {
  await start();
  act(() => insert(' Retractedword'));
  await settle();
  const target = original + '\n\nNewerword';
  await phoneSave(target);
  expect(md()).toContain('Retractedword');
  act(() => { expect(stand.editor.commands.undo()).toBe(true); });
  await finish();
  expect(md()).toBe(target);
  expect(stand.autosave.content).toBe(target);
  expect(stand.confirmed?.content).toBe(target);
  expect(hasNoteQuestion()).toBe(false);
});
