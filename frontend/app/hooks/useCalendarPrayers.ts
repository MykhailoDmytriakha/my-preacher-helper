'use client';

import { useMemo } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { prayerEntries } from '@/utils/calendarEntries';

/**
 * THE PRAYERS, AS THE CALENDAR NEEDS THEM — borrowed from the prayer journal's own hook and
 * translated, so a prayer answered on its page moves on the calendar at once, with nothing to
 * refetch and nothing to keep in step.
 */
export function useCalendarPrayers() {
  const { user } = useAuth();
  const { prayerRequests, loading, complete, checking, error } = usePrayerRequests(user?.uid ?? null);
  const entries = useMemo(() => prayerEntries(prayerRequests), [prayerRequests]);
  return { entries, isLoading: loading, complete, checking, error };
}
