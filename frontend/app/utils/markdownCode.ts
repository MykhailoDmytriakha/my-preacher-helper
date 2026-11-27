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
type QuoteContainer = Extract<Nodes, { type: 'blockquote' | 'list' | 'listItem' }>;
type WalkListItem = { node: ListItem; quoteDepth: number };
type WalkContext = { items: readonly WalkListItem[]; quoteDepth: number; footnoteLabelLine?: number };

function visitMarkdown(content: string, visit: (node: Nodes, context: WalkContext) => void): void {
  const pending: { node: Nodes; context: WalkContext }[] = [
    { node: parser.parse(content), context: { items: [], quoteDepth: 0 } },
  ];
  while (pending.length) {
    const { node, context } = pending.pop()!;
    visit(node, context);
    if (!('children' in node)) continue;
    const next = node.type === 'listItem' ? { ...context, items: [...context.items, { node, quoteDepth: context.quoteDepth }] }
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

export type MarkdownInlineCode = Pick<MarkdownCodeRange, 'start' | 'end' | 'value'>;

export type MarkdownExportBlock = MarkdownLocated & { openings: ListOpening[] } & (
  | { kind: 'block'; value: string }
  | { kind: 'thematicBreak' }
  | { kind: 'quote'; value: string; code: MarkdownInlineCode[]; itemQuoteDepth: number }
  | { kind: 'quoteSeparator' }
);

/** List markers whose first block begins on the same source line. */
function listOpenings(content: string, node: Nodes, context: WalkContext, blockStart: number): ListOpening[] {
  return context.items.flatMap(({ node: item }) => {
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

function quoteBody(content: string, node: Extract<Nodes, { type: 'paragraph' }>, position: MarkdownLocated) {
  // Mask continuation prefixes without shifting the original inline spans.
  const value = content.slice(position.start, position.end).replace(/(\r\n|\r|\n)([^\r\n]*)/g, (_match, newline: string, line: string) => {
    let remainder = line;
    for (let depth = 0; depth < position.quoteDepth; depth++) {
      const prefix = /^[ \t]*>[ \t]?/.exec(remainder);
      if (!prefix) break; // A lazy line may omit some or all quote markers.
      remainder = remainder.slice(prefix[0].length);
    }
    return newline + ' '.repeat(line.length - remainder.length) + remainder;
  });
  const code: MarkdownInlineCode[] = [];
  const pending: Nodes[] = [...node.children].reverse();
  while (pending.length) {
    const child = pending.pop()!;
    if (child.type === 'inlineCode') {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start !== undefined && end !== undefined) code.push({
        start: start - position.start, end: end - position.start, value: child.value.replace(/\r\n|\r|\n/g, ' '),
      });
    }
    if ('children' in child) {
      for (let index = child.children.length - 1; index >= 0; index--) pending.push(child.children[index]);
    }
  }
  return { value, code };
}

function quoteSeparators(content: string, node: QuoteContainer, offsets: number[]): MarkdownExportBlock[] {
  if (!node.position) return [];
  const separators: MarkdownExportBlock[] = [];
  let line = node.position.start.line - 1;
  const appendGap = (until: number) => {
    for (; line < until; line++) {
      const start = offsets[line];
      const end = offsets[line + 1] ?? content.length;
      const marker = content.slice(start, end).trim();
      if (/^(?:>[ \t]*)+$/.test(marker)) {
        separators.push({ kind: 'quoteSeparator', start, end, blockStart: start, openings: [], listDepth: 0, quoteDepth: 0 });
      }
    }
  };
  // Marker-only lines in the gaps separate quote blocks. Text inside a child (such as code) is literal.
  for (const child of node.children) {
    if (!child.position) continue;
    appendGap(child.position.start.line - 1);
    line = child.position.end.line;
  }
  appendGap(node.position.end.line);
  return separators;
}

/** Blocks Word renders with their own formatting, as classified by the Markdown parser. */
export function markdownExportBlocks(content: string): MarkdownExportBlock[] {
  const offsets = lineOffsets(content);
  const blocks: MarkdownExportBlock[] = [];
  visitMarkdown(content, (node, context) => {
    if (node.type === 'blockquote' || (context.quoteDepth > 0 && (node.type === 'list' || node.type === 'listItem'))) {
      for (const separator of quoteSeparators(content, node, offsets)) blocks.push(separator);
    }
    const quote = node.type === 'paragraph' && context.quoteDepth > 0;
    if (node.type !== 'code' && node.type !== 'thematicBreak' && !quote) return;
    // Word retains the footnote label as prose. A whole-line cut would discard it.
    if (node.type !== 'code' && node.position?.start.line === context.footnoteLabelLine) return;
    const position = locate(node, context, offsets);
    if (!position) return;
    const shared = { ...position, openings: listOpenings(content, node, context, position.blockStart) };
    if (node.type === 'code') blocks.push({ ...shared, kind: 'block', value: node.value });
    else if (node.type === 'thematicBreak') blocks.push({ ...shared, kind: 'thematicBreak' });
    else blocks.push({
      ...shared, kind: 'quote', ...quoteBody(content, node, position),
      itemQuoteDepth: context.items.at(-1)?.quoteDepth ?? 0,
    });
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
