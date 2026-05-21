'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBestSupportedFormat } from '@/utils/audioFormatUtils';

/**
 * Minimal MediaRecorder choreography: getUserMedia → MediaRecorder.start →
 * collect chunks → stop → assemble Blob → caller. The heavy
 * `useAudioRecorderLifecycle` covers pause/resume/cancel/grace-period/recovery
 * for the full focus-mode recorder; this is the lightweight version for
 * "toolbar press → speak → press again" widgets that don't need any of that
 * machinery.
 *
 * Shared concerns kept identical to the big hook so future Safari quirks or
 * format fallbacks land in one place: `getBestSupportedFormat`, the same
 * getUserMedia options (echo/noise/AGC), and the same cleanup that stops
 * tracks + clears refs in the right order.
 */
export interface UseMediaRecorderOptions {
  onComplete: (blob: Blob) => void;
  onError?: (message: string) => void;
  /** Hard cap in seconds; if set, recorder auto-stops at this elapsed time. */
  maxDuration?: number;
}

export type RecorderState = 'idle' | 'recording' | 'stopping';

export interface UseMediaRecorderResult {
  state: RecorderState;
  elapsedSeconds: number;
  start: () => Promise<void>;
  stop: () => void;
}

export function useMediaRecorder({ onComplete, onError, maxDuration }: UseMediaRecorderOptions): UseMediaRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      setState('stopping');
      recorder.stop();
    }
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimeType = getBestSupportedFormat();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        cleanup();
        setState('idle');
        setElapsedSeconds(0);
        if (blob.size > 0) onComplete(blob);
      };
      recorder.onerror = () => {
        cleanup();
        setState('idle');
        setElapsedSeconds(0);
        onError?.('Ошибка записи');
      };
      recorderRef.current = recorder;
      recorder.start();
      setState('recording');
      setElapsedSeconds(0);
      if (maxDuration && maxDuration > 0) {
        intervalRef.current = setInterval(() => {
          setElapsedSeconds((prev) => {
            const next = prev + 1;
            if (next >= maxDuration) stop();
            return next;
          });
        }, 1000);
      }
    } catch (error) {
      console.error('Microphone unavailable', error);
      cleanup();
      setState('idle');
      setElapsedSeconds(0);
      onError?.('Микрофон недоступен');
    }
  }, [cleanup, onComplete, onError, maxDuration, stop]);

  return { state, elapsedSeconds, start, stop };
}
