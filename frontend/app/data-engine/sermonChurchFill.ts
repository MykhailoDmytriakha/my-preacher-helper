import { buildUnspecifiedChurch, isUnspecifiedChurch } from '@/utils/church';

import { isChurchValue, type ChurchValue } from './churchFieldValue';
import { equalValues, object } from './fieldValues';
import { boundedRowId } from './rowFieldAction';

import type { DocumentData, FieldValue, Json } from './types';

export type SermonChurchFill = { rowId: string; rowCreatedAt: string; church: ChurchValue };

function findRow(rows: Json | undefined, id: string): DocumentData | undefined {
  if (!Array.isArray(rows)) return undefined;
  const matches = rows.filter(row => object(row) && row.id === id);
  return matches.length === 1 && object(matches[0]) ? matches[0] : undefined;
}

function sameRow(row: DocumentData | undefined, fill: SermonChurchFill): row is DocumentData {
  return Boolean(row && row.createdAt === fill.rowCreatedAt);
}

function validFill(fill: unknown): fill is SermonChurchFill {
  return object(fill) && boundedRowId(fill.rowId) && typeof fill.rowCreatedAt === 'string' && fill.rowCreatedAt.length > 0 && isChurchValue(fill.church) && !isUnspecifiedChurch(fill.church);
}

/** The metadata form can infer at most one church, on the date it was editing. */
export function captureSermonChurchFill(before: Json | undefined, after: Json | undefined, church: FieldValue): SermonChurchFill | undefined {
  const requested = church.value;
  if (!Array.isArray(after) || !isChurchValue(requested) || isUnspecifiedChurch(requested)) return undefined;
  const candidates = after.flatMap(row => {
    if (!object(row) || !boundedRowId(row.id) || typeof row.createdAt !== 'string' || !row.createdAt || !equalValues(row.church, requested)) return [];
    const opening = findRow(before, row.id);
    if (opening && (opening.createdAt !== row.createdAt || !isChurchValue(opening.church) || !isUnspecifiedChurch(opening.church))) return [];
    return [{ rowId: row.id, rowCreatedAt: row.createdAt, church: requested }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Re-evaluate an inferred church without rewriting authored date details or another date. */
export function rebaseSermonChurchFill(before: Json | undefined, after: Json | undefined, live: Json | undefined,
  acceptedChurch: FieldValue, fill: unknown): Json | undefined {
  if (!validFill(fill) || !Array.isArray(after)) return after;
  const requestedChurch = { exists: true, value: fill.church };
  const opening = findRow(before, fill.rowId), draft = findRow(after, fill.rowId);
  if (!sameRow(draft, fill) || !equalValues(draft.church, requestedChurch.value)) return after;
  const accepted = findRow(live, fill.rowId);
  let church: Json;
  if (opening) {
    if (!sameRow(opening, fill) || !isChurchValue(opening.church) || !isUnspecifiedChurch(opening.church)) return after;
    if (equalValues(requestedChurch, acceptedChurch) && sameRow(accepted, fill) && equalValues(opening.church, accepted.church)) return after;
    // Returning this leaf to the opening value lets the ordinary merge preserve the live row.
    church = opening.church;
  } else {
    if (accepted || equalValues(requestedChurch, acceptedChurch)) return after;
    church = isChurchValue(acceptedChurch.value) ? acceptedChurch.value : { ...buildUnspecifiedChurch() };
  }
  return after.map(row => row === draft ? { ...draft, church } : row);
}
