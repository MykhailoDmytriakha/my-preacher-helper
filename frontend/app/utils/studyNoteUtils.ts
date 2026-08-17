import { BibleLocale } from '../(pages)/(private)/studies/bibleData';
import { formatScriptureRef } from '../(pages)/(private)/studies/bookAbbreviations';

import type { StudyNote } from '@/models/models';

/**
 * Does this note match a typed search?
 *
 * Searching by the words a preacher actually remembers: the title, the tags, the text, and
 * the reference AS IT IS SHOWN (localized book names), so typing "Ин 2" finds the note whose
 * badge reads `Ин.2:1-11`. Every token must match somewhere — the same "narrow as you type"
 * behaviour the studies list already has, kept here so the note picker cannot drift from it.
 */
export function matchesStudyNoteQuery(
  note: StudyNote,
  tokens: string[],
  bibleLocale: BibleLocale
): boolean {
  if (tokens.length === 0) return true;
  const refs = (note.scriptureRefs ?? [])
    .map((ref) => formatScriptureRef(ref, bibleLocale))
    .join(' ');
  const haystack = `${note.title ?? ''} ${note.content ?? ''} ${(note.tags ?? []).join(' ')} ${refs}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Formats a StudyNote into a Markdown string for copying to clipboard
 * Includes title, content, and localized scripture references
 */
export function formatStudyNoteForCopy(
  note: StudyNote,
  bibleLocale: BibleLocale
): string {
  let markdown = '';

  // Add title if exists
  if (note.title && note.title.trim()) {
    markdown += `# ${note.title.trim()}\n\n`;
  }

  // Add content if exists
  if (note.content && note.content.trim()) {
    markdown += `${note.content.trim()}\n\n`;
  }

  // Add scripture references if exist
  if (note.scriptureRefs && note.scriptureRefs.length > 0) {
    markdown += '**Scripture References:**\n';
    note.scriptureRefs.forEach((ref) => {
      const formattedRef = formatScriptureRef(ref, bibleLocale);
      markdown += `- ${formattedRef}\n`;
    });
    markdown += '\n';
  }

  return markdown.trim();
}
