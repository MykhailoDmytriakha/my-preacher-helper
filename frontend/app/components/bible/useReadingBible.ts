import { useCallback, useEffect, useRef, useState } from 'react';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useUserSettingsQuery } from '@/hooks/useUserSettings';
import { readLanguageCookie } from '@/services/userSettings.service';
import { APP_LOCALES, resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { bibleForLocale, type BibleId } from '@/utils/bibles';
import { useTranslation } from '@locales/useTranslation';

import { readStoredTranslation, saveTranslation } from './translation';

const knownLocale = (value: unknown): AppLocale | null =>
  typeof value === 'string' && APP_LOCALES.includes(value as AppLocale) ? value as AppLocale : null;

/** Own first-choice readiness and the existing follow-language/manual-choice policy. */
export function useReadingBible(needsKnownNumbering: boolean, requestedBible?: BibleId, { persistRequested = true }: { persistRequested?: boolean } = {}) {
  const { language } = useTranslation();
  const locale = resolveAppLocale(language);
  const { uid, isAuthLoading } = useResolvedUid();
  const settings = useUserSettingsQuery(needsKnownNumbering ? uid : null);
  const profileLanguage = settings.data?.language;
  const loading = settings.isLoading;
  const online = settings.isOnline;
  const failed = Boolean(settings.error);
  const [bible, setBible] = useState<BibleId | null>(requestedBible ?? null);
  const chosen = useRef<BibleId | null>(null);
  const initialized = useRef(false);
  const previousLocale = useRef(locale);
  const previousRequest = useRef<string | undefined>(undefined);

  useEffect(() => {
    const languageChanged = previousLocale.current !== locale;
    previousLocale.current = locale;
    // A recovery link is an explicit visit to marks on this translation's words. Apply once per
    // arrival; retaining the URL must not undo a later deliberate picker choice.
    const requestKey = requestedBible ? `${requestedBible}:${persistRequested}` : undefined;
    if (requestedBible && previousRequest.current !== requestKey) {
      chosen.current = requestedBible;
      // An analysis visit follows its own words without changing the device's usual Bible.
      if (persistRequested) saveTranslation(requestedBible);
    }
    previousRequest.current = requestKey;
    const saved = chosen.current ?? readStoredTranslation();
    if (saved) {
      initialized.current = true;
      setBible(saved);
      return;
    }
    if (!initialized.current) {
      const profile = knownLocale(profileLanguage);
      // A cookie can belong to an earlier interface language. While connected, let the owner
      // profile answer first; offline, the known device language remains available immediately.
      const pendingProfile = isAuthLoading || (uid && loading && !failed && online);
      if (needsKnownNumbering && !profile && pendingProfile) return;
      const known = profile ?? knownLocale(readLanguageCookie());
      // Settings data may precede i18n publication. Use that known initial language,
      // then react only to actual later language changes, not another render of the old default.
      initialized.current = true;
      setBible(bibleForLocale(known ?? locale));
      return;
    }
    if (languageChanged) setBible(bibleForLocale(locale));
  }, [failed, isAuthLoading, loading, locale, needsKnownNumbering, online, persistRequested, profileLanguage, requestedBible, uid]);

  const changeBible = useCallback((next: BibleId) => {
    chosen.current = next;
    initialized.current = true;
    saveTranslation(next);
    setBible(next);
  }, []);

  return { bible, changeBible };
}
