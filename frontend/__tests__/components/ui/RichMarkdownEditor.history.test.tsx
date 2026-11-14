import { act, fireEvent, render } from '@testing-library/react';
import { closeHistory, redoDepth, undoDepth } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import React from 'react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { markdown, mountedEditor, typeAtEnd, undo } from '@test-utils/richMarkdownHistory';
import { ProductionSetContentReference } from '@test-utils/ProductionSetContentReference';
import { richMarkdownCorpus } from '@test-utils/richMarkdownCorpus';

import type { Transaction } from '@tiptap/pm/state';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

const original = 'Original paragraph.';
const phone = '\n\nPhone paragraph.';

it.each([false, true])('reconciles a confirmed append while preserving newer input, newer input=%s', hasNewerInput => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  typeAtEnd(editor, ' Typed.');
  const written = markdown(editor);
  if (hasNewerInput) typeAtEnd(editor, ' Newer.');
  const visibleBeforeAppend = markdown(editor);
  const after = written + phone;
  view.rerender(<RichMarkdownEditor value={after} observedAppend={{ before: written, after }} onChange={onChange} />);
  expect(markdown(editor)).toBe(hasNewerInput ? visibleBeforeAppend : after);
});

it.each([false, true])('ACCEPTED LIMITATION: foreign arrival retires all Undo/Redo, earlier typing=%s', earlierTyping => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  if (earlierTyping) {
    typeAtEnd(editor, ' Laptop edit.');
    view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={onChange} />);
  }
  const adopted = markdown(editor) + phone;
  onChange.mockClear();
  view.rerender(<RichMarkdownEditor value={adopted} onChange={onChange} />);
  expect(markdown(editor)).toBe(adopted);
  expect(undoDepth(editor.state)).toBe(0);
  expect(redoDepth(editor.state)).toBe(0);
  expect(undo(editor)).toBe(false);
  act(() => { expect(editor.commands.redo()).toBe(false); });
  expect(markdown(editor)).toBe(adopted);
  expect(onChange).not.toHaveBeenCalled();
});

it.each([false, true])('undoes and redoes later own actions without crossing the foreign boundary, prop action=%s', propAction => {
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  typeAtEnd(editor, ' Laptop edit.');
  view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
  const adopted = markdown(editor) + phone;
  view.rerender(<RichMarkdownEditor value={adopted} onChange={jest.fn()} />);
  if (propAction) view.rerender(<RichMarkdownEditor value={adopted + ' Later edit.'} valueIsUserAction onChange={jest.fn()} />);
  else typeAtEnd(editor, ' Later edit.');
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(adopted);
  expect(undo(editor)).toBe(false);
  act(() => { expect(editor.commands.redo()).toBe(true); });
  expect(markdown(editor)).toBe(adopted + ' Later edit.');
  act(() => { expect(editor.commands.redo()).toBe(false); });
});

it.each([
  ['same paragraph', ' Mine.', 'Start. Mine. Phone. End.'],
  ['own range contains arrival', ' abcdef', 'Start. abXYef End.'],
  ['arrival contains own range', ' Mine.', 'StaPHONEEnd.'],
  ['shared left edge', ' abcdef', 'Start. XYdef End.'],
  ['shared right edge', ' abcdef', 'Start. abcXY End.'],
  ['foreign deletion', ' abcdef', 'Start. abef End.'],
])('ACCEPTED LIMITATION: retires earlier typing for %s', (_shape, own, arrived) => {
  const view = render(<RichMarkdownEditor value="Start. End." onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.insertContentAt(7, own); });
  view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
  view.rerender(<RichMarkdownEditor value={arrived} onChange={jest.fn()} />);
  expect(undo(editor)).toBe(false);
  act(() => { expect(editor.commands.redo()).toBe(false); });
  expect(markdown(editor)).toBe(arrived);
  typeAtEnd(editor, ' Later.');
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(arrived);
  act(() => { expect(editor.commands.redo()).toBe(true); });
  expect(markdown(editor)).toBe(arrived + ' Later.');
});

