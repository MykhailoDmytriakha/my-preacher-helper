'use client';

import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { bookIdFromSlug, bookSlug } from '@/utils/bibleText';
import { placeIn } from '@/utils/versification';

import { BookOnList, TranslationPicker } from './BiblePicker';
import { booksOf } from './bookOrder';
import { PlaceTrailOnList } from './PlaceTrail';
import { usePlaceTrail } from './placeTrailStore';
import { BibleSearch } from './search/BibleSearch';

import type { LastPlace } from './lastPlace';
import type { BibleId } from '@/utils/bibles';


type BibleBookListProps = {
  /** The Bible read: its order of books, and the numbering "Continue" is said in. */
  bible: BibleId;
  lastPlace: LastPlace | null;
  /** A book, at a place; `toVerse` lights a verse found by the search line. */
  onOpen: (slug: string, place?: { chapter: number; verse: number; toVerse?: number }) => void;
  onChangeBible: (bible: BibleId) => void;
};

export function BibleBookList({ bible, lastPlace, onOpen, onChangeBible }: BibleBookListProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n.language);
  const lastBookId = lastPlace ? bookIdFromSlug(lastPlace.slug) : undefined;
  // "Continue" in the Bible read now, even when the place was left in another one.
  const continueAt = lastPlace && lastBookId
    ? (lastPlace.bible === bible ? lastPlace : placeIn(bible, lastPlace.bible, { book: lastBookId, chapter: lastPlace.chapter, verse: lastPlace.verse }))
    : null;
  const wide = useMediaQuery('(min-width: 768px)', false);
  const trail = usePlaceTrail();

  const testaments = booksOf(bible).map((testament) => ({
    ...testament,
    title: t(testament.key === 'old' ? 'bible.oldTestament' : 'bible.newTestament'),
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* The translation at the right edge, where the reader's line has it. */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">{t('bible.title')}</h1>
        <span className="ml-auto flex min-w-0">
          <TranslationPicker bible={bible} wide={wide} onPick={onChangeBible} />
        </span>
      </div>

      {/* THE ONE LINE (canvas v58): a place or words, «где + что». While it holds words, what it found
          stands in place of the page below. The line, the trail and the Testaments share the page's two edges. */}
      <BibleSearch
        bible={bible}
        locale={locale}
        wide={wide}
        surface="page"
        autoFocus={wide}
        onOpen={({ bookId, chapter, verse, toVerse }) => onOpen(bookSlug(bookId), { chapter, verse, ...(toVerse ? { toVerse } : {}) })}
      >
        <div className="mt-6 flex flex-col gap-6">
          {/* Where the person has been, the place they stopped lit; "Continue" only for a device with no trail yet. */}
          {trail.links.length > 0 ? (
            <PlaceTrailOnList trail={trail} bible={bible} locale={locale} onOpen={(book, place) => onOpen(bookSlug(book), place)} />
          ) : lastPlace && continueAt ? (
            <div>
              <button
                type="button"
                onClick={() => onOpen(lastPlace.slug, { chapter: continueAt.chapter, verse: continueAt.verse })}
                className="inline-flex min-h-11 items-center rounded-full border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
              >
                {t('bible.continueReading', { place: `${getLocalizedAbbrev(lastBookId as string, locale)} ${continueAt.chapter}:${continueAt.verse}` })}
              </button>
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            {testaments.map((testament) => (
              <section
                key={testament.key}
                aria-label={testament.title}
                className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-gray-700 dark:bg-gray-900"
              >
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{testament.title}</h2>
                {testament.groups.map((group) => (
                  <div key={group.key} className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t(`bible.groups.${group.key}`)}
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {group.ids.map((bookId) => (
                        <li key={bookId}>
                          {/* A press: its chapters, then a chapter's verses; a hold: the book at its start — as in the reader. */}
                          <BookOnList
                            bookId={bookId}
                            bible={bible}
                            locale={locale}
                            wide={wide}
                            here={bookId === lastBookId && continueAt ? { chapter: continueAt.chapter, verse: continueAt.verse } : undefined}
                            onOpen={(book, place) => onOpen(bookSlug(book), place)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <p className="-mt-3 text-[13px] leading-5 text-gray-500 dark:text-gray-400">{t('bible.holdBookHint')}</p>
        </div>
      </BibleSearch>
    </div>
  );
}
