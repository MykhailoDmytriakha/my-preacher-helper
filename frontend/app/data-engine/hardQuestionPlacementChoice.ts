import { equalValues, object, readField, writeField } from './fieldValues';
import { HARD_QUESTION_PLACEMENT_FIELDS, projectHardQuestionPlace, readHardQuestionPlace, readHardQuestionPlacementConflict } from './hardQuestionPlacement';
import { mergeDocumentFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

export function readHardQuestionPlacementReview(checkpoint: SessionCheckpoint) {
  const { confirmed, remoteCandidate: remote } = checkpoint;
  if (confirmed.resource.collection !== 'hardQuestions' || !remote?.value || remote.metadata?.deleted
    || confirmed.metadata?.generation !== remote.metadata?.generation) return;
  const compared = readHardQuestionPlacementConflict(checkpoint.conflicts);
  const saved = readHardQuestionPlace(remote.value);
  if (!compared || !saved) return;
  return { ...compared, saved, identity: JSON.stringify([remote, compared, Object.keys(checkpoint.pending), checkpoint.editGeneration]) };
}

function withoutPlace(document: DocumentData, opening: DocumentData, keepBases: boolean) {
  return [...HARD_QUESTION_PLACEMENT_FIELDS, 'updatedAt', ...(!keepBases ? ['basisIds'] : [])]
    .reduce((value, field) => writeField(value, [field], readField(opening, [field])), document);
}

export function resolveHardQuestionPlacementReview(checkpoint: SessionCheckpoint, identity: string, choice: 'local' | 'remote'): DocumentData {
  const review = readHardQuestionPlacementReview(checkpoint);
  const opening = checkpoint.confirmed.value, draft = checkpoint.draft, remote = checkpoint.remoteCandidate?.value;
  const changed = () => Object.assign(new Error('The compared place changed'), { code: 'decision-changed' });
  if (!review || review.identity !== identity || !opening || !draft || !remote || (choice === 'local' && review.unavailable)) throw changed();
  const draftPlace = readHardQuestionPlace(draft);
  // A second pending move can only be decided when its own destination is shown.
  if (Object.keys(checkpoint.pending).length > 1 && draftPlace && !equalValues(draftPlace, review.mine) && !equalValues(draftPlace, review.saved)) throw changed();
  const target = choice === 'local' ? review.mine : review.saved;
  const keepBases = draftPlace?.themeId === target.themeId && review.saved.themeId === target.themeId
    && readHardQuestionPlace(opening)?.themeId === target.themeId;
  const carried = mergeDocumentFields(opening, withoutPlace(draft, opening, keepBases), remote);
  if (carried.conflicts.length || !object(carried.value.value)) {
    throw Object.assign(new Error('Resolve the other question fields separately'), { code: 'other-changes-first' });
  }
  return projectHardQuestionPlace(carried.value.value, target);
}
