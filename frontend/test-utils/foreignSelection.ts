import { CommandManager } from '@tiptap/core';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

import { alignSequences } from '@/utils/alignSequences';

import { nodes, position, productionArrival, serialize } from './foreignContent';

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export const selectionTable = '| H1 | H2 |\n| --- | --- |\n| First | One |\n| abcdef | Two |';
const prose = 'Alpha abcdef END\n\nTail';
const range = 'First words\n\nLast words\n\nTail';
interface FallbackCase { name: string; before: string; after: string; selection?: string; text?: string; offset?: number }
export const fallbackCases: FallbackCase[] = [
  ...['previous', 'next'].flatMap(side => ['replace', 'insert', 'delete'].map(kind => {
    const before = 'First words\n\nWorking words\n\nLast words\n\nTail';
    const neighbour = side === 'previous' ? 'First words' : 'Last words';
    const after = kind === 'replace' ? before.replace(neighbour, 'PHONEARRIVAL sacred words')
      : kind === 'delete' ? before.replace(neighbour + '\n\n', '')
        : before.replace('Working words', side === 'previous' ? 'PHONEARRIVAL\n\nWorking words' : 'Working words\n\nPHONEARRIVAL');
    return { name: `${kind} ${side} neighbour`, before, after, text: 'Working words', offset: side === 'previous' ? 0 : 13 };
  })),
  { name: 'untouched range far from arrival', before: 'First words\n\nLast words\n\nSpacer\n\nTail', after: 'First words\n\nLast words\n\nSpacer\n\nPHONE Tail', selection: 'range' },
  { name: 'untouched selected node far from arrival', before: 'First\n\n---\n\nSpacer\n\nTail', after: 'First\n\n---\n\nSpacer\n\nPHONE Tail', selection: 'node' },
  { name: 'untouched selected cells far from arrival', before: selectionTable + '\n\nSpacer\n\nTail', after: selectionTable + '\n\nSpacer\n\nPHONE Tail', selection: 'cells' },
  { name: 'own paragraph changed', before: prose, after: prose.replace('Alpha', 'PHONE Alpha'), text: 'abcdef', offset: 3 },
  { name: 'text inserted exactly at the caret', before: prose, after: prose.replace('abcdef', 'abcPHONEARRIVALdef'), text: 'abcdef', offset: 3 },
  { name: 'own cell text changed', before: selectionTable + '\n\nTail', after: selectionTable.replace('abcdef', 'PHONEARRIVAL sacred words') + '\n\nTail', text: 'abcdef', offset: 3 },
  { name: 'column inserted before the cell', before: selectionTable + '\n\nTail', after: '| NEW | H1 | H2 |\n| --- | --- | --- |\n| New1 | First | One |\n| New2 | abcdef | Two |\n\nTail', text: 'abcdef', offset: 3 },
  { name: 'two changed tables swapped', before: '<table><tr><td>Alpha abcdef END</td></tr></table>\n\n<table><tr><td>Beta uvwxyz END</td></tr></table>\n\nTail', after: '<table><tr><td>Beta PHONE uvwxyz END</td></tr></table>\n\n<table><tr><td>Alpha abcdef REMOTE END</td></tr></table>\n\nTail', text: 'abcdef', offset: 3 },
  { name: 'emoji swapped', before: 'Start 😀😁 finish\n\nTail', after: 'Start 😁😀 finish\n\nTail', text: '😀😁', offset: 2 },
  { name: 'arrival within a forward range', before: range, after: range.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words'), selection: 'range' },
  { name: 'arrival within a backward range', before: range, after: range.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words'), selection: 'reverse' },
  { name: 'insertion at the start of a whole document selection', before: range, after: 'PHONEARRIVAL sacred words\n\n' + range, selection: 'all' },
  { name: 'insertion at the end of a whole document selection', before: range, after: range + '\n\nPHONEARRIVAL sacred words', selection: 'all' },
  { name: 'whole document selected', before: range, after: range.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words'), selection: 'all' },
  { name: 'selected node changed', before: 'First\n\n---\n\nTail', after: 'First\n\nPHONEARRIVAL\n\nTail', selection: 'node' },
  { name: 'cell selection in a changed table', before: selectionTable + '\n\nTail', after: selectionTable.replace('One', 'PHONEARRIVAL sacred words') + '\n\nTail', selection: 'cells' },
  { name: 'paragraph split', before: prose, after: 'Alpha abc\n\ndef END\n\nTail', text: 'abcdef', offset: 3 },
  { name: 'paragraph deleted', before: prose, after: 'Tail', text: 'abcdef', offset: 3 },
  { name: 'paragraph converted to a list', before: prose, after: '- Alpha abcdef END\n\nTail', text: 'abcdef', offset: 3 },
];

export function selectFallbackCase(editor: Editor, sample: typeof fallbackCases[number]) {
  const { doc, tr } = editor.state;
  if (sample.selection === 'all') editor.view.dispatch(tr.setSelection(new AllSelection(doc)));
  else if (sample.selection === 'node') editor.view.dispatch(tr.setSelection(NodeSelection.create(doc, doc.child(0).nodeSize)));
  else if (sample.selection === 'cells') {
    const cells: number[] = [];
    doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
    editor.view.dispatch(tr.setSelection(CellSelection.create(doc, cells[0], cells[cells.length - 1])));
  } else if (sample.selection) {
    const a = position(editor, 'First', 3), b = position(editor, 'Last', 4);
    editor.view.dispatch(tr.setSelection(TextSelection.create(doc, sample.selection === 'reverse' ? b : a, sample.selection === 'reverse' ? a : b)));
  } else editor.commands.setTextSelection(position(editor, sample.text!, sample.offset));
}

export const nextActions = ['type', 'Backspace', 'Delete', 'Enter', 'paste'] as const;
export function nextAction(editor: Editor, kind: string): boolean {
  if (kind === 'type') return editor.commands.insertContent('X');
  if (kind === 'undo' || kind === 'redo') return editor.commands[kind]();
  if (kind === 'paste') {
    // jsdom lacks this constructor; the actual installed paste pipeline still runs.
    if (!globalThis.ClipboardEvent) globalThis.ClipboardEvent = class extends Event {
      clipboardData: DataTransfer | null;
      constructor(type: string, init: ClipboardEventInit = {}) { super(type, init); this.clipboardData = init.clipboardData ?? null; }
    } as typeof ClipboardEvent;
    return editor.view.pasteText('PASTED words\n\nSecond pasted');
  }
  const before = editor.state.doc;
  const handled = !!editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: kind, bubbles: true, cancelable: true })));
  // Model only the browser's unhandled collapsed character deletion default.
  if ((kind === 'Backspace' || kind === 'Delete') && before.eq(editor.state.doc) && editor.state.selection.empty) {
    const p = editor.state.selection.$head, back = kind === 'Backspace';
    if (back ? p.parentOffset > 0 : p.parentOffset < p.parent.content.size) {
      const text = p.parent.textContent;
      const width = (back ? /[\uDC00-\uDFFF]/.test(text[p.parentOffset - 1] ?? '') : /[\uD800-\uDBFF]/.test(text[p.parentOffset] ?? '')) ? 2 : 1;
      editor.view.dispatch(editor.state.tr.delete(back ? p.pos - width : p.pos, back ? p.pos : p.pos + width));
      return true;
    }
  }
  return handled;
}

