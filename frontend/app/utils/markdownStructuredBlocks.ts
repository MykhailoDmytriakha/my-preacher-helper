import { codeFenceFor } from './markdownFence';
import { markdownProseSourceRanges } from './markdownSource';

export const STRUCTURED_BLOCK_TYPES = ['illustration', 'application', 'question', 'quote', 'definition'] as const;

interface Replacement {
  start: number;
  end: number;
  preparedStart: number;
  preparedEnd: number;
}

/** Prepare legacy prose callouts once, with positions still grounded in the authored source. */
export function prepareStructuredBlocks(content: string): {
  markdown: string;
  originalOffset: (offset: number) => number | null;
} {
  const names = STRUCTURED_BLOCK_TYPES.map(type => type[0].toUpperCase() + type.slice(1)).join('|');
  const pattern = new RegExp(`\\[(${names}):\\s*([\\s\\S]*?)\\]`, 'g');
  const matches = [...content.matchAll(pattern)];
  const ranges = matches.length ? markdownProseSourceRanges(content) : [];
  const replacements: Replacement[] = [];
  const parts: string[] = [];
  let cursor = 0;
  let preparedLength = 0;
  for (const match of matches) {
    const start = match.index;
    if (!ranges.some(range => start >= range.start && start < range.end)) continue;
    let escapes = 0;
    for (let index = start - 1; index >= 0 && content[index] === '\\'; index--) escapes++;
    if (escapes % 2) continue;
    const prefix = content.slice(cursor, start);
    const words = match[2].trim();
    const fence = codeFenceFor(words);
    const replacement = `\n${fence}${match[1].toLowerCase()}\n${words}\n${fence}\n`;
    preparedLength += prefix.length;
    replacements.push({ start, end: start + match[0].length, preparedStart: preparedLength, preparedEnd: preparedLength + replacement.length });
    parts.push(prefix, replacement);
    preparedLength += replacement.length;
    cursor = start + match[0].length;
  }
  parts.push(content.slice(cursor));
  const markdown = parts.join('');
  return {
    markdown,
    originalOffset: offset => {
      if (offset < 0 || offset > markdown.length) return null;
      let delta = 0;
      for (const replacement of replacements) {
        if (offset < replacement.preparedStart) break;
        if (offset === replacement.preparedStart) return replacement.start;
        if (offset < replacement.preparedEnd) return null;
        delta = replacement.end - replacement.preparedEnd;
      }
      return offset + delta;
    },
  };
}
