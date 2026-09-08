import { useCallback, useEffect, useRef, useState } from 'react';

import { copyPlainText } from '@/utils/clipboard';

interface UseClipboardOptions {
  successDuration?: number;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface CopyFeedbackOptions extends UseClipboardOptions {
  errorDuration?: number;
  ignoreWhileCopying?: boolean;
}

type CopyStatus = 'idle' | 'copying' | 'success' | 'error';

/** Plain and formatted copies share feedback lifetime, but retain their own transport. */
export function useCopyFeedback({
  successDuration = 1500, errorDuration, ignoreWhileCopying = false, onSuccess, onError,
}: CopyFeedbackOptions = {}) {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const copying = useRef(false);

  const invalidate = useCallback(() => {
    attempt.current += 1;
    copying.current = false;
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
  }, []);
  useEffect(() => invalidate, [invalidate]);

  const reset = useCallback((message: string | null = null) => {
    invalidate();
    setStatus(message === null ? 'idle' : 'error');
    setError(message);
  }, [invalidate]);

  const runCopy = useCallback(async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (ignoreWhileCopying && copying.current) return false;
    reset();
    const currentAttempt = attempt.current;
    copying.current = true;
    setStatus('copying');
    let copied = false;
    let failure = new Error('Copy failed');
    try {
      copied = await operation();
    } catch (cause) {
      if (cause instanceof Error) failure = cause;
    }
    if (currentAttempt !== attempt.current) return copied;
    copying.current = false;
    setStatus(copied ? 'success' : 'error');
    setError(copied ? null : failure.message);
    const duration = copied ? successDuration : errorDuration;
    if (duration !== undefined) feedbackTimer.current = setTimeout(() => reset(), duration);
    if (copied) onSuccess?.();
    else onError?.(failure);
    return copied;
  }, [errorDuration, ignoreWhileCopying, onError, onSuccess, reset, successDuration]);

  return { status, error, runCopy, reset };
}

export function useClipboard(options: UseClipboardOptions = {}) {
  const { status, error, runCopy, reset } = useCopyFeedback(options);
  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!text) {
      reset('No text provided');
      return false;
    }
    return runCopy(async () => { await copyPlainText(text); return true; });
  }, [reset, runCopy]);

  return { isCopied: status === 'success', isLoading: status === 'copying', error, copyToClipboard, reset };
}
