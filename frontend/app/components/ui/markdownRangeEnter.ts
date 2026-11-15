import { Extension } from '@tiptap/core';
import { chainCommands, newlineInCode, splitBlock } from '@tiptap/pm/commands';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { canSplit } from '@tiptap/pm/transform';

import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';

const splitTextblock = chainCommands(newlineInCode, splitBlock);

function listItemStart(position: ResolvedPos): number | undefined {
  for (let depth = position.depth; depth > 0; depth--) {
    if (position.node(depth).type.name === 'listItem') return position.before(depth);
  }
}

function replaceNestedRangeWithBreak(editor: Editor): boolean {
  if (!editor.isEditable || editor.view.composing) return false;
  const { state } = editor;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.$from.sameParent(selection.$to)) return false;
  const { $from, $to } = selection;
  if ($from.depth <= 1 && $to.depth <= 1) return false;

  // The stock shortcut preflights the split on the original tree. A spanning
  // deletion can remove a wrapper entirely or change the block at that position.
  const tr = state.tr.deleteSelection();
  // Keep the left edge when the deletion fits an opening wrapper for the
  // surviving content. The right edge would place the break inside that wrapper.
  const pos = tr.mapping.map(selection.from, -1);
  const at = tr.doc.resolve(pos);
  const marks = state.storedMarks ?? ($to.parentOffset ? $from.marks() : tr.storedMarks);
  if (at.parent.isTextblock) {
    const caret = TextSelection.create(tr.doc, pos);
    const splitItem = at.depth > 1 && at.node(-1).type === state.schema.nodes.listItem
      && listItemStart($from) !== listItemStart($to) && !at.parent.type.spec.code;
    if (splitItem && canSplit(tr.doc, pos, 2)) {
      tr.setSelection(caret).split(pos, 2);
    } else {
      // A fresh state lets the standard commands read the post-delete tree and
      // use their own mapping. Replay the chosen steps into the same Undo entry.
      const collapsed = EditorState.create({ doc: tr.doc, selection: caret });
      if (!splitTextblock(collapsed, next => {
        for (const step of next.steps) tr.step(step);
        tr.setSelection(next.selection.getBookmark().resolve(tr.doc));
      })) return true;
    }
  } else if (!(tr.doc.childCount === 1 && tr.doc.firstChild?.isTextblock && tr.doc.firstChild.content.size === 0)) {
    const paragraph = state.schema.nodes.paragraph;
    if (!at.parent.canReplaceWith(at.index(), at.index(), paragraph)) return true;
    tr.insert(pos, paragraph.create());
    // Start on the inserted line even if the deletion moved the caret into a
    // surviving block just after it.
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  }

  if (marks) {
    const { splittableMarks } = editor.extensionManager;
    tr.ensureMarks(marks.filter(mark => splittableMarks.includes(mark.type.name)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const MarkdownRangeEnter = Extension.create({
  name: 'markdownRangeEnter',
  priority: 110,
  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => replaceNestedRangeWithBreak(editor) };
  },
});
