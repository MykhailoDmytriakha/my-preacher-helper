'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useStudyNotes } from '@/hooks/useStudyNotes';
import { noteEntries, type CalendarEntry } from '@/utils/calendarEntries';

/**
 * THE STUDY NOTES, AS THE CALENDAR NEEDS THEM.
 *
 * No second road to the database: the studies section's own hook already holds every note with
 * its pending edits, so the calendar borrows that list and translates it — the same arrangement
 * the councils have. The one thing the translation cannot know is what to call a note with no
 * name, and that word comes from the language, not from the data.
 */
export function useCalendarNotes(): {
  entries: CalendarEntry[];
  isLoading: boolean;
  error: unknown;
} {
  const { t } = useTranslation();
  const { notes, loading, error } = useStudyNotes();
  const untitled = t('dashboardHome.sections.studies.untitled');
  const entries = useMemo(() => noteEntries(notes, { untitled }), [notes, untitled]);
  return { entries, isLoading: loading, error };
}
