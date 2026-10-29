'use client';

import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BookNavigator } from '@/components/bible/BiblePicker';
import { useBookTexts } from '@/components/bible/useBookTexts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { getLocalizedBookName } from '@/utils/bibleBooks';
import { isBibleId, type BibleId } from '@/utils/bibles';
import { verseWords, type BookText } from '@/utils/bibleText';
import { chaptersAround, movedReference, versesAround } from '@/utils/scriptureNeighbours';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { referenceBibleFor, sameScriptureReference, scriptureReferencesOverlap, withStoredBible } from '@/utils/scriptureReferenceNumbering';

import type { ScriptureReference, StudyNote } from '@/models/models';

/** A place of one book a comment can stand on: a verse, or a whole chapter when `verse` is absent. */
export type CommentSpot = { book: string; chapter: number; verse?: number };

const sameSpot = (a: CommentSpot, b: CommentSpot) => a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;

/** The place a reference stands on in its first chapter: a verse, or the chapter when it has none. */
const spotOf = (ref: ScriptureReference): CommentSpot => ({ book: ref.book, chapter: ref.chapter ?? 1, ...(ref.fromVerse !== undefined ? { verse: ref.fromVerse } : {}) });

/**
 * WHERE A COMMENT STANDS AND WHERE IT MOVES (case 2026-10-12-block-diagram; the owner, 2026-10-28): its place in the Bible
 * of the screen under the window, the place chosen to move it to until «Готово», the list of places around it, and the
 * words under the title, which follow the place. The window asks it and writes `moved` on save; nothing here is stored.
 */
