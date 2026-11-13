import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import { useAuth } from '@/providers/AuthProvider';
import { hasModalLayers } from '@/utils/modalLayerRegistry';
import { copyRecordingIntoNewNote, unassignedStudyRecordingFilter } from '@/utils/studyNoteAudioRecovery';
import { useTranslation } from '@locales/useTranslation';

import type { StudyNote } from '@/models/models';
import type { NewNoteDraft } from '@/utils/newNoteDrafts';

export default function UnassignedNoteRecordings({ uid, notes, drafts, beforeNavigate, onCopied }: {
  uid: string;
  notes: ReadonlyArray<Pick<StudyNote, 'id' | 'recordingSourceIds' | 'dictationSourceIds'>>;
  drafts: readonly NewNoteDraft[];
  beforeNavigate?: (navigate: () => void) => void;
  onCopied: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, loading } = useAuth();
  const owner = loading ? undefined : user?.uid;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const currentNavigation = useRef(beforeNavigate);
  currentNavigation.current = beforeNavigate;
  const refresh = useRef(onCopied);
  refresh.current = onCopied;
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
      if (mounted.current && currentOwner.current === uid) {
        refresh.current();
        // An analysis may finish opening without changing the list's navigation callback.
        // Its editor owns departure once it has a modal layer.
        if (currentNavigation.current !== beforeNavigate || hasModalLayers()) return false;
        const navigate = () => {
          if (mounted.current && currentOwner.current === uid && !hasModalLayers()) router.push(href);
        };
        if (beforeNavigate) beforeNavigate(navigate);
        else navigate();
      }
      return false;
    }} />;
}
