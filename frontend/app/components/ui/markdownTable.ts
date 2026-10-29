import { getHTMLFromFragment } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Fragment } from '@tiptap/pm/model';

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

interface TableMarkdownWriter {
  inTable: boolean;
  write(text: string): void;
  renderInline(node: ProseMirrorNode): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
}

/** Pipe syntax cannot retain spans, block cells, or a pipe inside code/link markup. */
function canWritePipeTable(table: ProseMirrorNode): boolean {
  if (JSON.stringify(table.toJSON()).includes('|')) return false;
  let supported = true;
  table.forEach((row, _offset, rowIndex) => {
    row.forEach(cell => {
      if (cell.type.name !== (rowIndex === 0 ? 'tableHeader' : 'tableCell')
        || cell.attrs.colspan > 1 || cell.attrs.rowspan > 1 || cell.attrs.colwidth
        || cell.childCount !== 1 || cell.firstChild?.type.name !== 'paragraph') {
        supported = false;
      }
      cell.descendants(child => {
        if (child.type.name === 'hardBreak' || child.text?.includes('\n')) supported = false;
      });
    });
  });
  return supported;
}

/** Keep ordinary tables as Markdown and use the schema's HTML for richer cell content. */
export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: TableMarkdownWriter, table: ProseMirrorNode) {
          if (!canWritePipeTable(table)) {
            state.write(getHTMLFromFragment(Fragment.from(table), table.type.schema));
            state.closeBlock(table);
            return;
          }
          const wasInTable = state.inTable;
          state.inTable = true;
          table.forEach((row, _offset, rowIndex) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, cellIndex) => {
              if (cellIndex) state.write(' | ');
              state.renderInline(cell.firstChild!);
            });
            state.write(' |');
            state.ensureNewLine();
            if (rowIndex === 0) {
              state.write('| ' + Array.from({ length: row.childCount }, () => '---').join(' | ') + ' |');
              state.ensureNewLine();
            }
          });
          state.closeBlock(table);
          state.inTable = wasInTable;
        },
      },
    };
  },
});
