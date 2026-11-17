import { act, screen } from '@testing-library/react';
import { stand, runHistory, original, md, insert, finish, stored, hasNoteQuestion, hasInlineQuestion } from '@test-utils/noteOrdering';

it('a prompt dictation save refused late offers the global question and preserves later typing', async () => {
  const row = await runHistory([
    { kind: 'dictate', word: 'Dictatedword' }, { kind: 'arriveSame', word: 'Phoneword' },
  ], 'known:prompt-save-late-refusal', { keepMounted: true });
  const local = original + '\n\nDictatedword', remote = original + ' Phoneword';
  expect(row.steps[0]).toMatchObject({ held: 1 });
  expect(row.requests).toHaveLength(1);
  expect(row.requests[0].response?.kind).toBe('conflict');
  expect(row.requests[0].refused).toBeGreaterThan(row.requests[0].issued);

  // The production-shaped identity exposes the existing global decision.
  expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
  expect(stand.autosave.content).toBe(local);
  expect(md()).toBe(local);
  expect(stand.editor.view.dom).toHaveTextContent('Dictatedword');
  expect(hasNoteQuestion()).toBe(true);
  expect(hasInlineQuestion()).toBe(false);
  expect(stand.autosave.saveBlocked).toBeFalsy();
  expect(await stored()).toBe(remote);
  expect(stand.laptop.engine.getPending()).toEqual(expect.arrayContaining([
    expect.objectContaining({ state: 'conflict', command: expect.objectContaining({ operationId: row.requests[0].operationId }) }),
  ]));

  act(() => insert(' Nextword'));
  await finish();
  // Later typing is outside the pending global choice and stays visible.
  expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
  expect(screen.getByText('common.saveError')).toBeInTheDocument();
  expect(hasNoteQuestion()).toBe(true);
  expect(hasInlineQuestion()).toBe(false);
  expect(stand.autosave.saveBlocked).toBeFalsy();
  expect(stand.autosave.content).toBe(local + ' Nextword');
  expect(md()).toBe(local + ' Nextword');
  expect(stand.editor.view.dom).toHaveTextContent('Dictatedword Nextword');
  expect(await stored()).toBe(remote);
  expect(stand.laptop.engine.getPending().filter(entry => entry.state === 'conflict')).toHaveLength(1);
  expect(jest.mocked(stand.laptop.transport.send)).toHaveBeenCalledTimes(1);
});
