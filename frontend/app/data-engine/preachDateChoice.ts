import { explicitPreachedFlag } from '@/utils/preachDateStatus';

import { PREACH_DATE_TARGET } from './datedRowAction';
import { equalValues, object } from './fieldValues';
import { orderedPreachDateFieldConflict, PREACH_ROW_BIRTH, preachDateDetailConflict, preachDateFieldScope, preachDateFieldTarget, readPreachDateFieldVersions, samePreachDateRow } from './preachDateFieldAction';
import { alignImplicitPreachStatuses, PREACH_STATUS_TARGET, replacePreachStatuses } from './preachStatusAction';
import { mergeDocumentFields } from './protocol';
import { existingRowField, existingRowFields, replaceExistingRowField, rowConflictValue } from './rowFieldAction';

import type { PreachStatusAction } from './preachStatusAction';
import type { ConflictDetail, DocumentData, Json, ResourceSnapshot } from './types';

function rowDetails(rows: Json | undefined, id: string, status: boolean, date: boolean): DocumentData | undefined {
  const row = Array.isArray(rows) ? rows.find(item => object(item) && item.id === id) : undefined;
  if (!object(row)) return undefined;
  const details = { ...row };
  if (status) delete details.status;
  if (date) delete details.date;
  return details;
}

function clearedPreachDays(basis: ResourceSnapshot, draft: DocumentData | null): Map<string, string> {
  if (basis.resource.collection !== 'sermons') return new Map();
  const before = basis.value?.preachDates, after = draft?.preachDates;
  const days = existingRowFields(before, PREACH_DATE_TARGET);
  const births = existingRowFields(before, PREACH_ROW_BIRTH);
  const afterBirths = existingRowFields(after, PREACH_ROW_BIRTH);
  return new Map([...existingRowFields(after, PREACH_DATE_TARGET)].flatMap(([id, day]) => {
    const birth = births.get(id);
    return day === '' && days.get(id) && birth && birth === afterBirths.get(id) ? [[id, birth] as const] : [];
  }));
}

function datedRows(value: Json | undefined): Map<string, DocumentData> {
  const rows = new Map<string, DocumentData>();
  if (Array.isArray(value)) {
    for (const item of value) if (object(item) && typeof item.id === 'string') rows.set(item.id, item);
  }
  return rows;
}

export function withoutPreachDateRow(value: DocumentData, rowId: string): DocumentData {
  return Array.isArray(value.preachDates)
    ? { ...value, preachDates: value.preachDates.filter(row => !object(row) || row.id !== rowId) } : value;
}

export function isOrderedPreachDateField(conflict: ConflictDetail): boolean {
  return orderedPreachDateFieldConflict(conflict) !== undefined;
}

/** A choice about a different field cannot reverse a preaching detail already ordered by the server. */
export function preachDateChoiceFrames(basis: DocumentData | null, draft: DocumentData | null,
  stored: DocumentData | null, conflicts: readonly ConflictDetail[], acceptStored = false) {
  if (!basis || !draft || !stored) return { basis, draft };
  for (const conflict of conflicts) {
    const ordered = orderedPreachDateFieldConflict(conflict);
    if (!ordered || !samePreachDateRow(ordered.rowId, basis, draft)) continue;
    const { rowId, field, queued } = ordered;
    const target = preachDateFieldTarget(field);
    const mine = existingRowField(draft.preachDates, rowId, target);
    const opening = existingRowField(basis.preachDates, rowId, target);
    if (mine === undefined || opening === undefined || !equalValues(rowConflictValue(mine), conflict.mine)) continue;
    if (acceptStored && !samePreachDateRow(rowId, basis, stored)) {
      basis = withoutPreachDateRow(basis, rowId);
      draft = withoutPreachDateRow(draft, rowId);
      continue;
    }
    const sameScope = equalValues(preachDateFieldScope(basis.preachDates, rowId, field), preachDateFieldScope(stored.preachDates, rowId, field));
    if (!queued || (acceptStored && !sameScope)) {
      const rows: Json | undefined = replaceExistingRowField(draft.preachDates, rowId, opening, target);
      if (rows !== undefined) draft = { ...draft, preachDates: rows };
      continue;
    }
    if (!samePreachDateRow(rowId, basis, stored) || !sameScope) throw retainedEdits();
    const saved = existingRowField(stored.preachDates, rowId, target);
    const rows: Json | undefined = saved === undefined ? undefined : replaceExistingRowField(basis.preachDates, rowId, saved, target);
    if (rows !== undefined) basis = { ...basis, preachDates: rows };
  }
  return { basis, draft };
}

