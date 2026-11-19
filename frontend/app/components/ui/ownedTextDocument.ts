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

/** Composition is witnessed by the editor; accepted appends install the exact published parse. */
export function ownedTextDocument(editor: Editor) {
  // The installed Android view ends an idle composition after five seconds without
  // a DOM compositionend. This timer only rechecks its public state; it never ends
  // a composition or treats elapsed time as proof that native input was admitted.
  const compositionCheckMs = 5000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ended: ReturnType<typeof setTimeout> | undefined;
  const waiting = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  const recheck = () => {
    if (editor.isDestroyed || !editor.view.composing) {
      for (const waiter of waiting) {
        if (editor.isDestroyed) waiter.reject(new Error('The note editor closed before text could be appended'));
        else waiter.resolve();
      }
      waiting.clear();
      clearTimeout(retry);
      retry = undefined;
    } else if (waiting.size && retry === undefined) {
      retry = setTimeout(() => { retry = undefined; recheck(); }, compositionCheckMs);
    }
  };
  const afterUpdate = () => {
    // Let all synchronous update listeners publish the admitted document first.
    if (waiting.size) void Promise.resolve().then(recheck);
  };
  editor.on('transaction', afterUpdate);
  editor.on('update', afterUpdate);
  editor.on('destroy', () => {
    clearTimeout(retry);
    clearTimeout(ended);
    // Tiptap emits destroy before destroying its view.
    for (const waiter of waiting) waiter.reject(new Error('The note editor closed before text could be appended'));
    waiting.clear();
  });
  return {
    compositionEnd: () => {
      // ProseMirror handles this same event after handleDOMEvents. Resume after its
      // composition-end microtasks and normal MutationObserver delivery, not inside it.
      clearTimeout(ended);
      ended = setTimeout(recheck, 0);
    },
    waitForComposition: () => new Promise<void>((resolve, reject) => {
      waiting.add({ resolve, reject });
      recheck();
    }),
    install: (value: string) => { applyForeignContent(editor, value); },
    append: (value: string) => {
      const { view, state } = editor;
      if (view.composing) return false;
      const target = canonicalForeignTarget(editor, value);
      const from = state.doc.content.findDiffStart(target.content);
      if (from !== null) {
        const end = state.doc.content.findDiffEnd(target.content)!;
        const overlap = Math.max(0, from - Math.min(end.a, end.b));
        const tr = closeHistory(state.tr).setMeta('preventUpdate', true);
        tr.replace(from, end.a + overlap, target.slice(from, end.b + overlap));
        // Retained suffix positions move with the insertion. Positions inside a list
        // whose attributes changed keep their place within its existing content.
        const position = (pos: number) => Math.min(
          pos > end.a ? tr.mapping.map(pos) : pos, tr.doc.content.size);
        const selection = state.selection;
        tr.setSelection(selection instanceof TextSelection
          ? TextSelection.between(tr.doc.resolve(position(selection.anchor)),
            tr.doc.resolve(position(selection.head)))
          : selection.from >= end.a ? selection.map(tr.doc, tr.mapping)
            : Selection.fromJSON(tr.doc, selection.toJSON()));
        tr.setStoredMarks(state.storedMarks);
        editor.view.dispatch(tr);
      }
      return true;
    },
    replace: (value: string) => { replaceOwnContent(editor, value); },
  } satisfies OwnedTextDocument & { compositionEnd(): void };
}
