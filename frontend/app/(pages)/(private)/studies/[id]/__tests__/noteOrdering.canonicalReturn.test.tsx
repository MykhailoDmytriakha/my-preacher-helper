import { act } from '@testing-library/react';

import * as foreign from '@/components/ui/foreignContent';
import { position } from '@test-utils/foreignContent';
import { finish, hasNoteQuestion, md, phoneSave, stand, start, stored } from '@test-utils/noteOrdering';

jest.mock('@/components/ui/foreignContent', () => ({ ...jest.requireActual('@/components/ui/foreignContent'), __esModule: true }));

// The node path installs an arrival without a whole-document replacement. It must forget the editor's
// last emission exactly as that replacement does: otherwise the same text returning from the other
// device is mistaken for the echo of the person's typing and the stale spelling stays as the root.
it('saves after the last emitted text returns as an arrival that follows a node-path installation', async () => {
  const initial = 'Alpha words\n\nSpacer one\n\nWorking words\n\nSpacer two\n\nTail words';
  await start(initial);
  const editor = stand.editor;
  act(() => {
    editor.commands.setTextSelection(position(editor, 'Working', 3));
    editor.commands.insertContent('OWN');
  });
  await finish();
  const emitted = md();

  const applied = jest.spyOn(foreign, 'applyForeignContent');
  await phoneSave(`${emitted}\n`);
  const paths = applied.mock.results.map(result => result.value);
  applied.mockRestore();
  expect(paths).toEqual([{ fallback: false }]);

  await phoneSave(emitted);
  act(() => { editor.commands.insertContent(' Laterword'); });
  await finish();

  expect(hasNoteQuestion()).toBe(false);
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(await stored()).toBe(md());
  expect(await stored()).toContain('Laterword');
});
