import { TextSelection } from '@tiptap/pm/state';
import { act, fireEvent, screen } from '@testing-library/react';

import { noteRef } from '@test-utils/deviceWorld';
import { finish, hasNoteQuestion, md, phoneSave, stand, start, stored } from '@test-utils/noteOrdering';

function selectWords(words: string, anchorOffset: number, headOffset = anchorOffset) {
  const editor = stand.editor;
  let start: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.isText && node.text === words) start = position;
  });
  if (start === undefined) throw new Error('Missing fixture words: ' + words);
  const base = start;
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, base + anchorOffset, base + headOffset)));
    editor.view.focus();
  });
  expect(editor.view.hasFocus()).toBe(true);
}

function editingPlace() {
  const { $anchor, $head } = stand.editor.state.selection;
  return [$anchor.parent.textContent, $anchor.parentOffset, $head.parent.textContent, $head.parentOffset];
}

it.each([
  ['the next cell', 'Intro.\n\n| First | Second |\n| --- | --- |\n| Keep my place | Old neighbor |\n\nTail.'],
  ['the previous list item', 'Intro.\n\n- Old neighbor\n- Keep my place\n- Final item\n\nTail.'],
])('keeps a backwards selection when another device edits %s and saves both edits', async (_case, opening) => {
  const arriving = opening.replace('Old neighbor', 'Updated words from the phone');
  await start(opening, true);
  selectWords('Keep my place', 7, 5);

  await phoneSave(arriving);

  expect(editingPlace()).toEqual(['Keep my place', 7, 'Keep my place', 5]);
  expect(md()).toContain('Updated words from the phone');
  act(() => { stand.editor.view.dispatch(stand.editor.state.tr.insertText('our')); });
  await finish();
  expect(hasNoteQuestion()).toBe(false);
  expect(await stored()).toContain('Keep our place');
  expect(await stored()).toContain('Updated words from the phone');
});

it('keeps the editing place while nearby incoming content could be reached by Backspace', async () => {
  const opening = 'Work here.\n\nTail.';
  const arrival = '| Column |\n| --- |\n| Words from the phone |\n\n' + opening;
  await start(opening);
  selectWords('Work here.', 0);
  await phoneSave(arrival);

  expect(editingPlace()).toEqual(['Work here.', 0, 'Work here.', 0]);
  expect(md()).toBe(opening);
  act(() => {
    const { view } = stand.editor;
    view.someProp('handleKeyDown', handle => handle(view, new KeyboardEvent('keydown', { key: 'Backspace' })));
  });
  expect(md()).toBe(opening);
  expect(await stored()).toBe(arrival);

  selectWords('Work here.', 4);
  await act(async () => {});
  expect(editingPlace()).toEqual(['Work here.', 4, 'Work here.', 4]);
  expect(md()).toContain('Words from the phone');
});

it('uses the displayed paragraph as the opening when the user types before leaving a changed place', async () => {
  const opening = 'Intro.\n\nOn the desk.\n\nTail.';
  const arrival = opening.replace('On the desk.', 'New words from the phone.');
  await start(opening);
  selectWords('On the desk.', 11);
  await phoneSave(arrival);

  expect(editingPlace()).toEqual(['On the desk.', 11, 'On the desk.', 11]);
  expect(md()).toBe(opening);
  act(() => { stand.editor.view.dispatch(stand.editor.state.tr.insertText(' today')); });
  await finish();

  expect(hasNoteQuestion()).toBe(true);
  expect(await stored()).toBe(arrival);
  expect(md()).toContain('On the desk today.');
});

