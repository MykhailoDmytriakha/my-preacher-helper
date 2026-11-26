import { readMarkdownHtml, readMarkdownHtmlWithRanges } from './markdownHtml';

import type { MarkdownCodeRange } from './markdownCode';
import type { Element, Root, RootContent } from 'hast';

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
function htmlLines(children: readonly RootContent[]): CellSpan[][] {
  const lines: CellSpan[][] = [[]];
  // Lines a <br> began: an empty one between two others is the blank line the person made.
  const broken = new Set<number>();
  let prefix = '';
  const breakLine = () => { if (lines[lines.length - 1].length) lines.push([]); };
  const visit = (node: RootContent, marks: Omit<CellSpan, 'text'>, pre: boolean): void => {
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
  children.forEach(child => visit(child, {}, false));
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
  return { source: sourceCell(content, cell).source, code: [], lines: htmlLines(cell.children), colSpan: span(cell.properties?.colSpan), rowSpan };
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

type ColumnMerge = { start: number; end: number; lastRow: number };

/** Find the free column runs in otherwise empty HTML rows. Word adds the inherited merges itself. */
export function emptyHtmlTableRows(rows: readonly MarkdownTableCell[][]): Map<number, number[]> {
  const empty = new Map<number, ColumnMerge[]>();
  let width = 0;
  let occupied: ColumnMerge[] = [];
  rows.forEach((row, index) => {
    occupied = occupied.filter(merge => index <= merge.lastRow);
    if (!row.length) {
      empty.set(index, occupied);
      return;
    }
    const merges: ColumnMerge[] = [];
    let column = 0;
    for (const cell of row) {
      for (const merge of occupied) {
        if (merge.start > column) break;
        column = Math.max(column, merge.end);
      }
      const end = column + (cell.colSpan ?? 1);
      if (cell.rowSpan) merges.push({ start: column, end, lastRow: index + cell.rowSpan - 1 });
      column = end;
    }
    width = Math.max(width, column);
    occupied = [...occupied, ...merges].sort((left, right) => left.start - right.start);
  });
  return new Map(Array.from(empty, ([index, merges]) => {
    const spans: number[] = [];
    let column = 0;
    for (const merge of merges) {
      if (column < merge.start) spans.push(merge.start - column);
      column = Math.max(column, merge.end);
    }
    if (column < width) spans.push(width - column);
    return [index, spans];
  }));
}

/**
 * Every table of the text, by the same reading the screen renders: a GFM table with its cell sources, and a table the
 * editor saved as HTML with each cell's paragraphs — one is as much a table as the other.
 */
function tableRanges(content: string, tree: Root) {
  const starts = [0];
  for (const match of content.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
  const tables = new Map<Element, MarkdownTableRange>();
  const containers = new Set<Root | RootContent>();
  const visit = (node: Root | RootContent, listDepth: number, quoteDepth: number): boolean => {
    if (node.type === 'element' && node.tagName === 'table') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return false;
      const html = /^<table\b/i.test(content.slice(start, end));
      if (html) {
        // A caption, and the words the safe reader leaves right inside the table when it unwraps a tag it does not allow
        // (a <caption> among them): the screen draws them above the table, and so does Word.
        const caption = node.children
          .filter(child => !(element(child) && ['thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'col'].includes(child.tagName)))
          .map(text).join('').replace(/\s+/g, ' ').trim();
        const rows = htmlRows(node).map(({ row, left }) => cellsOf(row).map(cell => htmlCell(content, cell, left)));
        // An HTML table may begin in the middle of a line: the words before it on that line are prose, not the table.
        tables.set(node, { start, end, blockStart: start, listDepth, quoteDepth, rows, html,
          ...(caption ? { caption } : {}) });
        return true;
      }
      const rows: MarkdownTableCell[][] = [];
      const collect = (parent: Element): void => {
        for (const child of parent.children.filter(element)) {
          if (child.tagName === 'tr') rows.push(cellsOf(child).map(cell => sourceCell(content, cell)));
          else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) collect(child);
        }
      };
      collect(node);
      tables.set(node, { start, end, blockStart: starts[node.position!.start.line - 1], listDepth, quoteDepth, rows, html });
      return true;
    }
    if ('children' in node) {
      const list = listDepth + Number(node.type === 'element' && node.tagName === 'li');
      const quote = quoteDepth + Number(node.type === 'element' && node.tagName === 'blockquote');
      for (const child of node.children) if (visit(child, list, quote)) containers.add(node);
    }
    return containers.has(node);
  };
  visit(tree, 0, 0);
  return { tables, containers };
}

type SourceSpan = { start: number; end: number };
type Prose = { kind: 'prose'; lines: CellSpan[][]; listDepth: number; quoteDepth: number };
type TablePiece = { kind: 'table'; table: MarkdownTableRange };
type HtmlFragment = SourceSpan & { kind: 'html'; headingCuts: SourceSpan[]; pieces: (Prose | TablePiece)[] };
type NodePiece = { kind: 'node'; node: RootContent; listDepth: number; quoteDepth: number };
type Fragment = SourceSpan & { headingCuts: SourceSpan[]; pieces: (NodePiece | TablePiece)[] };

function sourceSpan(node: RootContent): SourceSpan | undefined {
  const start = node.position?.start.offset, end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** An implicitly closed HTML element can end at its opening tag in parse locations. */
function lastSourceOffset(node: RootContent): number {
  let end = sourceSpan(node)?.end ?? 0;
  if ('children' in node) {
    for (const child of node.children) end = Math.max(end, lastSourceOffset(child));
  }
  return end;
}

/** An open table can move later source siblings before itself. */
function displacedTextEnd(siblings: readonly RootContent[], index: number, start: number, end: number): number {
  for (let previous = index - 1; previous >= 0; previous--) {
    const span = sourceSpan(siblings[previous]);
    if (!span) continue;
    if (span.end <= start) break;
    end = Math.max(end, span.end);
  }
  return end;
}

function htmlTableFragments(
  content: string, tree: Root, tables: ReadonlyMap<Element, MarkdownTableRange>, rawHtml: readonly SourceSpan[],
): Fragment[] {
  const spans: Omit<Fragment, 'pieces'>[] = [];
  const visit = (siblings: readonly RootContent[], rawParentStart?: number): void => {
    siblings.forEach((node, index) => {
      if (!element(node)) return;
      const table = tables.get(node);
      if (!table) {
        const start = sourceSpan(node)?.start;
        visit(node.children, start !== undefined && content[start] === '<' ? start : rawParentStart);
        return;
      }
      if (!table.html) return;
      const subtreeEnd = lastSourceOffset(node);
      const explicitEnd = /<\/table\s*>$/i.test(content.slice(table.start, table.end));
      const end = explicitEnd ? subtreeEnd : displacedTextEnd(siblings, index, table.start, subtreeEnd);
      const extent = { start: table.start, end };
      const headingCut = { ...extent };
      const preceding = siblings[index - 1];
      const prefix = preceding ? sourceSpan(preceding) : undefined;
      if (preceding?.type === 'text' && prefix && prefix.start < table.start && table.start < prefix.end) {
        // The parser can combine text from before the wrapper's blank line and inside the table.
        extent.start = prefix.start;
      } else if (rawParentStart !== undefined && siblings.slice(0, index).some(sibling =>
        sibling.type === 'text' && !sourceSpan(sibling) && sibling.value.trim())) {
        extent.start = Math.min(extent.start, rawParentStart);
      }
      const next = siblings[index + 1];
      const tail = next?.type === 'text' ? sourceSpan(next) : undefined;
      if (tail?.start === table.end && !/^[\r\n]/.test(content.slice(tail.start, tail.end))) extent.end = Math.max(extent.end, tail.end);
      for (const raw of rawHtml) {
        if (raw.start >= extent.end || raw.end <= extent.start) continue;
        extent.start = Math.min(extent.start, raw.start);
        extent.end = Math.max(extent.end, raw.end);
      }
      spans.push({ ...extent, headingCuts: [headingCut] });
    });
  };
  visit(tree.children);
  const fragments: Fragment[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start)) {
    const previous = fragments.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      previous.headingCuts.push(...span.headingCuts);
    } else fragments.push({ ...span, pieces: [] });
  }
  return fragments;
}

function fragmentPieces(fragment: Fragment): HtmlFragment['pieces'] {
  const result: HtmlFragment['pieces'] = [];
  let nodes: RootContent[] = [];
  let listDepth = 0, quoteDepth = 0;
  const flush = () => {
    if (!nodes.length) return;
    const lines = htmlLines(nodes);
    if (lines.length) result.push({ kind: 'prose', lines, listDepth, quoteDepth });
    nodes = [];
  };
  for (const piece of fragment.pieces) {
    if (piece.kind === 'table') {
      flush();
      result.push(piece);
    } else {
      if (listDepth !== piece.listDepth || quoteDepth !== piece.quoteDepth) flush();
      ({ listDepth, quoteDepth } = piece);
      nodes.push(piece.node);
    }
  }
  flush();
  return result;
}

/** Raw table fragments use the safe tree's order. Source slicing is only for the Markdown between them. */
export function markdownTableBlocks(content: string): (HtmlFragment | TablePiece)[] {
  const { tree, rawHtml } = readMarkdownHtmlWithRanges(content);
  const { tables, containers } = tableRanges(content, tree);
  const fragments = htmlTableFragments(content, tree, tables, rawHtml);
  if (!fragments.length) return Array.from(tables.values(), table => ({ kind: 'table', table }));
  const ordinaryTables: TablePiece[] = [];
  const claim = (span: SourceSpan) => fragments.find(fragment => fragment.start <= span.start && span.end <= fragment.end);
  const walk = (children: readonly RootContent[], listDepth: number, quoteDepth: number, owner?: Fragment): void => {
    // Repair may leave fostered text without offsets. A neighboring positioned node in the same
    // container identifies its raw fragment without treating the text's decoded length as a source range.
    const positions = children.map(sourceSpan);
    const owners = positions.map(span => span ? claim(span) : undefined);
    const next = [...owners];
    let following = owner;
    for (let index = children.length - 1; index >= 0; index--) {
      if (positions[index]) following = owners[index];
      else next[index] = following;
    }
    let previous = owner;
    children.forEach((node, index) => {
      const fragment = positions[index] ? owners[index] : owner ?? next[index] ?? previous;
      if (positions[index]) previous = owners[index];
      const table = element(node) ? tables.get(node) : undefined;
      if (table) (fragment?.pieces ?? ordinaryTables).push({ kind: 'table', table });
      else if (fragment && !containers.has(node)) fragment.pieces.push({ kind: 'node', node, listDepth, quoteDepth });
      else if (element(node)) walk(node.children, listDepth + Number(node.tagName === 'li'),
        quoteDepth + Number(node.tagName === 'blockquote'), fragment);
    });
  };
  walk(tree.children, 0, 0);
  return [
    ...ordinaryTables,
    ...fragments.map((fragment): HtmlFragment => ({
      kind: 'html', start: fragment.start, end: fragment.end, headingCuts: fragment.headingCuts, pieces: fragmentPieces(fragment),
    })),
  ].sort((left, right) => blockStart(left) - blockStart(right));
}

const blockStart = (block: HtmlFragment | TablePiece) => block.kind === 'html' ? block.start : block.table.blockStart;

export function markdownTableRanges(content: string): MarkdownTableRange[] {
  return [...tableRanges(content, readMarkdownHtml(content)).tables.values()];
}
