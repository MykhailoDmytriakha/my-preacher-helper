import { format } from 'date-fns';
import { enUS, ru, uk } from 'date-fns/locale';

import { COOKIE_LANG_KEY, DEFAULT_LANGUAGE } from '@locales/constants';

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

/**
 * THE INTERFACE'S LANGUAGE, CARRIED TO THE SERVER. A request says the language its sender's
 * interface speaks, so the server reads a note's old Scripture references in the Bible of the
 * person who wrote them (`scriptureReferenceNumbering.ts`, `noteLanguage`) — the owner, 2026-10-17:
 * "a Ukrainian interface — the Ukrainian Bible". The browser keeps it in its cookie (written on every
 * change of the language); where it is not known, nothing is said and the server reads as before.
 */
export const APP_LANGUAGE_HEADER = 'x-app-language';

/**
 * The interface's language in this browser: its cookie, and English without one — the interface starts
 * in the language the cookie names and in English when there is none (`locales/i18n.ts`,
 * `LanguageInitializer`), so the server reads as the screen does. Nothing outside a browser.
 */
export function browserInterfaceLanguage(): AppLocale | undefined {
  if (typeof document === 'undefined') return undefined;
  const value = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_LANG_KEY}=([^;]+)`))?.[1];
  return resolveAppLocale(value ?? DEFAULT_LANGUAGE);
}

/** The interface's language a request carried, or nothing when it carried none. */
export function requestLanguage(request: { headers?: Pick<Headers, 'get'> }): AppLocale | undefined {
  const value = request.headers?.get?.(APP_LANGUAGE_HEADER);
  return value ? resolveAppLocale(value) : undefined;
}

/**
 * The language a piece of text is written in, read off its letters: ї, і, є, ґ belong to
 * Ukrainian alone, any other Cyrillic reads as Russian, everything else as English. For text
 * that reaches a reader without the interface around it — a link's preview card, a reference
 * pulled out of dictated prose — this is the only language signal there is.
 */
export function detectTextLocale(text: string): AppLocale {
  if (/[іїєґ]/iu.test(text)) return 'uk';
  if (/[а-яё]/iu.test(text)) return 'ru';
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
  const title = formatMonthName(date, dateLocale);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * The same standalone month inside a sentence, in the language's own case: "за август 2026",
 * "in August 2026". Russian and Ukrainian months are masculine and inanimate, so this form is
 * also what "за" asks for; "в" would need the prepositional ("в августе"), which date-fns
 * does not have — templates put the month after "за", never after "в".
 */
export function formatMonthName(date: Date, dateLocale: Locale): string {
  return format(date, 'LLLL yyyy', { locale: dateLocale });
}
