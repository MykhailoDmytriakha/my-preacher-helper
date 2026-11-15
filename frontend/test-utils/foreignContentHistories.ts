import { closeHistory } from '@tiptap/pm/history';

import { blocks, nodes, serialize } from './foreignContent';

import type { Editor } from '@tiptap/core';

export interface HistoryOperation { kind: string; a: number; b: number; c: number; id: string }
export const operationKinds = ['type', 'split', 'join', 'delete3', 'list', 'indent', 'cell', 'paste',
  'arrivalReplace', 'arrivalInsert', 'arrivalDelete', 'arrivalReorder', 'selectArrivalType', 'undo', 'redo'];
export function randomSource(seed: number) {
  let value = seed >>> 0;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; };
}
export function executeOwn(editor: Editor, op: HistoryOperation): boolean {
  if (op.kind === 'undo' || op.kind === 'redo') return editor.commands[op.kind]();
  if (op.c % 4 !== 0) editor.view.dispatch(closeHistory(editor.state.tr));
  const bs = blocks(editor), index = op.a % bs.length, block = bs[index];
  editor.commands.setTextSelection(block.pos + op.b % (block.size + 1));
  if (op.kind === 'type') return editor.commands.insertContent(` OWN${op.id} `);
  if (op.kind === 'split') return editor.commands.splitBlock();
  if (op.kind === 'join') { editor.commands.setTextSelection(block.pos); return editor.commands.joinBackward(); }
  if (op.kind === 'delete3') {
    const last = bs[Math.min(bs.length - 1, index + 2)];
    editor.view.dispatch(editor.state.tr.delete(block.pos + Math.min(block.size, op.b % 5), last.pos + Math.min(last.size, 1 + op.b % 7)));
    return true;
  }
  if (op.kind === 'list') return editor.commands.toggleBulletList();
  if (op.kind === 'indent') return editor.commands.sinkListItem('listItem');
  if (op.kind === 'cell') {
    const cell = bs.find(b => {
      const pos = editor.state.doc.resolve(b.pos);
      for (let depth = 1; depth <= pos.depth; depth++) if (['tableCell', 'tableHeader'].includes(pos.node(depth).type.name)) return true;
      return false;
    });
    if (!cell) return false;
    editor.commands.setTextSelection(cell.pos + Math.min(cell.size, op.b % 4));
    return editor.commands.insertContent(` CELL${op.id} `);
  }
  if (op.kind === 'paste') return editor.commands.insertContent(`Pasted OWN${op.id}\n\nSecond pasted words\n\nThird pasted words`);
  throw new Error(`Unknown own operation ${op.kind}`);
}
export function arrivalValue(editor: Editor, op: HistoryOperation): string {
  let content = nodes(editor.state.doc);
  const index = op.a % content.length;
  const remote = (i: number) => editor.schema.nodes.paragraph.create(null, editor.schema.text(`ARR${op.id}X${i} alpha beta gamma omega`));
  if (op.kind === 'arrivalReplace') content.splice(index, Math.min(1 + op.b % 3, content.length - index),
    ...Array.from({ length: 1 + op.c % 3 }, (_, i) => remote(i)));
  else if (op.kind === 'arrivalInsert') content.splice(index, 0, editor.schema.nodes.paragraph.create(null, editor.schema.text(`ARR${op.id}X0 inserted alpha beta gamma`)));
  else if (op.kind === 'arrivalDelete') { if (content.length > 2) content.splice(index, Math.min(1 + op.b % 3, content.length - index)); }
  else if (op.kind === 'arrivalDuplicate') content.splice(index, 0, content[op.b % content.length]);
  else if (op.kind === 'arrivalReorder') {
    const other = op.b % content.length;
    [content[index], content[other]] = [content[other], content[index]];
  } else throw new Error(`Unknown arrival operation ${op.kind}`);
  if (content.length > 35) content = content.slice(0, 20);
  return serialize(editor, editor.schema.nodes.doc.create(null, content));
}
