import { splitMarkdownSections, type MarkdownSection } from './markdownSections';
import { normalizePlanArrows, normalizePlanPointHeadings, sanitizeMarkdown } from './markdownUtils';

/** One indentation step: 1.5rem in HTML, 360 twips in Word, two spaces in TXT. */
export const planHeadingIndent = (level: number): number => Math.max(0, level - 2);
export const planBodyIndent = (level: number): number => Math.max(0, level - 1);

export const preparePlanMarkdown = (content: string): string =>
  normalizePlanArrows(normalizePlanPointHeadings(sanitizeMarkdown(content)));

const plainBody = (content: string): string => content
  .replace(/\*\*(.*?)\*\*/g, '$1')
  .replace(/\*([^*\n]+)\*/g, '$1')
  .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)')
  .replace(/^\s*>\s?/gm, '')
  .replace(/<br\s*\/?>/gi, '\n');

const indentText = (content: string, depth: number): string => content.split('\n')
  .map(line => line.trim() ? `${'  '.repeat(depth)}${line}` : '')
  .join('\n');

/** Headings carry indentation into every following body block, not only the first line. */
export function planMarkdownToPlainText(content: string): string {
  const outline = splitMarkdownSections(preparePlanMarkdown(content));
  const renderSection = (section: MarkdownSection): string => [
    indentText(section.headingText, planHeadingIndent(section.level)),
    indentText(plainBody(section.body), planBodyIndent(section.level)),
    ...section.children.map(renderSection),
  ].filter(Boolean).join('\n\n');
  return [plainBody(outline.intro), ...outline.sections.map(renderSection)].filter(Boolean).join('\n\n');
}
