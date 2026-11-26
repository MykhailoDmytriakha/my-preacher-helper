import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { Nodes } from 'mdast';

// Match MarkdownDisplay's syntax, including code spans in GFM tables. Container boundaries
// belong to the parser: a list/quote can end an otherwise unclosed code block.
const parser = unified().use(remarkParse).use(remarkGfm).freeze();

interface CodeContext { listDepth: number; quoteDepth: number }
type CodeNode = Extract<Nodes, { type: 'code' | 'inlineCode' }>;
type ListItem = Extract<Nodes, { type: 'listItem' }>;
type WalkContext = { items: readonly ListItem[]; quoteDepth: number; footnoteLabelLine?: number };

function visitMarkdown(content: string, visit: (node: Nodes, context: WalkContext) => void): void {
  const pending: { node: Nodes; context: WalkContext }[] = [
    { node: parser.parse(content), context: { items: [], quoteDepth: 0 } },
  ];
  while (pending.length) {
    const { node, context } = pending.pop()!;
    visit(node, context);
    if (!('children' in node)) continue;
    const next = node.type === 'listItem' ? { ...context, items: [...context.items, node] }
      : node.type === 'blockquote' ? { ...context, quoteDepth: context.quoteDepth + 1 }
      : node.type === 'footnoteDefinition' ? { ...context, footnoteLabelLine: node.position?.start.line } : context;
    for (let index = node.children.length - 1; index >= 0; index--) {
      pending.push({ node: node.children[index], context: next });
    }
  }
}

function visitCode(content: string, visit: (node: CodeNode, context: WalkContext) => void): void {
  visitMarkdown(content, (node, context) => {
    if (node.type === 'code' || node.type === 'inlineCode') visit(node, context);
  });
}

interface MarkdownLocated extends CodeContext {
  start: number;
  end: number;
  blockStart: number;
}

export interface MarkdownCodeRange extends MarkdownLocated {
  kind: 'block' | 'inline';
  value: string;
}

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (const match of content.matchAll(/\r\n|\r|\n/g)) offsets.push(match.index! + match[0].length);
  return offsets;
}

function locate(node: Nodes, context: WalkContext, offsets: readonly number[]): MarkdownLocated | undefined {
  const position = node.position;
  if (position?.start.offset === undefined || position.end.offset === undefined) return;
  return {
    listDepth: context.items.length, quoteDepth: context.quoteDepth,
    start: position.start.offset, end: position.end.offset, blockStart: offsets[position.start.line - 1],
  };
}

/** Literal values and original source ranges come from the existing Markdown grammar. */
export function markdownCodeRanges(content: string): MarkdownCodeRange[] {
  const offsets = lineOffsets(content);
  const ranges: MarkdownCodeRange[] = [];
  visitCode(content, (node, context) => {
    const position = locate(node, context, offsets);
    if (!position) return;
    ranges.push({
      ...position, kind: node.type === 'code' ? 'block' : 'inline',
      // Match remark-rehype's inline-code display; block line breaks remain literal.
      value: node.type === 'inlineCode' ? node.value.replace(/\r?\n|\r/g, ' ') : node.value,
    });
  });
  return ranges;
}

/** Columns in a Markdown prefix, including tabs at four-column stops. */
export function markdownColumn(prefix: string, column = 0): number {
  for (const char of prefix) column += char === '\t' ? 4 - column % 4 : 1;
  return column;
}

interface ListOpening {
  marker: string;
  content: number;
}

export type MarkdownExportBlock = MarkdownLocated & { openings: ListOpening[] } &
  ({ kind: 'block'; value: string } | { kind: 'thematicBreak' });

/** List markers whose first block begins on the same source line. */
function listOpenings(content: string, node: Nodes, context: WalkContext, blockStart: number): ListOpening[] {
  return context.items.flatMap(item => {
    const start = item.position?.start;
    const child = item.children[0]?.position?.start;
    if (start?.offset === undefined || child?.offset === undefined || start.line !== node.position?.start.line) return [];
    const marker = /^(\d{1,9}[.)]|[-*+])([ \t]+)/.exec(content.slice(start.offset, child.offset));
    if (!marker) return [];
    const afterMarker = markdownColumn(marker[1], markdownColumn(content.slice(blockStart, start.offset)));
    const padding = markdownColumn(marker[2], afterMarker) - afterMarker;
    return [{ marker: marker[1], content: afterMarker + (padding > 4 ? 1 : padding) }];
  });
}

/** Blocks Word renders with their own formatting, as classified by the Markdown parser. */
export function markdownExportBlocks(content: string): MarkdownExportBlock[] {
  const offsets = lineOffsets(content);
  const blocks: MarkdownExportBlock[] = [];
  visitMarkdown(content, (node, context) => {
    if (node.type !== 'code' && node.type !== 'thematicBreak') return;
    // Word retains the footnote label as prose. A whole-line cut would discard it.
    if (node.type === 'thematicBreak' && node.position?.start.line === context.footnoteLabelLine) return;
    const position = locate(node, context, offsets);
    if (!position) return;
    const openings = listOpenings(content, node, context, position.blockStart);
    blocks.push(node.type === 'code'
      ? { ...position, openings, kind: 'block', value: node.value }
      : { ...position, openings, kind: 'thematicBreak' });
  });
  return blocks;
}

/** Zero-based LF-delimited source lines, matching the scanners without rewriting line endings. */
export function markdownCodeLines(content: string): ReadonlySet<number> {
  const lineStarts = [0];
  for (let offset = 0; offset < content.length; offset++) {
    if (content[offset] === '\n') lineStarts.push(offset + 1);
  }
  const lineAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low;
  };
  const lines = new Set<number>();
  visitCode(content, node => {
    if (node.type !== 'code' || !node.position) return;
    const { start, end } = node.position;
    // CommonMark also counts bare CR as a newline; callers retain those bytes inside LF lines.
    const lastLine = lineAt(Math.max(start.offset!, end.offset! - 1));
    for (let line = lineAt(start.offset!); line <= lastLine; line++) lines.add(line);
  });
  return lines;
}

/**
 * Mask code in its original source instead of reserializing prose. Whitespace and offsets stay
 * stable, and a block's quote/list markers cannot leak into a preview or become a paragraph.
 * Previews retain inline code; word/paragraph measurements opt into masking it too.
 */
export function withoutMarkdownCode(content: string, includeInline = false): string {
  if (!content) return content;
  const lineStarts = [0];
  for (const match of content.matchAll(/\r\n|\r|\n/g)) lineStarts.push(match.index! + match[0].length);
  const ranges: { start: number; end: number }[] = [];
  visitCode(content, node => {
    const position = node.position;
    if (!position) return;
    if (node.type === 'code') {
      ranges.push({ start: lineStarts[position.start.line - 1], end: position.end.offset! });
    } else if (includeInline) {
      ranges.push({ start: position.start.offset!, end: position.end.offset! });
    }
  });
  return maskMarkdownCodeRanges(content, ranges);
}

/** Mask already parser-confirmed ranges without changing original source offsets. */
export function maskMarkdownCodeRanges(
  content: string, ranges: ReadonlyArray<{ start: number; end: number }>,
): string {
  let cursor = 0;
  const parts: string[] = [];
  for (const { start, end } of ranges) {
    parts.push(content.slice(cursor, start), content.slice(start, end).replace(/[^\r\n]/g, ' '));
    cursor = end;
  }
  parts.push(content.slice(cursor));
  return parts.join('');
}
