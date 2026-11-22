import { act, screen } from '@testing-library/react';
import { stand, runHistory, original, md, insert, finish, stored, hasNoteQuestion, hasInlineQuestion } from '@test-utils/noteOrdering';

it('a prompt dictation save refused late offers one question in the note and preserves later typing', async () => {
  const row = await runHistory([
    { kind: 'dictate', word: 'Dictatedword' }, { kind: 'arriveSame', word: 'Phoneword' },
  ], 'known:prompt-save-late-refusal', { keepMounted: true });
  const local = original + '\n\nDictatedword', remote = original + ' Phoneword';
  expect(row.steps[0]).toMatchObject({ held: 1 });
  expect(row.requests).toHaveLength(1);
  expect(row.requests[0].response?.kind).toBe('conflict');
  expect(row.requests[0].refused).toBeGreaterThan(row.requests[0].issued);

  // The mounted session owns the decision for the submitted take.
  expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
  expect(stand.autosave.content).toBe(local);
  expect(md()).toBe(local);
  expect(stand.editor.view.dom).toHaveTextContent('Dictatedword');
  expect(hasNoteQuestion()).toBe(true);
  expect(hasInlineQuestion()).toBe(true);
  expect(stand.autosave.saveBlocked).toBe(true);
  expect(await stored()).toBe(remote);
  expect(stand.session?.state?.result).toMatchObject({ kind: 'conflict', operationId: row.requests[0].operationId });

  act(() => insert(' Nextword'));
  await finish();
  // Later typing stays visible while the submitted words are still contested.
  expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
  expect(hasNoteQuestion()).toBe(true);
  expect(hasInlineQuestion()).toBe(true);
  expect(stand.autosave.saveBlocked).toBe(true);
  expect(stand.autosave.content).toBe(local + ' Nextword');
  expect(md()).toBe(local + ' Nextword');
  expect(stand.editor.view.dom).toHaveTextContent('Dictatedword Nextword');
  expect(await stored()).toBe(remote);
  expect(Object.keys(stand.session?.state?.checkpoint.pending ?? {})).toHaveLength(1);
  expect(jest.mocked(stand.laptop.transport.send)).toHaveBeenCalledTimes(1);
});
