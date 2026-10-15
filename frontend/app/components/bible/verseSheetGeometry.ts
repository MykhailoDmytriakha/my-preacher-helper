import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';

import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/*
 * THE VERSE WINDOW'S ARITHMETIC — no screen, no browser: which rows a reference lights, where the
 * passage comes to rest, and which way it went when the person scrolled it out of sight.
 */

/** A reference the window opens: its numbers are in `bible`; `label` is the words the person tapped. */
export type SheetReference = ScriptureRefShape & { bible: BibleId; label?: string };

/** The longest passage lit at once: a chapter range is a few chapters, never a whole book by accident. */
const MAX_LIT_VERSES = 600;

/**
 * The rows ("chapter:verse" of the Bible read) the reference lights: the verses it names, or every
 * verse of the chapters it names whole, as the Bible read numbers them — the numbering module's
 * answer (`versesHeldIn`), so "Пс 50:12" of the Synodal lights Ps 51:10 in the King James and a
 * whole Psalm keeps all its verses across the renumbering.
 */
export function passageKeys(reference: SheetReference, reading: BibleId): string[] {
  return versesHeldIn(reference, reading)
    .slice(0, MAX_LIT_VERSES)
    .map((place) => `${place.chapter}:${place.verse}`);
}

/** Where a passage sits in the scrolling text, in px from its top. */
export type PassageBox = { top: number; bottom: number };

/** Space kept above a passage taller than the window, so its first line is not under the edge. */
const TOP_GAP = 12;

/**
 * Where the text is scrolled to show a passage: its middle in the middle of the window, or — when it
 * is taller than the window, as a whole chapter — its start near the top. Never past either end.
 */
export function restingScrollTop(box: PassageBox, viewHeight: number, scrollHeight: number): number {
  const height = box.bottom - box.top;
  const wanted = height > viewHeight - TOP_GAP * 4 ? box.top - TOP_GAP : box.top - (viewHeight - height) / 2;
  return Math.max(0, Math.min(Math.round(wanted), Math.max(0, scrollHeight - viewHeight)));
}

/** Which way the passage went: "up" when scrolled off the top, "down" off the bottom, null while any of it shows. */
export function passageAway(box: PassageBox, viewTop: number, viewHeight: number): 'up' | 'down' | null {
  if (box.bottom <= viewTop + 4) return 'up';
  if (box.top >= viewTop + viewHeight - 4) return 'down';
  return null;
}
