'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UsageCapDialog from '@/components/usage/UsageCapDialog';
import { USER_ENTITLEMENT_QUERY_KEY } from '@/hooks/useUserEntitlement';
import { subscribeToUsageClientEvents } from '@/services/usageCapClient';
import { getDeterministicVerse, normalizeGraceVerses } from '@/utils/usageGrace';

import type { UsageResource } from '@/services/usageLimits';

interface CapAnnouncement {
  resource: UsageResource;
  resetsAt: string;
}

export default function UsageCapGlobalHandler() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['translation', 'graceVerses']);
  const [announcement, setAnnouncement] = useState<CapAnnouncement | null>(null);

  useEffect(() => subscribeToUsageClientEvents((event) => {
    void queryClient.invalidateQueries({ queryKey: USER_ENTITLEMENT_QUERY_KEY });
    if (event.type !== 'cap-reached') return;
    // Being refused stops the person mid-sentence, so it is shown until it is read — the
    // toast this used to be was stacked under another one and timed out unnoticed.
    setAnnouncement({ resource: event.error.resource, resetsAt: event.error.resetsAt });
  }), [queryClient]);

  if (!announcement) return null;

  const verses = normalizeGraceVerses(t('graceVerses:verses', { returnObjects: true }));
  const resourceCounter = announcement.resource === 'ai'
    ? 1
    : announcement.resource === 'transcription' ? 2 : 3;

  return (
    <UsageCapDialog
      open
      onClose={() => setAnnouncement(null)}
      resetsAt={announcement.resetsAt}
      resource={announcement.resource}
      verse={getDeterministicVerse(verses, announcement.resetsAt, resourceCounter)}
    />
  );
}
