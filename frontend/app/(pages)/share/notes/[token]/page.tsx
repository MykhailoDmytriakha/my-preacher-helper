'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import '@locales/i18n';
import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import { useAuth } from '@/providers/AuthProvider';
import { readLanguageCookie } from '@/services/userSettings.service';
import { resolveAppLocale } from '@/utils/appLocale';
import { studyNoteLanguage } from '@/utils/documentLanguage';
import { formatScriptureReferences } from '@/utils/scriptureReference';
import { studyNoteOwnName } from '@/utils/studyNoteUtils';
import ThemeModeToggle from '@components/navigation/ThemeModeToggle';
import { useTranslation } from '@locales/useTranslation';

import { SharedNoteReader } from './SharedNoteReader';

import type { ScriptureReference } from '@/models/models';

const PAGE_CONTAINER_CLASS = 'min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100';
const CONTENT_WRAPPER_CLASS = 'mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6';

type ShareNoteStatus = 'loading' | 'ready' | 'notFound' | 'unavailable' | 'error';

// A study can gather forty passages; under the title they are a preview, not the index.
const PASSAGE_PREVIEW = 6;

interface ShareNotePayload {
  content: string;
  title?: string;
  scriptureRefs?: ScriptureReference[];
}

export default function SharedNotePage() {
  const { t, language: interfaceLanguage, i18n } = useTranslation();
  // The Bible page is behind sign-in: a reader with an account is offered it from the verse window,
  // a reader without one reads the passage in the window and stays on the note.
  const { user, loading: authLoading } = useAuth();
  const params = useParams<{ token?: string }>();
  const token = params?.token;

  const [status, setStatus] = useState<ShareNoteStatus>('loading');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);

  // The link's preview card names the note the way every screen does (title, else first passage);
  // the page opened from that card shows the same name above the text, or the card promised
  // something the page hides. A passage that became the heading is not repeated under it.
  const locale = resolveAppLocale(interfaceLanguage);
  const heading = studyNoteOwnName({ title, scriptureRefs }, locale);
  const passageRefs = title ? scriptureRefs : scriptureRefs.slice(1);
  const passages = formatScriptureReferences(passageRefs, { locale, style: 'long', limit: PASSAGE_PREVIEW });
  const hiddenPassages = Math.max(0, passageRefs.length - PASSAGE_PREVIEW);

  // A reader who has chosen no language — no account, nothing stored on this device — reads the note's
  // page in the note's language, and the verse window follows it to that language's Bible (the owner,
  // 2026-11-18: a Russian note opened in a private window showed the passages in English). Nothing is
  // stored: the reader's own choice, once made, still wins everywhere.
  const noteLanguage = status === 'ready' ? studyNoteLanguage({ title, content }) : null;
  useEffect(() => {
    if (!noteLanguage || authLoading || user || readLanguageCookie()) return;
    if (interfaceLanguage !== noteLanguage) void i18n.changeLanguage(noteLanguage);
  }, [noteLanguage, authLoading, user, interfaceLanguage, i18n]);

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
        // The server is there but cannot read the note now (the database's daily quota spent):
        // the link is fine, it is the moment that is wrong (BUG-20261019-routes-hang-when-store-refuses).
        if (response.status === 503) {
          setStatus('unavailable');
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

  // As in the app, the Scripture in the note is a link that opens the passage over the page (the owner,
  // 2026-11-17), read in the language the note is written in.
  const writtenIn = studyNoteLanguage({ title, content });
  return (
    <ScriptureLinksInWindow writtenIn={writtenIn} toBible={Boolean(user)}>
    <div className={PAGE_CONTAINER_CLASS}>
      {status === 'ready' && token ? (
        <SharedNoteReader
          token={token}
          content={content}
          heading={heading}
          passages={passages}
          hiddenPassages={hiddenPassages}
          scriptureRefs={scriptureRefs}
          writtenIn={writtenIn ?? locale}
        />
      ) : (
      <div className={CONTENT_WRAPPER_CLASS}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400" suppressHydrationWarning={true}>
            {t('shareNotes.title')} · {t('shareNotes.subtitle')}
          </p>
          <ThemeModeToggle variant="compact" className="shrink-0" />
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

        {status === 'unavailable' && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            suppressHydrationWarning={true}
          >
            {t('shareNotes.unavailable')}
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
      </div>
      )}
    </div>
    </ScriptureLinksInWindow>
  );
}
