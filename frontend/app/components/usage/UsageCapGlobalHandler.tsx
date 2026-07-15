'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { USER_ENTITLEMENT_QUERY_KEY } from '@/hooks/useUserEntitlement';
import { subscribeToUsageClientEvents } from '@/services/usageCapClient';
import {
  formatUsageResetDate,
  getDeterministicVerse,
  normalizeGraceVerses,
} from '@/utils/usageGrace';

export default function UsageCapGlobalHandler() {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation(['translation', 'graceVerses']);

  useEffect(() => subscribeToUsageClientEvents((event) => {
    void queryClient.invalidateQueries({ queryKey: USER_ENTITLEMENT_QUERY_KEY });
    if (event.type !== 'cap-reached') return;

    const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
    const verses = normalizeGraceVerses(t('graceVerses:verses', { returnObjects: true }));
    const resourceCounter = event.error.resource === 'ai'
      ? 1
      : event.error.resource === 'transcription' ? 2 : 3;
    const verse = getDeterministicVerse(verses, event.error.resetsAt, resourceCounter);
    const description = [t('usageGrace.softExpansion'), verse].filter(Boolean).join(' ');

    toast(t('usageGrace.hardCap', {
      date: formatUsageResetDate(event.error.resetsAt, locale),
    }), {
      description,
      duration: 12_000,
      id: `usage-hard-cap:${event.error.resource}:${event.error.resetsAt}`,
    });
  }), [i18n.language, i18n.resolvedLanguage, queryClient, t]);

  return null;
}
