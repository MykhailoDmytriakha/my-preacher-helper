import { isPreparationConfirmation, preparationConfirmationPaths, type PreparationConfirmation } from '@/utils/preparationFieldValues';

import { capturePreparationConfirmation, type PreparationConfirmationObservations } from './documentFieldAction';
import { equalValues, object, readField, restoreStoredField, writeField } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue, ResourceSnapshot } from './types';

type CheckObservation = NonNullable<PreparationConfirmationObservations[PreparationConfirmation]>;
export type PreparationCheckRetry = { field: PreparationConfirmation; generation: string; action: CheckObservation };
const fields = Object.keys(preparationConfirmationPaths).filter(isPreparationConfirmation);
const isCheckValue = (field: FieldValue) => !field.exists || typeof field.value === 'boolean';
const checked = (field: FieldValue) => field.value === true;

function readCheck(data: DocumentData, path: readonly string[]): FieldValue | undefined {
  for (const length of [1, 2]) {
    const container = readField(data, path.slice(0, length));
    if (container.exists && !object(container.value)) return;
  }
  const check = readField(data, path);
  return isCheckValue(check) ? check : undefined;
}

export function changedPreparationChecks(before: DocumentData, draft: DocumentData) {
  return fields.filter(field => !equalValues(readField(before, preparationConfirmationPaths[field]), readField(draft, preparationConfirmationPaths[field])));
}

function checkDraft(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'draft'>, field: PreparationConfirmation) {
  const { confirmed, draft } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || !confirmed.value || !draft || !confirmed.metadata || confirmed.metadata.deleted) return;
  const path = preparationConfirmationPaths[field];
  const before = readCheck(confirmed.value, path), mine = readCheck(draft, path);
  if (!before || !mine?.exists || equalValues(before, mine)
    || !equalValues(writeField(confirmed.value, path, mine), draft)) return;
  return { path, mine, generation: confirmed.metadata.generation };
}

export function capturePreparationCheckRetry(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'draft'>,
  field: PreparationConfirmation, time: ActionTime | null, reviewed?: true): PreparationCheckRetry | undefined {
  const scoped = checkDraft(checkpoint, field);
  if (!scoped) return;
  const action = capturePreparationConfirmation(checkpoint.confirmed, undefined, checkpoint.draft, { field, time, reviewed }, [])?.[field];
  if (action) return { field, generation: scoped.generation, action };
}

export function validPreparationCheckRetry(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'draft'>, retry: PreparationCheckRetry): boolean {
  return equalValues(capturePreparationCheckRetry(checkpoint, retry.field, retry.action.time, retry.action.reviewed), retry);
}

function provedCheckInChain(save: CommitRequest, chain: readonly CommitRequest[], field: PreparationConfirmation) {
  const action = save.sermonPreparationCheckActions?.[field];
  const preceding = chain[chain.indexOf(save) - 1];
  if (!action || !preceding || save.predecessor !== preceding.id) return;
  const { time, reviewed, predecessorOperationId: _retired, ...values } = action;
  const captured = capturePreparationConfirmation(save.baseline, preceding, save.value, { field, time, reviewed }, chain)?.[field];
  if (!equalValues(captured, action)) return;
  // The causal link was proved above and is being retired. The retry must also match the real opening without it.
  return { ...values, time, ...(reviewed && { reviewed }) };
}

export function recoverablePreparationChecks(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const opening = confirmed.value, metadata = confirmed.metadata;
  const first = source.pending[chain[0]?.id]?.value;
  const last = chain.at(-1)?.value;
  const saved = projected.confirmed.value;
  if (!metadata || !opening || !first || !last || !saved || !draft) return [];
  return fields.flatMap<{ field: PreparationConfirmation; restoreStored: (document: DocumentData) => DocumentData;
    continuation?: SessionCheckpoint }>(field => {
    const path = preparationConfirmationPaths[field];
    const baseline = readCheck(opening, path), mine = readCheck(draft, path), stored = readCheck(saved, path);
    if (!baseline || !mine?.exists || !stored
      || !equalValues(readField(first, path), baseline) || !equalValues(readField(last, path), mine)) return [];
    const save = chain.findLast((request, index) => {
      const previous = index > 0 ? chain[index - 1].value : null;
      return previous && request.value && !equalValues(readField(previous, path), readField(request.value, path));
    });
    if (!save || save.baseline.metadata?.generation !== metadata.generation) return [];
    const restoreStored = (document: DocumentData) => restoreStoredField(document, saved, path);
    const action = save.baseline.value && save.baseline.metadata.revision === metadata.revision
      && equalValues(readCheck(save.baseline.value, path), baseline) ? provedCheckInChain(save, chain, field) : undefined;
    const continuation: SessionCheckpoint = { confirmed, draft: writeField(opening, path, mine), editGeneration: source.editGeneration,
      dirty: true, pending: {}, conflicts: [], remoteCandidate: null };
    const retry = action && { field, generation: metadata.generation, action };
    if (retry && validPreparationCheckRetry(continuation, retry)) {
      continuation.preparationCheckRetry = retry;
    } else {
      if (checked(mine) === checked(stored)) return [{ field, restoreStored, continuation: undefined }];
      // A reversal can equal its old opening. Compare it against the newly read saved value instead.
      if (checked(mine) === checked(baseline)) {
        continuation.confirmed = projected.confirmed;
        continuation.draft = writeField(saved, path, mine);
      }
      continuation.unreadableScalarProof = [field];
    }
    return [{ field, restoreStored, continuation }];
  });
}

export function privatePreparationCheck(checkpoint: SessionCheckpoint, target: ResourceSnapshot) {
  const [field, other] = checkpoint.unreadableScalarProof ?? [];
  if (other !== undefined || !isPreparationConfirmation(field) || !target.value || target.metadata?.deleted
    || checkpoint.unreadableRowProofs?.length || checkpoint.unreadableExegeticalProofs?.length) return;
  const scoped = checkDraft(checkpoint, field);
  if (!scoped || scoped.generation !== target.metadata?.generation) return;
  const stored = readCheck(target.value, scoped.path);
  if (!stored) return;
  return { field, path: scoped.path, mine: scoped.mine, sameValue: checked(scoped.mine) === checked(stored) };
}

export function sermonPreparationCheckDraft(checkpoint: SessionCheckpoint) {
  const field = checkpoint.preparationCheckRetry?.field ?? checkpoint.unreadableScalarProof?.find(isPreparationConfirmation);
  if (!field || !checkpoint.draft || checkpoint.confirmed.resource.collection !== 'sermons') return;
  return { field, checked: checked(readField(checkpoint.draft, preparationConfirmationPaths[field])) };
}
