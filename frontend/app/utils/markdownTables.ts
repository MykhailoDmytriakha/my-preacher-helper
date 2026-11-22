import { readMarkdownHtml } from './markdownHtml';

import type { MarkdownCodeRange } from './markdownCode';
import type { Element, ElementContent, Root, RootContent } from 'hast';

/** A run of a cell's text with the marks its tags give it — already decoded, never to be read as Markdown again. */
export interface CellSpan {
  text: string;
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  highlight?: boolean;
}

export interface MarkdownTableCell {
  source: string;
  code: Pick<MarkdownCodeRange, 'start' | 'end' | 'value'>[];
  /** A cell of a table written as HTML: its lines — a paragraph, a list item, a break each — read from the tree. */
  lines?: CellSpan[][];
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
  /** An HTML table's caption, drawn above it. */
  caption?: string;
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

const MARKS: Record<string, Omit<CellSpan, 'text'>> = {
  strong: { bold: true }, b: { bold: true }, em: { italics: true }, i: { italics: true }, u: { underline: true },
  s: { strike: true }, del: { strike: true }, strike: { strike: true }, code: { code: true }, kbd: { code: true },
  sup: { superScript: true }, sub: { subScript: true }, mark: { highlight: true },
};
const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'dt', 'dd', 'figcaption', 'table', 'caption']);

/**
 * The lines of an HTML cell, as the browser draws them: a paragraph, a list item (with its bullet or number), a row of a
 * table inside it and a `<br>` each start a line; tags give the marks; spaces collapse as in HTML, except in `<pre>`.
 */
function htmlCellLines(cell: Element): CellSpan[][] {
  const lines: CellSpan[][] = [[]];
  // Lines a <br> began: an empty one between two others is the blank line the person made.
  const broken = new Set<number>();
  let prefix = '';
  const breakLine = () => { if (lines[lines.length - 1].length) lines.push([]); };
  const visit = (node: ElementContent, marks: Omit<CellSpan, 'text'>, pre: boolean): void => {
    if (node.type === 'text') {
      const text = pre ? node.value : node.value.replace(/\s+/g, ' ');
      if (!text || (!lines[lines.length - 1].length && !prefix && !text.trim())) return;
      if (prefix) lines[lines.length - 1].push({ text: prefix });
      lines[lines.length - 1].push({ text, ...marks });
      prefix = '';
      return;
    }
    if (node.type !== 'element') return;
    if (node.tagName === 'br') { lines.push([]); broken.add(lines.length - 1); return; }
    if (node.tagName === 'table') {
      for (const { row } of htmlRows(node)) visit(row, marks, pre);
      return;
    }
    if (node.tagName === 'img') { const alt = String(node.properties?.alt ?? ''); if (alt) visit({ type: 'text', value: alt }, marks, pre); return; }
    if (node.tagName === 'ul' || node.tagName === 'ol') {
      let number = Number(node.properties?.start ?? 1);
      for (const item of node.children) {
        if (item.type !== 'element' || item.tagName !== 'li') continue;
        breakLine();
        prefix = node.tagName === 'ol' ? `${number++}. ` : '• ';
        item.children.forEach(child => visit(child, marks, pre));
        prefix = '';
        breakLine();
      }
      return;
    }
    const block = BLOCKS.has(node.tagName);
    if (block && !prefix) breakLine();
    node.children.forEach(child => visit(child, { ...marks, ...MARKS[node.tagName] }, pre || node.tagName === 'pre'));
    if (block) breakLine();
    else if (node.tagName === 'td' || node.tagName === 'th') lines[lines.length - 1].push({ text: ' ' });
  };
  cell.children.forEach(child => visit(child, {}, false));
  const trimmed = lines.map(line => {
    const spans = line.map(span => ({ ...span }));
    if (spans.length) {
      spans[0].text = spans[0].text.replace(/^\s+/, '');
      spans[spans.length - 1].text = spans[spans.length - 1].text.replace(/\s+$/, '');
    }
    return spans.filter(span => span.text);
  });
  const first = trimmed.findIndex(line => line.length);
  const last = trimmed.length - 1 - [...trimmed].reverse().findIndex(line => line.length);
  return first < 0 ? [] : trimmed.filter((line, index) => index >= first && index <= last && (line.length || broken.has(index)));
}

/** A cell of an HTML table: its lines from the tree and its spans («rowspan=0» runs to the end of its group). */
function htmlCell(content: string, cell: Element, rowsLeft: number): MarkdownTableCell {
  const span = (value: unknown): number | undefined => Number(value) > 1 ? Number(value) : undefined;
  // A merge never runs past its own group of rows, as the browser draws it.
  const asked = String(cell.properties?.rowSpan) === '0' ? rowsLeft : span(cell.properties?.rowSpan) ?? 1;
  const rowSpan = Math.min(asked, rowsLeft) > 1 ? Math.min(asked, rowsLeft) : undefined;
  return { source: sourceCell(content, cell).source, code: [], lines: htmlCellLines(cell), colSpan: span(cell.properties?.colSpan), rowSpan };
}

const cellsOf = (row: Element): Element[] => row.children.filter(element).filter(cell => cell.tagName === 'th' || cell.tagName === 'td');

/** An HTML table's rows in the order the browser draws them — head, bodies, foot — each with its section's rows left. */
function htmlRows(table: Element): { row: Element; left: number }[] {
  const heads: Element[][] = [];
  const bodies: Element[][] = [];
  const feet: Element[][] = [];
  let loose: Element[] | null = null;
  for (const child of table.children.filter(element)) {
    if (child.tagName === 'tr') {
      if (!loose) { loose = []; bodies.push(loose); }
      loose.push(child);
      continue;
    }
    loose = null;
    const rows = child.children.filter(element).filter(row => row.tagName === 'tr');
    if (child.tagName === 'thead') heads.push(rows);
    else if (child.tagName === 'tbody') bodies.push(rows);
    else if (child.tagName === 'tfoot') feet.push(rows);
  }
  return [...heads, ...bodies, ...feet].flatMap(rows => rows.map((row, index) => ({ row, left: rows.length - index })));
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
      if (html) {
        // A caption, and the words the safe reader leaves right inside the table when it unwraps a tag it does not allow
        // (a <caption> among them): the screen draws them above the table, and so does Word.
        const caption = node.children
          .filter(child => !(element(child) && ['thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'col'].includes(child.tagName)))
          .map(text).join('').replace(/\s+/g, ' ').trim();
        const rows = htmlRows(node).map(({ row, left }) => cellsOf(row).map(cell => htmlCell(content, cell, left)));
        // An HTML table may begin in the middle of a line: the words before it on that line are prose, not the table.
        result.push({ start, end, blockStart: start, listDepth, quoteDepth, rows, html,
          ...(caption ? { caption } : {}) });
        return;
      }
      const rows: MarkdownTableCell[][] = [];
      const collect = (parent: Element): void => {
        for (const child of parent.children.filter(element)) {
          if (child.tagName === 'tr') rows.push(cellsOf(child).map(cell => sourceCell(content, cell)));
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
