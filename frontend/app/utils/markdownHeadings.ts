import { readMarkdownHtml } from './markdownHtml';
import { markdownHeadingText } from './markdownPlainText';

export interface MarkdownHeadingRange {
  /** Original source span, including line-leading indentation but excluding its newline. */
  start: number;
  end: number;
  /** The body starts after at most one physical line ending. */
  bodyStart: number;
  level: number;
  source: string;
  text: string;
  /** Original inline spelling, never reconstructed from decoded reader text. */
  authored: string;
}

/** Root headings only: a list, quote or code block retains ownership of its contents. */
export function markdownHeadingRanges(content: string): MarkdownHeadingRange[] {
  const result: MarkdownHeadingRange[] = [];
  for (const node of readMarkdownHtml(content).children) {
    if (node.type !== 'element' || !/^h[1-6]$/.test(node.tagName)) continue;
    const from = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (from === undefined || end === undefined) continue;
    const lineStart = Math.max(content.lastIndexOf('\n', from - 1), content.lastIndexOf('\r', from - 1)) + 1;
    const start = /^[ \t]*$/.test(content.slice(lineStart, from)) ? lineStart : from;
    const positioned = node.children.filter(child =>
      child.position?.start.offset !== undefined && child.position?.end.offset !== undefined);
    const authored = positioned.length ? content.slice(
      Math.min(...positioned.map(child => child.position!.start.offset!)),
      Math.max(...positioned.map(child => child.position!.end.offset!)),
    ) : '';
    const separator = /^(?:\r\n|\r|\n)/.exec(content.slice(end));
    result.push({
      start, end, bodyStart: end + (separator?.[0].length ?? 0),
      level: Number(node.tagName[1]), source: content.slice(start, end),
      text: markdownHeadingText(node), authored,
    });
  }
  return result;
}

/** A following heading replaces one line delimiter, not a meaningful blank body line. */
export const markdownBeforeHeading = (content: string, start: number, end: number): string =>
  content.slice(start, end).replace(/(?:\r\n|\r|\n)$/, '');
