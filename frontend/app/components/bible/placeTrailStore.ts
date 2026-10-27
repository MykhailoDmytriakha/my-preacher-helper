import { recordDiagnostic } from '@/utils/appDiagnostics';
import { wayBackPath } from '@/utils/bibleLink';
import { isBibleId } from '@/utils/bibles';
import { deviceChoice } from '@/utils/deviceChoice';
import {
  arriveAt,
  DEFAULT_TRAIL_LIMITS,
  EMPTY_TRAIL,
  keepWithin,
  leaveAt,
  TRAIL_HISTORY_CHOICES,
  TRAIL_RECENT_CHOICES,
  type Trail,
  type TrailLimits,
  type TrailPlace,
} from '@/utils/placeTrail';

/*
 * THE TRAIL OF PLACES ON THIS DEVICE (`utils/placeTrail.ts` is its rule): the links themselves, whether
 * the reader shows them, and the two numbers the settings set — how many places to keep and how many of
 * the last ones are recent. Both records live on the device, as the trail itself does: nothing is written
 * to the account on a move through the Bible (the owner, 2026-10-20). They are device choices
 * (`utils/deviceChoice.ts`): held in the page's memory and written through, so a device that refuses to
 * store keeps the trail for the visit.
 */
export type TrailPrefs = TrailLimits & {
  /** The trail under the reader's line (or above the phone's bar); hidden, its button still counts the links. */
  shown: boolean;
  /** The column of a wide reader shows the first words of each place's verse under it (the owner, 2026-10-26). */
  verseStart: boolean;
};

export const DEFAULT_TRAIL_PREFS: TrailPrefs = { ...DEFAULT_TRAIL_LIMITS, shown: false, verseStart: false };

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

function isTrailPlace(value: unknown): value is TrailPlace {
  if (!value || typeof value !== 'object') return false;
  const place = value as Partial<TrailPlace>;
  return typeof place.book === 'string' && isCount(place.chapter) && isCount(place.verse) && isBibleId(place.bible);
}

function parseTrail(raw: string | null): Trail {
  if (!raw) return EMPTY_TRAIL;
  try {
    const value = JSON.parse(raw) as { links?: unknown; at?: unknown };
    // A screen kept with a link is a path of this app, or nothing: the way back never leaves the app.
    const links = (Array.isArray(value.links) ? value.links.filter(isTrailPlace) : []).map(({ screen, ...place }) => {
      const path = typeof screen === 'string' ? wayBackPath(screen) : null;
      return path ? { ...place, screen: path } : place;
    });
    if (links.length === 0) return EMPTY_TRAIL;
    const at = typeof value.at === 'number' && Number.isInteger(value.at) && value.at >= 0 && value.at < links.length ? value.at : links.length - 1;
    return { links, at };
  } catch {
    return EMPTY_TRAIL;
  }
}

function parsePrefs(raw: string | null): TrailPrefs {
  if (!raw) return DEFAULT_TRAIL_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<TrailPrefs>;
    return {
      shown: typeof value.shown === 'boolean' ? value.shown : DEFAULT_TRAIL_PREFS.shown,
      verseStart: typeof value.verseStart === 'boolean' ? value.verseStart : DEFAULT_TRAIL_PREFS.verseStart,
      history: (TRAIL_HISTORY_CHOICES as readonly number[]).includes(value.history as number) ? value.history as number : DEFAULT_TRAIL_PREFS.history,
      recent: (TRAIL_RECENT_CHOICES as readonly number[]).includes(value.recent as number) ? value.recent as number : DEFAULT_TRAIL_PREFS.recent,
    };
  } catch {
    return DEFAULT_TRAIL_PREFS;
  }
}

const trailChoice = deviceChoice<Trail>({ key: 'bible:place-trail', parse: parseTrail, fallback: EMPTY_TRAIL });
const prefsChoice = deviceChoice<TrailPrefs>({
  key: 'bible:place-trail-prefs',
  parse: parsePrefs,
  fallback: DEFAULT_TRAIL_PREFS,
  onOtherTab: () => recordDiagnostic('setting', { source: 'other-tab', code: 'placeTrail' }),
});

const write = (next: Trail) => {
  if (next !== trailChoice.read()) trailChoice.save({ links: next.links, at: next.at });
};

/**
 * The place this page's reader last put on the trail: the way back goes from that link — the reader's own —
 * not from whichever link another tab of the app lit since (the trail is shared by the tabs of the device).
 */
let own: TrailPlace | null = null;

/** The person came to a verse or did something with it (a link followed, a book or chapter chosen, Back, a link of the trail, a mark, a copy). */
export function arriveOnTrail(place: TrailPlace): void {
  switching = null;
  own = place;
  write(arriveAt(trailChoice.read(), place, prefsChoice.read()));
}

/** The place this page's reader last put on the trail — where the way back goes from. */
export function ownTrailPlace(): TrailPlace | null {
  return own;
}

/** The way back: the light steps onto the link at `index`; the reader then opens its place, which arrives there. */
export function stepOnTrail(index: number): void {
  const trail = trailChoice.read();
  if (index >= 0 && index < trail.links.length && index !== trail.at) trailChoice.save({ links: trail.links, at: index });
}

/**
 * A change of translation reopens the reader at the same place: that opening is no arrival (the owner, 2026-10-27:
 * the trail follows moves and acts). The reader says so before it asks the page for the other Bible, and the next
 * opening of that book takes the word back (Codex review, 2026-10-27: guessed from the place's stored Bible, a
 * switch back added the place, and Back from another book was taken for a switch).
 */
let switching: string | null = null;
export function changeTranslationOnTrail(book: string): void {
  switching = book;
}
/**
 * The book opens for a change of translation; the word is taken back either way. No clock: a slow load and its retry
 * still open for the change (Codex review r3, 2026-10-27), and any other move on the trail first takes the word back.
 */
export function openedForTranslation(book: string): boolean {
  const was = switching === book;
  switching = null;
  return was;
}

/** The person leaves the verse they stopped at (`leaveAt`): it joins the trail, the light stays. */
export function leaveOnTrail(place: TrailPlace): void {
  switching = null;
  write(leaveAt(trailChoice.read(), place, prefsChoice.read()));
}

/** Where a change came from, for the technical details a feedback report sends. */
export type TrailPrefsSource = 'reader' | 'list' | 'settings';

// The diagnostics keep letters and hyphens only (`appDiagnostics` `safeData`): a number goes as a word.
const NUMBER_WORDS: Record<number, string> = { 5: 'five', 7: 'seven', 10: 'ten', 30: 'thirty', 50: 'fifty', 100: 'hundred' };
const said = (value: unknown) => (typeof value === 'boolean' ? (value ? 'on' : 'off') : NUMBER_WORDS[value as number] ?? 'other');

export function saveTrailPrefs(change: Partial<TrailPrefs>, from: TrailPrefsSource): void {
  const saved = prefsChoice.save(change);
  if (change.history !== undefined) write(keepWithin(trailChoice.read(), prefsChoice.read().history));
  Object.entries(change).forEach(([name, value]) => recordDiagnostic('setting', {
    source: from, code: `placeTrail-${name}`, result: saved === 'kept' ? said(value) : `${said(value)}-${saved}`,
  }));
}

export function usePlaceTrail(): Trail {
  return trailChoice.useChoice();
}

export function useTrailPrefs(): TrailPrefs {
  return prefsChoice.useChoice();
}

export function readPlaceTrail(): Trail {
  return trailChoice.read();
}

export function resetPlaceTrailForTests(): void {
  switching = null;
  own = null;
  trailChoice.resetForTests();
  prefsChoice.resetForTests();
}
