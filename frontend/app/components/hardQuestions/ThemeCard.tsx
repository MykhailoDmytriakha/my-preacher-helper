'use client';

import { ChevronRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import { BasisLine } from '@/components/hardQuestions/BasisPlaces';
import { CountChip, themePath } from '@/components/hardQuestions/parts';
import { type ThemeView } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';


/**
 * A THEME IN THE SECTION'S LIST, with what it stands on in sight (the owner chose it from a canvas, 2026-11-26:
 * «ты открываешь, быстро смотришь так: мне нужно вот это основание — раз, два, три, вот основные тексты»). The
 * title, with its count of questions beside it, opens the theme; each basis opens its page; each of a basis's
 * places opens over the list in the page's verse window. A theme with no bases shows its groups, one with no
 * groups its first questions.
 */
export function ThemeCard({ view }: { view: ThemeView }) {
  const { t } = useTranslation();
  const bases = view.theme.bases ?? [];
  const groups = view.theme.groups ?? [];
  const count = view.questions.length;
  return (
    <article className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 sm:px-5 sm:py-4 dark:border-gray-800 dark:bg-gray-900">
      <Link href={themePath(view.theme.id)}
        className="group -mx-1.5 flex items-start gap-3 rounded-lg px-1.5 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40">
        {/* The count follows the title's last word; on a narrow screen it moves under the title rather than crowd it. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="min-w-0 text-[17px] font-bold leading-6 text-gray-900 group-hover:underline dark:text-gray-50">{view.theme.title}</span>
          <CountChip count={count} label={t('hardQuestions.counts.questions', { count })} />
          {view.waiting > 0 && (
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{t('hardQuestions.counts.waiting', { count: view.waiting })}</span>
          )}
        </span>
        <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
      </Link>
      {bases.length ? (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800/70">
          {bases.map((basis) => <BasisLine key={basis.id} themeId={view.theme.id} basis={basis} />)}
        </ul>
      ) : groups.length ? (
        <p className="mt-1.5 text-[13px] text-gray-600 dark:text-gray-400">{groups.map((group) => group.title).join(' · ')}</p>
      ) : count ? (
        <p className="mt-1.5 text-[13px] text-gray-600 dark:text-gray-400">{view.questions.slice(0, 2).map((question) => `«${question.title}»`).join(' ')}</p>
      ) : null}
    </article>
  );
}
