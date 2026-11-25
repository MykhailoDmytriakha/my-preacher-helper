import { isOrdinaryStudyNote } from '@/utils/studyNoteType';

import { editorSlot, isDocumentEditorSlot, isRetirableOrdinaryEditor } from './editorIdentity';
import { mergeUnsentObservation } from './editorObservation';
import { equalValues } from './fieldValues';
import { readServiceOrderInputValue, type ServiceOrderInput } from './serviceOrderInput';
import { SERVICE_ORDER_INPUT_SLOT } from './serviceOrderInputReserve';
import { hasUnreadableDraftProof } from './session';

import type { CommitRequest } from './commits';
import type { EditorRecord, RecoveryCheckpoint } from './controller';
import type { ResourceRef, ResourceSnapshot } from './types';

const resourceKey = (resource: ResourceRef) => JSON.stringify([resource.collection, resource.id]);

export class PendingStartupAutosave extends Error {
  constructor(readonly receipts: readonly string[]) { super('Wait for the earlier delivery before resuming this draft'); }
}

function wasAutosaved(record: EditorRecord): boolean {
  if (record.autoSaveOnResume !== undefined) return record.autoSaveOnResume;
  // Older drafts have no policy on disk. Only slots that belonged exclusively
  // to autosaving screens establish that the person already expected this save.
  if (!isRetirableOrdinaryEditor(record.editorId)) return false;
  const slot = editorSlot(record.editorId);
  const { collection } = record.checkpoint.confirmed.resource;
  return (collection === 'groups' && slot === 'group') || (collection === 'councils' && slot === 'council')
    || (collection === 'sermons' && (slot === 'thoughts' || slot === 'scratch'));
}

function reservedNoteCreation(record: EditorRecord): boolean {
  const { confirmed, draft } = record.checkpoint;
  return record.autoSaveOnResume === true && editorSlot(record.editorId) === 'study-note'
    && confirmed.resource.collection === 'studyNotes' && confirmed.value === null && confirmed.metadata === null
    && draft?.userId === record.owner && isOrdinaryStudyNote(draft);
}

function autosavingSource(record: EditorRecord): boolean {
  return wasAutosaved(record) && safeAutosaveSource(record);
}

function safeAutosaveSource(record: EditorRecord): boolean {
  const { confirmed, draft, conflicts } = record.checkpoint;
  const hasOpening = confirmed.value && confirmed.metadata && !confirmed.metadata.deleted;
  return Boolean(draft && (hasOpening || reservedNoteCreation(record))
    && !record.prepared && !record.unfinalized.length && !record.retainedManualChoice && !record.recoveryOrigins?.length
    && !conflicts.length && !hasUnreadableDraftProof(record.checkpoint));
}

/** Several alternatives on one device still belong to that person; startup cannot pick one. */
export function recoverableAutosaves(copies: readonly RecoveryCheckpoint[], requests: readonly CommitRequest[],
  source = autosavingSource): RecoveryCheckpoint[] {
  const counts = new Map<string, number>();
  for (const { record } of copies) {
    const key = resourceKey(record.checkpoint.confirmed.resource);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const waiting = new Set(requests.filter(request => request.state !== 'acknowledged' && request.state !== 'cancelled')
    .map(request => resourceKey(request.baseline.resource)));
  return copies.filter(({ record, answer, actionResolutionRequired }) => {
    const key = resourceKey(record.checkpoint.confirmed.resource);
    const { dirty, pending, remoteCandidate } = record.checkpoint;
    return !answer && !actionResolutionRequired && source(record) && dirty && !remoteCandidate
      && !Object.keys(pending).length && counts.get(key) === 1 && !waiting.has(key);
  });
}

export function serviceOrderAutosaveSource(record: EditorRecord): boolean {
  const { confirmed, serviceOrderInputs } = record.checkpoint;
  return confirmed.resource.collection === 'serviceOrders' && safeAutosaveSource(record)
    && isDocumentEditorSlot(record.editorId, confirmed.resource, SERVICE_ORDER_INPUT_SLOT)
    && Object.values(serviceOrderInputs ?? {}).some(input => input.version && !input.retainedOnly);
}

export function serviceInputWithUnchangedOpening(record: EditorRecord, fresh: ResourceSnapshot): ServiceOrderInput | undefined {
  const { confirmed, draft, serviceOrderInputs } = record.checkpoint;
  const { value, metadata } = fresh;
  if (!value || !metadata || metadata.deleted || metadata.generation !== confirmed.metadata?.generation) return;
  return Object.values(serviceOrderInputs ?? {}).find(input => input.version?.generation === metadata.generation
    && input.version.observedRevision <= metadata.revision && !input.retainedOnly
    && (input.field !== 'orderTitle' || input.value.trim())
    && equalValues(readServiceOrderInputValue(draft, input), input.value)
    && equalValues(readServiceOrderInputValue(value, input), input.before));
}

export function pendingAutosaveReceipts(copies: readonly RecoveryCheckpoint[], requests: readonly CommitRequest[]) {
  const known = new Set(requests.filter(request => request.state !== 'conflict' && request.state !== 'refused').map(request => request.id));
  return copies.flatMap(source => {
    const { record } = source;
    if (!autosavingSource(record)) return [];
    const { draft, editGeneration } = record.checkpoint;
    const captured = Object.entries(record.checkpoint.pending);
    const latest = captured.reduce<EditorRecord['checkpoint']['pending'][string] | undefined>((tip, [, item]) =>
      !tip || item.generation > tip.generation ? item : tip, undefined);
    if (!latest || latest.generation >= editGeneration || equalValues(latest.value, draft)) return [];
    const receipts = captured.flatMap(([id]) => known.has(id) ? [id] : []);
    return receipts.length ? [{ source, receipts }] : [];
  });
}

export function originalAutosaveStillApplies(record: EditorRecord, fresh: ResourceSnapshot): boolean {
  const { confirmed } = record.checkpoint;
  if (reservedNoteCreation(record)) return fresh.value === null && fresh.metadata === null;
  if (!fresh.value || !fresh.metadata || fresh.metadata.deleted || confirmed.metadata?.generation !== fresh.metadata.generation) return false;
  if (confirmed.metadata.revision === fresh.metadata.revision) return equalValues(confirmed.value, fresh.value);
  return Boolean(mergeUnsentObservation(record.checkpoint, fresh));
}
