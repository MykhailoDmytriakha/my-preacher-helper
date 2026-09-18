import { createInstance } from 'i18next';
import { enUS, ru as ruDates, uk as ukDates } from 'date-fns/locale';

import { formatMonthName } from '@/utils/appLocale';

import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

jest.unmock('i18next');

/**
 * "4 ПРОПОВЕДЕЙ" IS NOT RUSSIAN.
 *
 * A count in the calendar must pick its word by the number, the way a person says it. The
 * month and book windows passed `count` to keys that had one form only, so they printed
 * "1 проповедей" and "1 sermons". These run the real i18next plural rules over the real files.
 */
const resources = { en: { translation: en }, ru: { translation: ru }, uk: { translation: uk } };

async function translatorFor(lng: 'en' | 'ru' | 'uk') {
  const i18n = createInstance();
  await i18n.init({ lng, resources, interpolation: { escapeValue: false } });
  return i18n;
}

const EXPECTED = {
  en: [[1, '1 sermon'], [2, '2 sermons'], [5, '5 sermons'], [21, '21 sermons']],
  ru: [[1, '1 проповедь'], [2, '2 проповеди'], [5, '5 проповедей'], [21, '21 проповедь'], [0, '0 проповедей']],
  uk: [[1, '1 проповідь'], [2, '2 проповіді'], [5, '5 проповідей'], [21, '21 проповідь'], [0, '0 проповідей']],
} as const;

describe('sermon counts in the calendar agree with the number', () => {
  it.each(['calendar.analytics.monthModalCount', 'calendar.analytics.bookModalCount'])(
    '%s', async (key) => {
      for (const lng of ['en', 'ru', 'uk'] as const) {
        const i18n = await translatorFor(lng);
        for (const [count, phrase] of EXPECTED[lng]) {
          expect(`${lng}: ${i18n.t(key, { count })}`).toBe(`${lng}: ${phrase}`);
        }
      }
    }
  );

  it('the word beside a bare number follows the same rule', async () => {
    for (const lng of ['en', 'ru', 'uk'] as const) {
      const i18n = await translatorFor(lng);
      for (const [count, phrase] of EXPECTED[lng]) {
        expect(`${lng}: ${count} ${i18n.t('calendar.totalSermonsWord', { count })}`).toBe(`${lng}: ${phrase}`);
      }
    }
  });
});

/**
 * "ПРОПОВЕДИ В АВГУСТ 2026" IS NOT RUSSIAN EITHER.
 *
 * "в" wants the prepositional case ("в августе"), which date-fns cannot give. "за" takes the
 * accusative, and every month is a masculine inanimate noun in Russian and Ukrainian, so its
 * accusative IS the standalone form date-fns already has.
 */
describe('the month window title', () => {
  const august = new Date(2026, 7, 14);

  it.each([
    ['en', enUS, 'Sermons in August 2026'],
    ['ru', ruDates, 'Проповеди за август 2026'],
    ['uk', ukDates, 'Проповіді за серпень 2026'],
  ] as const)('reads as a sentence in %s', async (lng, dateLocale, expected) => {
    const i18n = await translatorFor(lng);
    expect(i18n.t('calendar.analytics.monthModalTitle', { month: formatMonthName(august, dateLocale) })).toBe(expected);
  });
});
