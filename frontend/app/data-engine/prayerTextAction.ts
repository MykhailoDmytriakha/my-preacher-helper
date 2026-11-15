import type { ActionTime } from './actionClock';
import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { FieldValue } from './types';

export type PrayerTextField = 'description' | 'answerText';
export type PrayerTextTarget = {
  field: PrayerTextField;
  action: 'prayerTextActions';
  proof: 'prayerDescription' | 'prayerAnswerText';
  causal: true;
  optional: true;
  accepts: (value: unknown) => value is string;
};
export type PrayerTextOpening = { generation: string; revision: number; value: FieldValue; requestId?: string };
export type PrayerTextOpenings = Partial<Record<PrayerTextField, PrayerTextOpening>>;
export type PrayerTextCapture = { time: ActionTime | null; openings: PrayerTextOpenings };
export type PrayerTextObservations = Partial<Record<PrayerTextField, DocumentFieldObservation<FieldValue>>>;
export type PrayerTextStamps = Partial<Record<PrayerTextField, DocumentFieldStamp>>;

const text = (value: unknown): value is string => typeof value === 'string';
export const PRAYER_TEXT_TARGETS = [
  { field: 'description', action: 'prayerTextActions', proof: 'prayerDescription', causal: true, optional: true, accepts: text },
  { field: 'answerText', action: 'prayerTextActions', proof: 'prayerAnswerText', causal: true, optional: true, accepts: text },
] as const satisfies readonly PrayerTextTarget[];
