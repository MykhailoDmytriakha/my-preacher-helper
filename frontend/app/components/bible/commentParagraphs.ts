import { bookIndex, versesBetween } from './verseCopy/passagePick';

import type { VerseAt } from './verseCopy/selectedVerses';
import type { BookText } from '@/utils/bibleText';
import type { Passage } from '@/utils/scriptureReferenceNumbering';

/**
 * A COMMENT ON A RUN OF VERSES IS A PARAGRAPH (case 2026-10-12-block-diagram, phase 9; the owner's boards, 31.10): its words
 * stand above its first verse as a heading, in the comment's own type, and a line along its verses shows where it runs —
 * across a chapter's heading too. Paragraphs never cross: one lies whole inside another or apart from it, two levels deep
 * at most. This module owns those rules; the reader draws by them (`useBookUsage`) and the choice of verses for a comment
 * keeps to them (`useVerseCopy`). Nothing is stored: a paragraph is a comment whose place is longer than one verse.
 */

/** How deep paragraphs may lie inside each other: a paragraph and paragraphs inside it. */
export const PARAGRAPH_DEPTH = 2;

/**
 * A comment's piece on verses of the book read, its place counted in the Bible being read. `id` names the piece — a comment
 * read in another Bible may fall into two (King James Romans 16:24–27 is Synodal 14:24–26 and 16:24); `owner`, the comment.
 */
export type PlacedComment = { id: string; owner?: string; passage: Passage };

/** A run of verses as positions in the book: comparable across chapters. */
export type VerseSpan = { from: number; to: number };

/** A paragraph as the reader lays it out: its piece and comment, its first and last verses ("chapter:verse") and how deep it lies. */
export type LaidParagraph = { id: string; owner: string; first: string; last: string; level: number; inner: boolean; span: VerseSpan };

/** Why a run of verses cannot be a paragraph: it crosses another, is another's very run, or would lie three deep. */
export type ParagraphRefusal = { why: 'cross' | 'same'; with: string } | { why: 'deep' };

/** A verse's position in the book: chapters never hold ten thousand verses. */
export const versePosition = (chapter: number, verse: number) => chapter * 10000 + verse;

/** The verses a comment's place runs over, or null for a place that names whole chapters. */
export function spanOf(passage: Passage): VerseSpan | null {
  if (passage.fromVerse === undefined) return null;
  return { from: versePosition(passage.chapter, passage.fromVerse), to: versePosition(passage.toChapter, passage.toVerse ?? passage.fromVerse) };
}

/** Whether a comment's place is a paragraph: verses, more than one. */
export const isParagraph = (passage: Passage) => {
  const span = spanOf(passage);
  return span !== null && span.to > span.from;
};

/** Whether a run may stand among paragraphs laid already (each `{ id, span }`): apart from or wholly in or around each. */
export function paragraphRefusal(span: VerseSpan, laid: readonly { id: string; span: VerseSpan }[]): ParagraphRefusal | null {
  for (const other of laid) {
    if (other.span.from === span.from && other.span.to === span.to) return { why: 'same', with: other.id };
    const apart = other.span.to < span.from || other.span.from > span.to;
    const around = span.from <= other.span.from && other.span.to <= span.to;
    const inside = other.span.from <= span.from && span.to <= other.span.to;
    if (!apart && !around && !inside) return { why: 'cross', with: other.id };
  }
  const all = [...laid.map((other) => other.span), span];
  const depth = Math.max(...all.map((one) => all.filter((other) => other.from <= one.from && one.to <= other.to).length));
  return depth > PARAGRAPH_DEPTH ? { why: 'deep' } : null;
}

/**
 * The comments' paragraphs as the reader draws them, outer ones first. A comment that breaks the rules — written where
 * they were not kept (Studies, an older version), or two on the very same verses — is not lost: it stays `apart` and is
 * drawn as a comment under its first verse.
 */