/** A later server copy can reveal another independently contested field in this Save. */
export function preachDateReviewConflicts(basis: DocumentData | null, draft: DocumentData | null,
  stored: DocumentData | null, conflicts: readonly ConflictDetail[]): ConflictDetail[] {
  const result = conflicts.filter(conflict => !isOrderedPreachDateField(conflict));
  if (!conflicts.some(isOrderedPreachDateField)) return result;
  const frames = preachDateChoiceFrames(basis, draft, stored, conflicts, true);
  const entries = new Map(result.flatMap(conflict => {
    const versions = draft && stored && readPreachDateFieldVersions(conflict.path, draft, stored);
    if (!versions) return [[JSON.stringify(conflict.path), conflict]] as const;
    if (equalValues(versions.mine, versions.stored)) return [];
    return [[JSON.stringify(conflict.path), { ...conflict,
      mine: rowConflictValue(versions.mine), theirs: rowConflictValue(versions.stored) }]] as const;
  }));
  for (const conflict of mergeDocumentFields(frames.basis, frames.draft, stored).conflicts) entries.set(JSON.stringify(conflict.path), conflict);
  return [...entries.values()];
}

export function unresolvedPreachDateField(conflict: ConflictDetail): boolean {
  return !isOrderedPreachDateField(conflict) && preachDateDetailConflict(conflict.path) !== undefined;
}

const retainedEdits = () => Object.assign(new Error('The preaching date changed and has edits to recover'), { code: 'preach-date-edits-retained' });

/** A status edit or day clear cannot recreate a row deleted on the other device. */
export function chooseLocalPreachDateEdits(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot,
  actions: readonly PreachStatusAction[] | undefined): DocumentData | undefined {
  if (!basis.value || !draft || !stored.value || basis.resource.collection !== 'sermons') return undefined;
  const clears = clearedPreachDays(basis, draft);
  const statuses = new Map((actions ?? []).map(action => [action.rowId, action.rowCreatedAt]));
  const accepted = stored.value;
  const sameGeneration = stored.metadata?.generation === basis.metadata?.generation;
  const previousRows = datedRows(basis.value.preachDates);
  const storedRows = datedRows(accepted.preachDates);
  for (const [id, local] of datedRows(draft.preachDates)) {
    const previous = previousRows.get(id), current = storedRows.get(id);
    if (previous && local.createdAt === previous.createdAt && !equalValues(local.notes, previous.notes)
      && (!sameGeneration || !current || current.createdAt !== previous.createdAt)) throw retainedEdits();
  }
  if (!clears.size && !statuses.size) return undefined;
  const births = existingRowFields(accepted.preachDates, PREACH_ROW_BIRTH);
  const stale = new Set([...clears, ...statuses].filter(([id, birth]) => !sameGeneration || births.get(id) !== birth).map(([id]) => id));
  for (const id of stale) {
    const authored = rowDetails(draft.preachDates, id, statuses.has(id), clears.has(id));
    if (authored && !equalValues(authored, rowDetails(basis.value.preachDates, id, statuses.has(id), clears.has(id)))) {
      // Throw before retiring the request so the person's other edits stay recoverable.
      throw retainedEdits();
    }
  }
  const dropStale = (document: DocumentData): DocumentData => Array.isArray(document.preachDates) && stale.size
    ? { ...document, preachDates: document.preachDates.filter(row => !object(row) || typeof row.id !== 'string' || !stale.has(row.id)) }
    : document;
  const mine = dropStale(draft), base = dropStale(basis.value);
  const dates = existingRowFields(base.preachDates, PREACH_DATE_TARGET);
  const recorded = existingRowFields(accepted.preachDates, PREACH_STATUS_TARGET);
  const implicit = alignImplicitPreachStatuses(base.preachDates, mine.preachDates, accepted.preachDates, actions);
  const rows = [...clears.keys()].reduce((value, id) => {
    const before = dates.get(id);
    return before && !stale.has(id) && recorded.get(id) === 'preached' && !statuses.has(id)
      ? replaceExistingRowField(value, id, before, PREACH_DATE_TARGET) : value;
  }, implicit);
  const merged = mergeDocumentFields(base, rows !== undefined ? { ...mine, preachDates: rows } : mine, accepted);
  if (!merged.value.exists) return undefined;
  const value = merged.value.value as DocumentData;
  if (!actions?.length) return value;
  const mergedBirths = existingRowFields(value.preachDates, PREACH_ROW_BIRTH);
  const kept = actions.filter(action => !stale.has(action.rowId) && mergedBirths.get(action.rowId) === action.rowCreatedAt);
  const marked = replacePreachStatuses(value, kept, 'after');
  const entered = existingRowFields(draft.preachDates, PREACH_DATE_TARGET);
  const mergedDays = existingRowFields(marked.preachDates, PREACH_DATE_TARGET);
  const dated = kept.reduce<Json | undefined>((rows, action) => {
    const day = entered.get(action.rowId);
    return action.after === 'preached' && mergedDays.get(action.rowId) === '' && day
      ? replaceExistingRowField(rows, action.rowId, day, PREACH_DATE_TARGET) : rows;
  }, marked.preachDates);
  const result = dated === undefined ? marked : { ...marked, preachDates: dated };
  const flag = kept.length ? explicitPreachedFlag(result.preachDates, false) ?? accepted.isPreached : accepted.isPreached;
  if (flag !== undefined) return { ...result, isPreached: flag };
  delete result.isPreached;
  return result;
}
