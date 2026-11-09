export const ACTION_CLOCK_HEADER = 'x-engine-action-clock';

export function usesActionClock(collection: string): boolean {
  return collection === 'sermons' || collection === 'series' || collection === 'councils' || collection === 'prayerRequests' || collection === 'groups' || collection === 'bibleMarks' || collection === 'serviceOrders' || collection === 'studyNotes';
}

export function readsDocumentActionClock(collection: string): boolean {
  return collection === 'groups' || collection === 'series' || collection === 'councils' || collection === 'prayerRequests' || collection === 'studyNotes';
}

export type ActionTime = { earliestMs: number; latestMs: number };

export function isClockChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value);
}

export function isClockTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isActionTime(value: unknown): value is ActionTime {
  if (!value || typeof value !== 'object' || !('earliestMs' in value) || !('latestMs' in value)) return false;
  return isClockTime(value.earliestMs) && isClockTime(value.latestMs) && value.earliestMs <= value.latestMs;
}

export function boundedActionTime(value: unknown): ActionTime | undefined {
  if (!isActionTime(value) || value.latestMs - value.earliestMs > 175_000) return undefined;
  return { earliestMs: value.earliestMs, latestMs: value.latestMs };
}

export function compareActionTime(left: ActionTime, right: ActionTime): -1 | 0 | 1 {
  if (left.latestMs < right.earliestMs) return -1;
  return right.latestMs < left.earliestMs ? 1 : 0;
}
