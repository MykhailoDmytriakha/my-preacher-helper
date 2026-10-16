import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { Nodes } from 'mdast';

// Match MarkdownDisplay's syntax, including code spans in GFM tables. Container boundaries
// belong to the parser: a list/quote can end an otherwise unclosed code block.
const parser = unified().use(remarkParse).use(remarkGfm).freeze();

function visitCode(content: string, visit: (node: Nodes) => void): void {
  const pending: Nodes[] = [parser.parse(content)];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === 'code' || node.type === 'inlineCode') visit(node);
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
  }
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
