import { isAuthoredListComparison } from './authoredStringList';
import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { SERVICE_ORDER_STEP_BODY_TARGET, SERVICE_ORDER_STEP_SCRIPTURE_LIST, serviceOrderStepField } from './serviceOrderStepAction';

import type { ActionTime } from './actionClock';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { ServiceOrderStepBodyCapture, ServiceOrderStepScriptureCapture } from './serviceOrderStepAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

export function serviceStepScriptureConflict(checkpoint: SessionCheckpoint): string | undefined {
  if (checkpoint.confirmed.resource.collection !== 'serviceOrders' || checkpoint.conflicts.length !== 1) return;
  const row = serviceOrderStepField(checkpoint.conflicts[0].path);
  return row?.field === 'scriptureRefs' ? row.id : undefined;
}

export function reviewedServiceStepScriptureRows(checkpoint: SessionCheckpoint): string[] {
  if (checkpoint.confirmed.resource.collection !== 'serviceOrders') return [];
  return [...new Set(checkpoint.conflicts.flatMap(({ code, path }) => {
    const target = serviceOrderStepField(path);
    return isAuthoredListComparison(code) && target?.field === 'scriptureRefs' ? [target.id] : [];
  }))];
}

export function serviceStepScriptureChoice(checkpoint: SessionCheckpoint, rowId: string,
  time: ActionTime | null): ServiceOrderStepScriptureCapture | undefined {
  const { confirmed, draft } = checkpoint;
  if (!confirmed.metadata) return;
  const before = existingRowField(confirmed.value?.steps, rowId, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
  const after = existingRowField(draft?.steps, rowId, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
  if (!before || !after || equalValues(before, after)) return;
  return { generation: confirmed.metadata.generation, observedRevision: confirmed.metadata.revision, rowId, before, after, time };
}

export function readServiceStepBodyChoice(checkpoint: SessionCheckpoint, local = checkpoint.draft) {
  const { confirmed, remoteCandidate, conflicts, pending } = checkpoint;
  if (confirmed.resource.collection !== 'serviceOrders' || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate?.metadata?.generation || remoteCandidate.metadata.deleted
    || conflicts.length !== 1 || Object.keys(pending).length !== 1) return undefined;
  const row = serviceOrderStepField(conflicts[0].path);
  if (row?.field !== 'body') return undefined;
  const before = existingRowField(confirmed.value?.steps, row.id, SERVICE_ORDER_STEP_BODY_TARGET);
  const mine = existingRowField(local?.steps, row.id, SERVICE_ORDER_STEP_BODY_TARGET);
  const stored = existingRowField(remoteCandidate.value?.steps, row.id, SERVICE_ORDER_STEP_BODY_TARGET);
  if (before === undefined || mine === undefined || stored === undefined || mine === stored) return undefined;
  return { rowId: row.id, mine, stored };
}

export function serviceStepBodyRetry(checkpoint: SessionCheckpoint, rowId: string,
  time: ActionTime | null): ServiceOrderStepBodyCapture | undefined {
  const { confirmed, draft } = checkpoint;
  if (!confirmed.metadata || confirmed.metadata.deleted) return undefined;
  const before = existingRowField(confirmed.value?.steps, rowId, SERVICE_ORDER_STEP_BODY_TARGET);
  const after = existingRowField(draft?.steps, rowId, SERVICE_ORDER_STEP_BODY_TARGET);
  if (before === undefined || after === undefined || before === after) return undefined;
  return { generation: confirmed.metadata.generation, observedRevision: confirmed.metadata.revision, rowId, before, after, time };
}

export function keepUncontestedServiceStepScripture(checkpoint: SessionCheckpoint, local: DocumentData | null, rowId: string) {
  return keepUncontestedServiceStepField(checkpoint, local, rowId, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
}

export function keepUncontestedServiceStepBody(checkpoint: SessionCheckpoint, local: DocumentData | null, rowId: string) {
  return keepUncontestedServiceStepField(checkpoint, local, rowId, SERVICE_ORDER_STEP_BODY_TARGET);
}

function keepUncontestedServiceStepField<Value extends RowValue>(checkpoint: SessionCheckpoint, local: DocumentData | null,
  rowId: string, target: RowFieldTarget<Value>) {
  const base = checkpoint.confirmed.value, stored = checkpoint.remoteCandidate?.value;
  if (!local || !base || !stored) return;
  const opening = existingRowField(base.steps, rowId, target);
  if (opening === undefined) return;
  const steps = replaceExistingRowField(local.steps, rowId, opening, target);
  if (!steps) return;
  const merged = mergeDocumentFields(base, { ...local, steps }, stored);
  if (merged.conflicts.length) throw Object.assign(new Error('Other changes need review'), { code: 'decision-changed' });
  return merged.value.exists ? merged.value.value as DocumentData : undefined;
}
