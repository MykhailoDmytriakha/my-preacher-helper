'use client';

import { BookOpenIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { CareSectionHeader } from '@/components/care/CareSectionHeader';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useSearchInputQuery } from '@/hooks/useSearchInputQuery';
import { buildChipClasses } from '@/utils/chipClasses';
import { NEUTRAL_CAPTION } from '@/utils/themeColors';
import { OCCASIONS, OCCASION_KINDS, occasionNameKey, occasionNameMatches } from '@/utils/wordForOccasion';
import { useTranslation } from '@locales/useTranslation';

import '@locales/i18n';

/**
 * A WORD FOR THE OCCASION — the index (`utils/wordForOccasion.ts`): every topic the Gideons'
 * indexes name, one chip each, in three groups — life situations, virtues, foundations of faith —
 * so the whole index is seen at a glance before a visit, the owner's "open it, look, and
 * remember", and "where is it written about Christ's birth?" is found by eye. A chip opens the
 * topic's places.
 *
 * The particular cases (hospital, before surgery, serious injury, accident) keep their place at
 * the top, dimmed with "soon": the owner reserved it and will say what goes there (2026-11-10).
 * The search is kept in the address (`useSearchInputQuery`), so coming back from a situation finds
 * the same letters typed.
 */
export default function WordForOccasionPage() {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const search = useSearchInputQuery('q');

  const occasions = useMemo(
    () => OCCASIONS
      .map((occasion) => ({ id: occasion.id, kind: occasion.kind, name: t(occasionNameKey(occasion.id)), count: occasion.places.length }))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [t, locale],
  );
  const shown = occasions.filter((occasion) => occasionNameMatches(occasion.name, search.value));
  // One index, three kinds of the Gideons' lists: a group the search empties steps aside.
  const groups = OCCASION_KINDS
    .map((kind) => ({ kind, all: occasions.filter((o) => o.kind === kind).length, shown: shown.filter((o) => o.kind === kind) }))
    .filter((group) => group.shown.length > 0);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href="/care"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        {t('careWord.backToCare')}
      </Link>

      <CareSectionHeader
        title={t('care.sections.word.title')}
        titleClassName="text-emerald-700 dark:text-emerald-300"
        icon={<BookOpenIcon className="h-7 w-7 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
        description={t('careWord.subtitle')}
      />

      {/* Reserved, not built: quiet grey, no press — a place waiting, not a broken button. */}
      <section
        aria-label={t('careWord.casesTitle')}
        className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-gray-300 px-4 py-3.5 dark:border-gray-700"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-500 dark:text-gray-400">{t('careWord.casesTitle')}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {t('care.soon')}
          </span>
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">{t('careWord.casesList')}</span>
      </section>

      <div className="relative mt-6">
        <label htmlFor="word-for-occasion-search" className="sr-only">{t('careWord.searchLabel')}</label>
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 dark:text-gray-400"
          aria-hidden="true"
        />
        <input
          id="word-for-occasion-search"
          ref={search.inputRef}
          type="search"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          placeholder={t('careWord.searchPlaceholder')}
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-gray-300 bg-white pl-11 pr-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {groups.length ? groups.map((group) => (
        <section key={group.kind} aria-labelledby={`word-kind-${group.kind}`} className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={`word-kind-${group.kind}`} className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t(`careWord.kinds.${group.kind}`)}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('careWord.count', { count: group.all })}</span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {group.shown.map((occasion) => (
              <li key={occasion.id}>
                <Link
                  href={`/care/word/${occasion.id}`}
                  className={buildChipClasses({ tone: 'neutral', size: 'lg', interactive: true })}
                >
                  <span>{occasion.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{occasion.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )) : (
        <p className="mt-6 text-sm text-gray-600 dark:text-gray-300">{t('careWord.noMatch')}</p>
      )}

      <p className={`mt-7 text-xs leading-relaxed ${NEUTRAL_CAPTION}`}>{t('careWord.sources')}</p>
    </div>
  );
}
