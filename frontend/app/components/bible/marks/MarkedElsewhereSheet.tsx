'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { marksOnWord, type MarkedElsewhere, type VerseMarks } from '@/utils/bibleMarks';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, verseWords, type BookText } from '@/utils/bibleText';

import { ReaderSheet, SheetCloseButton } from '../ReaderSheet';

import { wordPaintClass } from './markPaint';

import type { AppLocale } from '@/utils/appLocale';

/*
 * A VERSE MARKED IN ANOTHER BIBLE, OPENED FROM ITS SIGN (2.9.3, the owner, 2026-10-16): the verse whole,
 * in the words of the translation where it was marked, painted as it is painted there — not a list of
 * the marked words. What the colours mean is told under the "T" (`MarkLegend`), not here. "Open in this
 * translation" changes the reader's Bible; the reading place goes along (`placesIn`).
 */
type Entry = { bible: BibleId; verses: MarkedElsewhere[] };

/** The other Bibles' texts of the book, fetched once each (kept on the device by the worker). */
function useOtherTexts(bookId: string, bibles: readonly BibleId[]): ReadonlyMap<BibleId, BookText | 'failed'> {
  const [texts, setTexts] = useState<ReadonlyMap<BibleId, BookText | 'failed'>>(new Map());
  const wanted = bibles.join('|');
  useEffect(() => {
    let alive = true;
    for (const bible of (wanted ? wanted.split('|') : []) as BibleId[]) {
      fetchBookText(bookId, bible).then(
        (text) => { if (alive) setTexts((known) => new Map(known).set(bible, text)); },
        () => { if (alive) setTexts((known) => new Map(known).set(bible, 'failed')); },
      );
    }
    return () => { alive = false; };
  }, [bookId, wanted]);
  return texts;
}

/** The colour shared by two neighbouring words paints the space between them too, as in the reader. */
function shared(a: ReturnType<typeof marksOnWord>, b: ReturnType<typeof marksOnWord>) {
  return { color: a.color && a.color === b.color ? a.color : null, pencil: a.pencil && a.pencil === b.pencil ? a.pencil : null };
}

function PaintedVerse({ raw, marks }: { raw: string; marks: VerseMarks }) {
  const words = verseWords(raw).split(/\s+/).filter(Boolean);
  const on = words.map((_, index) => marksOnWord(marks, index));
  return (
    <>
      {words.map((word, index) => (
        <span key={index}>
          <span data-word="" className={wordPaintClass(on[index])}>{word}</span>
          {index < words.length - 1 ? <span className={wordPaintClass(shared(on[index], on[index + 1]))}> </span> : null}
        </span>
      ))}
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
