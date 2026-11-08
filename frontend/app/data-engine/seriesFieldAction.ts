import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { FieldValue } from './types';

export type SeriesTimedField = 'title' | 'bookOrTopic' | 'status' | 'color';
export type SeriesFieldStamp = DocumentFieldStamp & { openingTheme?: string };
export type SeriesFieldStamps = Partial<Record<SeriesTimedField, SeriesFieldStamp>>;
export type SeriesFieldObservation = DocumentFieldObservation<FieldValue> & SeriesFieldStamp;
export type SeriesFieldObservations = Partial<Record<SeriesTimedField, SeriesFieldObservation>>;
export type SeriesHistoryField = { field: SeriesTimedField; value: string | null; winner: string | null };
export type SeriesMetadataHistoryPage = {
  owner: string; seriesId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: SeriesHistoryField[] }[];
};
export type SeriesFieldTarget = {
  field: SeriesTimedField;
  action: 'seriesFieldActions';
  proof: 'seriesTitle' | 'seriesBookOrTopic' | 'seriesStatus' | 'seriesColor';
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
] as const satisfies readonly SeriesFieldTarget[];