export function layParagraphs(comments: readonly PlacedComment[]): { laid: LaidParagraph[]; apart: Set<string> } {
  const runs = comments.flatMap((comment) => {
    const span = spanOf(comment.passage);
    return span && span.to > span.from ? [{ comment, span }] : [];
  }).sort((a, b) => a.span.from - b.span.from || b.span.to - a.span.to);
  const kept: { id: string; owner: string; span: VerseSpan; passage: Passage }[] = [];
  const apart = new Set<string>();
  for (const { comment, span } of runs) {
    if (paragraphRefusal(span, kept)) apart.add(comment.id);
    else kept.push({ id: comment.id, owner: comment.owner ?? comment.id, span, passage: comment.passage });
  }
  const laid = kept.map(({ id, owner, span, passage }) => ({
    id,
    owner,
    span,
    first: `${passage.chapter}:${passage.fromVerse}`,
    last: `${passage.toChapter}:${passage.toVerse ?? passage.fromVerse}`,
    level: kept.filter((other) => other.id !== id && other.span.from <= span.from && span.to <= other.span.to).length,
    inner: kept.some((other) => other.id !== id && span.from <= other.span.from && other.span.to <= span.to),
  }));
  return { laid, apart };
}

/** Why the verses chosen for a comment came out other than pressed: a paragraph taken whole, or the run stopped. */
export type PassageFitSaid = { why: 'took' | 'cross' | 'same'; with: string } | { why: 'deep' };

const atPosition = (position: number): VerseAt => ({ chapter: Math.floor(position / 10000), verse: position % 10000 });
const crosses = (a: VerseSpan, b: VerseSpan) => !(a.to < b.from || a.from > b.to) && !(a.from <= b.from && b.to <= a.to) && !(b.from <= a.from && a.to <= b.to);

/** A run grown over every paragraph it crosses, until it crosses none; `took` — the last one taken. */
function takenWhole(span: VerseSpan, others: readonly LaidParagraph[], first: string): { grown: VerseSpan; took: string } {
  const grown = { ...span };
  let took = first;
  for (let again = true; again;) {
    again = false;
    for (const other of others) {
      if (!crosses(grown, other.span)) continue;
      grown.from = Math.min(grown.from, other.span.from);
      grown.to = Math.max(grown.to, other.span.to);
      took = other.id;
      again = true;
    }
  }
  return { grown, took };
}

/**
 * THE VERSES CHOSEN FOR A COMMENT KEEP THE PARAGRAPHS' RULE (the owner's boards, 31.10): a press into another paragraph
 * takes that paragraph whole, when the result may stand; a run that would cross one or lie three deep stops at the last
 * verse it may reach, the end just moved drawn back; the very run of another paragraph is not taken — it is opened by its
 * heading. One verse always may: that is a comment, not a paragraph. `ignore` — the comment whose verses are changed:
 * every piece of it is left out.
 */
export function fitCommentPassage(text: BookText, laid: readonly LaidParagraph[], verses: VerseAt[], end: 'first' | 'last' | null, before: VerseAt[], ignore?: string): { verses: VerseAt[]; said?: PassageFitSaid } {
  if (verses.length < 2) return { verses };
  const others = laid.filter((paragraph) => paragraph.owner !== ignore);
  const sorted = [...verses].sort((a, b) => bookIndex(text, a) - bookIndex(text, b));
  const position = (at: VerseAt) => versePosition(at.chapter, at.verse);
  const span = { from: position(sorted[0]), to: position(sorted[sorted.length - 1]) };
  const refusal = paragraphRefusal(span, others);
  if (!refusal) return { verses };
  if (refusal.why === 'same') return { verses: before, said: refusal };
  if (refusal.why === 'cross') {
    const { grown, took } = takenWhole(span, others, refusal.with);
    if (!paragraphRefusal(grown, others)) return { verses: versesBetween(text, atPosition(grown.from), atPosition(grown.to)), said: { why: 'took', with: took } };
  }
  if (!end) return { verses: before, said: refusal };
  // The end just moved goes back towards the other until the run may stand — down to one verse, which always may.
  let first = 0;
  let last = sorted.length - 1;
  const refused = () => paragraphRefusal({ from: position(sorted[first]), to: position(sorted[last]) }, others);
  while (first < last && refused()) {
    if (end === 'first') first += 1; else last -= 1;
  }
  return { verses: sorted.slice(first, last + 1), said: refusal };
}
