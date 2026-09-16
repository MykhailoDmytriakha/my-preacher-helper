import { councilProgress, topicPreview } from '@/utils/council';
import { toDateOnlyKey, toLocalDateOnlyKey } from '@/utils/dateOnly';
import { getEffectivePreachDateStatus } from '@/utils/preachDateStatus';
import { formatScriptureRefs } from '@/utils/writeRecovery';

import type { Council, Group, PrayerRequest, Sermon, StudyNote } from '@/models/models';

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
export const CALENDAR_KINDS = ['sermon', 'group', 'council', 'note', 'prayer'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/**
 * How a thing stands on its day: a sermon is planned or preached, a council is ahead or held. A
 * note or a prayer that is on the calendar a second time says why: it was updated, or answered.
 */
export type CalendarEntryStatus = 'planned' | 'preached' | 'preparing' | 'held' | 'updated' | 'answered';

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

/** How many passages a day card previews under a note's title — the dashboard's number. */
const NOTE_REFERENCE_PREVIEW = 2;

/** The words a builder needs and cannot know: they belong to the language, not to the data. */
export interface NoteEntryWords {
  /** What to call a note that has no title and no Scripture to be named by. */
  untitled: string;
}

/**
 * A NOTE APPEARS ON THE DAY IT WAS WRITTEN AND, IF LATER, ON THE DAY IT WAS LAST TOUCHED.
 *
 * It has no day of its own the way a sermon has a preach date; what it has is the stamps the
 * clock left on it, and the owner asked for both. One day carries one card: a note written and
 * edited on the same day is simply "written that day", and the first event keeps the day —
 * otherwise nearly every note would read "updated" on the very day it was born, because that is
 * when notes get edited. Only the second appearance carries a status, so the reader knows why the
 * same note stands on the calendar twice.
 *
 * The stamps are instants, so the day is the person's own (`toLocalDateOnlyKey`), not the UTC
 * prefix that would put an evening's work on tomorrow. The title falls back the way the
 * dashboard's does: title, then the first Scripture reference, then a word for "untitled" that
 * the caller passes in, because this module speaks no language. The passages under the title are
 * a preview and stop at two, as they do in the dashboard's study panel: a note gathering seven
 * of them would otherwise put a wall of chapter numbers on a day card.
 */
export function noteEntries(notes: StudyNote[], words: NoteEntryWords): CalendarEntry[] {
  return notes.flatMap((note) => {
    const written = toLocalDateOnlyKey(note.createdAt);
    if (!written) return [];
    const ownTitle = note.title?.trim();
    const references = formatScriptureRefs(note.scriptureRefs?.slice(0, NOTE_REFERENCE_PREVIEW));
    const base = {
      kind: 'note' as const,
      refId: note.id,
      title: ownTitle || formatScriptureRefs(note.scriptureRefs?.slice(0, 1)) || words.untitled,
      href: `/studies/${note.id}`,
      // The references sit under a title of the note's own; under a title that IS the reference
      // they would only repeat it.
      ...(ownTitle && references ? { subtitle: references } : {}),
    };
    const entries: CalendarEntry[] = [{ ...base, id: `note-${note.id}-written`, date: written }];
    const touched = toLocalDateOnlyKey(note.updatedAt);
    if (touched && touched > written) {
      entries.push({ ...base, id: `note-${note.id}-updated`, date: touched, status: 'updated' });
    }
    return entries;
  });
}

/** The first paragraph of a text — what a card can carry without becoming the text itself. */
const firstParagraph = (text: string | undefined): string | undefined => {
  const paragraph = text?.split(/\n\s*\n/)[0]?.trim();
  return paragraph || undefined;
};

/**
 * A PRAYER APPEARS ON THE DAY IT WAS BROUGHT AND, ONCE ANSWERED, ON THE DAY OF THE ANSWER.
 *
 * The same rule as a note: one card per day, the first event keeps a shared day, and only the
 * second appearance says why it is there. The answer counts only while the prayer still stands
 * answered — an `answeredAt` left behind by a prayer moved back to active is history, not a day.
 * The updates written along the way stay inside the prayer: every one of them as a dot would turn
 * the calendar into the prayer's own journal.
 */
export function prayerEntries(prayers: PrayerRequest[]): CalendarEntry[] {
  return prayers.flatMap((prayer) => {
    const brought = toLocalDateOnlyKey(prayer.createdAt);
    if (!brought) return [];
    const subtitle = firstParagraph(prayer.description);
    const base = {
      kind: 'prayer' as const,
      refId: prayer.id,
      title: prayer.title,
      href: `/prayers/${prayer.id}`,
      ...(subtitle ? { subtitle } : {}),
    };
    const entries: CalendarEntry[] = [{ ...base, id: `prayer-${prayer.id}-brought`, date: brought }];
    const answered = prayer.status === 'answered' ? toLocalDateOnlyKey(prayer.answeredAt) : null;
    if (answered && answered > brought) {
      entries.push({ ...base, id: `prayer-${prayer.id}-answered`, date: answered, status: 'answered' });
    }
    return entries;
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
