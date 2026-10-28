import type { StudyNote } from '@/models/models';

/** The tabs of Studies, in their order on the screen. */
export const STUDY_NOTE_TABS = ['all', 'notes', 'comments', 'questions'] as const;
export type StudyNoteTab = (typeof STUDY_NOTE_TABS)[number];

/**
 * WHICH TAB OF STUDIES A NOTE STANDS IN — one rule for the list and for the note's own page, which keeps the same
 * tabs beside the editor. A note without a kind is a note (written before kinds existed); a comment and a question
 * have their own tabs, and «Все» holds every one.
 */
export function inStudyNoteTab(note: Pick<StudyNote, 'type'>, tab: StudyNoteTab): boolean {
  if (tab === 'notes') return note.type !== 'question' && note.type !== 'comment';
  if (tab === 'comments') return note.type === 'comment';
  if (tab === 'questions') return note.type === 'question';
  return true;
}
