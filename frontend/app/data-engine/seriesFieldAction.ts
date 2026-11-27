import { equalValues } from './fieldValues';
import { orderedFieldChoiceFrames } from './orderedFieldChoiceFrames';

import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot } from './types';

export type SeriesTimedField = 'title' | 'bookOrTopic' | 'status' | 'color' | 'description';
export type SeriesFieldStamp = DocumentFieldStamp & { openingTheme?: string };
export type SeriesFieldStamps = Partial<Record<SeriesTimedField, SeriesFieldStamp>>;
export type SeriesFieldObservation = DocumentFieldObservation<FieldValue> & SeriesFieldStamp;
export type SeriesFieldObservations = Partial<Record<SeriesTimedField, SeriesFieldObservation>>;
export type SeriesFieldReview = { fields: readonly string[]; original: SeriesFieldObservations };
export type SeriesHistoryField =
  | { field: Exclude<SeriesTimedField, 'description'>; value: string | null; winner: string | null }
  | { field: 'description'; value: string | null; winnerDigest: string };
export type SeriesMetadataHistoryPage = {
  owner: string; seriesId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: SeriesHistoryField[] }[];
};
type SeriesFieldPolicy = {
  field: SeriesTimedField;
  action: 'seriesFieldActions';
  proof: 'seriesTitle' | 'seriesBookOrTopic' | 'seriesStatus' | 'seriesColor' | 'seriesDescription';
  accepts: (value: unknown) => boolean;
  optional?: true;
  causal: true;
};

const shortText = (value: unknown) => typeof value === 'string' && value.length <= 1024;
const status = (value: unknown) => value === 'draft' || value === 'active' || value === 'completed';
export const SERIES_FIELD_TARGETS = [
  { field: 'title', action: 'seriesFieldActions', proof: 'seriesTitle', accepts: shortText, optional: true, causal: true },
  { field: 'bookOrTopic', action: 'seriesFieldActions', proof: 'seriesBookOrTopic', accepts: shortText, causal: true },
  { field: 'status', action: 'seriesFieldActions', proof: 'seriesStatus', accepts: status, causal: true },
  { field: 'color', action: 'seriesFieldActions', proof: 'seriesColor', accepts: shortText, optional: true, causal: true },
  { field: 'description', action: 'seriesFieldActions', proof: 'seriesDescription',
    accepts: (value: unknown) => typeof value === 'string', optional: true, causal: true },
] as const satisfies readonly SeriesFieldPolicy[];
export type SeriesFieldTarget = typeof SERIES_FIELD_TARGETS[number];

export const SERIES_METADATA_SETTLED = 'series-metadata-settled';
export const SERIES_METADATA_QUEUED = 'series-metadata-queued';

export function isReturnedSeriesField({ path, base, theirs, code }: ConflictDetail): boolean {
  return !code && path.length === 1 && path[0] !== 'description'
    && SERIES_FIELD_TARGETS.some(({ field }) => field === path[0]) && equalValues(base, theirs);
}

export function seriesReviewFrames(basis: ResourceSnapshot, reviewed: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (basis.resource.collection !== 'series') return { basis, reviewed, conflicts };
  return orderedFieldChoiceFrames(basis, reviewed, stored, conflicts, ({ code, path, mine, theirs }) => {
    if (path.length !== 1 || (code !== SERIES_METADATA_SETTLED && code !== SERIES_METADATA_QUEUED)) return;
    const mirroredTitle = path[0] === 'theme' && conflicts.some(item => item.path.length === 1 && item.path[0] === 'title'
      && item.code === code && equalValues(item.mine, mine) && equalValues(item.theirs, theirs));
    if (mirroredTitle || SERIES_FIELD_TARGETS.some(({ field }) => field === path[0])) {
      return code === SERIES_METADATA_SETTLED ? 'settled' : 'queued';
    }
  });
}
