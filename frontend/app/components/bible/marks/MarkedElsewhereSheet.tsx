'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';

import { useReadAgainWhenReachable } from '@/hooks/useReadAgainWhenReachable';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { marksOnWord, type MarkColor, type MarkedElsewhere, type VerseMarks } from '@/utils/bibleMarks';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, verseWords, type BookText } from '@/utils/bibleText';
import { useTranslation } from '@locales/useTranslation';

import { ReaderSheet, SheetCloseButton } from '../ReaderSheet';

import { MARK_FILL_CLASS, MARK_RUN_CLASS, wordPaintClass } from './markPaint';

import type { AppLocale } from '@/utils/appLocale';

/*
 * A VERSE MARKED IN ANOTHER BIBLE, OPENED FROM ITS SIGN (2.9.3, the owner, 2026-10-16): the verse whole,
 * in the words of the translation where it was marked, painted as it is painted there — not a list of
 * the marked words. What the colours mean is told under the "T" (`MarkLegend`), not here. "Open in this
 * translation" changes the reader's Bible; the reading place goes along (`placesIn`).
 */
type Entry = { bible: BibleId; verses: MarkedElsewhere[] };

type OtherTexts = ReadonlyMap<BibleId, BookText | 'failed'>;
const NO_TEXTS: OtherTexts = new Map();

/**
 * The other Bibles' texts of the book, fetched once each (kept on the device by the worker) and kept for
 * one book: a text of the book left must not stand under the next one's verse. A text that did not come
 * is said so and read again when the server is back in reach (`useReadAgainWhenReachable`,
 * BUG-20261112-link-texts-stay-dots-after-reconnect) — that one alone: a translation already shown is
 * not read again, where a second failure would take its words away, nor is one still on its way. The
 * person's own asking — the window opened again, another list of translations, the book come back to —
 * reads what did not come at once, as it always did.
 */
