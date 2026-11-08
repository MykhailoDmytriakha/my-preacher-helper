import { passagesIn, withStoredBible } from '@/utils/scriptureReferenceNumbering';
import { bookUsage, usageDocuments, type BookUsageEntry } from '@/utils/scriptureUsage';

import { isParagraphComment, layParagraphs, paragraphRefusal, spanOf, type LaidParagraph, type PassageFitSaid } from './commentParagraphs';

import type { ScriptureReference, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface BookCommentLayout { laid: readonly LaidParagraph[]; bodyOf(id: string): string }
/** One projection owns paragraph layout and its displayed words in every book. */
export function commentLayoutOf(entries: readonly BookUsageEntry[]): BookCommentLayout {
  return {
    laid: layParagraphs(entries.filter(entry => entry.kind === 'comment' && isParagraphComment(entry.passage, entry.paragraph))
      .map(entry => ({ id: entry.key, owner: entry.id, passage: entry.passage, ...(entry.paragraph !== undefined ? { paragraph: entry.paragraph } : {}) }))).laid,
    bodyOf: id => entries.find(entry => entry.kind === 'comment' && (entry.key === id || entry.id === id))?.body ?? '',
  };
}

/** Studies uses the same layout from its already loaded notes, only when saving a recovered kind. */
export function storedCommentLayout(notes: readonly StudyNote[], book: string, bible: BibleId, locale: AppLocale): BookCommentLayout {
  return commentLayoutOf(bookUsage(usageDocuments({ notes, sermons: [], groups: [], locale }), book, bible));
}

export function paragraphPlaceRefusal(reference: ScriptureReference, bible: BibleId, paragraph: boolean | undefined,
  editing: string | undefined, paragraphsForBook: (book: string) => BookCommentLayout | null, t: Translate, locale?: AppLocale): string | null {
  const pieces = passagesIn(locale ? withStoredBible(reference, locale) : reference, bible);
  const spans = pieces.flatMap(piece => {
    const span = spanOf(piece);
    return span && isParagraphComment(piece, paragraph) ? [span] : [];
  });
  if (!spans.length) return null;
  const layout = paragraphsForBook(reference.book);
  if (!layout) return t('comment.pick.unavailable');
  const others = layout.laid.filter(item => item.owner !== editing);
  for (const span of spans) {
    const refusal = paragraphRefusal(span, others);
    if (refusal) return sayFit(refusal, id => paragraphName(layout.bodyOf(id)), t);
  }
  return null;
}

/** What the reader says when the verses chosen for a comment come out other than pressed, or a place may not be saved. */
export function sayFit(said: PassageFitSaid, nameOf: (id: string) => string, t: (key: string, options?: Record<string, unknown>) => string): string {
  return said.why === 'deep' ? t('comment.pick.deep') : t(`comment.pick.${said.why}`, { title: nameOf(said.with) });
}

/** A paragraph named by its comment's first words, as far as a toast holds. */
export function paragraphName(body: string): string {
  const words = body.replace(/[#*_>`~[\]]/g, '').replace(/\s+/g, ' ').trim();
  return words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : words;
}
