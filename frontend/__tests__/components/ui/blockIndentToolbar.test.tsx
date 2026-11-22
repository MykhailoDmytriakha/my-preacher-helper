import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { RichMarkdownToolbar } from '@/components/ui/RichMarkdownToolbar';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';

/* The toolbar's «move right / move left» on a real editor: shown, enabled only where something can move, and it moves. */
const markdownOf = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

function editorAt(markdown: string, words: string) {
  const editor = new Editor({ extensions: richMarkdownExtensions(), content: markdown });
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(words)) at = pos + node.text.indexOf(words);
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  return editor;
}

it('moves a fallen verse back into its step from the toolbar, and then offers to move it out again', () => {
  const editor = editorAt('1. **Created**\n\n*Gen 1:26: «image»*', 'Gen 1:26');
  render(<RichMarkdownToolbar editor={editor as never} />);
  const right = screen.getByRole('button', { name: 'richText.indent' });
  expect(right).toBeEnabled();
  expect(screen.getByRole('button', { name: 'richText.outdent' })).toBeDisabled();
  act(() => { fireEvent.click(right); });
  expect(markdownOf(editor)).toBe('1. **Created**\n\n   *Gen 1:26: «image»*');
  expect(screen.getByRole('button', { name: 'richText.outdent' })).toBeEnabled();
});

it('keeps both buttons off where nothing can move', () => {
  render(<RichMarkdownToolbar editor={editorAt('Just a paragraph', 'Just') as never} />);
  expect(screen.getByRole('button', { name: 'richText.indent' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'richText.outdent' })).toBeDisabled();
});
