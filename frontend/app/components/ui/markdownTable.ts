import { Table } from '@tiptap/extension-table';
import { Fragment, Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';

/** The part of tiptap-markdown's serializer state a table writer uses. */
interface MarkdownWriter {
    readonly nodes: unknown;
    readonly marks: unknown;
    readonly options: unknown;
    out: string;
    write(text: string): void;
    renderContent(parent: ProseMirrorNode): void;
    ensureNewLine(): void;
    closeBlock(node: ProseMirrorNode): void;
}

/**
 * markdown-it, which reads the note back, splits a table row at a pipe unless a backslash stands right before it, and
 * then takes exactly that one backslash away — inside code too (`rules_block/table.mjs`, escapedSplit). So every pipe in
 * a cell's written words gets one backslash more, whatever stands before it: guessing which pipes were already escaped
 * lost a backslash written inside code (Codex review, 2026-10-29).
 */
export function escapeCellPipes(cell: string): string {
    return cell.replace(/\|/g, '\\|');
}

/** Marks whose words the two readers of a table row — the editor's markdown-it and the views' micromark — unescape alike. */
const READ_ALIKE = new Set(['bold', 'italic', 'strike', 'code', 'link']);

/**
 * A pipe stays only where both readers take its backslash the same way; elsewhere the views split the cell and the rest
 * of the row's words fall out of sight, or show a backslash the editor does not (Codex review, 2026-10-29):
 * - code with a backslash right before a pipe is written as plain words, giving up only its code look;
 * - a mark written as HTML (underline) holds its words outside Markdown's escapes, so with a pipe they go plain;
 * - a pipe in a link's address is written %7C, which names the same address; in its tooltip the pipe and any
 *   backslash are written &#124; and &#92;, which both readers turn back alike — a backslash would escape the next sign.
 */
function readableLink(link: Mark): Mark {
    const href = String(link.attrs.href ?? '');
    const title = typeof link.attrs.title === 'string' ? link.attrs.title : null;
    if (!href.includes('|') && !title?.includes('|')) return link;
    return link.type.create({
        ...link.attrs,
        href: href.replace(/\|/g, '%7C'),
        title: title === null ? title : title.replace(/\\/g, '&#92;').replace(/\|/g, '&#124;'),
    });
}

function readableText(child: ProseMirrorNode): ProseMirrorNode {
    const text = child.text ?? '';
    const marks = child.marks
        .filter((mark) => !(mark.type.name === 'code' && /\\\|/.test(text)))
        .filter((mark) => READ_ALIKE.has(mark.type.name) || !text.includes('|'))
        .map((mark) => (mark.type.name === 'link' ? readableLink(mark) : mark));
    return Mark.sameSet(marks, child.marks) ? child : child.mark(marks);
}

/** A cell's textblock with its words made readable alike, as above. */
function readableInCell(block: ProseMirrorNode): ProseMirrorNode {
    let changed = false;
    const children: ProseMirrorNode[] = [];
    block.forEach((child) => {
        const readable = child.isText ? readableText(child) : child;
        children.push(readable);
        changed ||= readable !== child;
    });
    return changed ? block.copy(Fragment.from(children)) : block;
}

/**
 * One cell's words on one line, as Markdown has no room for more inside a cell: its paragraphs, list items and quoted
 * lines stand side by side and a line break becomes a space. Every word stays, none run into the next.
 *
 * Written by a serializer of its own, to the end, and only then into the table's: tiptap-markdown keeps positions in what
 * it has written to tidy bold and italic marks when the next node is drawn, and backslashes put into its output moved
 * them — the tidying then cut a letter out of the cell (Codex review, 2026-10-29).
 */
function cellLine(state: MarkdownWriter, cell: ProseMirrorNode): string {
    const { paragraph } = cell.type.schema.nodes;
    const lines: ProseMirrorNode[] = [];
    cell.descendants((node) => {
        if (!node.isTextblock) return true;
        lines.push(readableInCell(paragraph.create(null, node.content)));
        return false;
    });
    const Writer = state.constructor as new (nodes: unknown, marks: unknown, options: unknown) => MarkdownWriter;
    const own = new Writer(state.nodes, state.marks, state.options);
    own.renderContent(cell.type.schema.topNodeType.create(null, lines));
    return escapeCellPipes(own.out.replace(/\\\n/g, ' ').replace(/\s*\n\s*/g, ' ').trim());
}

/** The cell whose top-left corner is this slot of the grid, or null for a slot another cell's span covers. */
function cellStartingAt(table: ProseMirrorNode, map: TableMap, row: number, column: number): ProseMirrorNode | null {
    const offset = map.map[row * map.width + column];
    const area = map.findCell(offset);
    return area.top === row && area.left === column ? table.nodeAt(offset) : null;
}

/**
 * The editor's table, always written back as a Markdown table. tiptap-markdown wrote one as HTML when it had no header
 * row or a cell held more than a paragraph — markup the plan's reading and preaching views show as text — and left a
 * pipe in a cell's words unescaped, so the next opening split the cell and dropped the last one's words (Codex review,
 * 2026-10-29). It goes by the table's grid: the first row is the header, as Markdown requires, and a merged cell's words
 * stand once, in its first row and column, the rest of its area left empty — so no word moves under another heading.
 */
export const MarkdownTable = Table.extend({
    addStorage() {
        return {
            ...this.parent?.(),
            // Merged over tiptap-markdown's own table spec, which keeps parsing as it was (markdown-it reads tables).
            markdown: {
                serialize(state: MarkdownWriter, node: ProseMirrorNode) {
                    const map = TableMap.get(node);
                    for (let row = 0; row < map.height; row += 1) {
                        state.write('| ');
                        for (let column = 0; column < map.width; column += 1) {
                            if (column) state.write(' | ');
                            const cell = cellStartingAt(node, map, row, column);
                            if (cell) state.write(cellLine(state, cell));
                        }
                        state.write(' |');
                        state.ensureNewLine();
                        if (row === 0) {
                            state.write(`| ${Array.from({ length: map.width }, () => '---').join(' | ')} |`);
                            state.ensureNewLine();
                        }
                    }
                    state.closeBlock(node);
                },
            },
        };
    },
});
