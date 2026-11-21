import { TextSelection } from '@tiptap/pm/state';
import { act, cleanup, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';

import type { Editor } from '@tiptap/core';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
afterEach(cleanup);

const paragraphs = Array.from({ length: 8 }, (_, index) => 'Paragraph ' + (index + 1) + ': abcdefghijklmnopqrstuvwxyz.');
const original = paragraphs.join('\n\n');
const later = 'Paragraph 7: saved on the other device.';
const withArrival = paragraphs.map((text, index) => index === 6 ? later : text).join('\n\n');

function selectText(editor: Editor, text: string, anchorOffset: number, headOffset = anchorOffset) {
  let start: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.isText && node.text === text) start = position;
  });
  if (start === undefined) throw new Error('Fixture text not found');
  const anchor = start + anchorOffset;
  const head = start + headOffset;
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
    editor.view.focus();
  });
}

function position(editor: Editor) {
  const { $anchor, $head } = editor.state.selection;
  return {
    anchorText: $anchor.parent.textContent,
    headText: $head.parent.textContent,
    anchorOffset: $anchor.parentOffset,
    headOffset: $head.parentOffset,
  };
}

it.each([
  { name: 'caret', anchor: 15, head: 15 },
  { name: 'forward range', anchor: 15, head: 20 },
  { name: 'backward range', anchor: 20, head: 15 },
])('keeps the $name in an unchanged paragraph through a remote update and types there', ({ anchor, head }) => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  selectText(editor, paragraphs[2], anchor, head);
  const before = position(editor);

  view.rerender(<RichMarkdownEditor value={withArrival} onChange={onChange} />);

  expect(position(editor)).toEqual(before);
  expect(editor.view.hasFocus()).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  act(() => editor.commands.insertContent('X'));
  const result = markdown(editor).split('\n\n');
  expect(result[2]).toBe(paragraphs[2].slice(0, Math.min(anchor, head)) + 'X' + paragraphs[2].slice(Math.max(anchor, head)));
  expect(result[6]).toBe(later);
});

it('keeps typing in the original table cell when an unrelated paragraph changes', () => {
  const table = '| Col A | Col B |\n| --- | --- |\n| abcdef | Other cell |';
  const before = 'Before.\n\n' + table + '\n\nBelow.';
  const after = 'Longer opening.\n\n' + table + '\n\nBelow from the other device.';
  const view = render(<RichMarkdownEditor value={before} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  selectText(editor, 'abcdef', 3);
  const previous = position(editor);

  view.rerender(<RichMarkdownEditor value={after} onChange={jest.fn()} />);

  expect(position(editor)).toEqual(previous);
  act(() => editor.commands.insertContent('X'));
  expect(markdown(editor)).toContain('abcXdef');
  expect(markdown(editor)).toContain('Below from the other device.');
});

it('waits for the active place to be left if the arriving text replaced the caret region', async () => {
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  selectText(editor, paragraphs[2], 25);
  const first = original.replace(paragraphs[2], 'Paragraph 3: First foreign version.');
  const latest = first.replace('First foreign version.', 'Second foreign version.');

  view.rerender(<RichMarkdownEditor value={first} onChange={onChange} />);
  view.rerender(<RichMarkdownEditor value={latest} onChange={onChange} />);

  expect(markdown(editor)).toBe(original);
  await act(async () => { editor.view.dom.blur(); });
  expect(markdown(editor)).toBe(latest);
  expect(onChange).not.toHaveBeenCalled();
});

it('holds the typist’s text for a choice when the arriving version replaced the active place', () => {
  const onChange = jest.fn();
  const settle = jest.fn();
  const onHoldText = jest.fn(() => settle);
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} onHoldText={onHoldText} />);
  const editor = mountedEditor(view.container);
  selectText(editor, paragraphs[2], 25);
  const arrived = original.replace(paragraphs[2], 'Paragraph 3: Different words from the phone.');
  view.rerender(<RichMarkdownEditor value={arrived} onChange={onChange} onHoldText={onHoldText} />);

  act(() => editor.commands.insertContent('OWN'));

  expect(onChange).not.toHaveBeenCalled();
  expect(onHoldText).toHaveBeenCalledWith(original.replace(paragraphs[2], paragraphs[2].slice(0, 25) + 'OWN' + paragraphs[2].slice(25)));
});