function useOtherTexts(bookId: string, bibles: readonly BibleId[]): OtherTexts {
  const [kept, setKept] = useState<{ bookId: string; texts: OtherTexts }>({ bookId, texts: NO_TEXTS });
  const texts = kept.bookId === bookId ? kept.texts : NO_TEXTS;
  const onTheWay = useRef(new Set<string>());
  const shownBook = useRef(bookId);
  shownBook.current = bookId;
  const wanted = bibles.join('|');
  /** The translations on screen now: the death of a read the window no longer shows is nobody's wait any more. */
  const onScreen = useRef(wanted);
  onScreen.current = wanted;
  const { round, begin, due, asking, failed } = useReadAgainWhenReachable();
  useEffect(() => {
    begin(`${bookId}:${wanted}`);
    // An answer for a book the window has left is dropped.
    const put = (bible: BibleId, text: BookText | 'failed') => {
      if (shownBook.current !== bookId) return;
      setKept((known) => ({ bookId, texts: new Map(known.bookId === bookId ? known.texts : NO_TEXTS).set(bible, text) }));
    };
    for (const bible of (wanted ? wanted.split('|') : []) as BibleId[]) {
      const key = `${bookId}:${bible}`;
      const here = texts.get(bible);
      if ((here && here !== 'failed') || onTheWay.current.has(key) || !due(key)) continue;
      const mark = asking(key);
      onTheWay.current.add(key);
      fetchBookText(bookId, bible).then(
        (text) => {
          onTheWay.current.delete(key);
          put(bible, text);
        },
        () => {
          onTheWay.current.delete(key);
          put(bible, 'failed');
          if (shownBook.current === bookId && onScreen.current.split('|').includes(bible)) failed(mark, key);
        },
      );
    }
    // `texts` is read to skip what is here already; reading again on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, wanted, round, begin, due, asking, failed]);
  return texts;
}

/** The colour shared by two neighbouring words paints the space between them too, as in the reader. */
function shared(a: ReturnType<typeof marksOnWord>, b: ReturnType<typeof marksOnWord>) {
  return { color: a.color && a.color === b.color ? a.color : null, pencil: a.pencil && a.pencil === b.pencil ? a.pencil : null };
}

/**
 * Neighbouring words under one marker colour are one band, each line of it rounded, as the reader draws them (the owner,
 * 2026-11-02); the pencil's line stays on its words and on the space it spans.
 */
function PaintedVerse({ raw, marks }: { raw: string; marks: VerseMarks }) {
  const words = verseWords(raw).split(/\s+/).filter(Boolean);
  const on = words.map((_, index) => marksOnWord(marks, index));
  const runs: { color: MarkColor | null; from: number; to: number }[] = [];
  on.forEach(({ color }, index) => {
    const last = runs[runs.length - 1];
    if (last && color !== null && last.color === color) last.to = index;
    else runs.push({ color, from: index, to: index });
  });
  const line = (index: number) => wordPaintClass({ color: null, pencil: shared(on[index], on[index + 1]).pencil });
  return (
    <>
      {runs.map(({ color, from, to }) => {
        const inside = words.slice(from, to + 1).map((word, offset) => (
          <span key={from + offset}>
            <span data-word="" className={wordPaintClass({ color: null, pencil: on[from + offset].pencil })}>{word}</span>
            {from + offset < to ? <span className={line(from + offset)}> </span> : null}
          </span>
        ));
        return (
          <Fragment key={from}>
            {color ? <span data-run="" className={`${MARK_FILL_CLASS[color]} ${MARK_RUN_CLASS}`}>{inside}</span> : inside}
            {to < words.length - 1 ? <span className={line(to)}> </span> : null}
          </Fragment>
        );
      })}
    </>
  );
}

export function MarkedElsewhereSheet({ at, bookId, locale, entries, onClose, onOpenBible }: {
  /** The verse of this Bible whose sign was tapped; nothing — the window is closed. */
  at: { chapter: number; verse: number } | null;
  bookId: string;
  locale: AppLocale;
  entries: readonly Entry[];
  onClose: () => void;
  onOpenBible: (bible: BibleId) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const texts = useOtherTexts(bookId, at ? entries.map((entry) => entry.bible) : []);
  if (!at || entries.length === 0) return null;

  return (
    <ReaderSheet titleId={titleId} onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">
          {getLocalizedAbbrev(bookId, locale)} {at.chapter}:{at.verse}
        </h2>
        <SheetCloseButton onClose={onClose} />
      </div>
      <p className="text-sm leading-snug text-gray-600 dark:text-gray-300">{t('bible.marks.elsewhereIntro')}</p>
      {entries.map(({ bible, verses }) => {
        const text = texts.get(bible);
        return (
          <section key={bible} data-testid={`marked-in-${bible}`} className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t(`bible.translations.${bible}.name`)} · {verses.map((entry) => `${entry.chapter}:${entry.verse}`).join(', ')}
            </h3>
            {text === 'failed' ? (
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">{t('bible.marks.elsewhereNoText')}</p>
            ) : (
              <p lang={BIBLES[bible].language} className="mt-1.5 min-h-[1.65em] font-serif text-lg leading-[1.65] text-gray-800 dark:text-gray-100">
                {text
                  ? verses.map((entry, index) => (
                    <span key={`${entry.chapter}:${entry.verse}`}>
                      {index > 0 ? ' ' : null}
                      {verses.length > 1 ? <sup className="mr-0.5 font-sans text-xs text-gray-500 dark:text-gray-400">{entry.verse}</sup> : null}
                      <PaintedVerse raw={text.chapters[entry.chapter - 1]?.[entry.verse - 1] ?? ''} marks={entry.marks} />
                    </span>
                  ))
                  : <span aria-hidden="true" className="inline-block h-4 w-3/4 animate-pulse rounded bg-gray-200 align-middle dark:bg-gray-700" />}
              </p>
            )}
            <button
              type="button"
              onClick={() => onOpenBible(bible)}
              className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-4 text-base font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
            >
              {t('bible.marks.openThere')}
            </button>
          </section>
        );
      })}
    </ReaderSheet>
  );
}
