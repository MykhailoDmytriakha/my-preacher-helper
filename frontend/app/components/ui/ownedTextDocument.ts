import { closeHistory } from '@tiptap/pm/history';

import { applyForeignContent, canonicalForeignTarget } from './foreignContent';

import type { OwnedTextDocument } from './useEditorOwnedText';
import type { Editor } from '@tiptap/core';

/** The same own replacement is used by owned and legacy editors. */
export function replaceOwnContent(editor: Editor, value: string): void {
  editor.chain()
    .command(({ tr }) => { closeHistory(tr).setMeta('addToHistory', true); return true; })
    .setContent(value, { emitUpdate: false }).run();
}

/** All three operations are synchronous and silent; only real editor edits emit Markdown. */
export function ownedTextDocument(editor: Editor): OwnedTextDocument {
  return {
    install: value => { applyForeignContent(editor, value); },
    append: block => {
      const target = canonicalForeignTarget(editor, block);
      const { state } = editor;
      const tr = closeHistory(state.tr).setMeta('preventUpdate', true);
      const empty = state.doc.childCount === 1 && state.doc.firstChild!.isTextblock && state.doc.firstChild!.content.size === 0;
      if (empty) tr.replaceWith(0, state.doc.content.size, target.content);
      else tr.insert(state.doc.content.size, target.content);
      editor.view.dispatch(tr);
    },
    replace: value => { replaceOwnContent(editor, value); },
  };
}
