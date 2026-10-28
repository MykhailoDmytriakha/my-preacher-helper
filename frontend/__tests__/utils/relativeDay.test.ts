import { relativeDay } from '@/utils/relativeDay';

import type { TFunction } from 'i18next';

const now = new Date('2026-10-28T12:00:00Z');
const t = ((key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key}:${options.count}`) as TFunction;

describe('a shared relative day in the application language', () => {
  it.each([
    ['2026-10-28T10:00:00Z', 'common.today'],
    ['2026-10-27T10:00:00Z', 'common.yesterday'],
    ['2026-10-25T10:00:00Z', 'common.daysAgo:3'],
    ['2026-10-14T10:00:00Z', 'common.weeksAgo:2'],
  ])('keeps the relative reading of %s', (date, expected) => {
    expect(relativeDay(date, t, now, 'en')).toBe(expected);
  });

  it.each([
    ['en', '8/1/2026'],
    ['ru', '01.08.2026'],
    ['uk', '01.08.2026'],
  ])('names an older day in %s instead of the browser language', (language, expected) => {
    expect(relativeDay('2026-08-01T12:00:00Z', t, now, language)).toBe(expected);
  });
});