it.each(['overlap', 'append'])('retires pre-arrival replacement Redo for %s', shape => {
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  view.rerender(<RichMarkdownEditor value="Requested replacement." valueIsUserAction onChange={jest.fn()} />);
  expect(undo(editor)).toBe(true);
  view.rerender(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  expect(redoDepth(editor.state)).toBe(1);
  const arrived = shape === 'append' ? original + phone : 'Phone replacement.';
  view.rerender(<RichMarkdownEditor value={arrived} onChange={jest.fn()} />);
  act(() => { expect(editor.commands.redo()).toBe(false); });
  expect(undo(editor)).toBe(false);
  expect(markdown(editor)).toBe(arrived);
});

it('retires history again on each arrival, including own edits inside the first arrival', () => {
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  for (let count = 1; count <= 4; count++) {
    typeAtEnd(editor, ' Own.');
    view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
    const adopted = markdown(editor) + phone;
    view.rerender(<RichMarkdownEditor value={adopted} onChange={jest.fn()} />);
    expect(undo(editor)).toBe(false);
    act(() => { expect(editor.commands.redo()).toBe(false); });
    expect(markdown(editor)).toBe(adopted);
  }
});

it.each(['older overlap', 'untouched middle'])('ACCEPTED LIMITATION: retires untouched-paragraph history for %s (U63-02/U63-03)', shape => {
  const initial = shape === 'older overlap' ? 'Start. End.\n\nOther.' : 'First.\n\nMiddle.\n\nLast.';
  const view = render(<RichMarkdownEditor value={initial} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  if (shape === 'older overlap') {
    act(() => { editor.commands.insertContentAt(7, ' abcdef'); });
    view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
    act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); });
    typeAtEnd(editor, ' Safe.');
  } else act(() => { editor.commands.insertContentAt(15, ' Mine.'); });
  view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
  const arrived = shape === 'older overlap' ? 'Start. abPHONEef End.\n\nOther. Safe.' : 'First PHONE.\n\nMiddle. Mine.\n\nLast TABLET.';
  view.rerender(<RichMarkdownEditor value={arrived} onChange={jest.fn()} />);
  expect(undoDepth(editor.state)).toBe(0);
  expect(undo(editor)).toBe(false);
  act(() => { expect(editor.commands.redo()).toBe(false); });
  expect(markdown(editor)).toBe(arrived);
});

it('retires both live branches while preserving plugin instances, order and non-history state', () => {
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  typeAtEnd(editor, ' Own.');
  const own = markdown(editor);
  view.rerender(<RichMarkdownEditor value={own} onChange={jest.fn()} />);
  view.rerender(<RichMarkdownEditor value="Requested." valueIsUserAction onChange={jest.fn()} />);
  expect(undo(editor)).toBe(true);
  view.rerender(<RichMarkdownEditor value={own} onChange={jest.fn()} />);
  expect(undoDepth(editor.state)).toBe(1);
  expect(redoDepth(editor.state)).toBe(1);
  const start = jest.fn(), destroy = jest.fn(), token = {};
  const observer = new Plugin({
    state: { init: () => token, apply: (_transaction, previous) => previous },
    view: () => { start(); return { destroy }; },
  });
  act(() => { editor.registerPlugin(observer); });
  const plugins = editor.state.plugins;
  const register = jest.spyOn(editor, 'registerPlugin'), unregister = jest.spyOn(editor, 'unregisterPlugin');
  view.rerender(<RichMarkdownEditor value={own + phone} onChange={jest.fn()} />);
  expect(undoDepth(editor.state)).toBe(0);
  expect(redoDepth(editor.state)).toBe(0);
  expect(editor.state.plugins).toEqual(plugins);
  editor.state.plugins.forEach((plugin, index) => expect(plugin).toBe(plugins[index]));
  expect(observer.getState(editor.state)).toBe(token);
  expect(start).toHaveBeenCalledTimes(2);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(register).not.toHaveBeenCalled();
  expect(unregister).not.toHaveBeenCalled();
  expect(mountedEditor(view.container)).toBe(editor);
});

