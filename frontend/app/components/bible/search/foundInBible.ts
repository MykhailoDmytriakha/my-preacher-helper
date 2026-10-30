'use client';

import { useSyncExternalStore } from 'react';

import type { BibleId } from '@/utils/bibles';
import type { VerseHit } from '@/utils/bibleSearch/searchIndex';

/*
 * THE FOUND VERSES SHOWN IN THE BIBLE (the owner's choice on the canvas «Путь в Библию», 30.10, «Поиск → Библия»): a
 * search opened in the reader keeps its verses beside the text — the list instead of the trail, a mark on the minimap,
 * a frame round each found verse — until the person closes it; «К поиску» brings back the same search window on the
 * verse stood at. The search is kept here, in the page's memory: the reader is made anew for each book, and the found
 * verses go from book to book with the person. What a line finds is the search's own (`utils/bibleSearch`).
 */

/** A search shown in the Bible: its line, as typed, and whether its first word was searched as a word. */
export type FoundSearch = { bible: BibleId; line: string; asWords: boolean };
/** A found verse in Bible order: `key` as the search window keys it, «John 6:35». */
export type FoundVerse = { key: string; bookId: string; chapter: number; verse: number; text: string };

let shown: FoundSearch | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

/** The search whose verses the reader shows beside the text. */
export function showFound(search: FoundSearch): void {
  shown = search;
  tell();
}

/** The found verses closed: the trail is back beside the text. */
export function closeFound(): void {
  if (!shown) return;
  shown = null;
  tell();
}

/**
 * A verse opened from a line (`fromSearch` — the search it was found by): one found by a search and opened alone — a
 * line that keeps no verses beside the text, or a screen without room for them — puts away the search kept before,
 * so its verses never stand beside a later search's verse (Codex review, 30.10). A place typed keeps them. The lines
 * that choose a place for something (a comment moved) do not call this: choosing is not reading.
 */
export function openedAlone(fromSearch: { line: string; asWords: boolean } | undefined): void {
  if (fromSearch) closeFound();
}

export function useFoundSearch(): FoundSearch | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => shown,
    () => null,
  );
}

export const foundKey = (bookId: string, chapter: number, verse: number) => `${bookId} ${chapter}:${verse}`;

/** The verses a search found, in the order of the Bible's books (`order`), chapters and verses — the order they are read in. */
export function foundInOrder(hits: readonly VerseHit[], order: readonly string[]): FoundVerse[] {
  const rank = new Map(order.map((bookId, index) => [bookId, index]));
  return hits
    .map((hit) => ({ key: foundKey(hit.book, hit.chapter, hit.verse), bookId: hit.book, chapter: hit.chapter, verse: hit.verse, text: hit.text }))
    .sort((a, b) => (rank.get(a.bookId) ?? 0) - (rank.get(b.bookId) ?? 0) || a.chapter - b.chapter || a.verse - b.verse);
}

/**
 * The found verse the reading stands at: the last one at or above the verse read in this book; before the first of the
 * book, its first. Null — none of them is in this book.
 */
export function foundAt(verses: readonly FoundVerse[], bookId: string, chapter: number, verse: number): FoundVerse | null {
  const here = verses.filter((one) => one.bookId === bookId);
  if (!here.length) return null;
  const above = here.filter((one) => one.chapter < chapter || (one.chapter === chapter && one.verse <= verse));
  return above.length ? above[above.length - 1] : here[0];
}

/**
 * How many verses the search window must show for the verse `key` to be among them: it lists the window's own order
 * (`windowOrder`), `step` at a time.
 */
export function shownFor(windowOrder: readonly string[], key: string, step: number): number {
  const at = windowOrder.indexOf(key);
  return at < 0 ? step : Math.ceil((at + 1) / step) * step;
}

/** The found verses drawn in the list beside the text: from the `from`-th up to, not including, the `to`-th. */
export type FoundRange = { from: number; to: number };

/**
 * Which found verses the list draws while the reading stands at the `at`-th (-1 — at none), `step` at a time: the
 * step that holds it, at first; reading on or back into the next step draws that step too, the list as scrolled; a
 * jump further draws the step it landed in, alone. So a word on every page never draws thousands of verses, and the
 * verse read is always among those drawn; a list grown shorter than the range starts again. The same range back —
 * nothing to change.
 */
export function drawnAround(range: FoundRange | null, at: number, step: number, count: number): FoundRange {
  const stepOf = (index: number) => Math.floor(index / step) * step;
  if (!range || (range.from > 0 && range.from >= count)) return at < 0 ? { from: 0, to: step } : { from: stepOf(at), to: stepOf(at) + step };
  if (at < 0 || (at >= range.from && at < range.to)) return range;
  if (at >= range.from - step && at < range.from) return { from: stepOf(at), to: range.to };
  if (at >= range.to && at < range.to + step) return { from: range.from, to: stepOf(at) + step };
  return { from: stepOf(at), to: stepOf(at) + step };
}
