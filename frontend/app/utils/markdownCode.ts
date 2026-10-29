import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { Nodes } from 'mdast';

// Match MarkdownDisplay's syntax, including code spans in GFM tables. Container boundaries
// belong to the parser: a list/quote can end an otherwise unclosed code block.
const parser = unified().use(remarkParse).use(remarkGfm).freeze();

interface CodeContext { listDepth: number; quoteDepth: number }
type CodeNode = Extract<Nodes, { type: 'code' | 'inlineCode' }>;

function visitCode(content: string, visit: (node: CodeNode, context: CodeContext) => void): void {
  const pending: { node: Nodes; context: CodeContext }[] = [
    { node: parser.parse(content), context: { listDepth: 0, quoteDepth: 0 } },
  ];
  while (pending.length) {
    const { node, context } = pending.pop()!;
    if (node.type === 'code' || node.type === 'inlineCode') visit(node, context);
    if ('children' in node) {
      const next = {
        listDepth: context.listDepth + Number(node.type === 'listItem'),
        quoteDepth: context.quoteDepth + Number(node.type === 'blockquote'),
      };
      for (let index = node.children.length - 1; index >= 0; index--) {
        pending.push({ node: node.children[index], context: next });
      }
    }
  }
}

export interface MarkdownCodeRange extends CodeContext {
  kind: 'block' | 'inline';
  start: number;
  end: number;
  blockStart: number;
  value: string;
}

/** Literal values and original source ranges come from the existing Markdown grammar. */
export function markdownCodeRanges(content: string): MarkdownCodeRange[] {
  const lineStarts = [0];
  for (const match of content.matchAll(/\r\n|\r|\n/g)) lineStarts.push(match.index! + match[0].length);
  const ranges: MarkdownCodeRange[] = [];
  visitCode(content, (node, context) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    ranges.push({
      ...context, kind: node.type === 'code' ? 'block' : 'inline', start, end,
      blockStart: lineStarts[node.position!.start.line - 1],
      // Match remark-rehype's inline-code display; block line breaks remain literal.
      value: node.type === 'inlineCode' ? node.value.replace(/\r?\n|\r/g, ' ') : node.value,
    });
  });
  return ranges;
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
  let cursor = 0;
  const parts: string[] = [];
  for (const { start, end } of ranges) {
    parts.push(content.slice(cursor, start), content.slice(start, end).replace(/[^\r\n]/g, ' '));
    cursor = end;
  }
  parts.push(content.slice(cursor));
  return parts.join('');
}
