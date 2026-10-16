import { useEffect, useMemo, useRef, useState } from 'react';

import { useAiUsage } from '@/hooks/useAiUsage';
import { useAuth } from '@/providers/AuthProvider';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { newClientId } from '@/utils/clientId';
import { recordingMatchesDestination } from '@/utils/recordingDraftScope';
import { deleteRecordingDraft, getRecordingDraft, moveRecordingDraft, saveRecordingDraft, saveRecordingDraftText } from '@/utils/recordingDraftStore';
import { transcribeAudioWithRetry, transcriptionFailureWords } from '@/utils/transcriptionRetryClient';

import type { FailureWords } from '@/utils/actionFailureMessage';
import type { RecordingDraft, RecordingDraftContext } from '@/utils/recordingDraftStore';

interface TextDictationOptions {
  onText: (text: string, sourceId?: string) => void | Promise<void>;
  /** Only for callbacks that await the canonical durable text writer themselves. */
  acceptAfterText?: boolean;
  canTranscribe?: () => boolean;
  transcribe?: (blob: Blob) => Promise<{ polishedText?: string; originalText?: string }>;
  onEmpty: () => void;
  onError?: (words: FailureWords) => void;
  onStart?: () => void;
  fallbackErrorKey?: string;
  endpoint?: '/api/thoughts/transcribe' | '/api/studies/transcribe';
  /** Stable field destination; isolated legacy callers can omit durable recovery. */
  recordingContext?: { context: RecordingDraftContext; contextId: string };
  linkedSourceIds?: readonly string[];
  onSourcePersisted?: (sourceId: string) => void;
}
class RecordingPreservationError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) { super('Recording preservation failed'); this.cause = cause; }
}

interface HeldRecording {
  id: string;
  blob: Blob;
  transcript?: string;
  transcriptPersisted?: boolean;
  persisted: boolean;
  retryAllowed: boolean;
}
interface DictationState {
  recording: boolean;
  processing: boolean;
  error: FailureWords | null;
  retries: number;
}
const idle = (): DictationState => ({ recording: false, processing: false, error: null, retries: 0 });

