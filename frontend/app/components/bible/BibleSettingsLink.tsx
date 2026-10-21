'use client';

import { ChevronRightIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { settingsSectionHref } from '@/utils/settingsSections';

/**
 * The way from the reader's "T" to the Bible's own settings (the owner, 2026-10-20: the "T" is about the
 * text, the Bible's settings live in Settings → Bible — and the reader leads there in one tap).
 */
export function BibleSettingsLink() {
  const { t } = useTranslation();
  return (
    <Link
      href={settingsSectionHref('bible')}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
    >
      <span className="inline-flex items-center gap-2">
        <Cog6ToothIcon className="h-5 w-5" aria-hidden="true" />
        {t('bible.settingsLink')}
      </span>
      <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}
