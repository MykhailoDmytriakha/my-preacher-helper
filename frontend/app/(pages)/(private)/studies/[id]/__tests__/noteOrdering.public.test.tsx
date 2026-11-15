import { stand, start, original, settle, md, stored } from '@test-utils/noteOrdering';
import { act } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';

it('public timer witness without added scheduling collaborators', async () => {
  await start(); const sends = jest.spyOn(stand.laptop.transport, 'send');
  const target = original + '\n\nArrivedword';
  const before = await stand.world.snapshot(noteRef);
  expect((await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'),
    resource: noteRef, generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, { ...before.value!, content: target }) })).kind).toBe('acknowledged');
  await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
  setTimeout(() => {

    const state = stand.editor.state;
    stand.editor.view.dispatch(state.tr.insertText(' Typedword', state.doc.content.size - 1));
  }, 0);
  for (let turn = 0; turn < 40; turn++) { await stand.world.settle(); jest.advanceTimersByTime(1); }
  for (const ms of [1600, 2000, 5000, 30000]) await settle(ms);

  expect(md()).toBe(original + ' Typedword');
  expect(stand.autosave.content).toBe(original + ' Typedword');
  expect(sends).toHaveBeenCalledTimes(0);
  const state = stand.editor.state;
  act(() => stand.editor.view.dispatch(state.tr.insertText(' Laterword', state.doc.content.size - 1)));
  for (const ms of [1600, 2000, 5000, 30000]) await settle(ms);

  expect(await stored()).toBe(target);
  expect(sends).toHaveBeenCalledTimes(0);
  expect(stand.autosave.saveBlocked).toBe(true);
  expect(stand.notices).toContain('freshness.conflictTitle');
}, 60000);