/** Raw source, provider result and accepted field text have distinct lifetimes. */
export function useTextDictation(options: TextDictationOptions) {
  const { user, loading: authLoading } = useAuth();
  const ownerId = authLoading ? null : user?.uid ?? null;
  const context = options.recordingContext?.context;
  const contextId = options.recordingContext?.contextId;
  const ownership = useMemo(() => ({
    ownerId, context, contextId, recording: false, held: null as HeldRecording | null,
    applied: new Set<string>(), known: new Set<string>(), busy: false,
  }), [ownerId, context, contextId]);
  const current = useRef(ownership); current.current = ownership;
  const callbacks = useRef(options); callbacks.current = options;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const live = () => mounted.current && current.current === ownership;
  const [state, setState] = useState<{ identity: object; value: DictationState } | null>(null);
  const shown = state?.identity === ownership ? state.value : idle();
  const patch = (change: Partial<DictationState>) => {
    if (live()) setState(previous => ({
      identity: ownership, value: { ...(previous?.identity === ownership ? previous.value : idle()), ...change },
    }));
  };
  const { blocked, blockedLabelKey, refresh } = useAiUsage();
  const transcriptionBlocked = blocked('dictation');

  const clear = () => {
    ownership.held = null;
    patch({ error: null, retries: 0 });
  };
  const discard = async () => {
    const held = ownership.held;
    if (!held || ownership.busy) return;
    if (context && contextId && ownerId) await deleteRecordingDraft(held.id, ownerId);
    if (ownership.held === held) clear();
  };
  const captureAcceptance = () => {
    const included = [...ownership.applied];
    return async () => {
      if (!ownerId) return;
      for (const id of included) {
        await deleteRecordingDraft(id, ownerId);
        ownership.applied.delete(id);
        ownership.known.delete(id);
      }
    };
  };
  const accept = () => captureAcceptance()();
  const carryTo = async (destinationId: string) => {
    if (!ownerId || !context || !contextId) return;
    for (const id of [...ownership.known]) {
      const draft = await getRecordingDraft(id, ownerId);
      if (draft && draft.context === context && draft.contextId === contextId) {
        await moveRecordingDraft(id, ownerId, { context, contextId }, destinationId);
      }
    }
  };

  const preserveSource = async (held: HeldRecording) => {
    if (!context || held.persisted) return;
    try {
      if (!ownerId || !contextId) throw new Error('Recording owner and destination are required');
      await saveRecordingDraft({ id: held.id, ownerId, context, contextId, blob: held.blob,
        mimeType: held.blob.type || 'audio/webm' });
      held.persisted = true;
    } catch (cause) { throw new RecordingPreservationError(cause); }
  };
  const recognizeSource = async (held: HeldRecording): Promise<string | null> => {
    if (held.transcript === undefined) {
      const result = callbacks.current.transcribe ? await callbacks.current.transcribe(held.blob)
        : await transcribeAudioWithRetry(held.blob, { endpoint: callbacks.current.endpoint ?? '/api/thoughts/transcribe' });
      held.transcript = (result.polishedText || result.originalText || '').trim();
    }
    if (context && ownerId && held.transcript && !held.transcriptPersisted) {
      let accepted: boolean;
      try { accepted = await saveRecordingDraftText(held.id, ownerId, held.transcript); }
      catch (cause) { throw new RecordingPreservationError(cause); }
      if (!accepted) return null;
      held.transcriptPersisted = true;
    }
    if (context && ownerId && !await getRecordingDraft(held.id, ownerId)) return null;
    return held.transcript;
  };
  const publishSourceText = async (held: HeldRecording, text: string) => {
    if (context) ownership.applied.add(held.id);
    const textIsDurable = callbacks.current.acceptAfterText;
    try { await callbacks.current.onText(text, held.id); }
    catch (error) { ownership.applied.delete(held.id); throw error; }
    // Its writer can finish after unmount and still release this exact source.
    if (textIsDurable) await captureAcceptance()().catch(() => undefined);
  };

  const transcribe = async (held: HeldRecording): Promise<boolean> => {
    if (!live() || ownership.busy || ownership.applied.has(held.id)) return false;
    ownership.busy = true;
    ownership.held = held;
    ownership.known.add(held.id);
    patch({ processing: true, error: null });
    const startedAt = Date.now();
    try {
      callbacks.current.onStart?.();
      await preserveSource(held);
      if (!live()) return false;
      callbacks.current.onSourcePersisted?.(held.id);
      if (callbacks.current.canTranscribe?.() === false) return false;
      const text = await recognizeSource(held);
      if (text === null) { ownership.held = null; return false; }
      recordDiagnostic('dictation', { source: 'field', result: text ? 'text' : 'empty', elapsedMs: Date.now() - startedAt });
      if (!live()) return false;
      if (!text) {
        callbacks.current.onEmpty();
        return false;
      }
      await publishSourceText(held, text);
      if (!live()) return false;
      ownership.held = null;
      patch({ error: null, retries: 0 });
      // Meter refresh cannot turn already-published words into a second transcription attempt.
      await refresh().catch(() => undefined);
      return false; // The field writer, rather than recognition, owns source retirement.
    } catch (cause) {
      recordDiagnostic('dictation', { source: 'field', result: 'failed', code: diagnosticErrorCode(cause), elapsedMs: Date.now() - startedAt });
      if (isUsageCapReachedError(cause)) {
        held.retryAllowed = false;
        return false;
      }
      if (live()) {
        const words = cause instanceof RecordingPreservationError ? { key: 'audio.draft.saveFailed' }
          : transcriptionFailureWords(cause, callbacks.current.fallbackErrorKey ?? 'errors.audioProcessing');
        patch({ error: words });
        callbacks.current.onError?.(words);
      }
      return false;
    } finally {
      ownership.busy = false;
      patch({ processing: false });
    }
  };
  const complete = (blob: Blob) => {
    if (ownership.busy) return;
    patch({ retries: 0 });
    void transcribe({ id: newClientId(), blob, persisted: false, retryAllowed: true });
  };
  const retry = () => {
    const held = ownership.held;
    if (!held || !held.retryAllowed || ownership.busy) return;
    patch({ retries: shown.retries + 1 });
    void transcribe(held);
  };
  const recover = (draft: RecordingDraft) => {
    if (!context || !contextId || draft.ownerId !== ownerId || !recordingMatchesDestination(draft, context, contextId, callbacks.current.linkedSourceIds)) return Promise.resolve(false);
    return transcribe({ id: draft.id, blob: draft.blob, transcript: draft.transcript, transcriptPersisted: draft.transcript !== undefined,
      persisted: true, retryAllowed: true });
  };

  return {
    isProcessing: shown.processing,
    isRecording: shown.recording,
    setIsRecording: (recording: boolean) => { ownership.recording = recording; patch({ recording }); },
    canChangeDestination: () => !ownership.recording && !ownership.busy && (!ownership.held || ownership.held.persisted),
    error: shown.error,
    retryCount: shown.retries,
    maxRetries: 3,
    transcriptionBlocked,
    blockedLabelKey: blockedLabelKey('dictation'),
    complete, retry, clear, discard, accept, recover, captureAcceptance, carryTo,
    appliedDraftIds: [...ownership.applied],
    recordingContext: options.recordingContext,
    recordingKey: JSON.stringify([ownerId, context, contextId]),
    stopProcessing: () => patch({ processing: false }),
  };
}
