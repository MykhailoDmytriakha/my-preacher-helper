import { act, fireEvent, screen } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';

import { draftKey, saveDraft } from '@/utils/durableDraft';
import { noteRef } from '@test-utils/deviceWorld';
import { start, stand, original, md, insert, finish, hasNoteQuestion } from '@test-utils/noteOrdering';

it('restoring a second draft with identical body does not add a body undo or move the caret', async () => {
  await start();
  stand.leave();
  const opening = { title: 'Original', content: original, tags: [], scriptureRefs: [], type: 'note' as const };
  const first = { ...opening, title: 'First recovered title' };
  const secondOpening = { ...first, content: original + ' Ownword' };
  const second = { ...secondOpening, title: 'Second recovered title' };
  const firstKey = draftKey('owner', 'note-x', 'note', 'first-legacy-opening');
  const secondKey = draftKey('owner', 'note-x', 'note', 'second-legacy-opening');
  expect(saveDraft(firstKey, first, undefined, false, 2, opening)).toBe(true);
  expect(saveDraft(secondKey, second, undefined, false, 1, secondOpening)).toBe(true);

  await stand.reopen();
  expect(screen.getByRole('combobox', { name: 'unsavedDraft.chooseCopy' })).toHaveValue(firstKey);
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await finish();
  expect((await stand.world.snapshot(noteRef)).value).toMatchObject(first);

  const editor = stand.editor;
  editor.view.setProps({ handleScrollToSelection: () => true });
  act(() => insert(' Ownword'));
  await finish();
  expect((await stand.world.snapshot(noteRef)).value).toMatchObject(secondOpening);
  act(() => editor.commands.setTextSelection(3));
  const bodyState = () => ({ depth: undoDepth(editor.state), selection: editor.state.selection.toJSON(), content: md() });
  const before = bodyState();
  expect(before).toMatchObject({ depth: 1, content: second.content });

  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await finish();
  expect((await stand.world.snapshot(noteRef)).value).toMatchObject(second);
  expect(stand.editor).toBe(editor);
  expect(bodyState()).toEqual(before);
  expect({
    question: hasNoteQuestion(), first: localStorage.getItem(firstKey), second: localStorage.getItem(secondKey),
  }).toEqual({ question: false, first: null, second: null });

  act(() => { expect(editor.commands.undo()).toBe(true); });
  expect(md()).toBe(original);
});
