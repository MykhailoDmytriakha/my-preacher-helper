import { isPreparationTextField, preparationTextField, preparationTextPaths, type PreparationTextField } from '@/utils/preparationFieldValues';

import { capturePreparationTextField, type DocumentFieldObservation } from './documentFieldAction';
import { canRebaseRefusedPointTail } from './exegeticalPointCapture';
import { equalValues, readField, writeField } from './fieldValues';
import { hasUnreadablePreparationText } from './unreadableDraftProof';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue } from './types';

export type PreparationTextRetry = { field: PreparationTextField; generation: string; action: DocumentFieldObservation<FieldValue> };

export function changedPreparationTextFields(before: DocumentData, after: DocumentData): PreparationTextField[] {
  return Object.keys(preparationTextPaths).filter(isPreparationTextField).filter(field =>
    !equalValues(readField(before, preparationTextPaths[field]), readField(after, preparationTextPaths[field])));
}

export function capturePreparationTextRetry({ confirmed, draft }: Pick<SessionCheckpoint, 'confirmed' | 'draft'>,
  field: PreparationTextField, time: ActionTime | null): PreparationTextRetry | undefined {
  const action = capturePreparationTextField(confirmed, draft, field, time);
  return action && confirmed.metadata ? { field, generation: confirmed.metadata.generation, action } : undefined;
}

export function preparationRetryMatches(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'draft'>, retry: PreparationTextRetry): boolean {
  return equalValues(capturePreparationTextRetry(checkpoint, retry.field, retry.action.time), retry);
}

/** Move one independently submitted preparation field out of the refused point's comparison. */
export function separateRefusedPreparationText(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const before = source.pending[chain[0]?.id]?.value;
  const saved = projected.confirmed.value;
  const submitted = chain.at(-1)?.value;
  if (!confirmed.metadata || confirmed.metadata.generation !== projected.confirmed.metadata?.generation
    || !confirmed.value || !before || !draft || !saved || !submitted || !projected.draft) return;
  const fields = changedPreparationTextFields(before, draft);
  if (fields.length !== 1) return;
  const [field] = fields, path = preparationTextPaths[field];
  const opening = readField(confirmed.value, path);
  const mine = readField(draft, path);
  if ((opening.exists && typeof opening.value !== 'string') || (mine.exists && typeof mine.value !== 'string')
    || !equalValues(opening, readField(before, path)) || !equalValues(mine, readField(submitted, path))) return;
  const stored = readField(saved, path);
  if (stored.exists && typeof stored.value !== 'string') return;

  const checkpoint = { ...projected, draft: writeField(projected.draft, path, stored) };
  if (!canRebaseRefusedPointTail(writeField(before, path, stored), writeField(draft, path, stored), checkpoint)) return;
  const lastEdit = chain.findLast((request, index) => {
    const previous = index && chain[index - 1].value;
    return previous && request.value && !equalValues(readField(previous, path), readField(request.value, path));
  });
  if (!lastEdit || lastEdit.baseline.metadata?.generation !== confirmed.metadata.generation) return;
  const matchingOpening = lastEdit.baseline.value && lastEdit.baseline.metadata.revision === confirmed.metadata.revision
    && equalValues(readField(lastEdit.baseline.value, path), opening);
  const action = matchingOpening ? lastEdit.sermonPreparationTextActions?.[field] : undefined;
  const continuation: SessionCheckpoint = {
    confirmed, draft: writeField(confirmed.value, path, mine), editGeneration: source.editGeneration,
    dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
  };
  const retry = action && { field, generation: confirmed.metadata.generation, action };
  if (retry && preparationRetryMatches(continuation, retry)) continuation.preparationTextRetry = retry;
  else continuation.unreadableScalarProof = [field];
  return { field, checkpoint, continuation };
}

export function preparationTextDraftPreview(checkpoint: SessionCheckpoint): string | undefined {
  const field = checkpoint.preparationTextRetry?.field ?? checkpoint.unreadableScalarProof?.find(isPreparationTextField);
  if (!field || !checkpoint.draft || checkpoint.confirmed.resource.collection !== 'sermons') return undefined;
  const { value } = readField(checkpoint.draft, preparationTextPaths[field]);
  return typeof value === 'string' ? value.slice(0, 500) : '';
}

export function readPreparationTextComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  if (!hasUnreadablePreparationText(checkpoint) || !confirmed.value || !draft || !remoteCandidate?.value
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation || conflicts.length !== 1) return;
  const { path, mine, theirs } = conflicts[0];
  const field = preparationTextField(path);
  if (!field || (mine.exists && typeof mine.value !== 'string') || (theirs.exists && typeof theirs.value !== 'string')
    || !equalValues(readField(draft, path), mine) || !equalValues(readField(remoteCandidate.value, path), theirs)) return;
  const identity = JSON.stringify([path, mine, theirs, remoteCandidate.metadata, checkpoint.editGeneration]);
  return { field, path, mine, stored: theirs, identity };
}

export function retryForPreparationTextChoice(resolved: SessionCheckpoint, comparison: NonNullable<ReturnType<typeof readPreparationTextComparison>>,
  time: ActionTime | null): PreparationTextRetry | undefined {
  const { value } = resolved.confirmed;
  if (!value || !equalValues(readField(value, comparison.path), comparison.stored)
    || !equalValues(resolved.draft, writeField(value, comparison.path, comparison.mine))) {
    throw Object.assign(new Error('The compared preparation text changed'), { code: 'decision-changed' });
  }
  const retry = capturePreparationTextRetry(resolved, comparison.field, time);
  if (resolved.dirty && !retry) {
    throw Object.assign(new Error('The compared preparation text could not be captured'), { code: 'decision-changed' });
  }
  return retry;
}
