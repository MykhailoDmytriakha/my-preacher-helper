import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';

import { readField } from './fieldValues';

import type { DocumentFieldObservation } from './documentFieldAction';
import type { DocumentData, FieldChange, FieldValue } from './types';

export type CouncilTimedField = 'title' | 'date';
export type CouncilHistoryField = CouncilTimedField | 'heldAt';
export type CouncilFieldActions = {
  councilTitleAction?: DocumentFieldObservation;
  councilDateAction?: DocumentFieldObservation<FieldValue>;
  councilLifecycleAction?: DocumentFieldObservation<FieldValue>;
};

export const COUNCIL_TIMED_FIELDS = [
  { field: 'title', action: 'councilTitleAction', draft: 'councilTitleDraft', proof: 'councilTitle', causal: true,
    accepts: (value: unknown) => typeof value === 'string' && value.length <= 1024 },
  { field: 'date', action: 'councilDateAction', draft: 'councilDateDraft', proof: 'councilDate', causal: true, optional: true,
    accepts: (value: unknown) => typeof value === 'string' && value.length <= 128 && (value === '' || isDateOnlyKey(shownDayOf(value))) },
] as const;

export const COUNCIL_LIFECYCLE = { field: 'heldAt', action: 'councilLifecycleAction', draft: 'councilLifecycleDraft',
  proof: 'councilLifecycle', causal: true, optional: true,
  accepts: (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)),
} as const;

export type CouncilFieldTarget = typeof COUNCIL_TIMED_FIELDS[number] | typeof COUNCIL_LIFECYCLE;

export function councilStatusOf(heldAt: FieldValue): 'held' | 'preparing' {
  return heldAt.exists ? 'held' : 'preparing';
}

export function withCouncilLifecycle(value: DocumentData, heldAt: FieldValue): DocumentData {
  const next: DocumentData = { ...value, status: councilStatusOf(heldAt) };
  if (heldAt.exists) next.heldAt = heldAt.value!;
  else delete next.heldAt;
  return next;
}

export function councilLifecycleValue(value: DocumentData | null | undefined): FieldValue | undefined {
  if (!value) return undefined;
  const heldAt = readField(value, ['heldAt']);
  if (value.status !== councilStatusOf(heldAt) || (heldAt.exists && !COUNCIL_LIFECYCLE.accepts(heldAt.value))) return undefined;
  return heldAt;
}

export function matchesCouncilLifecycle(changes: readonly FieldChange[], heldAt: FieldChange): boolean {
  const before = councilStatusOf(heldAt.before), after = councilStatusOf(heldAt.after);
  const status = changes.find(change => change.path.length === 1 && change.path[0] === 'status');
  return status ? status.before.exists && status.before.value === before && status.after.exists && status.after.value === after
    : before === after;
}
export type CouncilMetadataHistoryPage = {
  owner: string; councilId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: { field: CouncilHistoryField; value: string | null; winner: string | null }[] }[];
};
