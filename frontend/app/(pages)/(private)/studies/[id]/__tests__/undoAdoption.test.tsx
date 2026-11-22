import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import * as foreignContent from '@/components/ui/foreignContent';
import { baseTyping } from '@test-utils/foreignSelection';
import { stand, start, md, stored, settle, phoneSave } from '@test-utils/noteOrdering';
import { act } from '@testing-library/react';

import { redoDepth, undoDepth } from '@tiptap/pm/history';

jest.mock('@/components/ui/foreignContent', () => ({
  ...jest.requireActual('@/components/ui/foreignContent'), __esModule: true,
}));

const original = 'Original paragraph.';
const local = 'Original paragraph. Laptop edit.';
const phoneParagraph = 'Phone paragraph.';
let editorUpdates: string[];

async function openNote(initialContent = original, allowEquivalentSerialization = false) {
  await start(initialContent, allowEquivalentSerialization);
  editorUpdates = [];
  stand.editor.on('update', () => { editorUpdates.push(md()); });
  if (initialContent === original) expect(undoDepth(stand.editor.state)).toBe(0);
}

it.each([
  { name: 'earlier typing and one Undo', priorTyping: true, undos: 1, laterTyping: false },
  { name: 'earlier typing and two Undos', priorTyping: true, undos: 2, laterTyping: false },
  { name: 'regression pin: earlier typing without Undo', priorTyping: true, undos: 0, laterTyping: false },
  { name: 'no earlier typing and one Undo', priorTyping: false, undos: 1, laterTyping: false },
  { name: 'no earlier typing and two Undos', priorTyping: false, undos: 2, laterTyping: false },
  { name: 'typing, arrival, more typing and two Undos', priorTyping: true, undos: 2, laterTyping: true },
])('keeps the phone paragraph through autosave: $name', async ({ priorTyping, undos, laterTyping }) => {
  await openNote();
  const liveEditor = stand.editor;
  if (priorTyping) {
    act(() => {
      stand.editor.commands.setTextSelection(stand.editor.state.doc.content.size - 1);
      stand.editor.commands.insertContent(' Laptop edit.');
    });
    await settle();
    await settle(1600);
  }
  const savedLocal = priorTyping ? local : original;
  expect(await stored()).toBe(savedLocal);
  expect(stand.confirmed?.content).toBe(savedLocal);
  act(() => stand.editor.view.dom.blur());
  await settle(2000);
  const adopted = savedLocal + '\n\n' + phoneParagraph;
  await phoneSave(adopted);
  expect(stand.editor).toBe(liveEditor);
  expect(md()).toBe(adopted);
  expect(stand.confirmed?.content).toBe(adopted);
  expect(editorUpdates).not.toContain(adopted);
  expect(undoDepth(stand.editor.state)).toBe(0);
  expect(redoDepth(stand.editor.state)).toBe(0);
  if (laterTyping) {
    act(() => {
      stand.editor.commands.setTextSelection(stand.editor.state.doc.content.size - 1);
      stand.editor.commands.insertContent(' More laptop text.');
    });
    await settle();
    expect(md()).toBe(adopted + ' More laptop text.');
  }
  for (let index = 1; index <= undos; index++) {
    act(() => { stand.editor.commands.undo(); });
    await settle();
    await settle(1600);
    await settle(2000);
    const expected = adopted;
    expect(await stored()).toBe(expected);
    expect(md()).toBe(expected);
  }
  expect(stand.notices).toEqual([]);
  expect(stand.laptop.errors).toEqual([]);
  expect(stand.laptop.engine.getPending()).toEqual([]);
  expect(await stored()).toBe(adopted);
});

it('regression pin: keeps the note recording insertion undoable in the same mounted editor', async () => {
  await openNote();
  const editor = stand.editor;
  const voice = stand.voice;
  await act(async () => {
    voice.onSourcePersisted?.('recording-source');
    await voice.onText('Dictated passage.', 'recording-source');
  });
  await settle();
  expect(stand.editor).toBe(editor);
  expect(md()).toBe(original + '\n\nDictated passage.');
  act(() => { stand.editor.commands.undo(); });
  await settle();
  expect(md()).toBe(original);
});

