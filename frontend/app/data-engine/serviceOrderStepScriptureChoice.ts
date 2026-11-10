import { isAuthoredListComparison } from './authoredStringList';
import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { SERVICE_ORDER_STEP_SCRIPTURE_LIST, serviceOrderStepField } from './serviceOrderStepAction';

import type { ActionTime } from './actionClock';
import type { ServiceOrderStepScriptureCapture } from './serviceOrderStepAction';
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

export function keepUncontestedServiceStepScripture(checkpoint: SessionCheckpoint, local: DocumentData | null, rowId: string) {
  const base = checkpoint.confirmed.value, stored = checkpoint.remoteCandidate?.value;
  if (!local || !base || !stored) return;
  const opening = existingRowField(base.steps, rowId, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
  if (!opening) return;
  const steps = replaceExistingRowField(local.steps, rowId, opening, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
  if (!steps) return;
  const merged = mergeDocumentFields(base, { ...local, steps }, stored);
  if (merged.conflicts.length) throw Object.assign(new Error('Other changes need review'), { code: 'decision-changed' });
  return merged.value.exists ? merged.value.value as DocumentData : undefined;
}
