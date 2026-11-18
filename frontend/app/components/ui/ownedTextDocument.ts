import { closeHistory } from '@tiptap/pm/history';
import { Selection, TextSelection } from '@tiptap/pm/state';

import { applyForeignContent, canonicalForeignTarget } from './foreignContent';

import type { OwnedTextDocument } from './useEditorOwnedText';
import type { Editor } from '@tiptap/core';

/** The same own replacement is used by owned and legacy editors. */
export function replaceOwnContent(editor: Editor, value: string): void {
  editor.chain()
    .command(({ tr }) => { closeHistory(tr).setMeta('addToHistory', true); return true; })
    .setContent(value, { emitUpdate: false }).run();
}

/** Own appends wait for native input and install the parse of the exact published source. */
export function ownedTextDocument(editor: Editor): OwnedTextDocument {
  return {
    install: value => { applyForeignContent(editor, value); },
    append: value => {
      const { view, state } = editor;
      // Let the normal DOM observer admit native input; never replace a stale document.
      if (view.composing || view.dom.textContent !== state.doc.textContent) return false;
      const target = canonicalForeignTarget(editor, value);
      const from = state.doc.content.findDiffStart(target.content);
      if (from !== null) {
        const end = state.doc.content.findDiffEnd(target.content)!;
        const overlap = Math.max(0, from - Math.min(end.a, end.b));
        const tr = closeHistory(state.tr).setMeta('preventUpdate', true);
        tr.replace(from, end.a + overlap, target.slice(from, end.b + overlap));
        // An append keeps existing positions even when parsing changes a list's attributes.
        const selection = state.selection;
        tr.setSelection(selection instanceof TextSelection
          ? TextSelection.between(tr.doc.resolve(Math.min(selection.anchor, tr.doc.content.size)),
            tr.doc.resolve(Math.min(selection.head, tr.doc.content.size)))
          : Selection.fromJSON(tr.doc, selection.toJSON()));
        tr.setStoredMarks(state.storedMarks);
        editor.view.dispatch(tr);
      }
      return true;
    },
    replace: value => { replaceOwnContent(editor, value); },
  };
}
