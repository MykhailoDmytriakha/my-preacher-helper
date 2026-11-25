import { isPreparationTextField, preparationTextField, preparationTextPaths, type PreparationTextField } from '@/utils/preparationFieldValues';

import { capturePreparationTextField, type DocumentFieldObservation } from './documentFieldAction';
import { equalValues, object, readField, writeField } from './fieldValues';
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

function restoreStoredPreparationField(document: DocumentData, saved: DocumentData, path: readonly string[]): DocumentData {
  const stored = readField(saved, path);
  let result = writeField(document, path, stored);
  if (stored.exists || !readField(document, path).exists) return result;
  // Only remove a container made empty by clearing this field when there is no saved container.
  for (let length = path.length - 1; length > 0; length -= 1) {
    const parent = path.slice(0, length);
    const { value } = readField(result, parent);
    if (!object(value) || Object.keys(value).length || readField(saved, parent).exists) break;
    result = writeField(result, parent, { exists: false });
  }
  return result;
}

export function recoverablePreparationTextAfterRefusal(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const openingValue = confirmed.value;
  const metadata = confirmed.metadata;
  const before = source.pending[chain[0]?.id]?.value;
  const saved = projected.confirmed.value;
  const submitted = chain.at(-1)?.value;
  if (!metadata || metadata.generation !== projected.confirmed.metadata?.generation
    || !openingValue || !before || !draft || !saved || !submitted) return [];

  return changedPreparationTextFields(before, draft).flatMap(field => {
    const path = preparationTextPaths[field];
    const opening = readField(openingValue, path);
    const mine = readField(draft, path);
    const stored = readField(saved, path);
    if ((opening.exists && typeof opening.value !== 'string') || (mine.exists && typeof mine.value !== 'string')
      || (stored.exists && typeof stored.value !== 'string')
      || !equalValues(opening, readField(before, path)) || !equalValues(mine, readField(submitted, path))) return [];

    const lastEdit = chain.findLast((request, index) => {
      const previous = index && chain[index - 1].value;
      return previous && request.value && !equalValues(readField(previous, path), readField(request.value, path));
    });
    if (!lastEdit || lastEdit.baseline.metadata?.generation !== metadata.generation) return [];
    const matchingOpening = lastEdit.baseline.value && lastEdit.baseline.metadata.revision === metadata.revision
      && equalValues(readField(lastEdit.baseline.value, path), opening);
    const action = matchingOpening ? lastEdit.sermonPreparationTextActions?.[field] : undefined;
    const continuation: SessionCheckpoint = {
      confirmed, draft: writeField(openingValue, path, mine), editGeneration: source.editGeneration,
      dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
    };
    const retry = action && { field, generation: metadata.generation, action };
    if (retry && preparationRetryMatches(continuation, retry)) continuation.preparationTextRetry = retry;
    else continuation.unreadableScalarProof = [field];
    return [{ field, continuation, restoreStored: (document: DocumentData) => restoreStoredPreparationField(document, saved, path) }];
  });
}

export function preparationTextDraft(checkpoint: SessionCheckpoint) {
  const field = checkpoint.preparationTextRetry?.field ?? checkpoint.unreadableScalarProof?.find(isPreparationTextField);
  if (!field || !checkpoint.draft || checkpoint.confirmed.resource.collection !== 'sermons') return undefined;
  const { value } = readField(checkpoint.draft, preparationTextPaths[field]);
  return { field, preview: typeof value === 'string' ? value.slice(0, 500) : '' };
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
