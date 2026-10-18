import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import { useAuth } from '@/providers/AuthProvider';
import { copyRecordingIntoNewNote, unassignedStudyRecordingFilter } from '@/utils/studyNoteAudioRecovery';
import { useTranslation } from '@locales/useTranslation';

import type { StudyNote } from '@/models/models';
import type { NewNoteDraft } from '@/utils/newNoteDrafts';

export default function UnassignedNoteRecordings({ uid, notes, drafts }: {
  uid: string;
  notes: ReadonlyArray<Pick<StudyNote, 'id' | 'recordingSourceIds' | 'dictationSourceIds'>>;
  drafts: readonly NewNoteDraft[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, loading } = useAuth();
  const owner = loading ? undefined : user?.uid;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filterDraft = useMemo(() => unassignedStudyRecordingFilter(notes, drafts), [notes, drafts]);
  if (owner !== uid) return null;
  return <RecordingDraftBanner context="study" filterDraft={filterDraft}
    collapsedLabel={t('studiesWorkspace.unassignedAudio.title')}
    hintKey="studiesWorkspace.unassignedAudio.hint"
    resendLabelKey="studiesWorkspace.unassignedAudio.copy"
    header={<p className="text-sm text-gray-600 dark:text-gray-300">{t('studiesWorkspace.unassignedAudio.description')}</p>}
    onResend={async (_blob, draft) => {
      if (!mounted.current || currentOwner.current !== uid) return false;
      const href = await copyRecordingIntoNewNote(draft.id, uid);
      if (mounted.current && currentOwner.current === uid) router.push(href);
      return false;
    }} />;
}
