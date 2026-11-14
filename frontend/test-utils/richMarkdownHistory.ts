import { act } from '@testing-library/react';

import type { Editor } from '@tiptap/core';

export function mountedEditor(container: HTMLElement): Editor {
  const root = container.querySelector<HTMLElement & { editor: Editor }>('.tiptap');
  if (!root?.editor) throw new Error('Expected a mounted TipTap editor');
  root.editor.view.setProps({ handleScrollToSelection: () => true });
  return root.editor;
}

export function markdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
}

export function typeAtEnd(editor: Editor, text: string) {
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(text);
  });
}

export function undo(editor: Editor): boolean {
  let result = false;
  act(() => { result = editor.commands.undo(); });
  return result;
}
