import { readMarkdownHtml } from './markdownHtml';

import type { Root, RootContent } from 'hast';

/** Transform positioned prose in the original source, never reserialize authored Markdown. */
export function mapMarkdownProseSource(content: string, transform: (source: string) => string): string {
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: Root | RootContent): void => {
    // Prune the subtree: a link's displayed label is literal too.
    if (node.type === 'element' && ['code', 'pre', 'a'].includes(node.tagName)) return;
    if (node.type === 'text') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // Generated labels/backreferences have no source. Never infer offsets from decoded text.
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(readMarkdownHtml(content));
  ranges.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start < cursor) continue;
    parts.push(content.slice(cursor, start), transform(content.slice(start, end)));
    cursor = end;
  }
  parts.push(content.slice(cursor));
  return parts.join('');
}
