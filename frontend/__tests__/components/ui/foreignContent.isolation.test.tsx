import { act, render } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { EditorState, Selection } from '@tiptap/pm/state';
import React from 'react';

import { applyForeignContent } from '@/components/ui/foreignContent';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';
import { nodes, position, productionArrival } from '@test-utils/foreignContent';
import findings from '@test-utils/foreignContentFindings.json';
import inheritedEnter from '@test-utils/foreignContentInheritedEnter.json';
import { nextAction, nextActions } from '@test-utils/foreignSelection';
import { mountedEditor } from '@test-utils/richMarkdownHistory';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

const source = '**First words**\n\nNear before\n\n**Working words**\n\nNear after\n\nLast words';
it.each([
  ['far above', source.replace('First words', 'PHONE First words'), 'Working words'],
  ['far below', source.replace('Last words', 'PHONE Last words'), 'Working words'],
  ['several far runs', source.replace('First words', 'PHONE First words').replace('Last words', 'PHONE Last words'), 'Working words'],
  ['far change above a trailing empty paragraph', 'PHONE First\n\nSpacer\n\n```js\nx\n```', ''],
].flatMap(([name, value, text]) => ['null', 'empty', 'bold', 'italic'].map(marks => ({ name, value, text, marks }))))(
  'keeps the caret, stored marks and next typed character after $name with $marks marks', sample => {
    const before = sample.text ? source : 'First\n\nSpacer\n\n```js\nx\n```';
    const change = jest.fn();
    const view = render(<RichMarkdownEditor value={before} onChange={change} />);
    const editor = mountedEditor(view.container);
    act(() => {
      // Run normalizers before selecting the appended empty paragraph.
      productionArrival(editor, before);
      editor.commands.setTextSelection(sample.text ? position(editor, sample.text, 3) : editor.state.doc.content.size - 1);
      const marks = sample.marks === 'null' ? null : sample.marks === 'empty' ? [] : [editor.schema.marks[sample.marks].create()];
      editor.view.dispatch(editor.state.tr.setStoredMarks(marks));
      editor.view.focus();
    });
    const selection = editor.state.selection;
    const marks = editor.state.storedMarks;
    const effective = marks ?? selection.$head.marks();
    const oldText = selection.$head.parent.textContent;
    const offset = selection.$head.parentOffset;
    change.mockClear();
    view.rerender(<RichMarkdownEditor value={sample.value} onChange={change} />);
    expect(editor.state.selection.$head.parentOffset).toBe(offset);
    expect(editor.state.selection.$head.parent.textContent).toBe(oldText);
    expect(editor.state.storedMarks).toBe(marks);
    expect(editor.view.hasFocus()).toBe(true);
    expect(change).not.toHaveBeenCalled();
    act(() => { editor.commands.insertContent('X'); });
    expect(editor.state.selection.$head.parent.textContent).toBe(oldText.slice(0, offset) + 'X' + oldText.slice(offset));
    expect(editor.state.doc.nodeAt(editor.state.selection.head - 1)!.marks).toEqual(effective);
  },
);

it.each(findings.flatMap(sample => nextActions.map(action => ({ ...sample, action }))))(
  'matches production document and selection through $action after $name', sample => {
    const editors = [0, 1].map(() => new Editor({ extensions: richMarkdownExtensions(), content: 'Start' }));
    try {
      for (const editor of editors) {
        editor.view.setProps({ handleScrollToSelection: () => true });
        const doc = editor.schema.nodeFromJSON(sample.source);
        editor.view.updateState(EditorState.create({ doc, schema: editor.schema, plugins: editor.state.plugins,
          selection: Selection.fromJSON(doc, sample.selection), storedMarks: sample.marks?.map(mark => editor.schema.markFromJSON(mark)) ?? null }));
      }
      const [current, base] = editors;
      expect(applyForeignContent(current, sample.value)).toEqual({ fallback: true });
      productionArrival(base, sample.value);
      expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
      expect(current.state.selection.toJSON()).toEqual(base.state.selection.toJSON());
      const actions = 'actions' in sample ? sample.actions as string[] : [sample.action];
      for (const action of actions) {
        expect(nextAction(current, action)).toBe(nextAction(base, action));
        expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
        expect(current.state.selection.toJSON()).toEqual(base.state.selection.toJSON());
      }
    } finally { editors.forEach(editor => editor.destroy()); }
  },
);

it('preserves the arrived table through two inherited Backspaces exactly as production', () => {
  const before = 'First\n\nLast words\n\nTail';
  const value = 'First\n\n<table><tr><td>PHONEARRIVAL</td><td>Keep</td></tr><tr><td>abcdef</td><td>Last</td></tr></table>\n\nLast words\n\nTail';
  const editors = [0, 1].map(() => new Editor({ extensions: richMarkdownExtensions(), content: before }));
  try {
    const [current, base] = editors;
    for (const editor of editors) {
      editor.view.setProps({ handleScrollToSelection: () => true });
      editor.commands.setTextSelection(position(editor, 'Last words'));
    }
    expect(applyForeignContent(current, value)).toEqual({ fallback: true });
    productionArrival(base, value);
    const arrived = nodes(current.state.doc).find(node => node.type.name === 'table')!;
    for (let key = 0; key < 2; key++) {
      nextAction(current, 'Backspace'); nextAction(base, 'Backspace');
      expect(current.state.doc.toJSON()).toEqual(base.state.doc.toJSON());
      expect(current.state.selection.toJSON()).toEqual(base.state.selection.toJSON());
      expect(nodes(current.state.doc).some(node => node.eq(arrived))).toBe(true);
    }
  } finally { editors.forEach(editor => editor.destroy()); }
});

it('matches the inherited cross-list Enter exception without an arrival in the identical production state', () => {
  const editors = [0, 1].map(() => new Editor({ extensions: richMarkdownExtensions(), content: 'Start' }));
  try {
    const errors = editors.map(editor => {
      editor.view.setProps({ handleScrollToSelection: () => true });
      const doc = editor.schema.nodeFromJSON(inheritedEnter.doc);
      editor.view.updateState(EditorState.create({ doc, schema: editor.schema, plugins: editor.state.plugins,
        selection: Selection.fromJSON(doc, inheritedEnter.selection) }));
      try { nextAction(editor, 'Enter'); return undefined; } catch (error) { return String(error); }
    });
    expect(errors[0]).toContain('Inserted content deeper than insertion position');
    expect(errors[0]).toBe(errors[1]);
    expect(editors[0].state.doc.toJSON()).toEqual(editors[1].state.doc.toJSON());
    expect(editors[0].state.selection.toJSON()).toEqual(editors[1].state.selection.toJSON());
  } finally { editors.forEach(editor => editor.destroy()); }
});
