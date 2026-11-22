'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { findNewNoteDrafts, newNoteDraftHref, newNoteDraftId, type NewNoteDraft } from '@/utils/newNoteDrafts';
import { isRecordingOnlyNoteDraft } from '@/utils/studyNoteAudioRecovery';
import { useTranslation } from '@locales/useTranslation';

import UnassignedNoteRecordings from './UnassignedNoteRecordings';
import UnreadableNoteDrafts from './UnreadableNoteDrafts';

import type { StudyNote } from '@/models/models';

type NoteCreation = Pick<StudyNote, 'id' | 'title' | 'content' | 'recordingSourceIds' | 'dictationSourceIds'>;
const NO_CONFIRMED_CREATIONS: ReadonlySet<string> = new Set();

export default function UnfinishedNoteDrafts({ uid, notes, confirmedCreationIds = NO_CONFIRMED_CREATIONS, confirmedDictationSources, listCreations, canClassifyRecordings = true, beforeNavigate }: {
  uid: string | undefined;
  notes: ReadonlyArray<Pick<StudyNote, 'id' | 'recordingSourceIds' | 'dictationSourceIds'>>;
  confirmedCreationIds?: ReadonlySet<string>;
  confirmedDictationSources?: ReadonlyMap<string, readonly string[]>;
  listCreations?: () => Promise<NoteCreation[]>;
  canClassifyRecordings?: boolean;
  beforeNavigate?: (navigate: () => void) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<{ uid: string; drafts: NewNoteDraft[] } | null>(null);
  const refresh = useCallback(() => {
    if (uid) setSnapshot({ uid, drafts: findNewNoteDrafts(uid, new Set(notes.map(note => note.id)), confirmedCreationIds) });
  }, [uid, notes, confirmedCreationIds]);
  useEffect(() => {
    if (!uid) return;
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh, uid]);
  const [closed, setClosed] = useState<{ uid: string; notes: NoteCreation[] } | null>(null);
  useEffect(() => {
    if (!uid || !listCreations) return;
    let active = true;
    const read = () => { void listCreations().then(notes => { if (active) setClosed({ uid, notes }); }, () => undefined); };
    read();
    window.addEventListener('focus', read);
    return () => { active = false; window.removeEventListener('focus', read); };
  }, [uid, listCreations]);
  const drafts = snapshot && snapshot.uid === uid ? snapshot.drafts : [];
  const represented = new Set(notes.map(note => note.id));
  const creations = closed && closed.uid === uid ? [...new Map(closed.notes.map(note => [note.id, note])).values()]
    .filter(note => !represented.has(note.id) && !confirmedCreationIds.has(note.id)) : [];
  const navigate = (href: string) => beforeNavigate && ((event: { preventDefault(): void }) => {
    event.preventDefault();
    beforeNavigate(() => router.push(href));
  });
  if (!uid) return null;
  return (
    <>
    <UnreadableNoteDrafts owner={uid} />
    {(drafts.length > 0 || creations.length > 0) && <section aria-labelledby="unfinished-notes-title" className="my-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 id="unfinished-notes-title" className="font-semibold text-amber-900 dark:text-amber-200">{t('studiesWorkspace.unfinished.title')}</h2>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t('studiesWorkspace.unfinished.description')}</p>
      <ul className="mt-3 space-y-2">
        {creations.map(note => {
          const href = newNoteDraftHref(newNoteDraftId(note.id), uid);
          return <li key={note.id}>
            <Link href={href} onNavigate={navigate(href)} className="block min-w-0 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm hover:bg-amber-100 dark:border-amber-500/30 dark:bg-gray-900 dark:hover:bg-amber-500/10">
              <span className="block break-words font-medium text-gray-900 dark:text-gray-100">{note.title?.trim() || t('studiesWorkspace.untitled')}</span>
              {note.content.trim() && <span className="mt-1 block break-words text-gray-600 dark:text-gray-300">{note.content.replace(/\s+/g, ' ').trim().slice(0, 180)}</span>}
              <span className="mt-1 block font-medium text-amber-800 dark:text-amber-200">{t('studiesWorkspace.unfinished.continue')}</span>
            </Link>
          </li>;
        })}
        {drafts.map(draft => {
          const href = newNoteDraftHref(draft.docId, uid, draft.key, draft.created ? draft.creationTargetId : undefined);
          return (
            <li key={draft.key}>
              <Link href={href} onNavigate={navigate(href)} className="block min-w-0 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm hover:bg-amber-100 dark:border-amber-500/30 dark:bg-gray-900 dark:hover:bg-amber-500/10">
                <span className="block break-words font-medium text-gray-900 dark:text-gray-100">{draft.value.title.trim() || t('studiesWorkspace.untitled')}</span>
                {isRecordingOnlyNoteDraft(draft.value) && <span className="mt-1 block text-gray-600 dark:text-gray-300">{t('studiesWorkspace.unfinished.recording')}</span>}
                {draft.value.content.trim() && <span className="mt-1 block break-words text-gray-600 dark:text-gray-300">{draft.value.content.replace(/\s+/g, ' ').trim().slice(0, 180)}</span>}
                <span className="mt-1 block font-medium text-amber-800 dark:text-amber-200">{t(draft.created ? 'recordAvailability.keptCopy' : 'studiesWorkspace.unfinished.continue')}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>}
    {canClassifyRecordings && <UnassignedNoteRecordings uid={uid} notes={[...notes, ...creations]} drafts={drafts} confirmedDictationSources={confirmedDictationSources} beforeNavigate={beforeNavigate} onCopied={refresh} />}
    </>
  );
}
