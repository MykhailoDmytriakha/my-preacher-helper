import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history';
import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state';

import { androidIdleComposition } from './androidIdleComposition';
import { applyForeignContent, canonicalForeignTarget } from './foreignContent';

import type { OwnedTextDocument } from './useEditorOwnedText';
import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';

/** Keep an explicit replacement separate from the typing on either side. */
export function replaceOwnContent(editor: Editor, value: string): void {
  editor.chain()
    .command(({ tr }) => { closeHistory(tr).setMeta('addToHistory', true); return true; })
    .setContent(value, { emitUpdate: false }).run();
  editor.view.dispatch(closeHistory(editor.state.tr));
}

interface PendingArrival {
  value: string;
  /** Exact displayed-to-canonical pairs from appends performed during this hold. */
  appendHistory?: Map<string, string>;
}

/** Composition and displayed edit openings are witnessed by the editor. */
export function ownedTextDocument(editor: Editor) {
  // The installed Android view ends an idle composition after five seconds without
  // a DOM compositionend. A witnessed native Backspace inside that deadline
  // lets the editor retry the library's own completion after admitting the deletion.
  const compositionCheckMs = 5000;
  const { markdown } = editor.storage as unknown as {
    markdown: { getMarkdown(): string; serializer: { serialize(doc: DocumentNode): string } };
  };
  const android = androidIdleComposition(() => editor.view);
  let deferred: PendingArrival | undefined;
  const install = (value: string, protectPlace = true) => {
    const pending = deferred?.value === value ? deferred : { value };
    if (protectPlace && editor.view.composing) {
      deferred = pending;
      recheck();
    } else {
      deferred = applyForeignContent(editor, value, protectPlace).deferred ? pending : undefined;
    }
  };
  const retryArrival = () => {
    const arrival = deferred;
    if (arrival === undefined) return;
    queueMicrotask(() => {
      if (!editor.isDestroyed && deferred === arrival) install(arrival.value);
    });
  };
  editor.on('selectionUpdate', retryArrival);
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ended: ReturnType<typeof setTimeout> | undefined;
  const waiting = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  const recheck = () => {
    if (!editor.isDestroyed && waiting.size) android?.finishIfAdmitted();
    if (editor.isDestroyed || !editor.view.composing) {
      for (const waiter of waiting) {
        if (editor.isDestroyed) waiter.reject(new Error('The note editor closed before text could be appended'));
        else waiter.resolve();
      }
      waiting.clear();
      clearTimeout(retry);
      retry = undefined;
      retryArrival();
    } else if ((waiting.size || deferred !== undefined) && retry === undefined) {
      retry = setTimeout(() => { retry = undefined; recheck(); }, compositionCheckMs);
    }
  };
  const afterUpdate = () => {
    // Let all synchronous update listeners publish the admitted document first.
    if (waiting.size) void Promise.resolve().then(recheck);
  };
  editor.on('transaction', ({ transaction }) => {
    android?.observe(transaction);
    afterUpdate();
  });
  editor.on('update', afterUpdate);
  editor.on('destroy', () => {
    clearTimeout(retry);
    clearTimeout(ended);
    deferred = undefined;
    android?.end();
    // Tiptap emits destroy before destroying its view.
    for (const waiter of waiting) waiter.reject(new Error('The note editor closed before text could be appended'));
    waiting.clear();
  });
  return {
    compositionActivity: () => android?.activity(),
    beforeInput: (event: InputEvent) => android?.beforeInput(event),
    nativeInput: (event: InputEvent) => android?.input(event),
    compositionEnd: () => {
      android?.end();
      // ProseMirror handles this same event after handleDOMEvents. Resume after its
      // composition-end microtasks and normal MutationObserver delivery, not inside it.
      clearTimeout(ended);
      ended = setTimeout(recheck, 0);
    },
    waitForComposition: () => new Promise<void>((resolve, reject) => {
      waiting.add({ resolve, reject });
      afterUpdate();
    }),
    install,
    retryArrival,
    captureEdit: (value: string, transaction: Transaction): { value: string; opening?: string } => {
      if (!deferred) return { value };
      const opening = markdown.serializer.serialize(transaction.before);
      const history = deferred.appendHistory;
      const canonicalOpening = history?.get(opening);
      if (isHistoryTransaction(transaction) && canonicalOpening === deferred.value) {
        const restored = history?.get(value);
        if (restored !== undefined) {
          deferred.value = restored;
          return { value: restored, opening: canonicalOpening };
        }
      }
      // Give the session the text the user actually saw before this edit.
      if (opening !== value) deferred = undefined;
      return { value, opening };
    },
    append: (value: string, block: string) => {
      if (editor.view.composing) return false;
      const { state } = editor;
      let displayedValue = value;
      const pending = deferred;
      if (pending) {
        // Publish the append against the confirmed text. Keep drawing the held
        // editing place, and append the same words to that view.
        const shown = markdown.getMarkdown();
        displayedValue = shown ? `${shown}\n\n${block}` : block;
        pending.appendHistory ??= new Map();
        pending.appendHistory.set(shown, pending.value);
      }
      const target = canonicalForeignTarget(editor, displayedValue);
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
        editor.view.dispatch(closeHistory(editor.state.tr));
      }
      if (pending) {
        pending.appendHistory?.set(markdown.getMarkdown(), value);
        pending.value = value;
      }
      return true;
    },
    replace: (value: string) => {
      if (deferred) install(deferred.value, false);
      replaceOwnContent(editor, value);
    },
  } satisfies OwnedTextDocument & {
    compositionActivity(): void;
    beforeInput(event: InputEvent): void;
    nativeInput(event: InputEvent): void;
    compositionEnd(): void;
    retryArrival(): void;
    captureEdit(value: string, transaction: Transaction): { value: string; opening?: string };
  };
}
