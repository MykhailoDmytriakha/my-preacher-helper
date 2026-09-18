'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { dateFnsLocaleFor, resolveAppLocale, type AppLocale } from '@/utils/appLocale';

import type { Locale } from 'date-fns';

/**
 * The interface language for a component: the app's own code for it, and the date-fns locale
 * that names months and weekdays in it. One hook, so a screen cannot pick one from the
 * language and the other from somewhere else.
 */
export function useAppLocale(): { locale: AppLocale; dateLocale: Locale } {
  const { i18n } = useTranslation();
  const language = i18n?.language;
  return useMemo(
    () => ({ locale: resolveAppLocale(language), dateLocale: dateFnsLocaleFor(language) }),
    [language]
  );
}

export default useAppLocale;