export function useCommentPlace({ standing, newPlace, choosesOwn, restoreOwn, bible, placeOf, context, notes, ownId }: {
  /** The reference the comment stands on: a written one's first, a new one's own. */
  standing: ScriptureReference | undefined;
  /** A new comment's own place (null while not chosen); undefined for a written one. */
  newPlace: ScriptureReference | null | undefined;
  /** The window chooses a new comment's place its own way (Studies): no move here, and it brings a kept place back itself. */
  choosesOwn: boolean;
  /** With `choosesOwn`: how that window takes a place brought back with the words. */
  restoreOwn?: (reference: ScriptureReference) => void;
  /** The Bible the screen under the window reads; a place with no Bible of its own is counted in it. By default, the interface's. */
  bible?: BibleId;
  /** How that screen names a place; by default as Studies name it. */
  placeOf?: (reference: ScriptureReference) => string;
  /** The words of the place it stands on, as that screen gave them. */
  context?: string;
  /** Every study note: where other comments stand. */
  notes: readonly StudyNote[];
  /** The comment itself, not counted as another one at its place. */
  ownId?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n?.language);
  const screenBible = bible ?? referenceBibleFor(locale);
  const labelOf = (ref: ScriptureReference) => (placeOf ? placeOf(ref) : formatScriptureReference(ref, { locale }));
  /*
   * A COMMENT MOVES IN THE BIBLE IT WAS WRITTEN IN. Read in another Bible, a place loses what it is: Synodal Psalms 114 and
   * 115 are both King James 116, Synodal Psalm 9 is King James 9–10, Synodal Psalm 9:20–25 runs over a chapter's edge
   * there. Three rounds of review found moves lost or reshaped by such readings (Codex review, 2026-10-28), so the list, the
   * reader's window and a save count in the comment's own Bible — the one the person reads, but for a translation switched
   * since — and a reading in the screen's Bible only names it (`placeOf`).
   */
  const home = standing?.chapter !== undefined ? withStoredBible(standing, locale) : null;
  const placeBible: BibleId = home && isBibleId(home.bible) ? home.bible : screenBible;
  const onChapter = home !== null && home.fromVerse === undefined;
  const spotIn = (ref: ScriptureReference): CommentSpot => (onChapter ? { book: ref.book, chapter: ref.chapter ?? 1 } : spotOf(ref));
  // Where it moves on «Готово», exactly as chosen or brought back — what is saved; null — it stays.
  const [moved, setMoved] = useState<ScriptureReference | null>(null);
  // Another device's place was taken in a conflict: the window names its place itself, the screen's name being of the old one.
  const [ownName, setOwnName] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const here = moved ?? home;
  const texts = useBookTexts(here && (open || moved || ownName) ? [here.book] : [], placeBible);
  const text = here ? texts.get(here.book) ?? null : null;

  /** Moves it to a place, covering what it covers; the place it stands on is no move. */
  const placeAt = (spot: CommentSpot) => {
    if (!home) return;
    setMoved(sameSpot(spot, spotIn(home)) ? null : movedReference(home, placeBible, spot.book, { chapter: spot.chapter, verse: onChapter ? undefined : spot.verse }));
  };
  /** A place chosen in the list or the reader's window: moved there, the list closed, the focus back on its button. */
  const pick = (spot: CommentSpot) => {
    placeAt(spot);
    setOpen(false);
    buttonRef.current?.querySelector('button')?.focus();
  };
  // Another comment stands there: a verse — a comment on that verse; a chapter — one on that whole chapter.
  const taken = (spot: CommentSpot) => {
    const there = { bible: placeBible, book: spot.book, chapter: spot.chapter, ...(spot.verse !== undefined ? { fromVerse: spot.verse } : {}) };
    return notes.some((other) => other.type === 'comment' && other.id !== ownId
      && other.scriptureRefs.some((ref) => (ref.fromVerse !== undefined) === (spot.verse !== undefined) && scriptureReferencesOverlap(ref, there)));
  };
  // The words under the title follow the place the window names: the verse says its own, a chapter says it is whole.
  const wordsOf = (ref: ScriptureReference) => {
    if (onChapter || ref.fromVerse === undefined) {
      const chapters = ref.toChapter !== undefined && ref.toChapter > (ref.chapter ?? 0);
      return t(chapters ? 'comment.wholeChapters' : 'comment.wholeChapter', { place: labelOf(ref) });
    }
    const raw = text?.chapters[(ref.chapter ?? 1) - 1]?.[ref.fromVerse - 1];
    return raw ? verseWords(raw) : '';
  };
  const named = moved ?? (ownName ? home : null);
  // A screen that says how it names places has the window name its own — every piece of it, where its Bible parts it
  // (Codex review r4, 2026-10-28) — and so does the window that took another device's place.
  const homeLabel = (place: string) => ((ownName || placeOf) && home ? labelOf(home) : place);

  // A new comment keeps the place it is written to; a written one, only a place it is moving to.
  const keptPlace = newPlace !== undefined ? moved ?? newPlace : moved;
  const waits = (kept: ScriptureReference | null | undefined) => !choosesOwn && Boolean(kept) && !(keptPlace && sameScriptureReference(kept!, keptPlace));
  const list = here && home ? {
    bible: placeBible, locale, at: spotIn(here), home: spotIn(home), text, taken, onPick: pick, onHide: () => setOpen(false),
    // Its numbers are the comment's own Bible's: said where the screen reads another.
    writtenIn: placeBible !== screenBible ? placeBible : undefined,
  } : null;

  return {
    labelOf,
    moved,
    keptPlace,
    /** The button beside the place shows where the window shows a place and does not choose it its own way. */
    movable: Boolean(list) && !choosesOwn,
    /** Where it stood when the window opened, or the other device's place taken since: «Было у …». */
    homeLabel,
    /** The place the title names: the one moved to, else where it stands. */
    shown: (place: string) => (moved ? labelOf(moved) : homeLabel(place)),
    /** A place kept on the device that differs from the one held now: it waits to be brought back with the words. */
    waits,
    /** The place an offer of words from last time brings back, named; null where it brings none. */
    offered: (kept: ScriptureReference | null | undefined) => (kept && (choosesOwn || waits(kept)) ? labelOf(kept) : null),
    /**
     * What a save of a written comment writes for its place: moving changes its first reference, any others stay; the list
     * the window opened with is the baseline — the very list read, so a reference given its Bible on reading compares as stored.
     */
    write: (openedRefs: ScriptureReference[]) => (moved
      ? { updates: { scriptureRefs: [moved, ...openedRefs.slice(1)] }, baseline: { scriptureRefs: openedRefs } }
      : { updates: {}, baseline: {} }),
    open,
    buttonRef,
    toggle: () => setOpen((now) => !now),
    putBack: () => setMoved(null),
    /** The other device's version taken whole: its place stands, the one chosen here is let go, and the window names it. */
    tookTheirs: () => {
      setMoved(null);
      setOwnName(true);
    },
    /** A place a draft kept, brought back with the words as it was chosen; the window choosing its own place takes it its own way. */
    bringBack: (ref: ScriptureReference) => (choosesOwn ? restoreOwn?.(ref) : setMoved(home && sameScriptureReference(ref, home) ? null : ref)),
    /** The words under the title: of the place moved to or taken from another device, else as the screen gave them. */
    context: named ? wordsOf(named) : context,
    /** What the list of places is drawn with; null where the comment stands on no verse or chapter. */
    list,
  };
}