it('keeps the caret and the phone words when dictation appends during a held arrival', async () => {
  const opening = 'Work here.\n\nTail.';
  const arrival = '| Column |\n| --- |\n| Words from the phone |\n\n' + opening;
  await start(opening);
  selectWords('Work here.', 0);
  await phoneSave(arrival);

  await act(async () => { await stand.voice.onText('Spoken words.', 'caret-source'); });
  await finish();
  expect(editingPlace()).toEqual(['Work here.', 0, 'Work here.', 0]);
  expect(md()).toBe(opening + '\n\nSpoken words.');
  expect(await stored()).toBe(arrival + '\n\nSpoken words.');
  expect(hasNoteQuestion()).toBe(false);

  act(() => { expect(stand.editor.commands.undo()).toBe(true); });
  await finish();
  expect(hasNoteQuestion()).toBe(false);
  expect(await stored()).toBe(arrival);
});

it('does not use a pending title save as proof that its unseen body was displayed', async () => {
  const opening = 'Intro.\n\nOn the desk.\n\nTail.';
  const arrival = opening.replace('On the desk.', 'New words from the phone.');
  await start(opening);
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Later title' } });
  selectWords('On the desk.', 11);
  await phoneSave(arrival);
  expect(editingPlace()).toEqual(['On the desk.', 11, 'On the desk.', 11]);

  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  let releaseTitle!: () => void;
  const gate = new Promise<void>(resolve => { releaseTitle = resolve; });
  const sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
    await gate;
    return deliver(command);
  });
  try {
    await act(async () => {
      jest.advanceTimersByTime(1600);
      for (let i = 0; i < 5000 && !sends.mock.calls.length; i++) await Promise.resolve();
    });
    expect(sends).toHaveBeenCalled();
    await act(async () => { stand.editor.view.dispatch(stand.editor.state.tr.insertText(' today')); });
  } finally {
    releaseTitle();
  }
  await finish();

  expect(hasNoteQuestion()).toBe(true);
  expect(await stored()).toBe(arrival);
  expect((await stand.world.snapshot(noteRef)).value?.title).toBe('Later title');
  expect(md()).toContain('On the desk today.');
});

it.each(['Undo', 'return to the same words'])('keeps the phone version after %s before the next save', async cancel => {
  const opening = 'Intro.\n\nOn the desk.\n\nTail.';
  const arrival = opening.replace('On the desk.', 'New words from the phone.');
  const typed = ' today';
  await start(opening);
  selectWords('On the desk.', 11);
  await phoneSave(arrival);

  act(() => { stand.editor.view.dispatch(stand.editor.state.tr.insertText(typed)); });
  await act(async () => {});
  expect(md()).toContain('On the desk today.');
  act(() => {
    const editor = stand.editor;
    if (cancel === 'Undo') {
      expect(editor.commands.undo()).toBe(true);
    } else {
      const end = editor.state.selection.head;
      editor.view.dispatch(editor.state.tr.delete(end - typed.length, end));
    }
  });
  await finish();

  expect(hasNoteQuestion()).toBe(false);
  expect(await stored()).toBe(arrival);
  expect(stand.confirmed?.content).toBe(arrival);
  selectWords('Tail.', 2);
  await act(async () => {});
  expect(md()).toBe(arrival);
});

it('does not author the first phone copy when canceling a draft after a second one arrives', async () => {
  const opening = 'Intro.\n\nOn the desk.\n\nTail.';
  const first = opening.replace('On the desk.', 'First replacement from the phone.');
  const later = opening.replace('On the desk.', 'Second replacement from the phone.');
  await start(opening);
  selectWords('On the desk.', 11);
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  await phoneSave(first);
  act(() => { stand.editor.view.dispatch(stand.editor.state.tr.insertText(' today')); });
  await act(async () => {});
  await phoneSave(later);
  expect(md()).toContain('On the desk today.');

  act(() => { expect(stand.editor.commands.undo()).toBe(true); });
  await finish();

  expect(hasNoteQuestion()).toBe(false);
  expect(sends).not.toHaveBeenCalled();
  expect(await stored()).toBe(later);
  expect(stand.confirmed?.content).toBe(later);
  selectWords('Tail.', 2);
  await act(async () => {});
  expect(md()).toBe(later);
});
