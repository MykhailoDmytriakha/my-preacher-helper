import { placesIn } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';

/*
 * THE TRAIL OF PLACES — the verses the person came to or did something with, one link a verse (the owner,
 * 2026-10-20, case 2026-10-12-block-diagram, 2.12; the points, 2026-10-27, L11). A link is made by a move to a
 * place — a book opened at 1:1, a chapter at its first verse, a verse chosen, a search result, a link followed —
 * and by an act on a verse: a mark, a copy, a send, its links opened, its menu. Reading — a scroll — makes none
 * and moves none: where the person stopped joins the trail when they leave it (`leaveAt`). Coming to a verse
 * among the last few links — the recent ones — only moves the light there; any other verse, new or seen longer
 * ago, joins the end. Going back and forth between a few verses never grows the trail. Which links are recent
 * is this rule's own business: on screen every link looks the same.
 */

/**
 * A verse read, in the Bible that numbers it. `screen` — the screen of the app the place was opened from
 * (a note's reference): it stands left of this link, so the way back from here goes there.
 */
export type TrailPlace = { book: string; chapter: number; verse: number; bible: BibleId; screen?: string };

/** The place keeps the screen its link was opened from, unless it brings one of its own. */
const carry = (place: TrailPlace, link: TrailPlace): TrailPlace => (place.screen || !link.screen ? place : { ...place, screen: link.screen });

/** The links, oldest first, and which of them is being read (-1 — none yet). */
export type Trail = { links: TrailPlace[]; at: number };

/** How many places the trail keeps, and how many of the last ones count as recent. */
export type TrailLimits = { history: number; recent: number };

export const EMPTY_TRAIL: Trail = { links: [], at: -1 };
export const TRAIL_HISTORY_CHOICES = [10, 30, 50, 100] as const;
export const TRAIL_RECENT_CHOICES = [5, 7, 10] as const;
export const DEFAULT_TRAIL_LIMITS: TrailLimits = { history: 30, recent: 7 };

/** `place` is among the verses `of` covers in `place`'s Bible. */
const covers = (of: TrailPlace, place: TrailPlace) => placesIn(place.bible, of.bible, { book: of.book, chapter: of.chapter, verse: of.verse })
  .some((found) => found.chapter === place.chapter && found.verse === place.verse);

/**
 * One place: the same verse, whichever Bible numbers it (Psalm 23:1 of the King James is Psalm 22:1 of the Synodal).
 * Either way round: where one Bible joins two verses into one (King James Acts 19:40–41, Synodal 19:40), each of
 * the two is that one (Codex review, 2026-10-27: mapped one way only, a kept 19:41 and a new 19:40 were two links).
 */
export function sameVerse(a: TrailPlace, b: TrailPlace): boolean {
  if (a.book !== b.book) return false;
  if (a.bible === b.bible) return a.chapter === b.chapter && a.verse === b.verse;
  return covers(b, a) || covers(a, b);
}

/** Among the recent links, from the newest: the one holding `place`, or -1. */
function recentLink(trail: Trail, place: TrailPlace, limits: TrailLimits): number {
  const from = Math.max(0, trail.links.length - Math.max(1, limits.recent));
  for (let index = trail.links.length - 1; index >= from; index -= 1) if (sameVerse(trail.links[index], place)) return index;
  return -1;
}

/**
 * The person came to a place: the light moves to it among the recent links, or it joins the end. The
 * place the light is already on is that link, however long ago it was added — the way back steps the
 * light onto an older link first and then opens its place (the owner, 2026-10-20: "←" goes left along
 * the trail).
 */
export function arriveAt(trail: Trail, place: TrailPlace, limits: TrailLimits): Trail {
  const lit = trail.links[trail.at];
  if (lit && sameVerse(lit, place)) return { links: replaced(trail.links, trail.at, carry(place, lit)), at: trail.at };
  const recent = recentLink(trail, place, limits);
  if (recent >= 0) return { links: replaced(trail.links, recent, carry(place, trail.links[recent])), at: recent };
  return keepWithin({ links: [...trail.links, place], at: trail.links.length }, limits.history);
}

/**
 * The person leaves the verse they stopped at — for another place, the way back, another screen (the owner,
 * 2026-10-27: «если вышли, то он уже попадёт в историю, как тот, где ты остановился»). Not yet on the trail
 * among the recent links, it joins the end; the light stays where it was, so the way back still goes from the
 * place the person came to.
 */
export function leaveAt(trail: Trail, place: TrailPlace, limits: TrailLimits): Trail {
  const lit = trail.links[trail.at];
  if ((lit && sameVerse(lit, place)) || recentLink(trail, place, limits) >= 0) return trail;
  const at = trail.at < 0 ? trail.links.length : trail.at;
  return keepWithin({ links: [...trail.links, place], at }, limits.history);
}

