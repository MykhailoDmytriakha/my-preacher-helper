import type { StudyNote } from '@/models/models';

/** The tabs of Studies, in their order on the screen. */
export const STUDY_NOTE_TABS = ['all', 'notes', 'comments', 'questions', 'analyses'] as const;
export type StudyNoteTab = (typeof STUDY_NOTE_TABS)[number];

/**
 * WHICH TAB OF STUDIES A NOTE STANDS IN — one rule for the list and for the note's own page, which keeps the same
 * tabs beside the editor. A note without a kind is a note (written before kinds existed); a comment, a question and a
 * passage's analysis have their own tabs, and «Все» holds every one, so every count says what its tab shows. An
 * analysis opens in Studies in its own screen, the one the Bible opens (the owner, 02.11: «Изучение, вкладка
 * „Разборы“… открывается буквально этот текст»).
 */
export function inStudyNoteTab(note: Pick<StudyNote, 'type'>, tab: StudyNoteTab): boolean {
  if (tab === 'notes') return note.type !== 'question' && note.type !== 'comment' && note.type !== 'analysis';
  if (tab === 'comments') return note.type === 'comment';
  if (tab === 'questions') return note.type === 'question';
  if (tab === 'analyses') return note.type === 'analysis';
  return true;
}
