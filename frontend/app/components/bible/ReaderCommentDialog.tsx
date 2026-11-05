'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CommentDialog, type CommentTarget } from '@/components/CommentDialog';
import { CommentIcon } from '@/components/Icons';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { passageWords, type BookText } from '@/utils/bibleText';
import { newClientId } from '@/utils/clientId';
import { passagesIn, samePassage } from '@/utils/scriptureReferenceNumbering';

import { fitCommentPassage, isParagraph, paragraphRefusal, spanOf, type LaidParagraph, type PassageFitSaid } from './commentParagraphs';
import { passageLabel } from './useBookUsage';
import { PassagePickBar } from './verseCopy/PassagePickBar';

import type { RibbonChapterComment } from './BookRibbon';
import type { PickedPassage } from './verseCopy/passagePick';
import type { PassageLimit, VerseCopy } from './verseCopy/useVerseCopy';
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

/** What the reader asked to open: a comment already written, or a new one on a verse or a chapter. */
export type ReaderCommenting = { kind: 'edit'; id: string } | { kind: 'new'; reference: ScriptureReference };

/** A passage chosen in the reader as a comment's place: one verse as before, a run with its last verse — past its chapter, with the chapter that verse stands in. */
function referenceOf(passage: PickedPassage, book: string, bible: BibleId, id: string): ScriptureReference {
  const run = passage.toChapter !== passage.chapter
    ? { toVerseChapter: passage.toChapter, toVerse: passage.toVerse }
    : passage.toVerse !== passage.fromVerse ? { toVerse: passage.toVerse } : {};
  return { id, bible, book, chapter: passage.chapter, fromVerse: passage.fromVerse, ...run };
}

/**
 * THE COMMENT'S WINDOW OPENED FROM THE READER (case 2026-10-12-block-diagram, 3.2): names it by its place as the reader
 * numbers it — «Ис 40:31», «Ис 40–41» — and shows the verse's own words over the editor, or that it is on whole chapters.
 * And its verses (phase 9): a new comment's are chosen in the text first — the bar's «Написать комментарий» opens the
 * window on them, one verse or a paragraph; a written one's are chosen again from its window («Изменить стихи»), the window
 * stepping aside meanwhile with everything typed in it, the bar's «Готово» bringing it back with the new place.
 */
export function ReaderCommentDialog(props: {
  commenting: ReaderCommenting | null;
  setCommenting: (commenting: ReaderCommenting) => void;
  text: BookText | null;
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  passageOf: (id: string) => Passage | undefined;
  onClose: () => void;
  copy: VerseCopy;
  wide: boolean;
  /** The paragraphs on the book, and a comment's words by it or a piece of it (`useBookUsage`): a place saved keeps their rule. */
  laid: readonly LaidParagraph[];
  bodyOf: (id: string) => string;
}) {
  const { commenting, setCommenting, text, bookId, bible, copy, wide, laid, bodyOf } = props;
  const { t } = useTranslation();
  const key = commenting ? (commenting.kind === 'new' ? commenting.reference.id : commenting.id) : null;
  // The window whose verses are being chosen again — its key, the verses it offered, how it takes new ones; a choice let
  // go of brings it back as it was, and so does another window opened meanwhile (a heading pressed): the choice goes.
  const [choosing, setChoosing] = useState<{ key: string; id: string; offered: PickedPassage; moveTo: (reference: ScriptureReference) => void } | null>(null);
  useEffect(() => { if (!copy.picking) setChoosing(null); }, [copy.picking]);
  const clearChoice = copy.clear;
  useEffect(() => {
    if (choosing && choosing.key !== key) { setChoosing(null); clearChoice(); }
  }, [choosing, key, clearChoice]);
  const chosen = (passage: PickedPassage) => {
    copy.clear();
    if (choosing) {
      // The verses it offered, taken back as they were: its place stays as written — in its own Bible, every piece of it.
      if (!samePassage(passage, choosing.offered)) choosing.moveTo(referenceOf(passage, bookId, bible, choosing.id));
      setChoosing(null);
      return;
    }
    setCommenting({ kind: 'new', reference: referenceOf(passage, bookId, bible, newClientId()) });
  };
  const runHere = (here: ScriptureReference) => choosableRun(here, bookId, bible);
  // Said where «Изменить стихи» would stand: the comment's own Bible, where its verses are one run again.
  const versesRefusal = (here: ScriptureReference) => {
    const why = versesNotChoosable(here, bookId, bible);
    return why ? t(`comment.verses.${why}`, { translation: t(`bible.translations.${here.bible ?? bible}.short`) }) : null;
  };
  const chooseVerses = (here: ScriptureReference, moveTo: (reference: ScriptureReference) => void) => {
    const run = runHere(here);
    if (!run || !key) return;
    const offered = { chapter: run.chapter, fromVerse: run.fromVerse!, toChapter: run.toChapter, toVerse: run.toVerse ?? run.fromVerse! };
    setChoosing({ key, id: here.id, offered, moveTo });
    copy.startPassage({ chapter: offered.chapter, verse: offered.fromVerse }, { chapter: offered.toChapter, verse: offered.toVerse }, 'comment');
  };
  const editing = commenting?.kind === 'edit' ? commenting.id : undefined;
  // Every piece of the place in this book that is a paragraph keeps the rule; a comment on one verse always may stand
  // (Codex review r2: a verse inside two paragraphs was refused as a third level). A place in another book is not laid out
  // here: it stands as a comment there if it breaks the rule, nothing lost.
  const placeRefusal = (reference: ScriptureReference) => {
    const others = laid.filter((paragraph) => paragraph.owner !== editing);
    const pieces = reference.book === bookId ? passagesIn(reference, bible).filter(isParagraph) : [];
    for (const piece of pieces) {
      const refusal = paragraphRefusal(spanOf(piece)!, others);
      if (refusal) return sayFit(refusal, (id) => paragraphName(bodyOf(id)), t);
    }
    return null;
  };
  return (
    <>
      {copy.purpose === 'comment' && text ? (
        <PassagePickBar copy={copy} wide={wide} onOpen={chosen} action={t(choosing ? 'common.done' : 'comment.pick.write')} icon={<CommentIcon className="h-5 w-5" />} cancelLabel={t('comment.pick.cancel')} />
      ) : null}
      {commenting && text && key ? (
        <OpenReaderCommentDialog key={key} {...props} commenting={commenting} text={text} away={choosing?.key === key} onChooseVerses={chooseVerses} versesRefusal={versesRefusal} placeRefusal={placeRefusal} />
      ) : null}
    </>
  );
}

