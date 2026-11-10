'use client';

import { useMemo } from 'react';

import { useCouncilsRead } from '@/hooks/useCouncilsRead';
import { councilEntries } from '@/utils/calendarEntries';

/**
 * THE COUNCILS, AS THE CALENDAR NEEDS THEM.
 *
 * No second road to the database: the section's own hook already holds every council with its
 * unsaved edits and its shared write queue, so the calendar borrows that list and translates it.
 * A council renamed on the council page therefore changes in the calendar at once, with nothing
 * to refetch and nothing to keep in step.
 */
export function useCalendarCouncils() {
  const { councils, loading, complete, checking, error } = useCouncilsRead();
  const entries = useMemo(() => councilEntries(councils), [councils]);
  return { entries, isLoading: loading, complete, checking, error };
}
