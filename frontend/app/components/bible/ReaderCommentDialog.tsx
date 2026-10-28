'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CommentDialog, type CommentTarget } from '@/components/CommentDialog';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { verseWords, type BookText } from '@/utils/bibleText';
import { newClientId } from '@/utils/clientId';

import { passageLabel } from './useBookUsage';

import type { RibbonChapterComment } from './BookRibbon';
import type { VerseComment } from './verseCopy/VerseMenu';
import type { ScriptureReference } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { Passage } from '@/utils/scriptureReferenceNumbering';

/** What the reader asked to open: a comment already written, or a new one on a verse or a chapter. */
export type ReaderCommenting = { kind: 'edit'; id: string } | { kind: 'new'; reference: ScriptureReference };

/**
 * THE COMMENT'S WINDOW OPENED FROM THE READER (case 2026-10-12-block-diagram, 3.2): names it by its place as the reader
 * numbers it — «Ис 40:31», «Ис 40–41» — and shows the verse's own words over the editor, or that it is on whole chapters.
 */
export function ReaderCommentDialog(props: {
  commenting: ReaderCommenting | null;
  text: BookText | null;
  bookId: string;
  locale: AppLocale;
  passageOf: (id: string) => Passage | undefined;
  onClose: () => void;
}) {
  const { commenting, text } = props;
  if (!commenting || !text) return null;
  const key = commenting.kind === 'new' ? commenting.reference.id : commenting.id;
  return <OpenReaderCommentDialog key={key} {...props} commenting={commenting} text={text} />;
}

function OpenReaderCommentDialog({ commenting, text, bookId, locale, passageOf, onClose }: {
  commenting: ReaderCommenting;
  text: BookText;
  bookId: string;
  locale: AppLocale;
  /** Where a written comment stands in the Bible being read (`useBookUsage().commentPassage`). */
  passageOf: (id: string) => Passage | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const words = (chapter: number, verse: number) => verseWords(text.chapters[chapter - 1]?.[verse - 1] ?? '');
  const passage: Passage | undefined = commenting.kind === 'edit'
    ? passageOf(commenting.id)
    : { chapter: commenting.reference.chapter ?? 1, toChapter: commenting.reference.toChapter ?? commenting.reference.chapter ?? 1, fromVerse: commenting.reference.fromVerse, toVerse: commenting.reference.fromVerse };
  const place = passage ? passageLabel(abbrev, passage) : abbrev;
  const context = passage?.fromVerse !== undefined
    ? words(passage.chapter, passage.fromVerse)
    : t(passage && passage.toChapter > passage.chapter ? 'comment.wholeChapters' : 'comment.wholeChapter', { place });
  const target: CommentTarget = commenting.kind === 'edit' ? { kind: 'edit', id: commenting.id } : { kind: 'new', reference: commenting.reference };
  return <CommentDialog target={target} place={place} context={context} onClose={onClose} />;
}

/** The window's state in the reader: which comment is open, and opening a written one by its id. */
export function useReaderCommenting() {
  const [commenting, setCommenting] = useState<ReaderCommenting | null>(null);
  const edit = useCallback((id: string) => setCommenting({ kind: 'edit', id }), []);
  const close = useCallback(() => setCommenting(null), []);
  return { commenting, setCommenting, edit, close };
}

/**
 * THE READER'S DOORS TO A COMMENT — the verse menu's «Комментарий» and a chapter heading's: each opens the comment
 * written to that verse (starting there) or that whole chapter, else a new one numbered in the Bible being read.
 */
export function useCommentDoors({ ready, commentOn, setCommenting, bookId, bible }: {
  /** The comments are known (`useBookUsage().commentsReady`): before, a door would not see the one written there. */
  ready: boolean;
  commentOn: (chapter: number, verse: number | null) => string | undefined;
  setCommenting: (commenting: ReaderCommenting) => void;
  bookId: string;
  bible: BibleId;
}): { verse?: VerseComment; chapter?: RibbonChapterComment } {
  const { t } = useTranslation();
  const open = useCallback((chapter: number, verse: number | null) => {
    const id = commentOn(chapter, verse);
    const reference: ScriptureReference = { id: newClientId(), bible, book: bookId, chapter, ...(verse !== null ? { fromVerse: verse } : {}) };
    setCommenting(id ? { kind: 'edit', id } : { kind: 'new', reference });
  }, [commentOn, setCommenting, bible, bookId]);
  return useMemo(() => (!ready ? {} : {
    verse: {
      labelOf: ({ chapter, verse }) => t(commentOn(chapter, verse) ? 'comment.verseMenuEdit' : 'comment.verseMenu'),
      open: ({ chapter, verse }) => open(chapter, verse),
    },
    chapter: {
      labelOf: (chapter) => t(commentOn(chapter, null) ? 'comment.chapterMenuEdit' : 'comment.chapterMenu'),
      open: (chapter) => open(chapter, null),
    },
  }), [ready, commentOn, open, t]);
}