/**
 * The place under the window's title: «Было у Ис 40:31 — перенесётся по «Готово»» with «Вернуть» once it is moved, the
 * list of places while open, and the words of the place it stands on now.
 */
export function CommentPlaceShown({ where, place, busy, deciding }: {
  where: ReturnType<typeof useCommentPlace>;
  /** Where it stood when the window opened, as the screen under it names it. */
  place: string;
  busy: boolean;
  /** Words from last time wait for an answer: they may bring their own place back, so no place is chosen meanwhile. */
  deciding: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {where.moved ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 dark:text-gray-300" data-testid="comment-moved">
          <span>{t('comment.movedFrom', { place: where.homeLabel(place) })}</span>
          <button type="button" onClick={where.putBack} disabled={busy} className="min-h-8 rounded-lg bg-indigo-50 px-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950">
            {t('comment.moveBack')}
          </button>
        </div>
      ) : null}
      {/* Shut while a save is accepted: a place chosen then would show, and the place sent would be saved (Codex review r2). */}
      {where.movable && where.open && where.list && !deciding && !busy ? <CommentPlaceList {...where.list} /> : null}
      {where.context ? <p className="font-serif text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">{where.context}</p> : null}
    </>
  );
}

/**
 * THE BUTTON BESIDE A COMMENT'S PLACE (the owner, 2026-10-28: placement A, «карандаш в квадрате»): the sign of «edit the
 * entry», not the reader's pencil of marks. Lit while the list of places is open.
 */
