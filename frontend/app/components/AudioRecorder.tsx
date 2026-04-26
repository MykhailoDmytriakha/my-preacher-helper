"use client";

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import { getAudioRecordingDuration } from "@/utils/audioRecorderConfig";

import {
  AudioLevelIndicator,
  AudioRecoveryPanel,
  ErrorBanner,
  MainRecordButton,
  RecordingActionButtons,
  RecordingProgress,
  SplitRecordButton,
} from "./audio-recorder/AudioRecorderControls";
import { useAudioRecorderLifecycle } from "./audio-recorder/useAudioRecorderLifecycle";
import { useResponsiveRecorderVariant } from "./audio-recorder/useResponsiveRecorderVariant";

import type { AudioRecorderProps } from "./audio-recorder/types";

export const AudioRecorder = ({
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
  variant = "standard",
  autoStart = false,
  hideKeyboardShortcuts = false,
  onRecordingStateChange,
  splitLeft,
  enableAudioLevelMonitoring = true,
}: AudioRecorderProps) => {
  const { t } = useTranslation();
  const appliedVariant = useResponsiveRecorderVariant(variant);
  const shouldEnableAudioLevelMonitoring = enableAudioLevelMonitoring && appliedVariant === "standard";

  const {
    recordingTime,
    isRecording,
    isPaused,
    audioLevel,
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
    autoStart,
    hideKeyboardShortcuts,
    onRecordingStateChange,
    enableAudioLevelMonitoring: shouldEnableAudioLevelMonitoring,
    t,
  });

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const progressPercentage = useMemo(
    () => Math.min(100, (recordingTime / maxDuration) * 100),
    [maxDuration, recordingTime]
  );

  const isButtonDisabled = disabled || isProcessing || isInitializing;
  const shouldShowRecovery = Boolean(transcriptionErrorMessage && hasStoredAudio && storedAudioUrl);
  const isIdle = recordingState === "idle";

  return (
    <div className={`space-y-4 ${className} ${appliedVariant === "mini" ? "space-y-3" : ""}`}>
      {splitLeft && isIdle ? (
        <SplitRecordButton
          splitLeft={splitLeft}
          isButtonDisabled={isButtonDisabled}
          onStart={startRecording}
          t={t}
        />
      ) : (
        <div
          className={
            appliedVariant === "mini"
              ? "flex flex-col gap-3"
              : "flex w-full flex-col items-start gap-4 sm:flex-row sm:items-center"
          }
        >
          <MainRecordButton
            show={!isRecording || appliedVariant === "standard"}
            appliedVariant={appliedVariant}
            isRecording={isRecording}
            isPaused={isPaused}
            isButtonDisabled={isButtonDisabled}
            recordingState={recordingState}
            onStart={startRecording}
            onStop={stopRecording}
            t={t}
          />

          <RecordingActionButtons
            isRecording={isRecording}
            isPaused={isPaused}
            appliedVariant={appliedVariant}
            onStop={stopRecording}
            onPause={pauseRecording}
            onResume={resumeRecording}
            onCancel={cancelRecording}
            t={t}
          />

          <RecordingProgress
            isRecording={isRecording}
            isPaused={isPaused}
            appliedVariant={appliedVariant}
            formatTime={formatTime}
            recordingTime={recordingTime}
            maxDuration={maxDuration}
            progressPercentage={progressPercentage}
            isInGracePeriod={isInGracePeriod}
            gracePeriodRemaining={gracePeriodRemaining}
          />
        </div>
      )}

      <AudioRecoveryPanel
        show={shouldShowRecovery}
        audioUrl={storedAudioUrl}
        errorMessage={transcriptionErrorMessage}
        appliedVariant={appliedVariant}
        retryCount={retryCount}
        maxRetries={maxRetries}
        isProcessing={isProcessing || disabled}
        onRetry={retryTranscription}
        onRecordAgain={recordAgain}
        onDiscard={discardStoredAudio}
        t={t}
      />

      <ErrorBanner
        errorMessage={shouldShowRecovery ? null : transcriptionErrorMessage}
        appliedVariant={appliedVariant}
        onClose={closeError}
        t={t}
      />

      {shouldEnableAudioLevelMonitoring ? (
        <AudioLevelIndicator
          isRecording={isRecording}
          isPaused={isPaused}
          audioLevel={audioLevel}
          t={t}
        />
      ) : null}
    </div>
  );
};