it('regression pin: makes each requested replacement exactly one separate Undo step', () => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  typeAtEnd(editor, ' Earlier.');
  const before = markdown(editor);
  view.rerender(<RichMarkdownEditor value={before} onChange={onChange} />);
  onChange.mockClear();
  view.rerender(<RichMarkdownEditor value="Requested replacement." valueIsUserAction onChange={onChange} />);
  expect(undoDepth(editor.state)).toBe(2);
  expect(onChange).not.toHaveBeenCalled();
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(before);
  expect(undoDepth(editor.state)).toBe(1);
  act(() => { expect(editor.commands.redo()).toBe(true); });
  expect(markdown(editor)).toBe('Requested replacement.');
});

it.each([false, true])('regression pin: initial and identical values leave history untouched, own origin=%s', own => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} valueIsUserAction={own} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  expect(undoDepth(editor.state)).toBe(0);
  typeAtEnd(editor, ' Own.');
  const typed = markdown(editor);
  view.rerender(<RichMarkdownEditor value={typed} valueIsUserAction={own} onChange={onChange} />);
  undo(editor);
  const state = editor.state;
  expect(redoDepth(state)).toBe(1);
  view.rerender(<RichMarkdownEditor value={original} onChange={onChange} />);
  expect(editor.state).toBe(state);
  act(() => { editor.commands.redo(); });
  expect(markdown(editor)).toBe(typed);
});

