'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';
import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { resolveAppLocale } from '@/utils/appLocale';
import { formatScriptureReferences } from '@/utils/scriptureReference';
import { studyNoteOwnName } from '@/utils/studyNoteUtils';
import ThemeModeToggle from '@components/navigation/ThemeModeToggle';

import type { ScriptureReference } from '@/models/models';

const PAGE_CONTAINER_CLASS = 'min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100';
const CONTENT_WRAPPER_CLASS = 'mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6';

type ShareNoteStatus = 'loading' | 'ready' | 'notFound' | 'error';

// A study can gather forty passages; under the title they are a preview, not the index.
const PASSAGE_PREVIEW = 6;

interface ShareNotePayload {
  content: string;
  title?: string;
  scriptureRefs?: ScriptureReference[];
}

export default function SharedNotePage() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ token?: string }>();
  const token = params?.token;

  const [status, setStatus] = useState<ShareNoteStatus>('loading');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);

  // The link's preview card names the note the way every screen does (title, else first passage);
  // the page opened from that card shows the same name above the text, or the card promised
  // something the page hides. A passage that became the heading is not repeated under it.
  const locale = resolveAppLocale(i18n?.language);
  const heading = studyNoteOwnName({ title, scriptureRefs }, locale);
  const passageRefs = title ? scriptureRefs : scriptureRefs.slice(1);
  const passages = formatScriptureReferences(passageRefs, { locale, style: 'long', limit: PASSAGE_PREVIEW });
  const hiddenPassages = Math.max(0, passageRefs.length - PASSAGE_PREVIEW);

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
        setTitle(payload.title?.trim() || undefined);
        setScriptureRefs(Array.isArray(payload.scriptureRefs) ? payload.scriptureRefs : []);
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
            <p className="text-sm text-gray-500 dark:text-gray-400" suppressHydrationWarning={true}>
              {t('shareNotes.title')} · {t('shareNotes.subtitle')}
            </p>
            {status === 'ready' && heading && (
              <h1 className="text-2xl font-semibold sm:text-3xl">{heading}</h1>
            )}
            {status === 'ready' && passages && (
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {passages}
                {hiddenPassages > 0 && (
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    {' · '}
                    {t('shareNotes.morePassages', { count: hiddenPassages })}
                  </span>
                )}
              </p>
            )}
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
            <FoldableMarkdown content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
