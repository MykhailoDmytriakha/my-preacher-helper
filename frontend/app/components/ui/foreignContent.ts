import { CommandManager } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';

import { alignSequences, type DifferenceRun } from '@/utils/alignSequences';

import { retireHistory } from './foreignHistory';
import { adoptOutsideMarkdownSelection, mapForeignMarkdownSelection } from './foreignMarkdownSelection';

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state';

function foreignTransaction(tr: Transaction): Transaction {
  return closeHistory(tr).setMeta('addToHistory', false).setMeta('preventUpdate', true);
}

/** Use the installed setContent command, including its Markdown parser, off-view. */
function prepareReplacement(editor: Editor, value: string): Transaction {
  let replacement!: Transaction;
  // A custom state prevents CommandManager.run from dispatching to the live view.
  new CommandManager({ editor, state: editor.state }).chain()
    .command(({ tr }) => { foreignTransaction(tr); return true; })
    .setContent(value, { emitUpdate: false })
    .command(({ tr }) => { replacement = tr; return true; })
    .run();
  return replacement;
}

export function canonicalForeignTarget(editor: Editor, value: string): PMNode {
  // Audited state/appending hooks: see research/77-live-adoption-build.md.
  // The root has no paste, drop or simulated-input metadata.
  return editor.state.applyTransaction(prepareReplacement(editor, value)).state.doc;
}

function topLevel(doc: PMNode) {
  const nodes: PMNode[] = [], offsets = [0];
  doc.forEach(node => { nodes.push(node); offsets.push(offsets[offsets.length - 1] + node.nodeSize); });
  return { nodes, offsets };
}

function touchesEditingPlace(selection: Selection, runs: readonly DifferenceRun[]): boolean {
  const { $from, $to } = selection;
  const first = $from.index(0);
  const last = $to.index(0) - Number($to.depth === 0 && !selection.empty);
  return runs.some(({ oldFrom, oldTo }) => (
    // A mapped offset inside a replaced block can still point into arriving words.
    (oldFrom <= last && oldTo > first)
    // Backspace and Delete at a block edge reach adjacent content.
    || ($from.parentOffset === 0 && oldTo === first)
    || ($to.parentOffset === $to.parent.content.size && oldFrom === last + 1)
  ));
}

function distantCaret(state: EditorState, tr: Transaction, runs: readonly DifferenceRun[]): Selection | undefined {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty || Object.getPrototypeOf(selection) !== TextSelection.prototype) return;
  const index = selection.$head.index(0);
  const nearby = runs.some(run => run.oldFrom === run.oldTo
    ? run.oldFrom === index || run.oldFrom === index + 1
    : run.oldFrom <= index + 1 && run.oldTo > index - 1);
  if (!nearby) return TextSelection.create(tr.doc, tr.mapping.map(selection.head));
}

function dispatchArrival(editor: Editor, tr: Transaction): void {
  editor.view.dispatch(tr);
  retireHistory(editor);
}

function setArrivalSelection(state: EditorState, tr: Transaction, selection: Selection): Transaction {
  // setSelection and replacements clear stored marks, including an explicit [].
  return tr.setSelection(selection).setStoredMarks(state.storedMarks);
}

function deferArrival(editor: Editor, state: EditorState, target: PMNode): { fallback: false; deferred: true } {
  const outside = adoptOutsideMarkdownSelection(state.tr, target);
  if (outside.docChanged) {
    dispatchArrival(editor, foreignTransaction(outside).setStoredMarks(state.storedMarks));
  }
  return { fallback: false, deferred: true };
}

/** One quiet adoption path for both focused and background editors. Own edits use setContent. */
export function applyForeignContent(editor: Editor, value: string, protectPlace = false): { fallback: boolean; deferred?: true } {
  const state = editor.state;
  const replacement = prepareReplacement(editor, value);
  const target = state.applyTransaction(replacement).state.doc;
  const old = topLevel(state.doc), next = topLevel(target);
  const runs = alignSequences(old.nodes, next.nodes, (a, b) => a.eq(b));
  const protect = protectPlace && editor.isEditable && editor.view.hasFocus();
  const expected = protect ? mapForeignMarkdownSelection(state.selection, target) : undefined;

  if (protect && (!expected || touchesEditingPlace(state.selection, runs))) {
    return deferArrival(editor, state, target);
  }

  const tr = foreignTransaction(state.tr);
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    tr.replaceWith(old.offsets[run.oldFrom], old.offsets[run.oldTo], next.nodes.slice(run.newFrom, run.newTo));
  }
  const mapped = protect ? mapForeignMarkdownSelection(state.selection, tr.doc) : distantCaret(state, tr, runs);
  if (mapped) {
    setArrivalSelection(state, tr, mapped);
    // Appended plugin normalization can depend on the replaced ranges.
    const preview = state.applyTransaction(tr).state;
    if (preview.doc.eq(target) && (!expected || preview.selection.eq(expected))) {
      dispatchArrival(editor, tr);
      return { fallback: false };
    }
  }

  if (expected) {
    const full = mapForeignMarkdownSelection(state.selection, replacement.doc);
    if (!full) return deferArrival(editor, state, target);
    setArrivalSelection(state, replacement, full);
    const preview = state.applyTransaction(replacement).state;
    if (!preview.doc.eq(target) || !preview.selection.eq(expected)) return deferArrival(editor, state, target);
  }
  dispatchArrival(editor, replacement);
  return { fallback: true };
}
