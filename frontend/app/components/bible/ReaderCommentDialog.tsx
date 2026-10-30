'use client';

import { useCallback, useMemo, useRef, useState } from 'react';


import { CommentDialog, type CommentTarget } from '@/components/CommentDialog';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { verseWords, type BookText } from '@/utils/bibleText';
import { newClientId } from '@/utils/clientId';
import { passagesIn } from '@/utils/scriptureReferenceNumbering';
import { useTranslation } from '@locales/useTranslation';

import { passageLabel, type MinePlace } from './useBookUsage';

import type { RibbonChapterComment } from './BookRibbon';
import type { VerseComment } from './verseCopy/VerseMenu';
import type { ScriptureReference } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { Passage } from '@/utils/scriptureReferenceNumbering';

/**
 * A comment's place as the reader names its places — «Ис 41:2», in the Bible being read; every piece of it where a gap parts
 * it there: King James Romans 16 is Synodal 14:24–26 and 16 (Codex review r3–r4, 2026-10-28).
 */
export function readerPlaceName(reference: ScriptureReference, bible: BibleId, locale: AppLocale): string {
  const name = getLocalizedAbbrev(reference.book, locale);
  const [first, ...rest] = passagesIn(reference, bible);
  return first ? [passageLabel(name, first), ...rest.map((piece) => passageLabel('', piece).trim())].join(', ') : name;
}

/** The displayed occurrence that opened a written comment, scoped to its reader. */
type ReaderCommentOpening = { bookId: string; bible: BibleId; passage: Passage };
/** What the reader asked to open: a comment already written, or a new one on a verse or a chapter. */
export type ReaderCommenting = ({ kind: 'edit'; id: string; opening?: ReaderCommentOpening } | { kind: 'new'; reference: ScriptureReference }) & { opener?: HTMLElement | null };

/** Display provenance stays in the reader: the comment's target remains its stored id. */
function editingComment(id: string, bookId: string, bible: BibleId, passage?: Passage, opener?: HTMLElement | null): ReaderCommenting {
  return { kind: 'edit', id, ...(passage ? { opening: { bookId, bible, passage } } : {}), ...(opener ? { opener } : {}) };
}

/**
 * THE COMMENT'S WINDOW OPENED FROM THE READER (case 2026-10-12-block-diagram, 3.2): names it by its place as the reader
 * numbers it — «Ис 40:31», «Ис 40–41» — and shows the verse's own words over the editor, or that it is on whole chapters.
 */
export function ReaderCommentDialog(props: {
  commenting: ReaderCommenting | null;
  text: BookText | null;
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  passageOf: (id: string) => Passage | undefined;
  onClose: () => void;
}) {
  const { commenting, text } = props;
  if (!commenting || !text) return null;
  const key = commenting.kind === 'new' ? commenting.reference.id : commenting.id;
  return <OpenReaderCommentDialog key={key} {...props} commenting={commenting} text={text} />;
}

function OpenReaderCommentDialog({ commenting, text, bookId, bible, locale, passageOf, onClose }: {
  commenting: ReaderCommenting;
  text: BookText;
  bookId: string;
  /** The Bible being read: a place the comment moves to is counted and named in it. */
  bible: BibleId;
  locale: AppLocale;
  /** Where a written comment stands in the Bible being read (`useBookUsage().commentPassage`). */
  passageOf: (id: string) => Passage | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const returnFocusTo = useRef<HTMLElement | null>(commenting.opener ?? null);
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const words = (chapter: number, verse: number) => verseWords(text.chapters[chapter - 1]?.[verse - 1] ?? '');
  const opening = commenting.kind === 'edit' && commenting.opening?.bookId === bookId && commenting.opening.bible === bible
    ? commenting.opening.passage : undefined;
  const passage: Passage | undefined = commenting.kind === 'edit'
    ? opening ?? passageOf(commenting.id)
    : { chapter: commenting.reference.chapter ?? 1, toChapter: commenting.reference.toChapter ?? commenting.reference.chapter ?? 1, fromVerse: commenting.reference.fromVerse, toVerse: commenting.reference.fromVerse };
  const place = passage ? passageLabel(abbrev, passage) : abbrev;
  const context = passage?.fromVerse !== undefined
    ? words(passage.chapter, passage.fromVerse)
    : t(passage && passage.toChapter > passage.chapter ? 'comment.wholeChapters' : 'comment.wholeChapter', { place });
  const target: CommentTarget = commenting.kind === 'edit' ? { kind: 'edit', id: commenting.id } : { kind: 'new', reference: commenting.reference };
  const placeOf = (reference: ScriptureReference) => readerPlaceName(reference, bible, locale);
  return <CommentDialog target={target} place={place} context={context} bible={bible} placeOf={placeOf} onClose={onClose} returnFocusTo={returnFocusTo} openingPlace={opening ? place : undefined} />;
}

/** The window's state in the reader: which comment is open, and opening a written one by its id. */
export function useReaderCommenting(bookId: string, bible: BibleId) {
  const [commenting, setCommenting] = useState<ReaderCommenting | null>(null);
  const edit = useCallback((id: string, passage?: Passage) => setCommenting(editingComment(id, bookId, bible, passage)), [bookId, bible]);
  const close = useCallback(() => setCommenting(null), []);
  return { commenting, setCommenting, edit, close };
}

/**
 * THE READER'S DOORS TO A COMMENT — the verse menu's «Комментарий» and a chapter heading's: each opens the comment
 * written to that verse (starting there) or that whole chapter, else a new one numbered in the Bible being read.
 */
export function useCommentDoors({ ready, commentOn, commentPassage, setCommenting, bookId, bible }: {
  /** The comments are known (`useBookUsage().commentsReady`): before, a door would not see the one written there. */
  ready: boolean;
  commentOn: (chapter: number, verse: number | null) => string | undefined;
  commentPassage: (id: string, at: MinePlace) => Passage | undefined;
  setCommenting: (commenting: ReaderCommenting) => void;
  bookId: string;
  bible: BibleId;
}): { verse?: VerseComment; chapter?: RibbonChapterComment } {
  const { t } = useTranslation();
  const open = useCallback((chapter: number, verse: number | null, opener?: HTMLElement | null) => {
    const id = commentOn(chapter, verse);
    const reference: ScriptureReference = { id: newClientId(), bible, book: bookId, chapter, ...(verse !== null ? { fromVerse: verse } : {}) };
    setCommenting(id ? editingComment(id, bookId, bible, commentPassage(id, { chapter, verse }), opener) : { kind: 'new', reference, ...(opener ? { opener } : {}) });
  }, [commentOn, commentPassage, setCommenting, bible, bookId]);
  return useMemo(() => (!ready ? {} : {
    verse: {
      labelOf: ({ chapter, verse }) => t(commentOn(chapter, verse) ? 'comment.verseMenuEdit' : 'comment.verseMenu'),
      open: ({ chapter, verse }, opener) => open(chapter, verse, opener),
    },
    chapter: {
      labelOf: (chapter) => t(commentOn(chapter, null) ? 'comment.chapterMenuEdit' : 'comment.chapterMenu'),
      open: (chapter) => open(chapter, null),
    },
  }), [ready, commentOn, open, t]);
}
