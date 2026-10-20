'use client';

import { useServerUnavailableNotice } from '@/hooks/useServerUnavailableNotice';
import { sayFailure, withoutServerReadNotice, type FailureWords } from '@/utils/actionFailureMessage';
import { useTranslation } from '@locales/useTranslation';

/** Format a notification; data hooks retain their failure facts independently of this sentence. */
export function useFailureNotice() {
  const { t } = useTranslation();
  const serverUnavailable = useServerUnavailableNotice();
  return (words: FailureWords | null | undefined, fallback: string | null = null): string | null => {
    if (!words) return fallback;
    const shown = serverUnavailable ? withoutServerReadNotice(words) : words;
    return shown ? sayFailure(shown, t) : null;
  };
}
