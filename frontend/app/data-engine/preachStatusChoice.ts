import { explicitPreachedFlag } from '@/utils/preachDateStatus';

import { equalValues, object } from './fieldValues';
import { PREACH_ROW_BIRTH } from './preachDateFieldAction';
import { alignImplicitPreachStatuses, replacePreachStatuses } from './preachStatusAction';
import { mergeDocumentFields } from './protocol';
import { existingRowFields } from './rowFieldAction';

import type { PreachStatusAction } from './preachStatusAction';
import type { DocumentData, Json, ResourceSnapshot } from './types';

function rowDetails(rows: Json | undefined, id: string): DocumentData | undefined {
  const row = Array.isArray(rows) ? rows.find(item => object(item) && item.id === id) : undefined;
  if (!object(row)) return undefined;
  const details = { ...row };
  delete details.status;
  return details;
}

/** Choosing the saved status can only affect the same dates the person acted on. */
export function chooseLocalPreachStatuses(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot,
  actions: readonly PreachStatusAction[] | undefined): DocumentData | undefined {
  if (!basis.value || !draft || !stored.value || !actions?.length) return undefined;
  const accepted = stored.value;
  const births = existingRowFields(accepted.preachDates, PREACH_ROW_BIRTH);
  const sameGeneration = stored.metadata?.generation === basis.metadata?.generation;
  const stale = new Set(actions.filter(action => !sameGeneration || births.get(action.rowId) !== action.rowCreatedAt).map(action => action.rowId));
  for (const id of stale) {
    const authored = rowDetails(draft.preachDates, id);
    if (authored && !equalValues(authored, rowDetails(basis.value.preachDates, id))) {
      // Throw before retiring the request so the person's other edits stay recoverable.
      throw Object.assign(new Error('The preaching date changed and has edits to recover'), { code: 'preach-date-edits-retained' });
    }
  }
  const dropStale = (document: DocumentData): DocumentData => Array.isArray(document.preachDates) && stale.size
    ? { ...document, preachDates: document.preachDates.filter(row => !object(row) || typeof row.id !== 'string' || !stale.has(row.id)) }
    : document;
  const mine = dropStale(draft), base = dropStale(basis.value);
  const rows = alignImplicitPreachStatuses(base.preachDates, mine.preachDates, accepted.preachDates, actions);
  const merged = mergeDocumentFields(base, rows !== undefined ? { ...mine, preachDates: rows } : mine, accepted);
  if (!merged.value.exists) return undefined;
  const value = merged.value.value as DocumentData;
  const mergedBirths = existingRowFields(value.preachDates, PREACH_ROW_BIRTH);
  const kept = actions.filter(action => !stale.has(action.rowId) && mergedBirths.get(action.rowId) === action.rowCreatedAt);
  const result = replacePreachStatuses(value, kept, 'after');
  const flag = kept.length ? explicitPreachedFlag(result.preachDates, false) ?? accepted.isPreached : accepted.isPreached;
  if (flag !== undefined) return { ...result, isPreached: flag };
  delete result.isPreached;
  return result;
}