export function MovePlaceButton({ open, disabled, onToggle }: { open: boolean; disabled?: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={open}
      aria-label={t('comment.move')}
      title={t('comment.move')}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-50 ${open
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'}`}
    >
      <PencilSquareIcon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}

type Row = { kind: 'head'; key: string; label: string } | { kind: 'spot'; key: string; spot: CommentSpot; label: string; words: string };

/**
 * THE PLACES A COMMENT MAY MOVE TO (case 2026-10-12-block-diagram; the owner, 2026-10-28: «пять стихов вверх, пять стихов вниз,
 * что можно покручивать, а другое место — книгу, главу и стих, клац-клац-клац»): the verses around the place chosen now,
 * with their words, across a chapter's edge — or the chapters around it for a comment on a chapter. Where it stands and
 * where another comment already is are said on their rows. «Другое место…» opens the reader's own window of books,
 * chapters and verses, choosing instead of opening.
 */
export function CommentPlaceList({ bible, locale, at, home, text, taken, onPick, onHide, writtenIn }: {
  /** The Bible the places are counted in and shown by. */
  bible: BibleId;
  /** The comment's own Bible, named where the screen under the window reads another. */
  writtenIn?: BibleId;
  locale: AppLocale;
  /** The place chosen now: the list stands around it. */
  at: CommentSpot;
  /** Where the comment stands until «Готово». */
  home: CommentSpot;
  /** The text of `at`'s book, for what each verse says; absent while it comes. */
  text: BookText | null;
  /** Whether another comment stands at this place. */
  taken: (spot: CommentSpot) => boolean;
  onPick: (spot: CommentSpot) => void;
  onHide: () => void;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 768px)', false);
  const [choosing, setChoosing] = useState(false);
  const otherRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atRef = useRef<HTMLButtonElement | null>(null);
  const byChapter = at.verse === undefined;
  const bookName = getLocalizedBookName(at.book, locale);
  const chapterName = (chapter: number) => t(at.book === 'Psalms' ? 'bible.psalm' : 'bible.chapter', { number: chapter });
  const said = (chapter: number, verse: number) => {
    const raw = text?.chapters[chapter - 1]?.[verse - 1];
    return raw ? verseWords(raw) : '';
  };

  const rows: Row[] = [];
  if (byChapter) {
    for (const chapter of chaptersAround(bible, at.book, at.chapter)) {
      rows.push({ kind: 'spot', key: `c${chapter}`, spot: { book: at.book, chapter }, label: chapterName(chapter), words: said(chapter, 1) });
    }
  } else {
    let chapter = 0;
    for (const spot of versesAround(bible, at.book, { chapter: at.chapter, verse: at.verse ?? 1 })) {
      if (spot.chapter !== chapter) {
        chapter = spot.chapter;
        rows.push({ kind: 'head', key: `h${chapter}`, label: `${bookName} · ${chapterName(chapter)}` });
      }
      rows.push({ kind: 'spot', key: `${spot.chapter}:${spot.verse}`, spot: { book: at.book, ...spot }, label: `${spot.chapter}:${spot.verse}`, words: said(spot.chapter, spot.verse) });
    }
  }

  // Opened with the place chosen now in the middle of the list: five above it are there to scroll to.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const row = atRef.current;
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2;
  }, [at.book, at.chapter, at.verse]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" data-testid="comment-place-list">
      <div className="flex items-center gap-2 border-b border-gray-100 py-1.5 pl-3 pr-1.5 dark:border-gray-800">
        <span className="flex-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
          {t(byChapter ? 'comment.moveToChapter' : 'comment.moveToVerse')}
          {writtenIn ? ` · ${t('bible.writtenIn', { translation: t(`bible.translations.${writtenIn}.name`) })}` : null}
        </span>
        <button type="button" onClick={onHide} className="min-h-8 rounded-lg px-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
          {t('comment.moveHide')}
        </button>
      </div>
      <div ref={scrollRef} className="relative max-h-72 overflow-y-auto">
        {rows.map((row) => {
          if (row.kind === 'head') {
            return <div key={row.key} className="bg-gray-50 px-3 py-1 text-[11px] font-bold text-gray-400 dark:bg-gray-950 dark:text-gray-500">{row.label}</div>;
          }
          const current = sameSpot(row.spot, at);
          const note = sameSpot(row.spot, home) ? t('comment.placeHere') : taken(row.spot) ? t('comment.placeTaken') : '';
          return (
            <button
              key={row.key}
              ref={current ? atRef : undefined}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => onPick(row.spot)}
              className={`flex min-h-11 w-full items-center gap-2.5 border-b border-gray-100 px-3 text-left last:border-b-0 dark:border-gray-800 ${current
                ? 'bg-indigo-50 dark:bg-indigo-900/50'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
            >
              <span className={`shrink-0 text-xs font-bold tabular-nums text-gray-400 dark:text-gray-500 ${byChapter ? '' : 'min-w-10'}`}>{row.label}</span>
              <span className="min-w-0 flex-1 truncate font-serif text-sm text-gray-700 dark:text-gray-300">{row.words}</span>
              {note ? <span className="shrink-0 text-[11px] font-semibold text-gray-500 dark:text-gray-400">{note}</span> : null}
            </button>
          );
        })}
      </div>
      <button
        ref={otherRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={choosing}
        onClick={() => setChoosing(true)}
        className="block min-h-11 w-full border-t border-gray-100 px-3 text-left text-sm font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-gray-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
      >
        {t(byChapter ? 'comment.moveElsewhereChapter' : 'comment.moveElsewhere')}
      </button>
      {choosing ? (
        <BookNavigator
          start="books"
          bookId={at.book}
          bible={bible}
          currentChapter={at.chapter}
          currentVerse={at.verse ?? 1}
          text={text}
          locale={locale}
          wide={wide}
          anchorRef={otherRef}
          choosing={byChapter ? 'chapter' : 'verse'}
          layerClassName="z-[120]"
          centered
          label={t('comment.moveElsewhereLabel')}
          actionLabel={t('comment.moveHere')}
          onClose={() => {
            setChoosing(false);
            otherRef.current?.focus();
          }}
          onOpen={(book, place) => {
            setChoosing(false);
            onPick(byChapter ? { book, chapter: place.chapter } : { book, chapter: place.chapter, verse: place.verse });
          }}
        />
      ) : null}
    </div>
  );
}
