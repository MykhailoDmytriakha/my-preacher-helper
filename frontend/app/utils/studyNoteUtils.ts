import { formatScriptureReference, formatScriptureReferences, scriptureReferenceSearchText } from '@/utils/scriptureReference';

import { BibleLocale } from '../(pages)/(private)/studies/bibleData';

import type { StudyNote } from '@/models/models';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * THE NAME A NOTE GOES BY among other things — a dashboard card, a day on the calendar, the
 * preview of its link: its own title, else its first passage in the reader's language, else
 * nothing, and the caller says "untitled" in its own words. Three screens each spelled this
 * rule out for themselves; a fourth (the link preview) is where they would have drifted.
 */
export function studyNoteOwnName(
  note: { title?: string; scriptureRefs?: readonly ScriptureRefShape[] | null },
  locale: BibleLocale
): string | undefined {
  const title = note.title?.trim();
  if (title) return title;
  return formatScriptureReferences(note.scriptureRefs, { locale, style: 'long', limit: 1 });
}

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
    .map((ref) => scriptureReferenceSearchText(ref, bibleLocale))
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
      const formattedRef = formatScriptureReference(ref, { locale: bibleLocale });
      markdown += `- ${formattedRef}\n`;
    });
    markdown += '\n';
  }

  return markdown.trim();
}
