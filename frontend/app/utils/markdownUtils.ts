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

  // Remove any null or undefined characters
  let sanitized = content.replace(/\0/g, '');
  
  // Fix common markdown formatting issues
  // Remove any malformed asterisk patterns that might cause parsing issues
  sanitized = sanitized.replace(/\*\*\*\*\*/g, '**'); // Fix multiple asterisks
  sanitized = sanitized.replace(/\*\*\*\*/g, '**'); // Fix triple asterisks
  
  // Ensure proper spacing around markdown elements
  sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '**$1**'); // Fix bold formatting
  sanitized = sanitized.replace(/\*([^*]+)\*/g, '*$1*'); // Fix italic formatting
  
  // Remove control characters except line breaks and tabs
  // Keep \n (0x0A), \r (0x0D) and \t (0x09) so Markdown structure remains intact
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized.trim();
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
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    if (inCodeBlock) {
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
