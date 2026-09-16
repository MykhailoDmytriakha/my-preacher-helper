import { format } from 'date-fns';
import { enUS, ru, uk } from 'date-fns/locale';

import type { Locale } from 'date-fns';

/**
 * THE LANGUAGE THE INTERFACE SPEAKS — one answer for the whole app.
 *
 * The app ships three languages. Which one a screen is in used to be worked out by hand in
 * five components ("starts with ru? starts with uk? otherwise English"), and six calendar
 * components each kept their own switch to pick the matching date language. They agreed only
 * because nobody had changed one of them yet; the Bible book names, the Scripture references
 * and the month names all hang off this single decision, so it lives here.
 */
export type AppLocale = 'en' | 'ru' | 'uk';

export const APP_LOCALES: readonly AppLocale[] = ['en', 'ru', 'uk'];

/**
 * i18next reports whatever the browser or the saved setting said — `ru`, `ru-RU`, `uk-UA`,
 * sometimes an empty string on the first render. Anything that is not one of ours reads as
 * English, which is the language every string has.
 */
export function resolveAppLocale(language?: string | null): AppLocale {
  const lang = (language ?? '').toLowerCase();
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('uk')) return 'uk';
  return 'en';
}

const DATE_LOCALES: Record<AppLocale, Locale> = { en: enUS, ru, uk };

/** The date-fns locale for month and weekday names in the interface's own language. */
export function dateFnsLocaleFor(language?: string | null): Locale {
  return DATE_LOCALES[resolveAppLocale(language)];
}

/**
 * A month standing on its own — a heading, a bar label, a window title: "September 2026".
 *
 * Russian and Ukrainian decline month names. `MMMM` is the form a month takes INSIDE a date
 * ("20 сентября"); a month named by itself needs the standalone form `LLLL` ("Сентябрь").
 * Four calendar places wrote `MMMM` and printed "сентября 2026" as a heading. English has one
 * form, so it never showed there.
 */
export function formatMonthTitle(date: Date, dateLocale: Locale): string {
  const title = format(date, 'LLLL yyyy', { locale: dateLocale });
  return title.charAt(0).toUpperCase() + title.slice(1);
}
