import { isPrayerStatus } from '@/utils/prayerStatus';

import type { ActionTime } from './actionClock';
import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { ConflictDetail, FieldValue } from './types';
import type { PrayerStatus } from '@/models/models';

export type PrayerStatusField = 'status' | 'answeredAt';

export const PRAYER_STATUS_FIELDS = [
  { field: 'status', action: 'prayerStatusAction', proof: 'prayerStatus', causal: true, accepts: isPrayerStatus },
  { field: 'answeredAt', action: 'prayerAnsweredAtAction', proof: 'prayerAnsweredAt', causal: true, optional: true,
    accepts: (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)
      && value.length <= 64 && Number.isFinite(Date.parse(value)) },
] as const;
export type PrayerStatusTarget = typeof PRAYER_STATUS_FIELDS[number];
export const PRAYER_STATUS_REVIEW = 'prayer-status-review';
export const PRAYER_STATUS_SETTLED = 'prayer-status-settled';
export const PRAYER_STATUS_QUEUED = 'prayer-status-queued';

export function prayerStatusReviewTarget({ path, code }: ConflictDetail) {
  if ((code === PRAYER_STATUS_REVIEW || code === PRAYER_STATUS_SETTLED || code === PRAYER_STATUS_QUEUED) && path.length === 1) {
    return PRAYER_STATUS_FIELDS.find(target => target.field === path[0]);
  }
}

export type PrayerStatusOpening = {
  generation: string; revision: number; status: PrayerStatus; answeredAt: FieldValue;
  submitted?: Partial<Record<PrayerStatusField, { requestId: string; revision: number }>>;
};

export type PrayerStatusCapture = {
  time: ActionTime | null; fields: readonly PrayerStatusField[]; opening?: PrayerStatusOpening; reviewed?: true;
  original?: PrayerStatusObservations;
};

export type PrayerStatusStamp = DocumentFieldStamp & { reviewed?: true };
export type PrayerStatusObservation<Value = string> = DocumentFieldObservation<Value> & PrayerStatusStamp;
export type PrayerStatusObservations = {
  prayerStatusAction?: PrayerStatusObservation<PrayerStatus>;
  prayerAnsweredAtAction?: PrayerStatusObservation<FieldValue>;
};

export type PrayerStatusHistoryPage = {
  owner: string; prayerId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: { field: PrayerStatusField; value: string | null; winner: string | null }[] }[];
};
