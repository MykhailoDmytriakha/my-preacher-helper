import { AllSelection, NodeSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

import type { Node as DocumentNode, ResolvedPos } from '@tiptap/pm/model';

/** Match an unchanged subtree even when independent edits occur on both sides of it. */
function uniquePosition(doc: DocumentNode, target: DocumentNode): number | undefined {
    let found: number | undefined;
    let ambiguous = false;
    doc.descendants((node, position) => {
        if (!ambiguous && node.eq(target)) {
            if (found === undefined) found = position;
            else ambiguous = true;
        }
        // A child cannot be an equal copy of its own ancestor.
        return !ambiguous && node.nodeSize > target.nodeSize;
    });
    return ambiguous ? undefined : found;
}

function mapTextPosition(position: ResolvedPos, target: DocumentNode): number | undefined {
    const original = position.doc;
    const start = original.content.findDiffStart(target.content);
    if (start === null || position.pos < start) return position.pos;
    const end = original.content.findDiffEnd(target.content);
    if (end && position.pos > end.a) return position.pos + end.b - end.a;

    // Start with the largest anchor. The same table can contain repeated text cells.
    for (let depth = 1; depth <= position.depth; depth++) {
        const anchor = position.node(depth);
        const offset = position.before(depth);
        if (uniquePosition(original, anchor) !== offset) continue;
        const newOffset = uniquePosition(target, anchor);
        if (newOffset !== undefined) return newOffset + position.pos - offset;
    }
    return undefined;
}

function mapNodePosition(position: ResolvedPos, target: DocumentNode): number | undefined {
    const sameNode = position.nodeAfter;
    const mapped = mapTextPosition(position, target);
    if (sameNode && mapped !== undefined && target.nodeAt(mapped)?.eq(sameNode)) return mapped;
    if (sameNode && uniquePosition(position.doc, sameNode) === position.pos) return uniquePosition(target, sameNode);
    return undefined;
}

/** A failed mapping means the active editing place cannot be identified in the new document. */
export function mapForeignMarkdownSelection(selection: Selection, target: DocumentNode): Selection | undefined {
    if (selection instanceof AllSelection) return selection.$anchor.doc.eq(target) ? new AllSelection(target) : undefined;
    if (selection instanceof NodeSelection) {
        const position = mapNodePosition(selection.$anchor, target);
        if (position !== undefined) return NodeSelection.create(target, position);
    }
    if (selection instanceof CellSelection) {
        const anchor = mapNodePosition(selection.$anchorCell, target);
        const head = mapNodePosition(selection.$headCell, target);
        if (anchor !== undefined && head !== undefined) {
            const $anchor = target.resolve(anchor), $head = target.resolve(head);
            if ($anchor.parent.type.spec.tableRole === 'row' && $head.parent.type.spec.tableRole === 'row'
                && $anchor.start(-1) === $head.start(-1)) {
                const mapped = CellSelection.create(target, anchor, head);
                if (selection.content().eq(mapped.content())) return mapped;
            }
        }
    }
    if (selection instanceof TextSelection) {
        const anchor = mapTextPosition(selection.$anchor, target);
        const head = selection.empty ? anchor : mapTextPosition(selection.$head, target);
        if (anchor === undefined || head === undefined || (selection.anchor < selection.head) !== (anchor < head)
            || (selection.anchor > selection.head) !== (anchor > head)) return undefined;
        const $anchor = target.resolve(anchor), $head = target.resolve(head);
        if ($anchor.parent.inlineContent && $head.parent.inlineContent) {
            const mapped = new TextSelection($anchor, $head);
            if (selection.empty || selection.content().eq(mapped.content())) return mapped;
        }
    }
    return undefined;
}

/** Patch independent text inside the same list or table, keeping the native
 * selection away from replacements and from editing keys that join blocks. */
export function patchUnselectedStructure(
    tr: Transaction, selection: Selection, position: number, previous: DocumentNode, incoming: DocumentNode,
): boolean {
    if (!(selection instanceof TextSelection)
        || !['table', 'bulletList', 'orderedList'].includes(previous.type.name)
        || position >= selection.from || position + previous.nodeSize <= selection.to
        || selection.$from.parentOffset === 0 || selection.$to.parentOffset === selection.$to.parent.content.size) return false;

    return patchTextblocks(tr, selection, position, previous, incoming);
}

function patchTextblocks(
    tr: Transaction, selection: Selection, position: number, previous: DocumentNode, incoming: DocumentNode,
): boolean {
    if (previous.eq(incoming)) return true;
    if (!previous.sameMarkup(incoming) || previous.isLeaf || previous.isAtom) return false;
    if (previous.isTextblock) {
        const end = position + previous.nodeSize;
        if (position <= selection.to && end >= selection.from) return false;
        tr.replaceWith(position + 1, end - 1, incoming.content);
        return true;
    }
    if (previous.childCount !== incoming.childCount) return false;
    let offset = position + previous.nodeSize - 1;
    for (let index = previous.childCount - 1; index >= 0; index--) {
        const child = previous.child(index);
        offset -= child.nodeSize;
        if (!patchTextblocks(tr, selection, offset, child, incoming.child(index))) return false;
    }
    return true;
}

interface TopLevelAnchor {
    original: number;
    target: number;
    size: number;
}

function topLevelAnchor(doc: DocumentNode, target: DocumentNode, index: number): TopLevelAnchor | undefined {
    if (index < 0 || index >= doc.childCount) return undefined;
    const child = doc.child(index);
    const original = uniquePosition(doc, child);
    const next = uniquePosition(target, child);
    if (original === undefined || next === undefined || doc.resolve(original).depth !== 0 || target.resolve(next).depth !== 0) return undefined;
    return { original, target: next, size: child.nodeSize };
}

/** Keep the unresolved selection between exact neighboring nodes. The outer slices
 * can be replaced independently without publishing the unresolved text. */
export function adoptOutsideMarkdownSelection(tr: Transaction, target: DocumentNode): Transaction {
    const { selection, doc } = tr;
    const first = selection.$from.index(0);
    const last = selection.$to.index(0);
    if (first !== last || first >= doc.childCount) return tr;
    const left = topLevelAnchor(doc, target, first - 1);
    const right = topLevelAnchor(doc, target, last + 1);
    if ((!left && first > 0) || (!right && last < doc.childCount - 1)) return tr;
    if (left && right && left.target + left.size > right.target) return tr;

    // If the active block reappeared on the other side of an anchor, keep the
    // previous display until we can adopt the whole document. Do not show it twice.
    const moved = uniquePosition(target, doc.child(first));
    if (moved !== undefined && (left && moved < left.target || right && moved > right.target)) return tr;
    if (right) {
        const after = right.original + right.size;
        const suffix = target.content.cut(right.target + right.size);
        if (!doc.content.cut(after).eq(suffix)) tr.replaceWith(after, doc.content.size, suffix);
    }
    if (left) {
        const prefix = target.content.cut(0, left.target);
        if (!doc.content.cut(0, left.original).eq(prefix)) tr.replaceWith(0, left.original, prefix);
    }
    return tr;
}
