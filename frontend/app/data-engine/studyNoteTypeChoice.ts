import { isOrdinaryStudyNoteType } from '@/utils/studyNoteType';

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

export function readStudyNoteTypeComparison(checkpoint: SessionCheckpoint) {
  const comparison = comparedType(checkpoint.confirmed, checkpoint.draft, checkpoint.remoteCandidate, checkpoint.conflicts);
  return comparison && { ...comparison, identity: JSON.stringify([checkpoint.editGeneration,
    checkpoint.remoteCandidate?.metadata?.generation, checkpoint.remoteCandidate?.metadata?.revision, comparison]) };
}

export function keepUncontestedStudyNoteFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (!comparedType(basis, draft, stored, conflicts) || !basis.value || !draft || !stored?.value) return;
  const retained = writeField(draft, path, readField(basis.value, path));
  const merged = mergeDocumentFields(basis.value, retained, stored.value);
  if (merged.conflicts.length || !merged.value.exists) throw Object.assign(new Error('The shown note type choice changed'), { code: 'decision-changed' });
  return merged.value.value as DocumentData;
}
