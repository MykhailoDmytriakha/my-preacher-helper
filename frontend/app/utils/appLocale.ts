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
 * The language a piece of text is written in, when its letters say it: Latin against Cyrillic, and
 * within Cyrillic the letters Ukrainian alone has (і, ї, є, ґ) against those Russian alone has
 * (ы, э, ъ, ё). The larger share wins, so a typo or a quoted word does not turn a text (the owner,
 * 2026-10-20: "how do you know it is not a typo?"). Null where they do not say — Cyrillic with none
 * of those letters, or no letters at all.
 */
export function textLanguage(text: string): AppLocale | null {
  // Only the words: an address, a link's target or code is not the language of the text around it.
  const words = text.replace(/\]\([^)]*\)/g, ']').replace(/`[^`]*`/g, ' ').replace(/(?:https?:\/\/|www\.)\S+/giu, ' ');
  const count = (letters: RegExp) => words.match(letters)?.length ?? 0;
  const cyrillic = count(/\p{Script=Cyrillic}/gu);
  if (count(/\p{Script=Latin}/gu) > cyrillic) return 'en';
  if (!cyrillic) return null;
  const ukrainian = count(/[іїєґ]/giu);
  const russian = count(/[ыэъё]/giu);
  return ukrainian === russian ? null : ukrainian > russian ? 'uk' : 'ru';
}

/**
 * The language of a text for whoever must name one: `textLanguage`, and where the letters do not
 * say, Russian for Cyrillic and English for the rest. For text that reaches a reader without the
 * interface around it — a link's preview card, a reference pulled out of dictated prose — this is
 * the only language signal there is.
 */
export function detectTextLocale(text: string): AppLocale {
  return textLanguage(text) ?? (/\p{Script=Cyrillic}/u.test(text) ? 'ru' : 'en');
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
