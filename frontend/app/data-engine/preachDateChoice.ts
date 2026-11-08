import { explicitPreachedFlag } from '@/utils/preachDateStatus';

import { PREACH_DATE_TARGET } from './datedRowAction';
import { equalValues, object } from './fieldValues';
import { PREACH_ROW_BIRTH } from './preachDateFieldAction';
import { alignImplicitPreachStatuses, PREACH_STATUS_TARGET, replacePreachStatuses } from './preachStatusAction';
import { mergeDocumentFields } from './protocol';
import { existingRowFields, replaceExistingRowField } from './rowFieldAction';

import type { PreachStatusAction } from './preachStatusAction';
import type { DocumentData, Json, ResourceSnapshot } from './types';

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

export function hasClearedPreachDay(basis: ResourceSnapshot, draft: DocumentData | null): boolean {
  return clearedPreachDays(basis, draft).size > 0;
}

/** A status edit or day clear cannot recreate a row deleted on the other device. */
export function chooseLocalPreachDateEdits(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot,
  actions: readonly PreachStatusAction[] | undefined): DocumentData | undefined {
  if (!basis.value || !draft || !stored.value || basis.resource.collection !== 'sermons') return undefined;
  const clears = clearedPreachDays(basis, draft);
  const statuses = new Map((actions ?? []).map(action => [action.rowId, action.rowCreatedAt]));
  if (!clears.size && !statuses.size) return undefined;
  const accepted = stored.value;
  const births = existingRowFields(accepted.preachDates, PREACH_ROW_BIRTH);
  const sameGeneration = stored.metadata?.generation === basis.metadata?.generation;
  const stale = new Set([...clears, ...statuses].filter(([id, birth]) => !sameGeneration || births.get(id) !== birth).map(([id]) => id));
  for (const id of stale) {
    const authored = rowDetails(draft.preachDates, id, statuses.has(id), clears.has(id));
    if (authored && !equalValues(authored, rowDetails(basis.value.preachDates, id, statuses.has(id), clears.has(id)))) {
      // Throw before retiring the request so the person's other edits stay recoverable.
      throw Object.assign(new Error('The preaching date changed and has edits to recover'), { code: 'preach-date-edits-retained' });
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
