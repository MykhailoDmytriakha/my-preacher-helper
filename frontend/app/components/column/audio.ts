import { toast } from 'sonner';

import { isUsageCapReachedError } from '@/services/usageLimits';
import { logFailureOnce, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { ranOutOfTime } from '@/utils/aiTimeFailure';
import { newClientId } from '@/utils/clientId';
import { claimRecordingDraftWork, deleteRecordingDraft, saveRecordingDraft, type RecordingDraft } from '@/utils/recordingDraftStore';
import { transcriptionFailureWords } from '@/utils/transcriptionRetryClient';

import { isPointAudioSection } from './utils';

import type { OnAudioThoughtCreated, Translate } from './types';
import type React from 'react';

interface RecordAudioThoughtArgs {
  audioBlob: Blob;
  sectionId: string;
  sermonId: string;
  ownerId: string;
  setIsRecordingAudio: React.Dispatch<React.SetStateAction<boolean>>;
  setAudioError: (error: FailureWords | null) => void;
  setLimitReached?: (limitReached: boolean) => void;
  onAudioThoughtCreated?: OnAudioThoughtCreated;
  t: Translate;
  pointId?: string;
  subPointId?: string;
  successMessage?: string;
  onSuccess?: () => void;
  errorContext: string;
  source?: RecordingDraft;
  isCurrent?: () => boolean;
  onDraftCaptured?: (id: string) => void;
}
const identities = new WeakMap<Blob, { id: string; scope: string }>();
export const outlineRecordingContextId = (sermonId: string, sectionId: string) => JSON.stringify([sermonId, sectionId]);

function sameRecordingDestination(source: RecordingDraft | undefined, ownerId: string, contextId: string, pointId?: string, subPointId?: string): boolean {
  return !source || (source.ownerId === ownerId && source.context === 'outline' && source.contextId === contextId
    && source.destination?.pointId === pointId && source.destination?.subPointId === subPointId);
}

function recordingFailureWords(error: unknown, preserving: boolean): FailureWords {
  if (preserving) return { key: 'audio.draft.saveFailed' };
  return ranOutOfTime(error) ? { key: 'errors.aiOutOfTimeAudio' } : transcriptionFailureWords(error, 'errors.audioProcessing');
}

/** All structure microphones use the same durable source and original destination. */
export const recordAudioThought = async ({
  audioBlob, sectionId, sermonId, ownerId, setIsRecordingAudio, setAudioError, setLimitReached,
  onAudioThoughtCreated, t, pointId, subPointId, successMessage, onSuccess, errorContext,
  source, isCurrent = () => true, onDraftCaptured,
}: RecordAudioThoughtArgs) => {
  const contextId = outlineRecordingContextId(sermonId, sectionId);
  const scope = JSON.stringify([ownerId, contextId, pointId, subPointId]);
  const prior = identities.get(audioBlob);
  const id = source?.id ?? prior?.id ?? newClientId();
  // In work until this take ends here, which also keeps a second press from running it twice; the
  // «unfinished recording» card does not offer it meanwhile (BUG-20261117-recording-card-during-transcription).
  const releaseWork = claimRecordingDraftWork(id);
  if (!releaseWork) return null;
  let preserving = true;
  try {
    if (!ownerId || (prior && prior.scope !== scope) || !sameRecordingDestination(source, ownerId, contextId, pointId, subPointId)) {
      throw new Error('The recording destination is not available');
    }
    identities.set(audioBlob, { id, scope });
    onDraftCaptured?.(id);
    setIsRecordingAudio(true); setAudioError(null); setLimitReached?.(false);
    await saveRecordingDraft({ id, ownerId, blob: audioBlob, mimeType: audioBlob.type || 'audio/webm', context: 'outline', contextId,
      destination: { sectionId, ...(pointId ? { pointId } : {}), ...(subPointId ? { subPointId } : {}) } });
    preserving = false;
    if (!isCurrent()) return null;
    const { createAudioThought } = await import('@/services/thought.service');
    const thought = await createAudioThought(audioBlob, sermonId, 0, 3, pointId, subPointId,
      { id, ...(isPointAudioSection(sectionId) ? { sectionId } : {}) });
    // Server acceptance already owns the text; a failed cleanup keeps an idempotently recoverable source.
    await deleteRecordingDraft(id, ownerId).catch(() => undefined);
    if (isCurrent()) {
      if (isPointAudioSection(sectionId)) onAudioThoughtCreated?.(thought, sectionId);
      onSuccess?.();
      toast.success(successMessage ?? t('manualThought.addedSuccess', { defaultValue: 'Thought added successfully' }));
    }
    return thought;
  } catch (error) {
    logFailureOnce(error, errorContext);
    if (!isCurrent()) return null;
    if (isUsageCapReachedError(error)) {
      setLimitReached?.(true); setAudioError({ key: 'audio.limitReached' }); return null;
    }
    const words = recordingFailureWords(error, preserving);
    setAudioError(words); toast.error(sayFailure(words, t)); return null;
  } finally {
    releaseWork();
    if (isCurrent()) setIsRecordingAudio(false);
  }
};
