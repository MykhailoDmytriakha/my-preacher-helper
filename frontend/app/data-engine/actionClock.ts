export const ACTION_CLOCK_HEADER = 'x-engine-action-clock';

export type ActionTime = { earliestMs: number; latestMs: number };

export function isClockChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value);
}

export function isClockTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
