import type { StudyNoteType } from '@/models/models';

type DraftShape = { type?: StudyNoteType | string; tags?: readonly unknown[] | null; scriptureRefs?: readonly unknown[] | null };

/**
 * WHETHER A STUDY NOTE IS STILL A DRAFT — the one rule the server stores (`data-engine/serverRelations.ts`) and the
 * device shows before the server answers (`hooks/useStudyNotesEngine.ts`). A note is a draft until it has a tag and
 * a reference; the dashboard asks to review it. A comment is complete as written — it carries no tags — so it is
 * never a draft (case 2026-10-12-block-diagram, 3.2); neither is a passage's analysis, which is its own work (3.4).
 */
export function isStudyNoteDraft(note: DraftShape): boolean {
  if (note.type === 'comment' || note.type === 'analysis') return false;
  return !Array.isArray(note.tags) || note.tags.length === 0 || !Array.isArray(note.scriptureRefs) || note.scriptureRefs.length === 0;
}
