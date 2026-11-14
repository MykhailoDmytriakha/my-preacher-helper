import { isOrdinaryStudyNote, isOrdinaryStudyNoteType } from '@/utils/studyNoteType';

import { readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

const path = ['type'];
export const isStudyNoteTypeConflict = (conflict: ConflictDetail) => conflict.path.length === 1 && conflict.path[0] === 'type';

function comparedType(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (basis.resource.collection !== 'studyNotes' || !basis.value || !draft || !stored?.value || !basis.metadata
    || basis.metadata.generation !== stored.metadata?.generation || conflicts.length !== 1 || !isStudyNoteTypeConflict(conflicts[0])) return;
  const mine = draft.type ?? 'note', saved = stored.value.type ?? 'note';
  if (!isOrdinaryStudyNoteType(mine) || !isOrdinaryStudyNoteType(saved) || mine === saved) return;
  const shown = conflicts[0];
  if ((shown.mine.exists ? shown.mine.value : 'note') !== mine || (shown.theirs.exists ? shown.theirs.value : 'note') !== saved) return;
  return { mine, stored: saved };
}

function comparedTitle(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (basis.resource.collection !== 'studyNotes' || !basis.metadata || !draft || !stored?.value
    || basis.metadata.generation !== stored.metadata?.generation
    || !isOrdinaryStudyNote(basis.value) || !isOrdinaryStudyNote(draft) || !isOrdinaryStudyNote(stored.value)
    || conflicts.length !== 1 || conflicts[0].path.length !== 1 || conflicts[0].path[0] !== 'title') return;
  const mine = draft.title ?? '', saved = stored.value.title ?? '';
  if (typeof mine !== 'string' || typeof saved !== 'string' || mine === saved) return;
  const shown = conflicts[0];
  if ((shown.mine.exists ? shown.mine.value : '') !== mine || (shown.theirs.exists ? shown.theirs.value : '') !== saved) return;
  return { mine, stored: saved };
}

type NoteComparisonField = 'title' | 'type' | 'content';

function comparedStudyNoteFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (basis.resource.collection !== 'studyNotes' || !basis.metadata || !draft || !stored?.value
    || basis.metadata.generation !== stored.metadata?.generation || !isOrdinaryStudyNote(basis.value)
    || !isOrdinaryStudyNote(draft) || !isOrdinaryStudyNote(stored.value) || !conflicts.length) return;
  const compared: { field: NoteComparisonField; mine: string; stored: string }[] = [];
  for (const conflict of conflicts) {
    const [field] = conflict.path;
    if (conflict.path.length !== 1) return;
    const values = field === 'title' ? comparedTitle(basis, draft, stored, [conflict])
      : field === 'type' ? comparedType(basis, draft, stored, [conflict])
        : field === 'content' && typeof draft.content === 'string' && typeof stored.value.content === 'string'
          && conflict.mine.value === draft.content && conflict.theirs.value === stored.value.content
          && draft.content !== stored.value.content ? { mine: draft.content, stored: stored.value.content } : undefined;
    if (!values || (field !== 'title' && field !== 'type' && field !== 'content')) return;
    compared.push({ field, ...values });
  }
  return compared;
}

export function readStudyNoteFieldsComparison(checkpoint: SessionCheckpoint) {
  return comparedStudyNoteFields(checkpoint.confirmed, checkpoint.draft, checkpoint.remoteCandidate, checkpoint.conflicts);
}

export function keepUncontestedStudyNoteFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  const compared = comparedStudyNoteFields(basis, draft, stored, conflicts);
  if (!compared || !basis.value || !draft || !stored?.value) return;
  const opening = basis.value;
  const paths: string[][] = compared.map(({ field }) => [field]);
  // The source is still recoverable; only the chosen body can confirm that it used this transcript.
  if (compared.some(({ field }) => field === 'content')) paths.push(['dictationSourceIds']);
  const retained = paths.reduce((value, field) => writeField(value, field, readField(opening, field)), draft);
  const merged = mergeDocumentFields(opening, retained, stored.value);
  if (merged.conflicts.length || !merged.value.exists) throw Object.assign(new Error('The shown study note choice changed'), { code: 'decision-changed' });
  return merged.value.value as DocumentData;
}
