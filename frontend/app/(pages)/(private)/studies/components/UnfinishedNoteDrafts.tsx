'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { findNewNoteDrafts, newNoteDraftHref, retireConfirmedNewNoteDrafts, type NewNoteDraft } from '@/utils/newNoteDrafts';
import { useTranslation } from '@locales/useTranslation';

import type { StudyNote } from '@/models/models';

const NO_CONFIRMED_CREATIONS: ReadonlySet<string> = new Set();

export default function UnfinishedNoteDrafts({ uid, notes, confirmedCreationIds = NO_CONFIRMED_CREATIONS }: {
  uid: string | undefined;
  notes: ReadonlyArray<Pick<StudyNote, 'id'>>;
  confirmedCreationIds?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<{ uid: string; drafts: NewNoteDraft[] } | null>(null);
  useEffect(() => {
    if (!uid) return;
    const refresh = () => {
      retireConfirmedNewNoteDrafts(uid, confirmedCreationIds);
      setSnapshot({ uid, drafts: findNewNoteDrafts(uid, new Set(notes.map(note => note.id)), confirmedCreationIds) });
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [uid, notes, confirmedCreationIds]);
  const drafts = snapshot && snapshot.uid === uid ? snapshot.drafts : [];
  if (!uid || !drafts.length) return null;
  return (
    <section aria-labelledby="unfinished-notes-title" className="my-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 id="unfinished-notes-title" className="font-semibold text-amber-900 dark:text-amber-200">{t('studiesWorkspace.unfinished.title')}</h2>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t('studiesWorkspace.unfinished.description')}</p>
      <ul className="mt-3 space-y-2">
        {drafts.map(draft => (
          <li key={draft.docId}>
            <Link href={newNoteDraftHref(draft.docId, uid)} className="block min-w-0 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm hover:bg-amber-100 dark:border-amber-500/30 dark:bg-gray-900 dark:hover:bg-amber-500/10">
              <span className="block break-words font-medium text-gray-900 dark:text-gray-100">{draft.value.title.trim() || t('studiesWorkspace.untitled')}</span>
              {draft.value.content.trim() && <span className="mt-1 block break-words text-gray-600 dark:text-gray-300">{draft.value.content.replace(/\s+/g, ' ').trim().slice(0, 180)}</span>}
              <span className="mt-1 block font-medium text-amber-800 dark:text-amber-200">{t('studiesWorkspace.unfinished.continue')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
