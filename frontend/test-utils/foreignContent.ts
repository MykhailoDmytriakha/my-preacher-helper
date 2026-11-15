import { closeHistory } from '@tiptap/pm/history';

import { retireHistory } from '@/components/ui/foreignHistory';

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export function nodes(doc: PMNode): PMNode[] {
  const result: PMNode[] = [];
  doc.forEach(node => result.push(node));
  return result;
}
export function serialize(editor: Editor, doc: PMNode): string {
  return (editor.storage as unknown as { markdown: { serializer: { serialize: (doc: PMNode) => string } } }).markdown.serializer.serialize(doc);
}
export function position(editor: Editor, text: string, offset = 0): number {
  let result = -1;
  editor.state.doc.descendants((node, pos) => {
    if (result < 0 && node.isText && node.text!.includes(text)) result = pos + node.text!.indexOf(text) + offset;
  });
  if (result < 0) throw new Error(`Missing text: ${text}`);
  return result;
}
export function blocks(editor: Editor) {
  const result: { pos: number; size: number }[] = [];
  editor.state.doc.descendants((node, pos) => { if (node.isTextblock) result.push({ pos: pos + 1, size: node.content.size }); });
  return result;
}
/** Independent oracle: actually dispatch today's full path from the exact same state/schema. */
export function productionDocument(editor: Editor, value: string): PMNode {
  const before = editor.state;
  try {
    editor.chain().command(({ tr }) => { closeHistory(tr).setMeta('addToHistory', false); return true; })
      .setContent(value, { emitUpdate: false }).run();
    return editor.state.doc;
  } finally {
    editor.view.updateState(before);
  }
}
export function productionArrival(editor: Editor, value: string) {
  editor.chain().command(({ tr }) => { closeHistory(tr).setMeta('addToHistory', false); return true; })
    .setContent(value, { emitUpdate: false }).run();
  retireHistory(editor);
}
export const paragraphs = Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}: abcdefghijklmnopqrstuvwxyz.`).join('\n\n');
export const table = '| A | B |\n| --- | --- |\n| abcdef | Keep |';
export const structuralInitial = 'Old alpha OWNBASEA ending\n\nOld beta OWNBASEB middle\n\nOld gamma OWNBASEC ending\n\n- First list item\n- Second list item\n\n| A | B |\n| --- | --- |\n| Cell words | Keep |\n\nTail stable';
