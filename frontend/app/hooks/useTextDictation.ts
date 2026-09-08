import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiUsage } from '@/hooks/useAiUsage';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { buildTranscriptionErrorMessage, transcribeAudioWithRetry, TranscriptionClientError } from '@/utils/transcriptionRetryClient';

interface TextDictationOptions {
  onText: (text: string) => void;
  onEmpty: () => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  fallbackErrorKey?: string;
}

/** Transcription and in-session audio recovery; each editor owns how text and errors are presented. */
export function useTextDictation({ onText, onEmpty, onError, onStart, fallbackErrorKey = 'errors.audioProcessing' }: TextDictationOptions) {
  const { t } = useTranslation();
  const { transcriptionBlocked, refresh } = useAiUsage();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    try {
      const result = await transcribeAudioWithRetry(blob, { endpoint: '/api/thoughts/transcribe' });
      const text = (result.polishedText || result.originalText || '').trim();
      if (!text) {
        onEmpty();
        return;
      }
      onText(text);
      await refresh();
      clear();
    } catch (cause) {
      // Usage-cap presentation belongs to the global handler, without a second local error.
      if (isUsageCapReachedError(cause)) return;
      storedBlob.current = blob;
      const message = cause instanceof TranscriptionClientError
        ? buildTranscriptionErrorMessage(cause, t)
        : cause instanceof Error ? cause.message : t(fallbackErrorKey);
      setError(message);
      onError?.(message);
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
  return { isProcessing, error, retryCount, maxRetries: 3, transcriptionBlocked, complete, retry, clear, stopProcessing };
}
