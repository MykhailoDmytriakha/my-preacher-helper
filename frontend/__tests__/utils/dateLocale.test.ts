import { formatDateForLocale, formatDateTimeForLocale } from '@/utils/dateFormatter';

describe('Locale-aware date display', () => {
  const date = new Date(2026, 0, 15, 12, 34, 56);

  it.each([
    ['en-US', '1/15/2026'],
    ['ru-RU', '15.01.2026'],
    ['uk-UA', '15.01.2026'],
    [undefined, '1/15/2026'],
    [null, '1/15/2026'],
    ['', '1/15/2026'],
    ['unsupported-language', '1/15/2026'],
  ])('formats a calendar date for %s independently of the browser', (language, expected) => {
    expect(formatDateForLocale(date, language)).toBe(expected);
    expect(formatDateForLocale('2026-01-15', language)).toBe(expected);
  });

  it('keeps local time and seconds in date-time labels', () => {
    expect(formatDateTimeForLocale(date, 'en')).toBe('1/15/2026, 12:34:56 PM');
    expect(formatDateTimeForLocale(date, 'ru')).toBe('15.01.2026, 12:34:56');
    expect(formatDateTimeForLocale(date, 'uk')).toBe('15.01.2026, 12:34:56');
  });

  it('keeps custom date options and the input date unchanged', () => {
    const before = date.getTime();
    expect(formatDateForLocale(date, 'en', { day: 'numeric', month: 'long' })).toBe('January 15');
    expect(date.getTime()).toBe(before);
  });

  it('leaves invalid metadata dates blank', () => {
    expect(formatDateForLocale('not-a-date', 'ru')).toBe('');
    expect(formatDateTimeForLocale(new Date(NaN), 'uk')).toBe('');
  });
});
