import type { StudyNote } from '@/models/models';

/** The tabs of Studies, in their order on the screen. */
export const STUDY_NOTE_TABS = ['all', 'notes', 'comments', 'questions'] as const;
export type StudyNoteTab = (typeof STUDY_NOTE_TABS)[number];

/**
 * WHICH TAB OF STUDIES A NOTE STANDS IN — one rule for the list and for the note's own page, which keeps the same
 * tabs beside the editor. A note without a kind is a note (written before kinds existed); a comment and a question
 * have their own tabs, and «Все» holds every one. A passage's analysis lives on the Bible for now — it opens in the
 * reader, not in the note editor — so no tab shows it yet (case 2026-10-12-block-diagram, 3.4).
 */
export function inStudyNoteTab(note: Pick<StudyNote, 'type'>, tab: StudyNoteTab): boolean {
  if (!inStudies(note)) return false;
  if (tab === 'notes') return note.type !== 'question' && note.type !== 'comment';
  if (tab === 'comments') return note.type === 'comment';
  if (tab === 'questions') return note.type === 'question';
  return true;
}

/**
 * Whether a note stands in Studies at all — its lists, its counts, its tags and books, the home page's count of study notes
 * (Codex, 30.10: «Все» counted two analyses it did not show). A passage's analysis does not, yet.
 */
export function inStudies(note: Pick<StudyNote, 'type'>): boolean {
  return note.type !== 'analysis';
}