/**
 * The verses an act on several verses leaves on the trail: one a run of verses that follow each other — its
 * first — in the order the runs were chosen (the owner, 2026-10-27: 9:10 chosen, then 7:10–12, then 8:13 leave
 * 9:10, 7:10, 8:13).
 */
export function actedVerses<T extends { chapter: number; verse: number }>(
  verses: readonly T[],
  /** How many verses a chapter has: a chapter's last verse and the next one's first are one run (Ruth 1:22–2:1). */
  chapterLength?: (chapter: number) => number | undefined
): T[] {
  const firstChosen = new Map<string, number>();
  verses.forEach((verse, index) => {
    const key = `${verse.chapter}:${verse.verse}`;
    if (!firstChosen.has(key)) firstChosen.set(key, index);
  });
  const ordered = [...verses]
    .filter((verse, index) => firstChosen.get(`${verse.chapter}:${verse.verse}`) === index)
    .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
  const runs: T[][] = [];
  for (const verse of ordered) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    const follows = last && (last.chapter === verse.chapter
      ? last.verse + 1 === verse.verse
      : last.chapter + 1 === verse.chapter && verse.verse === 1 && chapterLength?.(last.chapter) === last.verse);
    if (follows) run.push(verse);
    else runs.push([verse]);
  }
  const chosenAt = (run: T[]) => Math.min(...run.map((verse) => firstChosen.get(`${verse.chapter}:${verse.verse}`) ?? 0));
  return runs.sort((a, b) => chosenAt(a) - chosenAt(b)).map((run) => run[0]);
}

function findLast(links: TrailPlace[], match: (link: TrailPlace) => boolean, otherwise: number): number {
  for (let index = links.length - 1; index >= 0; index -= 1) if (match(links[index])) return index;
  return otherwise;
}

/** The first and the last verse on the screen, in the Bible being read. */
export type SeenVerses = { first: { chapter: number; verse: number }; last: { chapter: number; verse: number } };

const before = (a: { chapter: number; verse: number }, b: { chapter: number; verse: number }) => a.chapter < b.chapter || (a.chapter === b.chapter && a.verse < b.verse);

/**
 * A link's verse is on the screen of `book` read in `bible` — any verse it covers there: Synodal Acts 19:40 is King
 * James 19:40–41, and the link stays lit while 19:41 is read (Codex review, 2026-10-27).
 */
export function linkOnScreen(link: TrailPlace | null | undefined, book: string, seen: SeenVerses | null, bible: BibleId): boolean {
  if (!link || !seen || link.book !== book) return false;
  const verses = link.bible === bible ? [link] : placesIn(bible, link.bible, { book: link.book, chapter: link.chapter, verse: link.verse });
  return verses.some((verse) => !before(verse, seen.first) && !before(seen.last, verse));
}

/**
 * The way back: the link left of the reader's own one (the link of the place the reader last put on the
 * trail — the lit one, else the last holding its verse); -1 — the reader's link is the first, or not on the trail.
 */
export function linkBefore(trail: Trail, here: TrailPlace): number {
  const own = ownLink(trail, here);
  return own > 0 ? own - 1 : -1;
}

/** The reader's own link: the lit one when it holds the reader's place, else the last holding it; -1 — none. */
export function ownLink(trail: Trail, here: TrailPlace): number {
  const lit = trail.links[trail.at];
  return lit && sameVerse(lit, here) ? trail.at : findLast(trail.links, (link) => sameVerse(link, here), -1);
}

/**
 * Where the light stands among the links: which link is lit, and the place of every other one. It changes
 * when the light goes to another link (a recent verse, "←", another tab) or the links shift (a verse added,
 * the oldest gone); it stays otherwise. A column or a row brings the lit link into view on this key, so a list
 * the person scrolled stays put while they read (Codex review, 2026-10-26: the column jumped back to the top).
 */
export function litLinkKey(trail: Trail): string {
  return `${trail.at}|${trail.links.map((link, index) => (index === trail.at ? '*' : `${link.bible}:${link.book}:${link.chapter}:${link.verse}`)).join('|')}`;
}

/** No more than `history` links: the oldest leave first, the one being read never does. */
export function keepWithin(trail: Trail, history: number): Trail {
  const limit = Math.max(1, history);
  let { links, at } = trail;
  while (links.length > limit) {
    const leaving = at === 0 ? 1 : 0;
    links = links.filter((_, index) => index !== leaving);
    if (leaving < at) at -= 1;
  }
  return links === trail.links ? trail : { links, at };
}

function replaced(links: TrailPlace[], index: number, place: TrailPlace): TrailPlace[] {
  const next = links.slice();
  next[index] = place;
  return next;
}
