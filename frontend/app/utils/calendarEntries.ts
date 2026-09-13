import { councilProgress, topicPreview } from '@/utils/council';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getEffectivePreachDateStatus } from '@/utils/preachDateStatus';

import type { Council, Group, Sermon } from '@/models/models';

/**
 * ONE SHAPE FOR EVERYTHING THE CALENDAR SHOWS.
 *
 * The calendar began with sermons, then grew groups, and each was carried through the screens as
 * its own type: two unions, two `flatMap`s, and a `kind === 'sermon' ? … : …` in front of every
 * field, twice over in two components. A third thing to show — the brothers' council — would have
 * turned each of those ternaries into a nested one, and the day cell was already deciding "not a
 * sermon, therefore a group", which a third kind quietly breaks.
 *
 * So the sources are translated ONCE, here, into a single entry the screens can render without
 * knowing where it came from. Adding a fourth section to the calendar is then a builder and a
 * line of configuration, not a pass through every view.
 *
 * Pure: no React, no network. What each kind LOOKS like — its colour, its icon, its words — is a
 * view decision and lives in `components/calendar/calendarKinds.tsx`.
 */
export const CALENDAR_KINDS = ['sermon', 'group', 'council'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** How a thing stands on its day: a sermon is planned or preached, a council is ahead or held. */
export type CalendarEntryStatus = 'planned' | 'preached' | 'preparing' | 'held';

export interface CalendarEntry {
  kind: CalendarKind;
  /** Unique across kinds and across the several dates one thing may have. */
  id: string;
  /** The thing itself, for looking up what it belongs to (a series, say). */
  refId: string;
  /** YYYY-MM-DD, the only date form this calendar speaks. */
  date: string;
  title: string;
  href: string;
  subtitle?: string;
  location?: string;
  audience?: string;
  outcome?: string;
  status?: CalendarEntryStatus;
  /**
   * WHAT THIS THING IS MADE OF, listed — a council's section headings today.
   *
   * A day answers "what do I have and what is it about", and for a council the agenda IS the
   * "about": its name alone sent the pastor out of the calendar to remember it. Absent when
   * there is nothing named yet, so a card never draws an empty block.
   */
  sections?: { titles: string[]; hidden: number };
  /** For a council: how many of its sections have an outcome. */
  progress?: { done: number; total: number };
}

export function sermonEntries(sermons: Sermon[]): CalendarEntry[] {
  return sermons.flatMap((sermon) =>
    (sermon.preachDates ?? []).flatMap((preachDate) => {
      const date = toDateOnlyKey(preachDate.date);
      if (!date) return [];
      const church = preachDate.church?.name
        ? `${preachDate.church.name}${preachDate.church.city ? `, ${preachDate.church.city}` : ''}`
        : undefined;
      return [
        {
          kind: 'sermon' as const,
          id: `sermon-${sermon.id}-${preachDate.id}`,
          refId: sermon.id,
          date,
          title: sermon.title,
          href: `/sermons/${sermon.id}`,
          subtitle: sermon.verse,
          location: church,
          audience: preachDate.audience,
          outcome: preachDate.outcome,
          status: getEffectivePreachDateStatus(preachDate, Boolean(sermon.isPreached)),
        },
      ];
    })
  );
}

export function groupEntries(groups: Group[]): CalendarEntry[] {
  return groups.flatMap((group) =>
    (group.meetingDates ?? []).flatMap((meetingDate) => {
      const date = toDateOnlyKey(meetingDate.date);
      if (!date) return [];
      return [
        {
          kind: 'group' as const,
          id: `group-${group.id}-${meetingDate.id}`,
          refId: group.id,
          date,
          title: group.title,
          href: `/groups/${group.id}`,
          subtitle: group.description,
          location: meetingDate.location,
          audience: meetingDate.audience,
          outcome: meetingDate.outcome,
        },
      ];
    })
  );
}

/**
 * A council appears on the day it is called for. One without a date is not hidden information —
 * it simply has no day yet, and a calendar has nowhere to put it; the section itself lists those.
 */
export function councilEntries(councils: Council[]): CalendarEntry[] {
  return councils.flatMap((council) => {
    const date = toDateOnlyKey(council.date);
    if (!date) return [];
    // The section's own rule for what counts as handled — not a second copy of it living here.
    const { done, total } = councilProgress(council);
    // The SAME rule the section's own list uses for how many headings a card carries, so the two
    // surfaces cannot drift into showing different amounts of the same council.
    const { topics, hidden } = topicPreview(council);
    const sections = { titles: topics.map((topic) => topic.title.trim()), hidden };
    return [
      {
        kind: 'council' as const,
        id: `council-${council.id}`,
        refId: council.id,
        date,
        title: council.title,
        href: `/care/council/${council.id}`,
        status: council.status === 'held' ? ('held' as const) : ('preparing' as const),
        progress: { done, total },
        ...(sections.titles.length > 0 ? { sections } : {}),
      },
    ];
  });
}

/** Everything that falls on each day, keyed by the day. */
export function entriesByDate(entries: CalendarEntry[]): Record<string, CalendarEntry[]> {
  return entries.reduce<Record<string, CalendarEntry[]>>((byDate, entry) => {
    (byDate[entry.date] ??= []).push(entry);
    return byDate;
  }, {});
}

/**
 * Which KINDS fall on each day — all the day cell needs to know to mark itself, and the reason it
 * no longer has to guess a kind by what a thing is missing.
 */
export function kindsByDate(entries: CalendarEntry[]): Record<string, CalendarKind[]> {
  const byDate = entries.reduce<Record<string, Set<CalendarKind>>>((acc, entry) => {
    (acc[entry.date] ??= new Set()).add(entry.kind);
    return acc;
  }, {});
  return Object.fromEntries(
    Object.entries(byDate).map(([date, kinds]) => [date, CALENDAR_KINDS.filter((kind) => kinds.has(kind))])
  );
}

export function countByKind(entries: CalendarEntry[]): Record<CalendarKind, number> {
  const counts = Object.fromEntries(CALENDAR_KINDS.map((kind) => [kind, 0])) as Record<CalendarKind, number>;
  entries.forEach((entry) => {
    counts[entry.kind] += 1;
  });
  return counts;
}

/** Only the entries that fall in one month, given as YYYY-MM. */
export function entriesInMonth(entries: CalendarEntry[], month: string): CalendarEntry[] {
  return entries.filter((entry) => entry.date.startsWith(month));
}

/** Newest first — the order both the month list and the agenda read in. */
export function byNewestFirst(a: CalendarEntry, b: CalendarEntry): number {
  return b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind);
}