/**
 * A comment's verses are chosen again in this book's text, read here as one run: moved to another book, or falling into
 * two pieces in this Bible (King James Romans 16 in the Synodal), they are not offered to be chosen here; nor is a comment
 * on a whole chapter, though its chapter reads as verses in another Bible (Codex review r3: Synodal Psalm 114 is King
 * James 116:1–9). Null — not offered.
 */
export function choosableRun(here: ScriptureReference, bookId: string, bible: BibleId): Passage | null {
  const pieces = here.book === bookId && here.fromVerse !== undefined ? passagesIn(here, bible) : [];
  return pieces.length === 1 && pieces[0].fromVerse !== undefined ? pieces[0] : null;
}

/** Why a comment's verses are not chosen again here (`choosableRun`): moved to another book, or not one run in this Bible. */
export function versesNotChoosable(here: ScriptureReference, bookId: string, bible: BibleId): 'otherBook' | 'notOneRun' | null {
  if (choosableRun(here, bookId, bible)) return null;
  return here.book === bookId ? 'notOneRun' : 'otherBook';
}

function OpenReaderCommentDialog({ commenting, text, bookId, bible, locale, passageOf, onClose, away, onChooseVerses, versesRefusal, placeRefusal }: {
  commenting: ReaderCommenting;
  text: BookText;
  bookId: string;
  /** The Bible being read: a place the comment moves to is counted and named in it. */
  bible: BibleId;
  locale: AppLocale;
  /** Where a written comment stands in the Bible being read (`useBookUsage().commentPassage`). */
  passageOf: (id: string) => Passage | undefined;
  onClose: () => void;
  away: boolean;
  onChooseVerses: (here: ScriptureReference, moveTo: (reference: ScriptureReference) => void) => void;
  versesRefusal: (here: ScriptureReference) => string | null;
  placeRefusal: (reference: ScriptureReference) => string | null;
}) {
  const { t } = useTranslation();
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const passage: Passage | undefined = commenting.kind === 'new' ? passagesIn(commenting.reference, bible)[0] : passageOf(commenting.id);
  const place = passage ? passageLabel(abbrev, passage) : abbrev;
  const onVerses = passage?.fromVerse !== undefined;
  const context = onVerses
    ? passageWords(text, { chapter: passage.chapter, verse: passage.fromVerse! }, { chapter: passage.toChapter, verse: passage.toVerse ?? passage.fromVerse! })
    : t(passage && passage.toChapter > passage.chapter ? 'comment.wholeChapters' : 'comment.wholeChapter', { place });
  const target: CommentTarget = commenting.kind === 'edit' ? { kind: 'edit', id: commenting.id } : { kind: 'new', reference: commenting.reference };
  const placeOf = (one: ScriptureReference) => readerPlaceName(one, bible, locale);
  // A comment on whole chapters keeps its chapter doors: its verses are not chosen in the text.
  return <CommentDialog target={target} place={place} context={context} bible={bible} placeOf={placeOf} onClose={onClose} away={away} onChooseVerses={onVerses ? onChooseVerses : undefined} versesRefusal={versesRefusal} placeRefusal={placeRefusal} />;
}

/** What the reader says when the verses chosen for a comment come out other than pressed, or a place may not be saved. */
function sayFit(said: PassageFitSaid, nameOf: (id: string) => string, t: (key: string, options?: Record<string, unknown>) => string): string {
  return said.why === 'deep' ? t('comment.pick.deep') : t(`comment.pick.${said.why}`, { title: nameOf(said.with) });
}

