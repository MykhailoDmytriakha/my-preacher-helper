import type { ActionTime } from './actionClock';
import type { DocumentFieldObservation, DocumentFieldStamp, PrayerTitleCapture } from './documentFieldAction';
import type { DocumentTagIntent } from './documentTagCapture';
import type { ConflictDetail, EditorCommitAction, FieldValue } from './types';

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
type PrayerTextTimes = Partial<Record<PrayerTextField, ActionTime | null>>;
export type PrayerTextCapture = { time: ActionTime | null; openings: PrayerTextOpenings; originalTimes?: PrayerTextTimes };
export type PrayerTextObservations = Partial<Record<PrayerTextField, DocumentFieldObservation<FieldValue>>>;
export type PrayerTextStamps = Partial<Record<PrayerTextField, DocumentFieldStamp>>;

export const PRAYER_TEXT_SETTLED = 'prayer-text-settled';
export const PRAYER_TEXT_QUEUED = 'prayer-text-queued';

export type PrayerEditableText = 'title' | PrayerTextField;

export function orderedPrayerTextField({ path, code }: ConflictDetail): PrayerEditableText | undefined {
  if (path.length === 1 && (path[0] === 'title' || path[0] === 'description' || path[0] === 'answerText')
    && (code === PRAYER_TEXT_SETTLED || code === PRAYER_TEXT_QUEUED)) return path[0];
}

export function prayerTextEditAction(time: ActionTime | null, openings: PrayerTextOpenings, title?: PrayerTitleCapture,
  tagMembership?: readonly DocumentTagIntent[], originalTimes?: PrayerTextTimes) {
  const tags = tagMembership && { tagMembership };
  if (Object.keys(openings).length) return {
    kind: 'prayer-text', text: { time, openings, ...(originalTimes && { originalTimes }) }, title, ...tags,
  } as const satisfies EditorCommitAction;
  if (title) return { kind: 'prayer-title', title, ...tags } as const satisfies EditorCommitAction;
  if (tagMembership) return { kind: 'document-tags', tagMembership } as const satisfies EditorCommitAction;
}

const text = (value: unknown): value is string => typeof value === 'string';
export const PRAYER_TEXT_TARGETS = [
  { field: 'description', action: 'prayerTextActions', proof: 'prayerDescription', causal: true, optional: true, accepts: text },
  { field: 'answerText', action: 'prayerTextActions', proof: 'prayerAnswerText', causal: true, optional: true, accepts: text },
] as const satisfies readonly PrayerTextTarget[];
