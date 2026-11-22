import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

import { indentBlock, outdentBlock } from '@/components/ui/blockIndent';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';

/*
 * Owner, 2026-11-22: a step's verses fell out of the step and the numbered steps restarted at «1.» — «как мне из них
 * сделать двоечки». Move right puts a block back into the step above and lets the numbering run on; move left takes it out.
 */
const markdownOf = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

function editorAt(markdown: string, words: string) {
  const editor = new Editor({ extensions: richMarkdownExtensions(), content: markdown });
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(words)) at = pos + node.text.indexOf(words);
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  return editor;
}
const run = (editor: Editor, command: typeof indentBlock) => command(editor.state, editor.view.dispatch);
/** The saved text opened again: what each top-level block is, and what each numbered item holds. */
function reopened(markdown: string) {
  const editor = new Editor({ extensions: richMarkdownExtensions(), content: markdown });
  const blocks: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name !== 'orderedList') { blocks.push(`${node.type.name}: ${node.textContent}`); return; }
    node.forEach((item, _offset, index) => blocks.push(`${Number(node.attrs.start ?? 1) + index}. ${[...Array(item.childCount).keys()].map((at) => item.child(at).textContent).join(' | ')}`));
  });
  return blocks;
}

it('puts a verse that fell out of a step back into it, and the steps count on', () => {
  const editor = editorAt('1. **Created**\n\n*Gen 1:26: «image»*\n\n1. **Crowned**', 'Gen 1:26');
  expect(run(editor, indentBlock)).toBe(true);
  expect(reopened(markdownOf(editor))).toEqual(['1. Created | Gen 1:26: «image»', '2. Crowned']);
});

it('moves a list of thoughts under the step above it', () => {
  const editor = editorAt('1. **Crowned**\n\n   *Ps 8:6: «crowned»*\n\n- God gave him dominion', 'God gave');
  expect(run(editor, indentBlock)).toBe(true);
  expect(markdownOf(editor)).toBe('1. **Crowned**\n\n   *Ps 8:6: «crowned»*\n\n   - God gave him dominion');
});

it('nests a thought under the one above it, as the list\'s own indent does', () => {
  const editor = editorAt('- First\n- Second', 'Second');
  expect(run(editor, indentBlock)).toBe(true);
  expect(markdownOf(editor)).toBe('- First\n  - Second');
});

it('takes a verse out of a step: the list splits, and the next step keeps its number', () => {
  const editor = editorAt('1. **Created**\n\n   *Gen 1:26: «image»*\n\n2. **Crowned**', 'Gen 1:26');
  expect(run(editor, outdentBlock)).toBe(true);
  expect(reopened(markdownOf(editor))).toEqual(['1. Created', 'paragraph: Gen 1:26: «image»', '2. Crowned']);
});

it('says when there is nothing to move', () => {
  const editor = editorAt('Just a paragraph', 'Just');
  expect(indentBlock(editor.state)).toBe(false);
  expect(outdentBlock(editor.state)).toBe(false);
});

describe('move left keeps every list\'s own numbers (Codex check)', () => {
  it('leaves a separate list that follows as written', () => {
    const editor = editorAt('1. Step A\n\n   Verse A\n\n8) Other A', 'Verse A');
    expect(run(editor, outdentBlock)).toBe(true);
    // Its own start stays; the editor writes every ordered list with «.», this one included.
    expect(reopened(markdownOf(editor))).toEqual(['1. Step A', 'paragraph: Verse A', '8. Other A']);
  });

  it('counts on after a step taken out of the middle', () => {
    const editor = editorAt('1. Step A\n2. Step B\n3. Step C', 'Step B');
    expect(run(editor, outdentBlock)).toBe(true);
    expect(reopened(markdownOf(editor))).toEqual(['1. Step A', 'paragraph: Step B', '2. Step C']);
  });
});
