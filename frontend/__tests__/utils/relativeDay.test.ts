import { enUS, ru, uk } from 'date-fns/locale';

import { relativeDay } from '@/utils/relativeDay';

import type { TFunction } from 'i18next';

const now = new Date('2026-10-28T12:00:00Z');
const t = ((key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key}:${options.count}`) as unknown as TFunction;

describe('a shared relative day in the application language', () => {
  it.each([
    ['2026-10-28T10:00:00Z', 'common.today'],
    ['2026-10-27T10:00:00Z', 'common.yesterday'],
    ['2026-10-25T10:00:00Z', 'common.daysAgo:3'],
    ['2026-10-14T10:00:00Z', 'common.weeksAgo:2'],
  ])('keeps the relative reading of %s', (date, expected) => {
    expect(relativeDay(date, t, enUS, now)).toBe(expected);
  });

  it.each([
    [enUS, '1 Aug 2026'],
    [ru, '1 авг. 2026'],
    [uk, '1 серп. 2026'],
  ])('names an older day in its interface locale', (dateLocale, expected) => {
    expect(relativeDay('2026-08-01T12:00:00Z', t, dateLocale, now)).toBe(expected);
  });
});
