'use client';

import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { bookIdFromSlug, bookSlug } from '@/utils/bibleText';
import { placeIn } from '@/utils/versification';

import { TranslationPicker } from './BiblePicker';
import { booksOf } from './bookOrder';

import type { LastPlace } from './lastPlace';
import type { BibleId } from '@/utils/bibles';


type BibleBookListProps = {
  /** The Bible read: its order of books, and the numbering "Continue" is said in. */
  bible: BibleId;
  lastPlace: LastPlace | null;
  onOpen: (slug: string, place?: { chapter: number; verse: number }) => void;
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

  const testaments = booksOf(bible).map((testament) => ({
    ...testament,
    title: t(testament.key === 'old' ? 'bible.oldTestament' : 'bible.newTestament'),
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">{t('bible.title')}</h1>
        <TranslationPicker bible={bible} wide={wide} onPick={onChangeBible} />
      </div>

      {lastPlace && continueAt ? (
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
                      <button
                        type="button"
                        onClick={() => onOpen(bookSlug(bookId))}
                        className="inline-flex min-h-10 items-center rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
                      >
                        {getLocalizedBookName(bookId, locale)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
