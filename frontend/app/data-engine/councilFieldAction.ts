import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';

import type { DocumentFieldObservation } from './documentFieldAction';
import type { FieldValue } from './types';

export type CouncilTimedField = 'title' | 'date';
export type CouncilFieldActions = {
  councilTitleAction?: DocumentFieldObservation;
  councilDateAction?: DocumentFieldObservation<FieldValue>;
};

export const COUNCIL_TIMED_FIELDS = [
  { field: 'title', action: 'councilTitleAction', draft: 'councilTitleDraft', proof: 'councilTitle', causal: true,
    accepts: (value: unknown) => typeof value === 'string' && value.length <= 1024 },
  { field: 'date', action: 'councilDateAction', draft: 'councilDateDraft', proof: 'councilDate', causal: true, optional: true,
    accepts: (value: unknown) => typeof value === 'string' && value.length <= 128 && (value === '' || isDateOnlyKey(shownDayOf(value))) },
] as const;

export type CouncilFieldTarget = typeof COUNCIL_TIMED_FIELDS[number];
export type CouncilMetadataHistoryPage = {
  owner: string; councilId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: { field: CouncilTimedField; value: string | null; winner: string | null }[] }[];
};
