import { enUS, ru } from 'date-fns/locale';

import { relativeDay } from '@/utils/relativeDay';

import type { TFunction } from 'i18next';

const t = ((key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)) as unknown as TFunction;
const now = new Date(2026, 10, 2, 12);
const daysBefore = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe('relativeDay — when a card was last touched', () => {
  it('says the last weeks in words', () => {
    expect(relativeDay(daysBefore(0), t, ru, now)).toBe('common.today');
    expect(relativeDay(daysBefore(1), t, ru, now)).toBe('common.yesterday');
    expect(relativeDay(daysBefore(3), t, ru, now)).toBe('common.daysAgo:3');
    expect(relativeDay(daysBefore(15), t, ru, now)).toBe('common.weeksAgo:2');
  });

  it('says an older day in the interface language, not the browser\'s', () => {
    // BUG-20261102-dates-in-browser-language: a Russian interface on an English browser showed «7/26/2026».
    const old = new Date(2026, 6, 26, 10).toISOString();
    expect(relativeDay(old, t, ru, now)).toBe('26 июл. 2026');
    expect(relativeDay(old, t, enUS, now)).toBe('26 Jul 2026');
  });
});
