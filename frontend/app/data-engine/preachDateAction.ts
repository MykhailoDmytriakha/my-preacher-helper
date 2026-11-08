import { isActionTime, type ActionTime } from './actionClock';

import type { DocumentData, FieldChange, FieldValue, Json, ResourceSnapshot } from './types';

export type DisplacedPreachDate = {
  rowId: string; date: string; winnerDate: string; generation: string;
  actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type PreachDateHistoryEntry = DisplacedPreachDate & { id: string; acceptedAt: string };
export type PreachDateHistoryPage = { owner: string; sermonId: string; generation: string; entries: PreachDateHistoryEntry[]; nextCursor: string | null };

export type PreachDateActionCapture = { rowId: string; time: ActionTime };
export type PreachDateActionEvidence = PreachDateActionCapture & { before: string; after: string; observedRevision: number };

export function existingPreachDate(rows: Json | undefined, rowId: string): string | undefined {
  if (!Array.isArray(rows)) return undefined;
  const matches = rows.filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.id === rowId);
  const row = matches.length === 1 ? matches[0] : undefined;
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return undefined;
  return row.date;
}

export function capturePreachDateAction(baseline: ResourceSnapshot, predecessor: { value: DocumentData | null } | undefined,
  after: DocumentData | null, capture?: PreachDateActionCapture): PreachDateActionEvidence | undefined {
  if (baseline.resource.collection !== 'sermons' || !baseline.metadata?.generation || !capture || !isActionTime(capture.time)) return undefined;
  const before = predecessor ? predecessor.value : baseline.value;
  const previousDate = existingPreachDate(before?.preachDates, capture.rowId);
  const nextDate = existingPreachDate(after?.preachDates, capture.rowId);
  if (!previousDate || !nextDate || previousDate === nextDate) return undefined;
  return { ...capture, before: previousDate, after: nextDate, observedRevision: baseline.metadata.revision };
}

export function replaceExistingDate(rows: Json | undefined, rowId: string, date: string): Json | undefined {
  if (!Array.isArray(rows) || !existingPreachDate(rows, rowId)) return rows;
  return rows.map(row => row && typeof row === 'object' && !Array.isArray(row) && row.id === rowId ? { ...row, date } : row);
}

export function matchesPreachDateChange(changes: FieldChange[], evidence: PreachDateActionEvidence): boolean {
  const change = changes.find(item => item.path.length === 1 && item.path[0] === 'preachDates');
  return Boolean(change?.before.exists && change.after.exists
    && existingPreachDate(change.before.value, evidence.rowId) === evidence.before
    && existingPreachDate(change.after.value, evidence.rowId) === evidence.after);
}

export function isCapturedDateConflict(conflict: { path: string[]; base: FieldValue; mine: FieldValue; theirs: FieldValue },
  action: PreachDateActionEvidence): boolean {
  return conflict.path.length === 3 && conflict.path[0] === 'preachDates'
    && conflict.path[1] === `id:${action.rowId}` && conflict.path[2] === 'date'
    && conflict.base.exists && conflict.base.value === action.before
    && conflict.mine.exists && conflict.mine.value === action.after
    && conflict.theirs.exists && typeof conflict.theirs.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(conflict.theirs.value);
}

export function capturedDateBaseline(changes: FieldChange[], action: PreachDateActionEvidence): FieldChange[] {
  return changes.map(change => change.path.length === 1 && change.path[0] === 'preachDates'
    ? { ...change, before: { ...change.before, value: replaceExistingDate(change.before.value, action.rowId, action.before) } }
    : change);
}
