'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';
import MarkdownDisplay from '@components/MarkdownDisplay';
import ThemeModeToggle from '@components/navigation/ThemeModeToggle';

const PAGE_CONTAINER_CLASS = 'min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100';
const CONTENT_WRAPPER_CLASS = 'mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6';

type ShareNoteStatus = 'loading' | 'ready' | 'notFound' | 'error';

interface ShareNotePayload {
  content: string;
}

export default function SharedNotePage() {
  const { t } = useTranslation();
  const params = useParams<{ token?: string }>();
  const token = params?.token;

  const [status, setStatus] = useState<ShareNoteStatus>('loading');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      try {
        setStatus('loading');
        const response = await fetch(`/api/share/notes/${token}`, { cache: 'no-store' });
        if (response.status === 404) {
          setStatus('notFound');
          return;
        }
        if (!response.ok) {
          setStatus('error');
          return;
        }
        const payload = (await response.json()) as ShareNotePayload;
        setContent(payload.content || '');
        setStatus('ready');
      } catch (error) {
        console.error('Failed to load shared note', error);
        setStatus('error');
      }
    };

    load();
  }, [token]);

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <div className={CONTENT_WRAPPER_CLASS}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold" suppressHydrationWarning={true}>
              {t('shareNotes.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400" suppressHydrationWarning={true}>
              {t('shareNotes.subtitle')}
            </p>
          </header>
          <ThemeModeToggle variant="compact" className="shrink-0 sm:mt-1" />
        </div>

        {status === 'loading' && (
          <div
            className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            suppressHydrationWarning={true}
          >
            {t('common.loading')}
          </div>
        )}

        {status === 'notFound' && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            suppressHydrationWarning={true}
          >
            {t('shareNotes.notFound')}
          </div>
        )}

        {status === 'error' && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            suppressHydrationWarning={true}
          >
            {t('shareNotes.error')}
          </div>
        )}

        {status === 'ready' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <MarkdownDisplay content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
