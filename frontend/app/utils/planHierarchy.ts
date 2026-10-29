import { markdownToPlainTextBlocks } from './markdownPlainText';
import { normalizePlanArrows, normalizePlanArrowText, normalizePlanPointHeadings, sanitizeMarkdown } from './markdownUtils';

/** One indentation step: 1.5rem in HTML, 360 twips in Word, two spaces in TXT. */
export const planHeadingIndent = (level: number): number => Math.max(0, level - 2);
export const planBodyIndent = (level: number): number => Math.max(0, level - 1);

export const preparePlanMarkdown = (content: string): string =>
  normalizePlanArrows(normalizePlanPointHeadings(sanitizeMarkdown(content)));

const indentText = (content: string, depth: number): string => content.split('\n')
  .map(line => line.trim() ? `${'  '.repeat(depth)}${line}` : '')
  .join('\n');

/** Headings carry indentation into every following body block, not only the first line. */
export function planMarkdownToPlainText(content: string): string {
  let headingLevel = 1;
  const blocks = markdownToPlainTextBlocks(normalizePlanPointHeadings(content), normalizePlanArrowText);
  return blocks.map((block, index) => {
    if (block.headingLevel) headingLevel = block.headingLevel;
    const depth = block.headingLevel ? planHeadingIndent(headingLevel) : planBodyIndent(headingLevel);
    const paragraphBreak = block.headingLevel || blocks[index - 1]?.headingLevel || block.blankBefore;
    const separator = index ? (paragraphBreak ? '\n\n' : '\n') : '';
    return separator + indentText(block.text, depth);
  }).join('');
}
