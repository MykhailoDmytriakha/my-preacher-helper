'use client';

import { useMemo } from 'react';

import { useCouncils } from '@/hooks/useCouncils';
import { councilEntries, type CalendarEntry } from '@/utils/calendarEntries';

/**
 * THE COUNCILS, AS THE CALENDAR NEEDS THEM.
 *
 * No second road to the database: the section's own hook already holds every council with its
 * unsaved edits and its shared write queue, so the calendar borrows that list and translates it.
 * A council renamed on the council page therefore changes in the calendar at once, with nothing
 * to refetch and nothing to keep in step.
 */
export function useCalendarCouncils(): {
  entries: CalendarEntry[];
  isLoading: boolean;
  error: unknown;
} {
  const { councils, loading, error } = useCouncils();
  const entries = useMemo(() => councilEntries(councils), [councils]);
  return { entries, isLoading: loading, error };
}
