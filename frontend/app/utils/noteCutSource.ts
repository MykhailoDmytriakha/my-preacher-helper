import { uniqueHeadingLookup } from '@/utils/headingLookup';
import { markdownHeadingRanges } from '@/utils/markdownHeadings';

export const MAX_CUT_CHARS = 60_000;

export const normalizeHeading = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/** Current reader labels and their authored spellings; invented or ambiguous keys do not resolve. */
export function collectNoteHeadings(content: string): Map<string, string> {
  const headings = markdownHeadingRanges(content).filter(heading => heading.text);
  const byId = new Map(headings.map(heading => [String(heading.start), heading.text]));
  const lookup = uniqueHeadingLookup(headings.map(heading => ({
    id: String(heading.start),
    labels: [heading.text, heading.authored,
      ...(heading.historical ? [heading.historical.text, heading.historical.authored,
        ...(heading.historical.source.trim().match(/^#{1,6}\s+(.+)$/)?.slice(1) ?? [])] : []),
      // Exact former ATX authored spelling is lookup-only; this never detects a boundary.
      ...(heading.source.trim().match(/^#{1,6}\s+(.+)$/)?.slice(1) ?? [])],
  })), normalizeHeading);
  return new Map([...lookup].map(([key, id]) => [key, byId.get(id)!]));
}

/** A passage the model names counts only if the note itself writes it. */
export function groundKeyPassage(keyPassage: string, content: string): string {
  const passage = keyPassage.replace(/\s+/g, ' ').trim();
  if (!passage) return '';
  const haystack = content.replace(/\s+/g, ' ');
  return haystack.includes(passage) ? passage : '';
}