it('holds typing into the drawn document while React installs a foreign value', () => {
  const onChange = jest.fn();
  const onHoldText = jest.fn();
  const arrived = original.replace(paragraphs[2], 'Paragraph 3: Different words from the phone.');
  function WithIncomingValue({ value }: { value: string }) {
    useLayoutEffect(() => {
      if (value === arrived) {
        expect(markdown(editor)).toBe(original);
        editor.commands.insertContent('OWN');
      }
    }, [value]);
    return <RichMarkdownEditor value={value} onChange={onChange} onHoldText={onHoldText} />;
  }
  const view = render(<WithIncomingValue value={original} />);
  const editor = mountedEditor(view.container);
  selectText(editor, paragraphs[2], 25);
  view.rerender(<WithIncomingValue value={arrived} />);

  expect(onChange).not.toHaveBeenCalled();
  expect(onHoldText).toHaveBeenCalledWith(original.replace(paragraphs[2],
    paragraphs[2].slice(0, 25) + 'OWN' + paragraphs[2].slice(25)));
});

it('shows a disjoint arriving edit while protecting the changed active paragraph from autosave', () => {
  const onChange = jest.fn();
  const onHoldText = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} onHoldText={onHoldText} />);
  const editor = mountedEditor(view.container);
  selectText(editor, paragraphs[2], 25);
  const arrived = withArrival.replace(paragraphs[2], 'Paragraph 3: The phone replaced these words.');

  view.rerender(<RichMarkdownEditor value={arrived} onChange={onChange} onHoldText={onHoldText} />);

  expect(markdown(editor)).toBe(withArrival);
  expect(position(editor).anchorOffset).toBe(25);
  act(() => editor.commands.insertContent('OWN'));
  expect(onChange).not.toHaveBeenCalled();
  expect(onHoldText).toHaveBeenCalledWith(withArrival.replace(
    paragraphs[2], paragraphs[2].slice(0, 25) + 'OWN' + paragraphs[2].slice(25),
  ));
});

it('keeps a pending Bold choice when a distant arrival is followed by typing and Undo', () => {
  const onChange = jest.fn();
  const onEditAfterForeignValue = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} onEditAfterForeignValue={onEditAfterForeignValue} />);
  const editor = mountedEditor(view.container);
  selectText(editor, paragraphs[2], 25);
  act(() => { editor.commands.toggleBold(); });
  expect(editor.state.storedMarks?.map(mark => mark.type.name)).toEqual(['bold']);

  view.rerender(<RichMarkdownEditor value={withArrival} onChange={onChange} onEditAfterForeignValue={onEditAfterForeignValue} />);

  expect(editor.state.storedMarks?.map(mark => mark.type.name)).toEqual(['bold']);
  expect(onEditAfterForeignValue).not.toHaveBeenCalled();
  act(() => { editor.view.dispatch(editor.state.tr.insertText('X')); });
  expect(markdown(editor)).toContain(paragraphs[2].slice(0, 25) + '**X**' + paragraphs[2].slice(25));
  expect(onEditAfterForeignValue.mock.calls).toEqual([[withArrival]]);
  act(() => { expect(editor.commands.undo()).toBe(true); });
  expect(markdown(editor)).toBe(withArrival);
  expect(onEditAfterForeignValue.mock.calls).toEqual([[withArrival]]);
});

it('keeps an arriving adjacent table out of reach of an in-flight Backspace', async () => {
  const original = 'Work here.\n\nTail.';
  const arrived = '| Heading |\n| --- |\n| PHONE ARRIVAL |\n\n' + original;
  const onChange = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={onChange} />);
  const editor = mountedEditor(view.container);
  selectText(editor, 'Work here.', 0);

  view.rerender(<RichMarkdownEditor value={arrived} onChange={onChange} />);

  expect(markdown(editor)).toBe(original);
  expect(position(editor).anchorOffset).toBe(0);
  act(() => {
    editor.view.someProp('handleKeyDown', handle => handle(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })));
  });
  expect(markdown(editor)).toBe(original);
  expect(onChange).not.toHaveBeenCalled();
  selectText(editor, 'Work here.', 4);
  await act(async () => {});
  expect(markdown(editor)).toContain('PHONE ARRIVAL');
  expect(position(editor).anchorOffset).toBe(4);
  expect(onChange).not.toHaveBeenCalled();
});
