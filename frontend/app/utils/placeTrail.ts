import { placeIn } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';

/*
 * THE TRAIL OF PLACES — where the person has been in the Bible, one link a place, the place being read
 * lit (the owner, 2026-10-20, case 2026-10-12-block-diagram, 2.12). A place is a chapter: reading on
 * moves its link along with the person. Coming to a place among the last few links — the recent ones —
 * only moves the light there; any other place, new or seen longer ago, joins the end. Going back and
 * forth between a few places, or round a circle of them, never grows the trail. Which links are recent
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

/** One place: the same chapter, whichever Bible numbers it (Psalm 22 of the Synodal is Psalm 23 of the King James). */
export function sameChapter(a: TrailPlace, b: TrailPlace): boolean {
  if (a.book !== b.book) return false;
  if (a.bible === b.bible) return a.chapter === b.chapter;
  const found = placeIn(a.bible, b.bible, { book: b.book, chapter: b.chapter, verse: b.verse });
  return found ? found.chapter === a.chapter : false;
}

/**
 * The person came to a place: the light moves to it among the recent links, or it joins the end. The
 * place the light is already on is that link, however long ago it was added — the way back steps the
 * light onto an older link first and then opens its place (the owner, 2026-10-20: "←" goes left along
 * the trail).
 */
export function arriveAt(trail: Trail, place: TrailPlace, limits: TrailLimits): Trail {
  const lit = trail.links[trail.at];
  if (lit && sameChapter(lit, place)) return { links: replaced(trail.links, trail.at, carry(place, lit)), at: trail.at };
  const from = Math.max(0, trail.links.length - Math.max(1, limits.recent));
  for (let index = trail.links.length - 1; index >= from; index -= 1) {
    if (sameChapter(trail.links[index], place)) return { links: replaced(trail.links, index, carry(place, trail.links[index])), at: index };
  }
  return keepWithin({ links: [...trail.links, place], at: trail.links.length }, limits.history);
}

const samePlace = (a: TrailPlace, b: TrailPlace) => a.book === b.book && a.chapter === b.chapter && a.verse === b.verse && a.bible === b.bible;

/**
 * Reading on from `from` to `to`: the reader's own link — the one holding `from`, not whichever link
 * another tab lit since — follows the verse read. Into the next chapter it goes along, unless that
 * chapter is already among the recent links: then the light moves there, as an arrival would, and the
 * link left keeps the verse the person stopped at. A link the reader cannot find any more is left alone.
 */
export function readOn(trail: Trail, from: TrailPlace, to: TrailPlace, limits: TrailLimits): Trail {
  if (samePlace(from, to)) return trail;
  const own = trail.links[trail.at] && samePlace(trail.links[trail.at], from)
    ? trail.at
    : findLast(trail.links, (link) => samePlace(link, from), findLast(trail.links, (link) => sameChapter(link, from), -1));
  if (own < 0) return trail;
  if (!sameChapter(trail.links[own], to)) {
    const recentFrom = Math.max(0, trail.links.length - Math.max(1, limits.recent));
    for (let index = trail.links.length - 1; index >= recentFrom; index -= 1) {
      if (index !== own && sameChapter(trail.links[index], to)) return { links: replaced(trail.links, index, carry(to, trail.links[index])), at: index };
    }
  }
  return { links: replaced(trail.links, own, carry(to, trail.links[own])), at: own };
}

function findLast(links: TrailPlace[], match: (link: TrailPlace) => boolean, otherwise: number): number {
  for (let index = links.length - 1; index >= 0; index -= 1) if (match(links[index])) return index;
  return otherwise;
}

/**
 * The way back: the link left of the reader's own one (the link of the place being read — the lit one,
 * else the last of its chapter); -1 — the reader's link is the first, or not on the trail.
 */
export function linkBefore(trail: Trail, here: TrailPlace): number {
  const own = ownLink(trail, here);
  return own > 0 ? own - 1 : -1;
}

/** The reader's own link: the lit one when it holds the place being read, else the last of its chapter; -1 — none. */
export function ownLink(trail: Trail, here: TrailPlace): number {
  const lit = trail.links[trail.at];
  return lit && sameChapter(lit, here) ? trail.at : findLast(trail.links, (link) => sameChapter(link, here), -1);
}

/**
 * Where the light stands among the links: which link is lit, and the place of every other one. It changes
 * when the light goes to another link (a recent place, "←", reading into a chapter already on the trail,
 * another tab) or the links shift (a place added, the oldest gone); it stays while only the lit link's own
 * chapter and verse move — reading on, a jump within its chapter. A column or a row brings the lit link
 * into view on this key, so a list the person scrolled stays put while they read (Codex review,
 * 2026-10-26: the column jumped back to the top as the text was read on).
 */
export function litLinkKey(trail: Trail): string {
  return `${trail.at}|${trail.links.map((link, index) => (index === trail.at ? '*' : `${link.bible}:${link.book}:${link.chapter}`)).join('|')}`;
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