it('B31 ACCEPTED LIMITATION: an arrival retires saved own typing through real note autosave', async () => {
  await openNote();
  const editor = stand.editor;
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' Laptop edit.');
  });
  await settle(1600); await settle(2000);
  const before = { text: md(), stored: await stored(), depth: undoDepth(editor.state) };
  await phoneSave(local + '\n\n' + phoneParagraph);
  const arrival = { text: md(), stored: await stored(), depth: undoDepth(editor.state) };
  const steps = [];
  for (const command of ['undo', 'undo', 'redo'] as const) {
    let result = false;
    act(() => { result = editor.commands[command](); });
    await settle(1600); await settle(2000);
    steps.push({ command, result, text: md(), stored: await stored(), depth: undoDepth(editor.state) });
  }
  expect(before.text).toBe(local);
  expect(arrival.text).toBe(local + '\n\n' + phoneParagraph);
  expect(steps[0]).toEqual(expect.objectContaining({ result: false, text: local + '\n\n' + phoneParagraph, stored: local + '\n\n' + phoneParagraph }));
  expect(steps[1].result).toBe(false);
  expect(steps[2]).toEqual(expect.objectContaining({ result: false, text: local + '\n\n' + phoneParagraph, stored: local + '\n\n' + phoneParagraph }));
});

it('C12 preserves the production table shape through foreign adoption, later typing and note autosave', async () => {
  await openNote('| A | B |\n| --- | --- |\n| abcdef | Keep |', true);
  const editor = stand.editor;
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  await settle(1600); await settle(2000);
  const remote = '| A | B |\n| --- | --- |\n| abef | Keep |';
  await phoneSave(remote);
  expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1);
  expect(md().trim()).toBe(remote);
  act(() => { expect(editor.commands.undo()).toBe(false); expect(editor.commands.redo()).toBe(false); });
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Own.'); });
  await settle(1600); await settle(2000);
  expect(await stored()).toBe(md());
  expect(String(await stored())).toContain('abef');
  expect(String(await stored())).toContain('Own.');
  expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1);
  act(() => { expect(editor.commands.undo()).toBe(true); });
  await settle(1600); await settle(2000);
  expect(String(await stored()).trim()).toBe(remote);
  expect(stand.editor).toBe(editor);
  expect(stand.notices).toEqual([]);
});


it('keeps the note caret at its words through a far arrival and autosave', async () => {
  const initial = 'Alpha abcdef END\n\nMiddle unchanged\n\nTail';
  await openNote(initial);
  const editor = stand.editor;
  const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
  act(() => { editor.commands.setTextSelection(10); editor.view.focus(); });
  const arrived = initial.replace('Tail', 'PHONE Tail');
  await phoneSave(arrived);
  expect(stand.editor).toBe(editor);
  expect(editor.state.selection.anchor).toBe(10);
  const paths = arrivalPath.mock.results.map(result => result.value);
  arrivalPath.mockRestore();
  writeForeignEvidence('caller-note-far', paths);
  expect(paths).toEqual([{ fallback: false }]);
  expect(editor.state.selection.head).toBe(10);
  expect(editorUpdates).toEqual([]);
  expect(await stored()).toBe(arrived);
  act(() => { editor.commands.insertContent('X'); });
  await settle(1600); await settle(2000);
  const expected = 'Alpha abcXdef END\n\nMiddle unchanged\n\nPHONE Tail';
  expect(md()).toBe(expected);
  expect(await stored()).toBe(expected);
  expect(stand.notices).toEqual([]);
});


it('stores the production result after an adjacent arrival in note autosave', async () => {
  const initial = 'First words\n\nLast words\n\nTail';
  await openNote(initial);
  const editor = stand.editor;
  const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  const arrived = initial.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words');
  const expected = baseTyping(editor, arrived);
  await phoneSave(arrived);
  expect(stand.editor).toBe(editor);

  expect(editorUpdates).toEqual([]);
  expect(await stored()).toBe(arrived);
  const paths = arrivalPath.mock.results.map(result => result.value);
  arrivalPath.mockRestore();
  writeForeignEvidence('caller-note-adjacent', paths);
  expect(paths.every(result => result.fallback)).toBe(true);
  expect(editor.state.doc.toJSON()).toEqual(expected.document);
  expect(editor.state.selection.toJSON()).toEqual(expected.selection);
  act(() => { editor.commands.insertContent('X'); });
  await settle(1600); await settle(2000);
  expect(md()).toBe(expected.typed);
  expect(await stored()).toBe(md());

  expect(stand.notices).toEqual([]);
});
