import { enUS, ru, uk } from 'date-fns/locale';

import { dateFnsLocaleFor, formatMonthName, formatMonthTitle, resolveAppLocale } from '@/utils/appLocale';

/**
 * THE LANGUAGE OF THE INTERFACE, DECIDED ONCE.
 *
 * Five components worked it out by hand and six more each kept a switch for the date
 * language. They agreed today; this is what keeps them agreeing tomorrow.
 */
describe('which language the interface speaks', () => {
  it.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['RU', 'ru'],
    ['uk', 'uk'],
    ['uk-UA', 'uk'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['de', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ])('reads %p as %p', (language, expected) => {
    expect(resolveAppLocale(language)).toBe(expected);
  });
});

describe('the date language that goes with it', () => {
  it('hands date-fns the locale of the interface', () => {
    expect(dateFnsLocaleFor('ru')).toBe(ru);
    expect(dateFnsLocaleFor('uk-UA')).toBe(uk);
    expect(dateFnsLocaleFor('en')).toBe(enUS);
  });

  it('falls back to English for a language it does not speak', () => {
    expect(dateFnsLocaleFor('fr')).toBe(enUS);
    expect(dateFnsLocaleFor(undefined)).toBe(enUS);
  });
});

describe('a month named on its own', () => {
  const september = new Date(2026, 8, 20);

  it.each([
    [enUS, 'September 2026'],
    // Russian and Ukrainian decline the month: "20 сентября" inside a date, "Сентябрь" alone.
    [ru, 'Сентябрь 2026'],
    [uk, 'Вересень 2026'],
  ])('reads as a person would say it (%#)', (locale, expected) => {
    expect(formatMonthTitle(september, locale)).toBe(expected);
  });

  it('never borrows the in-a-date form', () => {
    expect(formatMonthTitle(september, ru)).not.toMatch(/сентября/i);
    expect(formatMonthTitle(september, uk)).not.toMatch(/вересня/i);
  });
});

describe('a month named inside a sentence', () => {
  const august = new Date(2026, 7, 14);

  it.each([
    [enUS, 'August 2026'],
    [ru, 'август 2026'],
    [uk, 'серпень 2026'],
  ])('keeps the standalone form and the language\'s own case (%#)', (locale, expected) => {
    expect(formatMonthName(august, locale)).toBe(expected);
  });
});
