'use client';

import { ArrowLeftIcon, LinkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';

import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';

import ShareLinksPanel from '../components/ShareLinksPanel';

export default function ShareLinksPage() {
  const { t } = useTranslation();
  const { notes, loading: notesLoading } = useStudyNotes();
  const {
    shareLinks,
    loading: shareLinksLoading,
    createShareLink,
    deleteShareLink,
  } = useStudyNoteShareLinks();

  const loading = notesLoading || shareLinksLoading;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-100 dark:ring-emerald-800/60">
            <LinkIcon className="h-4 w-4" />
            {t('studiesWorkspace.shareLinks.title')}
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {t('studiesWorkspace.shareLinks.manageButton')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('studiesWorkspace.shareLinks.subtitle')}
          </p>
        </div>
        <Link
          href="/studies"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t('common.back')}
        </Link>
      </header>

      <ShareLinksPanel
        notes={notes}
        shareLinks={shareLinks}
        loading={loading}
        onCreate={createShareLink}
        onDelete={deleteShareLink}
      />
    </section>
  );
}
