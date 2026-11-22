import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { canJoin, liftTarget } from '@tiptap/pm/transform';

import type { Node as ProseNode } from '@tiptap/pm/model';

/*
 * MOVE RIGHT, MOVE LEFT — the editor's indent controls (owner, 2026-11-22: a step's verses fell out of the step, and the
 * numbered steps restarted at «1.» after them, with no way to put them back). A plan step is a numbered list item whose
 * verses and thoughts sit inside it; these two commands move blocks into and out of items without retyping them.
 */

type Dispatch = ((tr: Transaction) => void) | undefined;

const isList = (node: ProseNode | null | undefined) => node?.type.name === 'bulletList' || node?.type.name === 'orderedList';

/**
 * A block standing right after a list — a verse under a step, a list of thoughts — goes into that list's last item.
 * A list of the same kind that follows then joins it, so the steps count on: 1, 2, 3 instead of 1, 1, 1.
 */
function moveIntoListAbove(state: EditorState, dispatch: Dispatch): boolean {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'listItem') continue;
    const index = $from.index(depth - 1);
    if (index === 0 || !isList($from.node(depth - 1).child(index - 1))) continue;
    const start = $from.before(depth);
    const sameParent = $to.depth >= depth && $to.start(depth - 1) === $from.start(depth - 1);
    const end = sameParent ? $to.after(depth) : $from.after(depth);
    if (!dispatch) return true;
    const content = state.doc.slice(start, end).content;
    // The list above ends at `start`; its last item's content ends two tokens earlier (the item's and the list's close).
    const tr = state.tr.delete(start, end).insert(start - 2, content);
    const boundary = start + content.size;
    const before = tr.doc.resolve(boundary).nodeBefore;
    const after = tr.doc.resolve(boundary).nodeAfter;
    if (after && before && after.type === before.type && canJoin(tr.doc, boundary)) tr.join(boundary);
    const size = tr.doc.content.size;
    tr.setSelection(TextSelection.create(tr.doc, Math.min($from.pos - 2, size), Math.min($to.pos - 2, size)));
    dispatch(tr.scrollIntoView());
    return true;
  }
  return false;
}

/**
 * When a lift cuts an ordered list in two, its second part counts on from the first: steps after a verse taken out keep
 * their numbers, steps after a step taken out count on from the ones before it. Only that list's own second part is
 * renumbered — a separate list that merely follows (another start, another delimiter) is left as written.
 */
function countOnAfterSplit(state: EditorState, tr: Transaction): void {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const list = $from.node(depth);
    if (list.type.name !== 'orderedList') continue;
    const index = $from.index(depth);
    if (index >= list.childCount - 1) return;
    const firstPos = tr.mapping.map($from.before(depth), -1);
    const first = tr.doc.nodeAt(firstPos);
    const $rest = tr.doc.resolve(tr.mapping.map($from.posAtIndex(index + 1, depth), 1));
    let restDepth = $rest.depth;
    while (restDepth > 0 && $rest.node(restDepth).type.name !== 'orderedList') restDepth -= 1;
    if (restDepth === 0) return;
    const restPos = $rest.before(restDepth);
    const rest = $rest.node(restDepth);
    if (restPos === firstPos || first?.type.name !== 'orderedList') return;
    tr.setNodeMarkup(restPos, undefined, { ...rest.attrs, start: Number(first.attrs.start ?? 1) + first.childCount });
    return;
  }
}

/** Move right: a list item goes one level deeper; a block under a list goes into its last item. */
export function indentBlock(state: EditorState, dispatch?: Dispatch): boolean {
  const item = state.schema.nodes.listItem;
  return (item ? sinkListItem(item)(state, dispatch) : false) || moveIntoListAbove(state, dispatch);
}

/**
 * Move left: an item's own line goes one level up (or out of the list). A later block of an item — a step's verse — leaves
 * the item with everything after it in that item; the list splits around it, and its second part counts on from the first.
 */
export function outdentBlock(state: EditorState, dispatch?: Dispatch): boolean {
  const item = state.schema.nodes.listItem;
  if (!item) return false;
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth - 1).type !== item) depth -= 1;
  if (depth === 0 || $from.index(depth - 1) === 0) {
    return liftListItem(item)(state, dispatch && ((tr) => { countOnAfterSplit(state, tr); dispatch(tr); }));
  }
  const range = $from.blockRange(state.doc.resolve($from.end(depth - 1)));
  const target = range ? liftTarget(range) : null;
  if (!range || target === null || target === undefined) return false;
  if (!dispatch) return true;
  const tr = state.tr.lift(range, target);
  countOnAfterSplit(state, tr);
  dispatch(tr.scrollIntoView());
  return true;
}
