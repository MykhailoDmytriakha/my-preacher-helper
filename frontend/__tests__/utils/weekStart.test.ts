import {
  DEFAULT_FIRST_DAY_OF_WEEK,
  getWeekStartsOn,
  isFirstDayOfWeek,
  normalizeFirstDayOfWeek,
} from '@/utils/weekStart';

describe('weekStart utilities', () => {
  it('recognizes supported first-day-of-week values', () => {
    expect(isFirstDayOfWeek('sunday')).toBe(true);
    expect(isFirstDayOfWeek('monday')).toBe(true);
    expect(isFirstDayOfWeek('tuesday')).toBe(false);
    expect(isFirstDayOfWeek(null)).toBe(false);
  });

  it('normalizes unknown values to the default', () => {
    expect(normalizeFirstDayOfWeek('monday')).toBe('monday');
    expect(normalizeFirstDayOfWeek('invalid')).toBe(DEFAULT_FIRST_DAY_OF_WEEK);
    expect(normalizeFirstDayOfWeek(undefined)).toBe(DEFAULT_FIRST_DAY_OF_WEEK);
  });

  it('maps the preference to react-day-picker weekStartsOn values', () => {
    expect(getWeekStartsOn('sunday')).toBe(0);
    expect(getWeekStartsOn('monday')).toBe(1);
    expect(getWeekStartsOn(undefined)).toBe(0);
  });
});