/** A paragraph named by its comment's first words, as far as a toast holds. */
function paragraphName(body: string): string {
  const words = body.replace(/[#*_>`~[\]]/g, '').replace(/\s+/g, ' ').trim();
  return words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : words;
}

/**
 * THE PARAGRAPHS' RULE WHILE A COMMENT'S VERSES ARE CHOSEN (`commentParagraphs.ts`): the reader's verse choice keeps it,
 * the comment whose verses are chosen again left out of the paragraphs it is checked against.
 */
export function useCommentLimit({ text, laid, bodyOf, commenting }: {
  text: BookText | null;
  laid: readonly LaidParagraph[];
  bodyOf: (id: string) => string;
  commenting: ReaderCommenting | null;
}): PassageLimit {
  const { t } = useTranslation();
  const editing = commenting?.kind === 'edit' ? commenting.id : undefined;
  return useCallback((verses, end, before) => {
    if (!text) return { verses };
    const fit = fitCommentPassage(text, laid, verses, end, before, editing);
    return { verses: fit.verses, ...(fit.said ? { said: sayFit(fit.said, (id) => paragraphName(bodyOf(id)), t) } : {}) };
  }, [text, laid, bodyOf, editing, t]);
}

/** The window's state in the reader: which comment is open, and opening a written one by its id. */
export function useReaderCommenting() {
  const [commenting, setOpen] = useState<ReaderCommenting | null>(null);
  // One window at a time: while one is open — stepped aside too, while its verses are chosen — another does not take its
  // place, which would close it with its words unasked and leave them to be «found» later (the owner, 01.11: closing is
  // the person's, and asks first). Only its own close lets it go.
  const setCommenting = useCallback((next: ReaderCommenting) => setOpen((now) => now ?? next), []);
  const edit = useCallback((id: string) => setCommenting({ kind: 'edit', id }), [setCommenting]);
  const close = useCallback(() => setOpen(null), []);
  return { commenting, setCommenting, edit, close };
}

/**
 * A COMMENT'S WINDOW HOLDS THE READER: while it is open — stepped aside too, its verses being chosen in the text — leaving
 * the book or the translation brings it back instead, and it asks itself before its words go (Codex review r3: the page
 * opens a new reader for another Bible or book, and the window went with the old one unasked). True — the reader stays.
 */
export function useCommentHoldsReader(commenting: ReaderCommenting | null, bringBack: () => void): () => boolean {
  return useCallback(() => {
    if (!commenting) return false;
    bringBack();
    return true;
  }, [commenting, bringBack]);
}

/**
 * THE READER'S DOORS TO A COMMENT — the verse menu's «Комментарий» and a chapter heading's: each opens the comment
 * written to that verse (starting there) or that whole chapter, else a new one numbered in the Bible being read.
 */
export function useCommentDoors({ ready, commentOn, setCommenting, bookId, bible, choosePassage, passageOf }: {
  /** The comments are known (`useBookUsage().commentsReady`): before, a door would not see the one written there. */
  ready: boolean;
  commentOn: (chapter: number, verse: number | null) => string | undefined;
  setCommenting: (commenting: ReaderCommenting) => void;
  bookId: string;
  bible: BibleId;
  /**
   * A verse with no comment of its own (phase 9): its verses are chosen first — the bar's «Написать комментарий» right
   * away writes on that verse, as before; a verse pressed below or above makes the comment a paragraph.
   */
  choosePassage?: (chapter: number, verse: number) => void;
  /** Where a written comment stands: the verse's item says «абзац» for one on a run of verses. */
  passageOf?: (id: string) => Passage | undefined;
}): { verse?: VerseComment; chapter?: RibbonChapterComment } {
  const { t } = useTranslation();
  const open = useCallback((chapter: number, verse: number | null) => {
    const id = commentOn(chapter, verse);
    if (!id && verse !== null && choosePassage) { choosePassage(chapter, verse); return; }
    const reference: ScriptureReference = { id: newClientId(), bible, book: bookId, chapter, ...(verse !== null ? { fromVerse: verse } : {}) };
    setCommenting(id ? { kind: 'edit', id } : { kind: 'new', reference });
  }, [commentOn, setCommenting, bible, bookId, choosePassage]);
  return useMemo(() => (!ready ? {} : {
    verse: {
      // «Комментарий или абзац» writes either (phase 9; the owner, 01.11); written there, it says which it opens.
      labelOf: ({ chapter, verse }) => {
        const id = commentOn(chapter, verse);
        if (!id) return t('comment.verseMenu');
        const passage = passageOf?.(id);
        return t(passage && isParagraph(passage) ? 'comment.verseMenuEditParagraph' : 'comment.verseMenuEdit');
      },
      open: ({ chapter, verse }) => open(chapter, verse),
    },
    chapter: {
      labelOf: (chapter) => t(commentOn(chapter, null) ? 'comment.chapterMenuEdit' : 'comment.chapterMenu'),
      open: (chapter) => open(chapter, null),
    },
  }), [ready, commentOn, open, t, passageOf]);
}
