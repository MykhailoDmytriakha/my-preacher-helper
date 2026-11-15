import { CommandManager } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';

import { alignSequences } from '@/utils/alignSequences';

import { retireHistory } from './foreignHistory';

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/** Use the installed setContent command, including its Markdown parser, off-view. */
export function canonicalForeignTarget(editor: Editor, value: string): PMNode {
  let replacement!: Transaction;
  // A custom state prevents CommandManager.run from dispatching to the live view.
  new CommandManager({ editor, state: editor.state }).chain()
    .command(({ tr }) => { closeHistory(tr).setMeta('addToHistory', false); return true; })
    .setContent(value, { emitUpdate: false })
    .command(({ tr }) => { replacement = tr; return true; })
    .run();
  // Audited state/appending hooks: see research/77-live-adoption-build.md.
  // The root has no paste, drop or simulated-input metadata.
  return editor.state.applyTransaction(replacement).state.doc;
}

function topLevel(doc: PMNode) {
  const nodes: PMNode[] = [], offsets = [0];
  doc.forEach(node => { nodes.push(node); offsets.push(offsets[offsets.length - 1] + node.nodeSize); });
  return { nodes, offsets };
}

/** Automatic arrivals only. Own actions keep their existing whole-document command. */
export function applyForeignContent(editor: Editor, value: string): { fallback: boolean } {
  const target = canonicalForeignTarget(editor, value);
  const state = editor.state, old = topLevel(state.doc), next = topLevel(target);
  const runs = alignSequences(old.nodes, next.nodes, (a, b) => a.eq(b));
  const tr = closeHistory(state.tr).setMeta('addToHistory', false).setMeta('preventUpdate', true);
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    tr.replaceWith(old.offsets[run.oldFrom], old.offsets[run.oldTo], next.nodes.slice(run.newFrom, run.newTo));
  }
  const fallback = () => {
    editor.chain()
      .command(({ tr: full }) => { closeHistory(full).setMeta('addToHistory', false); return true; })
      .setContent(value, { emitUpdate: false }).run();
    retireHistory(editor);
    return { fallback: true };
  };
  const selection = state.selection;
  const index = selection.$head.index(0);
  // A retained caret and its neighbours must all be outside the arrival.
  const nearby = runs.some(run => run.oldFrom === run.oldTo
    ? run.oldFrom === index || run.oldFrom === index + 1
    : run.oldFrom <= index + 1 && run.oldTo > index - 1);
  const caret = selection instanceof TextSelection && selection.empty
    && [TextSelection].some(type => selection.constructor === type);
  if (!caret || nearby) return fallback();
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(selection.head)));
  // setSelection and replacements clear stored marks, including an explicit [].
  tr.setStoredMarks(state.storedMarks);
  // Appended plugin normalization can depend on the replaced ranges.
  if (!state.applyTransaction(tr).state.doc.eq(target)) return fallback();
  editor.view.dispatch(tr);
  retireHistory(editor);
  return { fallback: false };
}
