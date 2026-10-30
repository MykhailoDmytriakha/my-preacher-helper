import { readMarkdownHtml } from './markdownHtml';
import { markdownHeadingText } from './markdownPlainText';
import { prepareStructuredBlocks } from './markdownStructuredBlocks';

import type { Element, Root } from 'hast';

interface HeadingSpelling {
  source: string;
  text: string;
  authored: string;
}

export interface MarkdownHeadingRange extends HeadingSpelling {
  /** Original source span, including line-leading indentation but excluding its newline. */
  start: number;
  end: number;
  /** The body starts after at most one physical line ending. */
  bodyStart: number;
  level: number;
  /** Lookup-only spelling before structured prose preparation shortened this heading. */
  historical?: HeadingSpelling;
}

const rootHeadings = (tree: Root): Element[] => tree.children.filter((node): node is Element =>
  node.type === 'element' && /^h[1-6]$/.test(node.tagName));

const authoredSpelling = (node: Element, content: string, originalOffset: (offset: number) => number | null): string => {
  const spans = node.children.flatMap(child => {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    const from = originalOffset(start);
    const to = originalOffset(end);
    return from === null || to === null ? [] : [{ start: from, end: to }];
  });
  return spans.length ? content.slice(Math.min(...spans.map(span => span.start)), Math.max(...spans.map(span => span.end))) : '';
};

/** Root headings only: a list, quote, callout or code block owns its contents. */
export function markdownHeadingRanges(content: string): MarkdownHeadingRange[] {
  const prepared = prepareStructuredBlocks(content);
  const original = prepared.markdown === content ? [] : rootHeadings(readMarkdownHtml(content));
  const originalByStart = new Map(original.map(node => [node.position?.start.offset, node]));
  const result: MarkdownHeadingRange[] = [];
  for (const node of rootHeadings(readMarkdownHtml(prepared.markdown))) {
    const preparedFrom = node.position?.start.offset;
    const preparedEnd = node.position?.end.offset;
    if (preparedFrom === undefined || preparedEnd === undefined) continue;
    const from = prepared.originalOffset(preparedFrom);
    const end = prepared.originalOffset(preparedEnd);
    // Generated callout internals have no original heading boundary.
    if (from === null || end === null) continue;
    const lineStart = Math.max(content.lastIndexOf('\n', from - 1), content.lastIndexOf('\r', from - 1)) + 1;
    const start = /^[ \t]*$/.test(content.slice(lineStart, from)) ? lineStart : from;
    const source = content.slice(start, end);
    const previous = originalByStart.get(from);
    const previousEnd = previous?.position?.end.offset;
    const historical = previous && previousEnd !== undefined && previousEnd !== end ? {
      source: content.slice(start, previousEnd),
      text: markdownHeadingText(previous),
      authored: authoredSpelling(previous, content, offset => offset),
    } : undefined;
    const separator = /^(?:\r\n|\r|\n)/.exec(content.slice(end));
    result.push({
      start, end, bodyStart: end + (separator?.[0].length ?? 0),
      level: Number(node.tagName[1]), source,
      text: markdownHeadingText(node), authored: authoredSpelling(node, content, prepared.originalOffset),
      ...(historical ? { historical } : {}),
    });
  }
  return result;
}

/** A following heading replaces one line delimiter, not a meaningful blank body line. */
export const markdownBeforeHeading = (content: string, start: number, end: number): string =>
  content.slice(start, end).replace(/(?:\r\n|\r|\n)$/, '');
