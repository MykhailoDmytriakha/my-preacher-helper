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
