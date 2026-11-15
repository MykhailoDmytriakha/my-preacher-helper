import React, { useLayoutEffect } from 'react';
import { act, render } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useEditorValue } from '@/components/ui/useEditorValue';
import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';
jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it.each([false, true])('directed W3 preserves the document and Undo, own=%s', own => {
  let supply!: (value: string) => void;
  let armed = false;
  const changes: string[] = [], replacements: string[] = [];
  function Host() {
    const value = useEditorValue('Original.');
    supply = own ? value.act : value.observe;
    useLayoutEffect(() => {
      if (!armed || value.value !== 'Original.\n\nPHONE.') return;
      armed = false;
      editor.view.dispatch(editor.state.tr.insertText(' Typedword', editor.state.doc.content.size - 1));
    }, [value.value]);
    return <RichMarkdownEditor value={value.value} valueIsUserAction={value.isUserAction} valueBeforeUserAction={value.foreignValueBeforeAction}
      onChange={next => { changes.push(next); value.observe(next); }} />;
  }
  const view = render(<Host />); const editor = mountedEditor(view.container);
  editor.on('transaction', ({ transaction }) => {
    if (transaction.getMeta('preventUpdate')) replacements.push(transaction.doc.textContent);
  });
  armed = true; act(() => supply('Original.\n\nPHONE.'));
  expect(changes).toEqual(['Original. Typedword']);
  expect(markdown(editor)).toBe('Original. Typedword');
  expect(replacements).toEqual([]);
  expect(undoDepth(editor.state)).toBe(1);
  view.unmount();
});

it('reports a foreign application once before onChange and never marks typing echoes', () => {
  const events: string[] = [];
  let supply!: (value: string) => void;
  function Host() {
    const [value, set] = React.useState('Original.'); supply = set;
    return <RichMarkdownEditor value={value} onEditAfterForeignValue={basis => events.push('root:' + basis)}
      onChange={next => { events.push('change:' + next); set(next); }} />;
  }
  const view = render(<Host />); const editor = mountedEditor(view.container);
  const type = (text: string) => act(() => editor.view.dispatch(editor.state.tr.insertText(text, editor.state.doc.content.size - 1)));
  type(' First'); type(' Second');
  act(() => supply('Foreign.')); type(' Third'); type(' Fourth');
  expect(events).toEqual(['root:Original.', 'change:Original. First', 'change:Original. First Second',
    'root:Foreign.', 'change:Foreign. Third', 'change:Foreign. Third Fourth']);
  view.unmount();
});

it('an installed own value drops a pending foreign mark', () => {
  const roots: string[] = [];
  let supply!: (value: string) => void;
  function Host() {
    const value = useEditorValue('Original.'); supply = value.act;
    return <RichMarkdownEditor value={value.value} valueIsUserAction={value.isUserAction} valueBeforeUserAction={value.foreignValueBeforeAction}
      onEditAfterForeignValue={basis => roots.push(basis)} onChange={value.observe} />;
  }
  const view = render(<Host />); const editor = mountedEditor(view.container);
  act(() => supply('Original. Ownword'));
  act(() => editor.view.dispatch(editor.state.tr.insertText(' Typedword', editor.state.doc.content.size - 1)));
  expect(roots).toEqual([]);
  expect(markdown(editor)).toBe('Original. Ownword Typedword');
  view.unmount();
});