it.each(richMarkdownCorpus)('matches production setContent Markdown AND JSON for foreign and own corpus %s', (_name, source) => {
  const onChange = jest.fn();
  const view = render(<><RichMarkdownEditor value="Before." onChange={onChange} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
  const roots = view.container.querySelectorAll<HTMLElement>('.tiptap');
  const editor = mountedEditor(roots[0].parentElement!);
  const reference = mountedEditor(roots[1].parentElement!);
  act(() => { reference.commands.setContent(source, { emitUpdate: false }); });
  view.rerender(<><RichMarkdownEditor value={source} onChange={onChange} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
  expect(markdown(editor)).toBe(markdown(reference));
  expect(editor.getJSON()).toEqual(reference.getJSON());
  expect(onChange).not.toHaveBeenCalled();
  view.rerender(<><RichMarkdownEditor value="Before." onChange={onChange} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
  const before = editor.getJSON();
  view.rerender(<><RichMarkdownEditor value={source} valueIsUserAction onChange={onChange} /><RichMarkdownEditor value="Reference." onChange={jest.fn()} /></>);
  expect(editor.getJSON()).toEqual(reference.getJSON());
  expect(markdown(editor)).toBe(markdown(reference));
  expect(undo(editor)).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});

it.each([
  ['repeat insertion', 'aaaa', 'aaaaa'], ['repeat deletion', 'aaaaa', 'aaaa'],
  ['mark change', 'One two three', 'One **two** three'], ['delete all', 'Words.', ''],
])('uses one full-document setContent transaction outside history for %s', (_name, before, after) => {
  const view = render(<RichMarkdownEditor value={before} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  const transactions: Transaction[] = [];
  editor.on('transaction', ({ transaction }) => { transactions.push(transaction); });
  const oldSize = editor.state.doc.content.size;
  view.rerender(<RichMarkdownEditor value={after} onChange={jest.fn()} />);
  expect(markdown(editor)).toBe(after);
  expect(transactions).toHaveLength(1);
  expect(transactions[0].steps).toHaveLength(1);
  expect(transactions[0].steps[0].toJSON()).toMatchObject({ stepType: 'replace', from: 0, to: oldSize });
  expect(transactions[0].getMeta('addToHistory')).toBe(false);
  expect(transactions[0].getMeta('preventUpdate')).toBe(true);
  expect(undo(editor)).toBe(false);
});

it('keeps a foreign append when Undo removes letters composed during its arrival', async () => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  fireEvent.compositionStart(editor.view.dom, { data: '' });
  typeAtEnd(editor, ' 日本語');
  const arrived = original + phone;
  view.rerender(<RichMarkdownEditor value={arrived} onChange={onChange} />);
  expect(markdown(editor)).toBe(original + ' 日本語');
  await act(async () => { fireEvent.compositionEnd(editor.view.dom, { data: '日本語' }); });
  expect(markdown(editor)).toBe(original + ' 日本語' + phone);
  expect(onChange).toHaveBeenCalledTimes(1);
  onChange.mockClear();
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(arrived);
  expect(onChange).toHaveBeenLastCalledWith(arrived);
  expect(undo(editor)).toBe(false);
});

it.each([false, true].flatMap(composing => [
  { composing, name: 'paragraphs', source: 'First old phrase.\n\nUntouched paragraph.\n\nLast.', arrived: 'First PHONE.\n\nUntouched paragraph.\n\nLast TABLET.' },
  { composing, name: 'table', source: '| A | B |\n| --- | --- |\n| abcdef | Keep |', arrived: '| A | B |\n| --- | --- |\n| abef | Keep |' },
  { composing, name: 'list', source: '- First abcdef\n- Last', arrived: '- First abef\n- Last PHONE' },
  { composing, name: 'code', source: '```js\nabcdef\n```', arrived: '```js\nabef\n```' },
]))('applies the production replacement in $name after composition=$composing has settled', async ({ composing, source, arrived }) => {
  const initial = render(<ProductionSetContentReference value={source} />);
  const positions: number[] = [];
  mountedEditor(initial.container).state.doc.descendants((node, start) => {
    if (node.isTextblock) for (let offset = 0; offset <= node.content.size; offset++) positions.push(start + 1 + offset);
  });
  initial.unmount();
  const endpoints = [positions[0], positions[Math.floor(positions.length / 2)], positions[positions.length - 1]];
  const selections = [
    ...positions.map(from => ({ from, to: from })),
    ...endpoints.flatMap(from => endpoints.map(to => ({ from, to }))),
  ];
  for (const selection of selections) {
    // Mount one focused editor at a time. Two simultaneous synthetic compositions share a DOM selection.
    const control = render(<ProductionSetContentReference value={source} />);
    const reference = mountedEditor(control.container);
    act(() => { reference.commands.setTextSelection(selection); reference.view.focus(); });
    control.rerender(<ProductionSetContentReference value={arrived} editable={false} />);
    const expectedSelection = reference.state.selection.toJSON();
    const expectedJSON = reference.getJSON();
    const expectedComposing = reference.view.composing, expectedFocus = reference.isFocused;
    control.unmount();
    const onChange = jest.fn();
    const view = render(<RichMarkdownEditor value={source} onChange={onChange} />);
    const editor = mountedEditor(view.container);
    act(() => { editor.commands.setTextSelection(selection); editor.view.focus(); });
    if (composing) fireEvent.compositionStart(editor.view.dom, { data: '' });
    const beforeJSON = editor.getJSON();
    onChange.mockClear();
    view.rerender(<RichMarkdownEditor value={arrived} editable={false} onChange={onChange} />);
    if (composing) {
      expect(editor.getJSON()).toEqual(beforeJSON);
      await act(async () => { fireEvent.compositionEnd(editor.view.dom, { data: '' }); });
      expect(undo(editor)).toBe(false);
    } else {
      expect({ selection, actual: editor.state.selection.toJSON() }).toEqual({ selection, actual: expectedSelection });
      expect(editor.view.composing).toBe(expectedComposing);
      expect(editor.isFocused).toBe(expectedFocus);
    }
    expect(editor.isEditable).toBe(false);
    expect(editor.getJSON()).toEqual(expectedJSON);
    expect(onChange).not.toHaveBeenCalled();
    view.unmount();
  }
});
