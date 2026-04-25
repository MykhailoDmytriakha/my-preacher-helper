import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createConfiguredMediaRecorder,
  getAllSupportedFormats,
  getBestSupportedFormat,
  hasKnownIssues,
  logAudioInfo,
} from "@/utils/audioFormatUtils";
import { getAudioGracePeriod } from "@/utils/audioRecorderConfig";

import { ERROR_KEYS } from "./constants";

import type {
  RecordingState,
  UseAudioRecorderLifecycleArgs,
  UseAudioRecorderLifecycleResult,
} from "./types";

export function useAudioRecorderLifecycle({
  onRecordingComplete,
  isProcessing,
  maxDuration,
  onError,
  disabled,
  onRetry,
  transcriptionError,
  onClearError,
  autoStart,
  hideKeyboardShortcuts,
  onRecordingStateChange,
  enableAudioLevelMonitoring = true,
  t,
}: UseAudioRecorderLifecycleArgs): UseAudioRecorderLifecycleResult {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [storedAudioBlob, setStoredAudioBlob] = useState<Blob | null>(null);
  const [transcriptionErrorState, setTranscriptionErrorState] = useState<string | null>(null);
  const gracePeriodDuration = getAudioGracePeriod();
  const [isInGracePeriod, setIsInGracePeriod] = useState(false);
  const [gracePeriodRemaining, setGracePeriodRemaining] = useState(gracePeriodDuration);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const hasAutoStartedRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    onRecordingStateChange?.(isRecording || isInitializing);
  }, [isRecording, isInitializing, onRecordingStateChange]);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    mediaRecorder.current = null;
    chunks.current = [];
    isRecordingRef.current = false;
    isPausedRef.current = false;
    setAudioLevel(0);
  }, []);

  const handleError = useCallback(
    (error: Error, messageKey: string) => {
      console.error("AudioRecorder error:", error);
      const errorMessage = t(messageKey);
      if (onError) {
        onError(errorMessage);
      } else {
        alert(errorMessage);
      }
      isRecordingRef.current = false;
      isPausedRef.current = false;
      cleanup();
      setIsRecording(false);
      setIsPaused(false);
      setIsInitializing(false);
    },
    [cleanup, onError, t]
  );

  const monitorAudioLevel = useCallback(() => {
    animationFrameRef.current = null;
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let index = 0; index < bufferLength; index += 1) {
      sum += dataArray[index];
    }

    const average = sum / bufferLength;
    setAudioLevel(Math.min(100, (average / 128) * 100));

    if (isRecordingRef.current && !isPausedRef.current) {
      animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
    }
  }, []);

  const validateRecordingPrerequisites = useCallback(() => {
    console.log("AudioRecorder: startRecording called", { disabled, isProcessing, isInitializing });

    if (disabled || isProcessing || isInitializing) {
      console.log("AudioRecorder: Start conditions not met - returning early");
      return false;
    }

    console.log("AudioRecorder: Starting new recording...");
    return true;
  }, [disabled, isInitializing, isProcessing]);

  const initializeRecordingState = useCallback(() => {
    chunks.current = [];
    console.log("AudioRecorder: Cleared chunks array before starting");
    setIsInitializing(true);
    setAudioLevel(0);
    setTranscriptionErrorState(null);
  }, []);

  const acquireMediaStream = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    streamRef.current = stream;
    return stream;
  }, []);

  const setupAudioMonitoring = useCallback((stream: MediaStream) => {
    if (!enableAudioLevelMonitoring) {
      return;
    }

    try {
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
    } catch (audioContextError) {
      console.warn("Could not create audio context for level monitoring:", audioContextError);
    }
  }, [enableAudioLevelMonitoring]);

  const initiateRecording = useCallback(() => {
    mediaRecorder.current!.start();
    isRecordingRef.current = true;
    isPausedRef.current = false;
    setIsRecording(true);
    setIsPaused(false);
    setIsInitializing(false);

    if (analyserRef.current) {
      animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
    }
  }, [monitorAudioLevel]);

  const startRecording = useCallback(async () => {
    if (!validateRecordingPrerequisites()) {
      return;
    }

    initializeRecordingState();

    try {
      const stream = await acquireMediaStream();
      setupAudioMonitoring(stream);

      const bestFormat = getBestSupportedFormat();
      const allSupported = getAllSupportedFormats();

      console.log(`AudioRecorder: Selected format: ${bestFormat}`);
      console.log(`AudioRecorder: Browser supports: ${allSupported.join(", ")}`);
      console.log(`AudioRecorder: Browser: ${navigator.userAgent}`);

      if (hasKnownIssues(bestFormat)) {
        console.warn(`⚠️ AudioRecorder: Format ${bestFormat} has known compatibility issues with OpenAI`);
        console.warn("⚠️ AudioRecorder: Your browser doesn't support better formats (MP4/MP3/WAV)");
        console.warn("⚠️ AudioRecorder: Consider using Chrome/Firefox latest version for better compatibility");
      }

      const handleDataAvailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };

      const handleStop = async () => {
        if (chunks.current.length > 0) {
          const mimeType = mediaRecorder.current?.mimeType || bestFormat;
          const blob = new Blob(chunks.current, { type: mimeType });

          await logAudioInfo(blob, "AudioRecorder Output");
          console.log(`AudioRecorder: Chunks count: ${chunks.current.length}`);

          if (blob.size === 0) {
            console.error("AudioRecorder: Empty blob created");
            handleError(new Error("Recording failed - empty audio"), ERROR_KEYS.AUDIO_PROCESSING);
            cleanup();
            return;
          }

          if (blob.size < 1000) {
            console.warn(`AudioRecorder: Very small blob (${blob.size} bytes) - recording might be too short`);
          }

          setStoredAudioBlob(blob);
          onRecordingComplete(blob);
        } else {
          console.error("AudioRecorder: No chunks recorded");
          handleError(new Error("Recording failed - no data"), ERROR_KEYS.AUDIO_PROCESSING);
        }

        cleanup();
      };

      const handleRecorderError = () => {
        handleError(new Error("MediaRecorder error"), ERROR_KEYS.AUDIO_PROCESSING);
      };

      mediaRecorder.current = createConfiguredMediaRecorder(
        stream,
        bestFormat,
        handleDataAvailable,
        handleStop,
        handleRecorderError
      );

      initiateRecording();
    } catch (error) {
      handleError(error as Error, ERROR_KEYS.MICROPHONE_UNAVAILABLE);
    }
  }, [
    acquireMediaStream,
    cleanup,
    handleError,
    initializeRecordingState,
    initiateRecording,
    onRecordingComplete,
    setupAudioMonitoring,
    validateRecordingPrerequisites,
  ]);

  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorder.current) return;

    try {
      mediaRecorder.current.stop();
      isRecordingRef.current = false;
      isPausedRef.current = false;
      setIsRecording(false);
      setIsPaused(false);
    } catch (error) {
      handleError(error as Error, ERROR_KEYS.AUDIO_PROCESSING);
    }
  }, [handleError, isRecording]);

  const cancelRecording = useCallback(() => {
    console.log("AudioRecorder: cancelRecording called", {
      isRecording,
      hasMediaRecorder: Boolean(mediaRecorder.current),
    });

    if (!isRecording || !mediaRecorder.current) {
      console.log("AudioRecorder: Cancel conditions not met - returning early");
      return;
    }

    console.log("AudioRecorder: Canceling recording...");

    try {
      chunks.current = [];
      console.log("AudioRecorder: Cleared chunks array");

      mediaRecorder.current.onstop = null;
      mediaRecorder.current.ondataavailable = null;
      mediaRecorder.current.stop();

      isRecordingRef.current = false;
      isPausedRef.current = false;
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
      setStoredAudioBlob(null);
      setTranscriptionErrorState(null);

      cleanup();
      console.log("AudioRecorder: Recording canceled successfully");
    } catch (error) {
      console.error("Error canceling recording:", error);
      chunks.current = [];
      isRecordingRef.current = false;
      isPausedRef.current = false;
      cleanup();
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
      setStoredAudioBlob(null);
      setTranscriptionErrorState(null);
    }
  }, [cleanup, isRecording]);

  const pauseRecording = useCallback(() => {
    console.log("AudioRecorder: pauseRecording called", {
      isRecording,
      isPaused,
      hasMediaRecorder: Boolean(mediaRecorder.current),
    });

    if (!isRecording || isPaused || !mediaRecorder.current) {
      console.log("AudioRecorder: Pause conditions not met - returning early");
      return;
    }

    console.log("AudioRecorder: Pausing recording...");

    try {
      mediaRecorder.current.pause();
      isPausedRef.current = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setIsPaused(true);
      console.log("AudioRecorder: Recording paused successfully");
    } catch (error) {
      console.error("Error pausing recording:", error);
      handleError(error as Error, ERROR_KEYS.AUDIO_PROCESSING);
    }
  }, [handleError, isPaused, isRecording]);

  const resumeRecording = useCallback(() => {
    console.log("AudioRecorder: resumeRecording called", {
      isRecording,
      isPaused,
      hasMediaRecorder: Boolean(mediaRecorder.current),
    });

    if (!isRecording || !isPaused || !mediaRecorder.current) {
      console.log("AudioRecorder: Resume conditions not met - returning early");
      return;
    }

    console.log("AudioRecorder: Resuming recording...");

    try {
      mediaRecorder.current.resume();
      isPausedRef.current = false;
      if (analyserRef.current && animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
      }
      setIsPaused(false);
      console.log("AudioRecorder: Recording resumed successfully");
    } catch (error) {
      console.error("Error resuming recording:", error);
      handleError(error as Error, ERROR_KEYS.AUDIO_PROCESSING);
    }
  }, [handleError, isPaused, isRecording, monitorAudioLevel]);

  const retryTranscription = useCallback(() => {
    if (storedAudioBlob && onRetry) {
      setTranscriptionErrorState(null);
      onRetry();
    }
  }, [onRetry, storedAudioBlob]);

  const closeError = useCallback(() => {
    setTranscriptionErrorState(null);
    setStoredAudioBlob(null);
    onClearError?.();
  }, [onClearError]);

  const clearStoredAudio = useCallback(() => {
    setStoredAudioBlob(null);
    setTranscriptionErrorState(null);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).clearAudioRecorderStorage = clearStoredAudio;
    }
  }, [clearStoredAudio]);

  useEffect(() => {
    if (transcriptionError) {
      setTranscriptionErrorState(transcriptionError);
    }
  }, [transcriptionError]);

  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        if (isInGracePeriod) {
          setGracePeriodRemaining((previous) => {
            const nextRemaining = previous - 1;
            if (nextRemaining <= 0) {
              stopRecording();
              return 0;
            }
            return nextRemaining;
          });
          return;
        }

        setRecordingTime((previous) => {
          const nextTime = previous + 1;
          if (nextTime >= maxDuration) {
            if (gracePeriodDuration > 0) {
              setIsInGracePeriod(true);
              setGracePeriodRemaining(gracePeriodDuration);
              return maxDuration;
            }

            stopRecording();
            return maxDuration;
          }

          return nextTime;
        });
      }, 1000);
    } else {
      if (!isRecording && recordingTime > 0 && !isProcessing) {
        setRecordingTime(0);
        setIsInGracePeriod(false);
        setGracePeriodRemaining(gracePeriodDuration);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    gracePeriodDuration,
    isInGracePeriod,
    isPaused,
    isProcessing,
    isRecording,
    maxDuration,
    recordingTime,
    stopRecording,
  ]);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    if (hideKeyboardShortcuts) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.code === "Space" && event.ctrlKey) {
        event.preventDefault();
        if (isRecording) {
          stopRecording();
        } else {
          void startRecording();
        }
        return;
      }

      if (event.code === "Escape" && isRecording) {
        event.preventDefault();
        cancelRecording();
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [cancelRecording, hideKeyboardShortcuts, isRecording, startRecording, stopRecording]);

  useEffect(() => {
    if (!autoStart || hasAutoStartedRef.current) {
      return;
    }

    hasAutoStartedRef.current = true;
    const id = setTimeout(() => {
      void startRecording();
    }, 0);

    return () => {
      clearTimeout(id);
    };
  }, [autoStart, startRecording]);

  const recordingState = useMemo<RecordingState>(() => {
    if (isProcessing) return "processing";
    if (isInitializing) return "initializing";
    if (isRecording && isPaused) return "paused";
    if (isRecording) return "recording";
    return "idle";
  }, [isInitializing, isPaused, isProcessing, isRecording]);

  return {
    recordingTime,
    isRecording,
    isPaused,
    audioLevel,
    isInitializing,
    isInGracePeriod,
    gracePeriodRemaining,
    recordingState,
    transcriptionErrorMessage: transcriptionErrorState || transcriptionError || null,
    hasStoredAudio: Boolean(storedAudioBlob),
    startRecording,
    stopRecording,
    cancelRecording,
    pauseRecording,
    resumeRecording,
    retryTranscription,
    closeError,
  };
}
