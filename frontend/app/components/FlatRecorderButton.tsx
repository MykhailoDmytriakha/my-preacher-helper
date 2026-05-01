"use client";

import { CheckIcon, PauseIcon, PlayIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import { MicrophoneIcon } from "@/components/Icons";
import { getAudioRecordingDuration } from "@/utils/audioRecorderConfig";

import { AudioRecoveryPanel, ErrorBanner } from "./audio-recorder/AudioRecorderControls";
import { useAudioRecorderLifecycle } from "./audio-recorder/useAudioRecorderLifecycle";

import type { RecordingState, TranslationFn } from "./audio-recorder/types";

interface FlatRecorderButtonProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  maxDuration?: number;
  onError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
  onRetry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  transcriptionError?: string | null;
  onClearError?: () => void;
}

const AUDIO_NEW_RECORDING_KEY = "audio.newRecording";
const AUDIO_STOP_RECORDING_KEY = "audio.stopRecording";
const FLAT_RECORDER_WIDTH_CLASS = "w-[188px]";
const FLAT_RECORDER_ACTIVE_GRID_CLASS = "grid-cols-[86px_34px_34px_34px]";

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const getRootClasses = (disabled: boolean, recordingState: RecordingState) => {
  if (disabled) {
    return "border-slate-300/60 bg-slate-100/70 text-slate-400 dark:border-slate-600/60 dark:bg-slate-800/40 dark:text-slate-500";
  }

  switch (recordingState) {
    case "recording":
    case "paused":
      return "border-red-400 bg-red-500 text-white shadow-sm shadow-red-500/30 dark:border-red-400/70 dark:bg-red-500";
    case "processing":
      return "border-blue-300 bg-blue-500 text-white shadow-sm shadow-blue-500/20 dark:border-blue-300/70 dark:bg-blue-500";
    case "initializing":
      return "border-yellow-300 bg-yellow-500 text-white shadow-sm shadow-yellow-500/20 dark:border-yellow-300/70 dark:bg-yellow-500";
    default:
      return "border-slate-300/80 bg-white/70 text-slate-600 hover:border-green-300 hover:bg-green-50 hover:text-green-700 dark:border-blue-100/30 dark:bg-white/10 dark:text-blue-50/85 dark:hover:border-green-300/60 dark:hover:bg-green-400/15 dark:hover:text-green-100";
  }
};

const getPauseButtonClasses = (isPaused: boolean) => (
  isPaused
    ? "bg-green-500 text-white hover:bg-green-600 focus-visible:ring-green-300"
    : "bg-yellow-500 text-white hover:bg-yellow-600 focus-visible:ring-yellow-300"
);