/** BASE really runs from the identical source state, then the test restores that state. */
export function baseSnapshot(editor: Editor, value: string) {
  const source = editor.state;
  try {
    productionArrival(editor, value);
    return { doc: editor.state.doc, selection: editor.state.selection.toJSON(), state: editor.state };
  } finally { editor.view.updateState(source); }
}

/** Independently count positions through changed runs outside the caret's neighbours. */
export function exactSelection(source: EditorState, target: PMNode): Record<string, unknown> | null {
  const old = nodes(source.doc), next = nodes(target), selection = source.selection;
  if (!(selection instanceof TextSelection) || !selection.empty
    || ![TextSelection].some(type => selection.constructor === type)) return null;
  const top = selection.$head.index(0);
  const runs = alignSequences(old, next, (a, b) => a.eq(b));
  let shift = 0;
  for (const run of runs) {
    if (run.oldFrom === run.oldTo) {
      if ([top, top + 1].includes(run.oldFrom)) return null;
    } else {
      for (const index of [top - 1, top, top + 1]) {
        if (index >= run.oldFrom && index < run.oldTo) return null;
      }
    }
    if (run.oldTo <= top) shift += next.slice(run.newFrom, run.newTo).reduce((n, node) => n + node.nodeSize, 0)
      - old.slice(run.oldFrom, run.oldTo).reduce((n, node) => n + node.nodeSize, 0);
  }
  return { type: 'text', anchor: selection.head + shift, head: selection.head + shift };
}

export function nestedArrival(editor: Editor, kind: string, id: string, a: number): string {
  const content = nodes(editor.state.doc), token = `ARR${id}`;
  const p = (text: string) => editor.schema.nodes.paragraph.create(null, editor.schema.text(text));
  if (kind === 'arrivalTable') {
    const index = content.findIndex(node => node.type.name === 'table');
    if (index < 0) {
      const cell = (text: string) => editor.schema.nodes.tableCell.create(null, p(text));
      const row = (x: string, y: string) => editor.schema.nodes.tableRow.create(null, [cell(x), cell(y)]);
      content.splice(a % (content.length + 1), 0, editor.schema.nodes.table.create(null, [row(token, 'Keep'), row('abcdef', 'Last')]));
    } else {
      const json = content[index].toJSON();
      if (a % 3 === 0) json.content.unshift(JSON.parse(JSON.stringify(json.content[0])));
      else if (a % 3 === 1 && json.content.length > 1) json.content.reverse();
      json.content[a % json.content.length].content[0].content = [p(token + ' sacred words').toJSON()];
      content[index] = editor.schema.nodeFromJSON(json);
    }
  } else {
    const index = content.findIndex(node => node.type.name === 'bulletList');
    const item = (text: string) => editor.schema.nodes.listItem.create(null, p(text));
    if (index < 0) content.splice(a % (content.length + 1), 0, editor.schema.nodes.bulletList.create(null, [item('First'), item(token), item('Last')]));
    else {
      const list = nodes(content[index]);
      if (a % 3 === 0) list.unshift(item(token));
      else if (a % 3 === 1) list[a % list.length] = item(token);
      else { list.reverse(); list.push(item(token)); }
      content[index] = editor.schema.nodes.bulletList.create(null, list.slice(0, 8));
    }
  }
  return serialize(editor, editor.schema.nodes.doc.create(null, content.slice(0, 25)));
}

/** Compare mounted caller persistence to BASE without announcing a synthetic own edit. */
export function baseTyping(editor: Editor, value: string) {
  const base = baseSnapshot(editor, value);
  let typed!: Transaction;
  new CommandManager({ editor, state: base.state }).chain().insertContent('X')
    .command(({ tr }) => { typed = tr; return true; }).run();
  const doc = base.state.applyTransaction(typed).state.doc;
  return { document: base.doc.toJSON(), selection: base.selection, typed: serialize(editor, doc) };
}
