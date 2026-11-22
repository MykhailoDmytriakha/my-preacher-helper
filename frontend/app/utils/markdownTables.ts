import { readMarkdownHtml } from './markdownHtml';

import type { MarkdownCodeRange } from './markdownCode';
import type { Element, Root, RootContent } from 'hast';

export interface MarkdownTableCell {
  source: string;
  code: Pick<MarkdownCodeRange, 'start' | 'end' | 'value'>[];
  /** A cell of a table written as HTML: its paragraphs, each its own source. */
  paragraphs?: string[];
  colSpan?: number;
  rowSpan?: number;
}

export interface MarkdownTableRange {
  start: number;
  end: number;
  blockStart: number;
  listDepth: number;
  quoteDepth: number;
  rows: MarkdownTableCell[][];
  /** Written as HTML — as the editor saves a table Markdown cannot hold (an empty first column, merged cells). */
  html: boolean;
}

const element = (node: RootContent): node is Element => node.type === 'element';
const text = (node: RootContent): string => node.type === 'text'
  ? node.value : 'children' in node ? node.children.map(text).join('') : '';

/** Cell positions include separator pipes; positioned inline children own the content. */
function sourceCell(content: string, cell: Element): MarkdownTableCell {
  const positioned = cell.children.filter(node =>
    node.position?.start.offset !== undefined && node.position?.end.offset !== undefined);
  if (!positioned.length) return { source: '', code: [] };
  const start = Math.min(...positioned.map(node => node.position!.start.offset!));
  const end = Math.max(...positioned.map(node => node.position!.end.offset!));
  const code: MarkdownTableCell['code'] = [];
  const visit = (node: RootContent): void => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (element(node) && node.tagName === 'code' && from !== undefined && to !== undefined
      && content[from] === '`') {
      code.push({ start: from - start, end: to - start, value: text(node) });
      return;
    }
    if ('children' in node) node.children.forEach(visit);
  };
  cell.children.forEach(visit);
  return { source: content.slice(start, end), code };
}

/** A cell of an HTML table: its paragraphs (`<p>`, `<br>` breaks) and its spans. */
function htmlCell(content: string, cell: Element): MarkdownTableCell {
  const { source } = sourceCell(content, cell);
  const paragraphs = source.split(/<\/p>\s*<p\b[^>]*>|<br\s*\/?>/i)
    .map(part => part.replace(/^\s*<p\b[^>]*>|<\/p>\s*$/gi, '').trim());
  const span = (value: unknown): number | undefined => Number(value) > 1 ? Number(value) : undefined;
  return { source, code: [], paragraphs, colSpan: span(cell.properties?.colSpan), rowSpan: span(cell.properties?.rowSpan) };
}

/**
 * Every table of the text, by the same reading the screen renders: a GFM table with its cell sources, and a table the
 * editor saved as HTML with each cell's paragraphs — one is as much a table as the other.
 */
export function markdownTableRanges(content: string): MarkdownTableRange[] {
  const starts = [0];
  for (const match of content.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
  const result: MarkdownTableRange[] = [];
  const visit = (node: Root | RootContent, listDepth: number, quoteDepth: number): void => {
    if (node.type === 'element' && node.tagName === 'table') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const html = /^<table\b/i.test(content.slice(start, end));
      const rows: MarkdownTableCell[][] = [];
      const collect = (parent: Element): void => {
        for (const child of parent.children.filter(element)) {
          if (child.tagName === 'tr') rows.push(child.children.filter(element)
            .filter(cell => cell.tagName === 'th' || cell.tagName === 'td')
            .map(cell => html ? htmlCell(content, cell) : sourceCell(content, cell)));
          else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) collect(child);
        }
      };
      collect(node);
      result.push({ start, end, blockStart: starts[node.position!.start.line - 1], listDepth, quoteDepth, rows, html });
      return;
    }
    if ('children' in node) {
      const list = listDepth + Number(node.type === 'element' && node.tagName === 'li');
      const quote = quoteDepth + Number(node.type === 'element' && node.tagName === 'blockquote');
      node.children.forEach(child => visit(child, list, quote));
    }
  };
  visit(readMarkdownHtml(content), 0, 0);
  return result;
}
