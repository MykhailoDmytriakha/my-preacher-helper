import { BibleLocale } from '../(pages)/(private)/studies/bibleData';
import { formatScriptureRef } from '../(pages)/(private)/studies/bookAbbreviations';

import { getStudyText } from './nodeTreeAdapter';

import type { StudyNote } from '@/models/models';

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
  const noteText = getStudyText(note);
  if (noteText.trim()) {
    markdown += `${noteText.trim()}\n\n`;
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
