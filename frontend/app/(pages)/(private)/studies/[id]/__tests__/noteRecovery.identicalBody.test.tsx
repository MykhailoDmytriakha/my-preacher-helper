import { act, fireEvent, screen } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';
import { start, stand, md, insert, finish } from '@test-utils/noteOrdering';

it('restoring a second draft with identical body does not add a body undo or move the caret', async () => {
  await start();
  const recovery = (title:string) => ({title, content:md(), tags:[], scriptureRefs:[], type:'note' as const});
  stand.recovery = recovery('First recovered title');
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), {target:{value:'Trigger recovery'}});
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  await finish();
  stand.editor.view.setProps({handleScrollToSelection:()=>true});
  act(() => insert(' Ownword'));
  stand.recovery = recovery('Second recovered title');
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), {target:{value:'Trigger second'}});
  expect(document.querySelector('.tiptap')).toBeTruthy();
  act(() => stand.editor.commands.setTextSelection(3));
  const before = {depth:undoDepth(stand.editor.state), selection:stand.editor.state.selection.toJSON(), content:md()};
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  const after = {depth:undoDepth(stand.editor.state), selection:stand.editor.state.selection.toJSON(), content:md()};
  expect(after).toEqual(before);
});
