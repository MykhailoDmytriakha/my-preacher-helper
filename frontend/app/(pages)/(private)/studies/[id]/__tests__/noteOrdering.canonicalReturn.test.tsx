import { act } from '@testing-library/react';

import * as foreign from '@/components/ui/foreignContent';
import { position } from '@test-utils/foreignContent';
import { finish, hasNoteQuestion, md, phoneSave, stand, start, stored } from '@test-utils/noteOrdering';

jest.mock('@/components/ui/foreignContent', () => ({ ...jest.requireActual('@/components/ui/foreignContent'), __esModule: true }));

// A node-path installation and a later byte-equal arrival both become the page's content base.
// Neither requires an editor mark or an echo witness.
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
