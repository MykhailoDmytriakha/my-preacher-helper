import { act, render } from '@testing-library/react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { position } from '@test-utils/foreignContent';
import { markdown, mountedEditor, undo } from '@test-utils/richMarkdownHistory';

import type { Editor } from '@tiptap/core';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

function pressEnter(editor: Editor) {
  let handled = false;
  act(() => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    handled = Boolean(editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)));
  });
  expect(handled).toBe(true);
}

it.each([false, true])('replaces a selection across two list items with a break (backward=%s)', backward => {
  const original = '- First\n- Last\n\nTail';
  const change = jest.fn();
  const view = render(<RichMarkdownEditor value={original} onChange={change} />);
  const editor = mountedEditor(view.container);
  const first = position(editor, 'First', 0);
  const last = position(editor, 'Last', 4);
  act(() => {
    editor.commands.setTextSelection(backward ? { from: last, to: first } : { from: first, to: last });
    editor.view.focus();
  });

  pressEnter(editor);

  expect(editor.state.selection.empty).toBe(true);
  expect(editor.state.selection.$head.parent.textContent).toBe('');
  expect(editor.state.doc.textContent).toBe('Tail');
  expect(editor.state.doc.lastChild?.textContent).toBe('Tail');
  expect(change).toHaveBeenCalledTimes(1);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(original);
});

it('keeps the prefix and suffix in separate numbered items after Enter', () => {
  const original = '4. Left middle\n5. middle Right\n6. Last\n\nTail';
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'Left middle', 5),
      to: position(editor, 'middle Right', 7),
    });
    editor.view.focus();
  });

  pressEnter(editor);

  const list = editor.state.doc.firstChild!;
  expect(list.type.name).toBe('orderedList');
  expect(list.attrs.start).toBe(4);
  expect(list.childCount).toBe(3);
  expect(list.child(0).textContent).toBe('Left ');
  expect(list.child(1).textContent).toBe('Right');
  expect(list.child(2).textContent).toBe('Last');
  expect(editor.state.selection.$head.parent.textContent).toBe('Right');
  expect(editor.state.selection.$head.parentOffset).toBe(0);
  expect(editor.state.doc.lastChild?.textContent).toBe('Tail');
});

it('still makes a new list item when the selection is within one item', () => {
  const view = render(<RichMarkdownEditor value={'- Left cut Right\n- Tail'} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'Left cut Right', 5),
      to: position(editor, 'Left cut Right', 9),
    });
    editor.view.focus();
  });

  pressEnter(editor);

  const list = editor.state.doc.firstChild!;
  expect(list.childCount).toBe(3);
  expect(list.child(0).textContent).toBe('Left ');
  expect(list.child(1).textContent).toBe('Right');
  expect(list.child(2).textContent).toBe('Tail');
});

it('keeps a partial break inside its nested list and preserves neighboring items', () => {
  const original = '- Outer\n  - Left middle\n  - middle Right\n- Keep\n\nTail';
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'Left middle', 5),
      to: position(editor, 'middle Right', 7),
    });
    editor.view.focus();
  });

  pressEnter(editor);

  const outer = editor.state.doc.firstChild!;
  const inner = outer.child(0).child(1);
  expect(inner.type.name).toBe('bulletList');
  expect(inner.childCount).toBe(2);
  expect(inner.child(0).textContent).toBe('Left ');
  expect(inner.child(1).textContent).toBe('Right');
  expect(outer.child(1).textContent).toBe('Keep');
  expect(editor.state.doc.lastChild?.textContent).toBe('Tail');
});

it('splits ordinary paragraphs with the existing Enter behavior', () => {
  const view = render(<RichMarkdownEditor value={'Left cut\n\ncut Right\n\nTail'} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'Left cut', 5),
      to: position(editor, 'cut Right', 4),
    });
    editor.view.focus();
  });

  pressEnter(editor);

  expect(markdown(editor)).toBe('Left \n\nRight\n\nTail');
  expect(editor.state.selection.$head.parent.textContent).toBe('Right');
});

it('creates a plain paragraph before a surviving quote when Enter replaces a heading and its boundary', () => {
  const original = '## First\n\n> Last\n\nTail';
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'First', 0),
      to: position(editor, 'Last', 0),
    });
    editor.view.focus();
  });

  pressEnter(editor);

  const { doc, selection } = editor.state;
  expect(doc.child(0).type.name).toBe('paragraph');
  expect(doc.child(0).textContent).toBe('');
  expect(doc.child(1).type.name).toBe('blockquote');
  expect(doc.child(1).textContent).toBe('Last');
  expect(doc.child(2).textContent).toBe('Tail');
  expect(selection.$head.parent).toBe(doc.child(0));
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(original);
});

it('keeps the starting Bold mark for the next keystroke after replacing a list range', () => {
  const view = render(<RichMarkdownEditor value={'- **First**\n- Last\n\nTail'} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'First', 2),
      to: position(editor, 'Last', 2),
    });
    editor.view.focus();
  });

  pressEnter(editor);
  act(() => { editor.view.dispatch(editor.state.tr.insertText('New')); });

  expect(editor.state.doc.firstChild?.child(1).textContent).toBe('Newst');
  expect(editor.state.doc.firstChild?.child(1).firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(['bold']);
});

it('keeps an entire table when the table extension limits a range to the preceding heading', () => {
  const original = '## First\n\n| Heading |\n| --- |\n| Value |\n\nTail';
  const view = render(<RichMarkdownEditor value={original} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  const table = editor.state.doc.child(1);
  act(() => {
    editor.commands.setTextSelection({
      from: position(editor, 'First', 0),
      to: position(editor, 'Heading', 0),
    });
    editor.view.focus();
  });

  expect(editor.state.selection.$to.parent.type.name).toBe('heading');

  pressEnter(editor);

  const { doc, selection } = editor.state;
  expect(doc.child(0).textContent).toBe('');
  expect(doc.child(1).type.name).toBe('paragraph');
  expect(doc.child(2).eq(table)).toBe(true);
  expect(doc.child(3).textContent).toBe('Tail');
  expect(selection.$head.parent).toBe(doc.child(1));
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(original);
});
