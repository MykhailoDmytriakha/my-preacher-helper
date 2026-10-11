import { useRef, useState } from 'react';

import { useAiUsage } from '@/hooks/useAiUsage';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { transcribeAudioWithRetry, transcriptionFailureWords } from '@/utils/transcriptionRetryClient';

import type { FailureWords } from '@/utils/actionFailureMessage';

interface TextDictationOptions {
  onText: (text: string) => void;
  onEmpty: () => void;
  onError?: (words: FailureWords) => void;
  onStart?: () => void;
  fallbackErrorKey?: string;
}

/**
 * Transcription and in-session audio recovery; each editor owns how text and errors are presented.
 * A failure is kept as words and said where shown, so a language switch re-says it.
 */
export function useTextDictation({ onText, onEmpty, onError, onStart, fallbackErrorKey = 'errors.audioProcessing' }: TextDictationOptions) {
  const { blocked, blockedLabelKey, refresh } = useAiUsage();
  // The same two-resource rule: a dictation request is admitted for transcription AND ai.
  const transcriptionBlocked = blocked('dictation');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<FailureWords | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const storedBlob = useRef<Blob | null>(null);

  const clear = () => {
    storedBlob.current = null;
    setError(null);
    setRetryCount(0);
  };

  const transcribe = async (blob: Blob) => {
    onStart?.();
    setIsProcessing(true);
    setError(null);
    const startedAt = Date.now();
    try {
      const result = await transcribeAudioWithRetry(blob, { endpoint: '/api/thoughts/transcribe' });
      const text = (result.polishedText || result.originalText || '').trim();
      recordDiagnostic('dictation', { source: 'field', result: text ? 'text' : 'empty', elapsedMs: Date.now() - startedAt });
      if (!text) {
        onEmpty();
        return;
      }
      onText(text);
      await refresh();
      clear();
    } catch (cause) {
      recordDiagnostic('dictation', { source: 'field', result: 'failed', code: diagnosticErrorCode(cause), elapsedMs: Date.now() - startedAt });
      // Usage-cap presentation belongs to the global handler, without a second local error.
      if (isUsageCapReachedError(cause)) return;
      storedBlob.current = blob;
      const words = transcriptionFailureWords(cause, fallbackErrorKey);
      setError(words);
      onError?.(words);
    } finally {
      setIsProcessing(false);
    }
  };

  const complete = (blob: Blob) => {
    setRetryCount(0);
    void transcribe(blob);
  };
  const retry = () => {
    if (!storedBlob.current) return;
    setRetryCount(count => count + 1);
    void transcribe(storedBlob.current);
  };

  const stopProcessing = () => setIsProcessing(false);
  return {
    isProcessing,
    error,
    retryCount,
    maxRetries: 3,
    transcriptionBlocked,
    blockedLabelKey: blockedLabelKey('dictation'),
    complete,
    retry,
    clear,
    stopProcessing,
  };
}
