'use client';

import { useMemo } from 'react';
import { enUS as dayPickerEnUS, ru as dayPickerRu, uk as dayPickerUk } from 'react-day-picker/locale';
import { useTranslation } from 'react-i18next';

import { dateFnsLocaleFor, resolveAppLocale, type AppLocale } from '@/utils/appLocale';

import type { Locale } from 'date-fns';
import type { DayPickerProps } from 'react-day-picker';

type DayPickerLocale = NonNullable<DayPickerProps['locale']>;

/**
 * A date-fns locale says months and weekdays; react-day-picker's own locale adds what its buttons and
 * cells say to a screen reader ("Go to the Next Month", "Today, …, selected"), which a date-fns locale
 * does not carry, so a calendar given one spoke English (BUG-20261006-library-screen-reader-words-english).
 */
const DAY_PICKER_LOCALES: Record<AppLocale, DayPickerLocale> = { en: dayPickerEnUS, ru: dayPickerRu, uk: dayPickerUk };

/**
 * The interface language for a component: the app's own code for it, the date-fns locale
 * that names months and weekdays in it, and the calendar's (`<DayPicker locale>`) that also words
 * its labels. One hook, so a screen cannot pick one from the language and another from elsewhere.
 */
export function useAppLocale(): { locale: AppLocale; dateLocale: Locale; dayPickerLocale: DayPickerLocale } {
  const { i18n } = useTranslation();
  const language = i18n?.language;
  return useMemo(
    () => {
      const locale = resolveAppLocale(language);
      return { locale, dateLocale: dateFnsLocaleFor(language), dayPickerLocale: DAY_PICKER_LOCALES[locale] };
    },
    [language]
  );
}

export default useAppLocale;
