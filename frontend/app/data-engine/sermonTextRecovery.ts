import { isPreparationTextField } from '@/utils/preparationFieldValues';
import { isSermonTextRecoveryField, SERMON_TEXT_RECOVERY_FIELDS, sermonTextRecoveryField, sermonTextRecoveryPath, type SermonTextRecoveryField } from '@/utils/sermonTextRecoveryFields';

import { acceptsSermonRecoveryText, captureSermonRecoveryText, type DocumentFieldObservation } from './documentFieldAction';
import { equalValues, readField, restoreStoredField, writeField } from './fieldValues';
import { hasUnreadableSermonText } from './unreadableDraftProof';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue } from './types';

type SermonTextObservation = DocumentFieldObservation<FieldValue> & { reviewed?: true };
export type SermonTextRetry = { field: SermonTextRecoveryField; generation: string; action: SermonTextObservation };

function observedWord(value: string | FieldValue): FieldValue {
  return typeof value === 'string' ? { exists: true, value } : value;
}

function fieldValues(action: DocumentFieldObservation<string | FieldValue> & { reviewed?: true }): SermonTextObservation {
  return { ...action, before: observedWord(action.before), after: observedWord(action.after) };
}

export function observedSermonText(request: CommitRequest, field: SermonTextRecoveryField): SermonTextObservation | undefined {
  if (isPreparationTextField(field)) return request.sermonPreparationTextActions?.[field];
  const observation = field === 'title' ? request.sermonTitleAction : request.sermonVerseAction;
  return observation && fieldValues(observation);
}

export function capturedSermonTextRetry(retry: SermonTextRetry, other?: CommitRequest['sermonPreparationTextActions']):
  Pick<CommitRequest, 'sermonTitleAction' | 'sermonVerseAction' | 'sermonPreparationTextActions'> {
  const { field, action } = retry;
  if (isPreparationTextField(field)) return { sermonPreparationTextActions: { ...other, [field]: action } };
  const { before, after, ...stamp } = action;
  if (typeof before.value !== 'string' || typeof after.value !== 'string') {
    throw Object.assign(new Error('The recovered sermon text changed'), { code: 'decision-changed' });
  }
  const observation = { ...stamp, before: before.value, after: after.value };
  return field === 'title' ? { sermonTitleAction: observation } : { sermonVerseAction: observation };
}

export function changedSermonTextFields(before: DocumentData, after: DocumentData): SermonTextRecoveryField[] {
  return SERMON_TEXT_RECOVERY_FIELDS.filter(field =>
    !equalValues(readField(before, sermonTextRecoveryPath(field)), readField(after, sermonTextRecoveryPath(field))));
}

export function captureSermonTextRetry({ confirmed, draft }: Pick<SessionCheckpoint, 'confirmed' | 'draft'>,
  field: SermonTextRecoveryField, time: ActionTime | null): SermonTextRetry | undefined {
  const action = captureSermonRecoveryText(confirmed, draft, field, time);
  return action && confirmed.metadata ? { field, generation: confirmed.metadata.generation, action: fieldValues(action) } : undefined;
}

export function sermonTextRetryMatches(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'draft'>, retry: SermonTextRetry): boolean {
  const { reviewed, ...action } = retry.action;
  return (!reviewed || retry.field === 'verse')
    && equalValues(captureSermonTextRetry(checkpoint, retry.field, action.time), { ...retry, action });
}

export function recoverableSermonTextAfterRefusal(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const openingValue = confirmed.value;
  const metadata = confirmed.metadata;
  const before = source.pending[chain[0]?.id]?.value;
  const saved = projected.confirmed.value;
  const submitted = chain.at(-1)?.value;
  if (!metadata || metadata.generation !== projected.confirmed.metadata?.generation
    || !openingValue || !before || !draft || !saved || !submitted) return [];

  return changedSermonTextFields(before, draft).flatMap(field => {
    const path = sermonTextRecoveryPath(field);
    const opening = readField(openingValue, path);
    const mine = readField(draft, path);
    const stored = readField(saved, path);
    if (![opening, mine, stored].every(value => acceptsSermonRecoveryText(value, field))
      || (!isPreparationTextField(field) && (typeof mine.value !== 'string' || !mine.value.trim()))
      || !equalValues(opening, readField(before, path)) || !equalValues(mine, readField(submitted, path))) return [];

    const lastEdit = chain.findLast((request, index) => {
      const previous = index && chain[index - 1].value;
      return previous && request.value && !equalValues(readField(previous, path), readField(request.value, path));
    });
    if (!lastEdit || lastEdit.baseline.metadata?.generation !== metadata.generation) return [];
    const matchingOpening = lastEdit.baseline.value && lastEdit.baseline.metadata.revision === metadata.revision
      && equalValues(readField(lastEdit.baseline.value, path), opening);
    const action = matchingOpening ? observedSermonText(lastEdit, field) : undefined;
    const continuation: SessionCheckpoint = {
      confirmed, draft: writeField(openingValue, path, mine), editGeneration: source.editGeneration,
      dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
    };
    const retry = action && { field, generation: metadata.generation, action };
    if (retry && sermonTextRetryMatches(continuation, retry)) continuation.sermonTextRetry = retry;
    else continuation.unreadableScalarProof = [field];
    return [{ field, continuation, restoreStored: (document: DocumentData) => restoreStoredField(document, saved, path) }];
  });
}

export function sermonTextDraft(checkpoint: SessionCheckpoint) {
  const field = checkpoint.sermonTextRetry?.field ?? checkpoint.unreadableScalarProof?.find(isSermonTextRecoveryField);
  if (!field || !checkpoint.draft || checkpoint.confirmed.resource.collection !== 'sermons') return undefined;
  const { value } = readField(checkpoint.draft, sermonTextRecoveryPath(field));
  return { field, preview: typeof value === 'string' ? value.slice(0, 500) : '' };
}

export function readSermonTextDraftComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  if (!hasUnreadableSermonText(checkpoint) || !confirmed.value || !draft || !remoteCandidate?.value
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation || conflicts.length !== 1) return;
  const { path, mine, theirs } = conflicts[0];
  const field = sermonTextRecoveryField(path);
  if (!field || !acceptsSermonRecoveryText(mine, field) || !acceptsSermonRecoveryText(theirs, field)
    || !equalValues(readField(draft, path), mine) || !equalValues(readField(remoteCandidate.value, path), theirs)) return;
  const identity = JSON.stringify([path, mine, theirs, remoteCandidate.metadata, checkpoint.editGeneration]);
  return { field, path, mine, stored: theirs, identity };
}

export function retryForSermonTextChoice(resolved: SessionCheckpoint, comparison: NonNullable<ReturnType<typeof readSermonTextDraftComparison>>,
  time: ActionTime | null): SermonTextRetry | undefined {
  const { value } = resolved.confirmed;
  if (!value || !equalValues(readField(value, comparison.path), comparison.stored)
    || !equalValues(resolved.draft, writeField(value, comparison.path, comparison.mine))) {
    throw Object.assign(new Error('The compared sermon text changed'), { code: 'decision-changed' });
  }
  const retry = captureSermonTextRetry(resolved, comparison.field, time);
  if (resolved.dirty && !retry) {
    throw Object.assign(new Error('The compared sermon text could not be captured'), { code: 'decision-changed' });
  }
  if (retry && retry.field === 'verse') retry.action.reviewed = true;
  return retry;
}