const ActiveRecorderControls = ({
  isRecording,
  isPaused,
  timerLabel,
  pauseRecording,
  resumeRecording,
  cancelRecording,
  stopRecording,
  t,
}: {
  isRecording: boolean;
  isPaused: boolean;
  timerLabel: string;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
  stopRecording: () => void;
  t: TranslationFn;
}) => {
  const pauseLabel = isPaused ? t("audio.resumeRecording") : t("audio.pauseRecording");

  return (
    <>
      <div
        className="flex h-full min-w-0 items-center justify-center gap-1.5 rounded-l-[5px] px-2 text-xs font-bold text-white"
        data-testid="flat-recorder-timer"
        aria-live="polite"
      >
        <MicrophoneIcon className={`h-3.5 w-3.5 shrink-0 ${isRecording && !isPaused ? "animate-pulse" : ""}`} />
        <span className="w-[3.1rem] whitespace-nowrap text-left font-mono tabular-nums">
          {timerLabel}
        </span>
      </div>
      <button
        type="button"
        onClick={isPaused ? resumeRecording : pauseRecording}
        className={`flex h-full w-[34px] items-center justify-center border-l border-white/25 transition-colors focus-visible:outline-none focus-visible:ring-2 ${getPauseButtonClasses(isPaused)}`}
        aria-label={pauseLabel}
        title={pauseLabel}
      >
        {isPaused ? <PlayIcon className="h-3.5 w-3.5" /> : <PauseIcon className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={cancelRecording}
        className="flex h-full w-[34px] items-center justify-center border-l border-red-300 bg-white text-gray-700 transition-colors hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        aria-label={t("audio.cancelRecording")}
        title={t("audio.cancelRecording")}
      >
        <XMarkIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={stopRecording}
        className="flex h-full w-[34px] items-center justify-center rounded-r-[5px] border-l border-white/25 bg-red-500 text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        aria-label={t(AUDIO_STOP_RECORDING_KEY)}
        title={t(AUDIO_STOP_RECORDING_KEY)}
      >
        <CheckIcon className="h-3.5 w-3.5" />
      </button>
    </>
  );
};

const IdleRecorderControl = ({
  recordingState,
  isInitializingOrProcessing,
  timerLabel,
  mainLabel,
  isButtonDisabled,
  onMainClick,
  t,
}: {
  recordingState: RecordingState;
  isInitializingOrProcessing: boolean;
  timerLabel: string;
  mainLabel: string;
  isButtonDisabled: boolean;
  onMainClick: () => void;
  t: TranslationFn;
}) => (
  <button
    type="button"
    onClick={onMainClick}
    disabled={isButtonDisabled}
    className="col-span-4 flex h-full min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-xs font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-green-300 disabled:cursor-not-allowed"
    aria-label={mainLabel}
    title={mainLabel}
  >
    {recordingState === "processing" ? (
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    ) : (
      <MicrophoneIcon className={`h-3.5 w-3.5 shrink-0 ${isInitializingOrProcessing ? "animate-pulse" : ""}`} />
    )}
    <span className="min-w-0 truncate">
      {isInitializingOrProcessing ? timerLabel : t(AUDIO_NEW_RECORDING_KEY)}
    </span>
  </button>
);

export function FlatRecorderButton({
  onRecordingComplete,
  isProcessing = false,
  maxDuration = getAudioRecordingDuration(),
  onError,
  disabled = false,
  className = "",
  onRetry,
  retryCount = 0,
  maxRetries = 3,
  transcriptionError,
  onClearError,
}: FlatRecorderButtonProps) {
  const { t } = useTranslation();
  const {
    recordingTime,
    isRecording,
    isPaused,
    isInitializing,
    isInGracePeriod,
    gracePeriodRemaining,
    recordingState,
    transcriptionErrorMessage,
    hasStoredAudio,
    storedAudioUrl,
    startRecording,
    stopRecording,
    cancelRecording,
    pauseRecording,
    resumeRecording,
    retryTranscription,
    recordAgain,
    discardStoredAudio,
    closeError,
  } = useAudioRecorderLifecycle({
    onRecordingComplete,
    isProcessing,
    maxDuration,
    onError,
    disabled,
    onRetry,
    transcriptionError,
    onClearError,
    autoStart: false,
    hideKeyboardShortcuts: true,
    enableAudioLevelMonitoring: false,
    t,
  });

  const remainingTime = Math.max(0, maxDuration - recordingTime);
  const timerLabel = isInGracePeriod && gracePeriodRemaining > 0
    ? String(gracePeriodRemaining)
    : formatTime(remainingTime);
  const isInitializingOrProcessing = isInitializing || isProcessing;
  const isButtonDisabled = disabled || isInitializing || isProcessing;

  const rootClasses = getRootClasses(disabled, recordingState);

  const mainLabel = isRecording || isPaused
    ? t(AUDIO_STOP_RECORDING_KEY)
    : t(AUDIO_NEW_RECORDING_KEY);

  const handleMainClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }

    void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const shouldShowRecovery = Boolean(transcriptionErrorMessage && hasStoredAudio && storedAudioUrl);

  return (
    <div className={`relative inline-flex flex-col items-end ${className}`}>
      <div
        className={`inline-grid h-8 ${FLAT_RECORDER_WIDTH_CLASS} ${FLAT_RECORDER_ACTIVE_GRID_CLASS} items-stretch rounded-md border transition-colors duration-200 ${rootClasses}`}
        data-testid="flat-recorder-button"
      >
        {isRecording || isPaused ? (
          <ActiveRecorderControls
            isRecording={isRecording}
            isPaused={isPaused}
            timerLabel={timerLabel}
            pauseRecording={pauseRecording}
            resumeRecording={resumeRecording}
            cancelRecording={cancelRecording}
            stopRecording={stopRecording}
            t={t}
          />
        ) : (
          <IdleRecorderControl
            recordingState={recordingState}
            isInitializingOrProcessing={isInitializingOrProcessing}
            timerLabel={timerLabel}
            mainLabel={mainLabel}
            isButtonDisabled={isButtonDisabled}
            onMainClick={handleMainClick}
            t={t}
          />
        )}
      </div>

      <AudioRecoveryPanel
        show={shouldShowRecovery}
        audioUrl={storedAudioUrl}
        errorMessage={transcriptionErrorMessage}
        appliedVariant="mini"
        retryCount={retryCount}
        maxRetries={maxRetries}
        isProcessing={isProcessing || disabled}
        onRetry={retryTranscription}
        onRecordAgain={recordAgain}
        onDiscard={discardStoredAudio}
        t={t}
        className="absolute right-0 top-full z-50 mt-2 w-[320px] max-w-[calc(100vw-2rem)]"
      />

      <ErrorBanner
        errorMessage={shouldShowRecovery ? null : transcriptionErrorMessage}
        appliedVariant="mini"
        onClose={closeError}
        t={t}
      />
    </div>
  );
}
