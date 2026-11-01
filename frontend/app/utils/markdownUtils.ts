import { markdownCodeLines } from '@/utils/markdownCode';
import { mapMarkdownProseSource } from '@/utils/markdownSource';

/**
 * Utility functions for markdown content sanitization and processing
 */

/**
 * Sanitizes markdown content to prevent parsing errors in react-markdown
 * @param content - The markdown content to sanitize
 * @returns Sanitized markdown content
 */
export const sanitizeMarkdown = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const sanitized = mapMarkdownProseSource(content, source => source
    .replace(/\*\*\*\*\*/g, '**')
    .replace(/\*\*\*\*/g, '**')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, ''));

  // Trimming a code edge would erase indentation or literal trailing spaces.
  const lines = sanitized.split('\n');
  const first = lines.findIndex(line => line.trim() !== '');
  if (first < 0) return '';
  const last = lines.length - 1 - [...lines].reverse().findIndex(line => line.trim() !== '');
  const codeLines = markdownCodeLines(sanitized);
  const trimmedStart = codeLines.has(first) ? sanitized : sanitized.trimStart();
  return codeLines.has(last) ? trimmedStart : trimmedStart.trimEnd();
};

/**
 * Normalizes heading hierarchy in AI-generated plan-point markdown.
 * Why: AI sometimes mixes real `### Heading` blocks with plain "Label:" paragraphs
 * that introduce a list. That mix produces a jagged visual hierarchy and slows the
 * preacher's eye during live delivery. This promotes pseudo-heading "Label:" lines
 * to real `### ` headings and strips trailing colons from existing `### ` headings
 * so every grouping is rendered with the same H3 style.
 */
const TRAILING_COLON = /[:：]\s*$/;
const LIST_ITEM_PREFIX = /^\s*([-*+]|\d+[.)])\s/;

const isListOrIndentedLine = (line: string, trimmed: string): boolean =>
  /^\s/.test(line) || /^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed);

const isPseudoHeadingCandidate = (trimmed: string): boolean =>
  trimmed.length > 0 && trimmed.length <= 120 && TRAILING_COLON.test(trimmed);

const nextNonBlankLine = (lines: string[], fromIndex: number): string => {
  for (let j = fromIndex; j < lines.length; j++) {
    if (lines[j].trim() !== '') return lines[j];
  }
  return '';
};

const promoteOrKeep = (line: string, trimmed: string, lines: string[], i: number): string => {
  if (isListOrIndentedLine(line, trimmed)) return line;
  if (!isPseudoHeadingCandidate(trimmed)) return line;
  if (!LIST_ITEM_PREFIX.test(nextNonBlankLine(lines, i + 1))) return line;
  return `### ${trimmed.replace(TRAILING_COLON, '')}`;
};

export const normalizePlanPointHeadings = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const lines = content.split('\n');
  const out: string[] = [];
  const codeLines = markdownCodeLines(content);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (codeLines.has(i)) {
      out.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (headingMatch) {
      out.push(`${headingMatch[1]} ${headingMatch[2].replace(TRAILING_COLON, '')}`);
      continue;
    }

    out.push(promoteOrKeep(line, trimmed, lines, i));
  }

  return out.join('\n');
};

/**
 * Validates if content is safe to pass to react-markdown
 * @param content - The content to validate
 * @returns True if content is safe, false otherwise
 */
export const isValidMarkdownContent = (content: string): boolean => {
  if (!content || typeof content !== 'string') {
    return false;
  }
  
  // Check for common problematic patterns
  const problematicPatterns = [
    /\*\*\*\*\*/, // Multiple asterisks
    /\*\*\*\*/, // Four asterisks
    /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/, // Control characters excluding \t, \n, \r
  ];
  
  return !problematicPatterns.some(pattern => pattern.test(content));
};

/**
 * Decodes the handful of HTML entities that the markdown renderer (ReactMarkdown)
 * decodes automatically, so non-markdown consumers (the Word export) match the UI.
 * Without this, a model-emitted "&gt;" shows as "->" in the plan UI but as a literal
 * "&gt;" in Word (docx re-escapes the "&" to "&amp;gt;"). `&amp;` is decoded LAST so a
 * genuine "&amp;gt;" collapses to "&gt;" rather than all the way to ">".
 */
export const decodeBasicHtmlEntities = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }
  return content
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#0*62;/g, '>')
    .replace(/&#0*60;/g, '<')
    .replace(/&amp;/g, '&');
};

/** Normalize prose arrows after parsing has already decoded entities. Never apply to code or URLs. */
export const normalizePlanArrowText = (content: string): string =>
  content.replace(/\s*(?:-{1,2}>|—>|=>)\s*/g, ' → ');

export const normalizePlanArrows = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }
  // Keep source entities encoded for the next parser; decoding here can activate HTML
  // or decode a literal &amp;gt; twice. Whitespace normalization cannot eat a new line.
  return mapMarkdownProseSource(content, source => source.replace(
    /[ \t]*(?:-{1,2}|—|=)(?:>|&gt;|&#0*62;|&#x0*3e;)[ \t]*/gi,
    ' → ',
  ));
};

// Keep the public preview entry point while the shared safe reader owns projection.
export { markdownPreviewText } from './markdownPlainText';
