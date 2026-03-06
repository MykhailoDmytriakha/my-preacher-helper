import { MicFilledIcon } from "@components/Icons";

import {
  AUDIO_TRANSLATION_KEYS,
  CSS_ANIMATIONS,
  ICON_SIZES,
} from "./constants";

import type {
  AudioLevelIndicatorProps,
  ErrorBannerProps,
  MainRecordButtonProps,
  RecordingActionButtonsProps,
  RecordingProgressProps,
  RetryTranscriptionButtonProps,
  SplitRecordButtonProps,
} from "./types";

export const MainRecordButton = ({
  show,
  appliedVariant,
  isRecording,
  isPaused,
  isButtonDisabled,
  recordingState,
  onStart,
  onStop,
  t,
}: MainRecordButtonProps) => {
  if (!show) return null;

  const baseStyles =
    "relative overflow-hidden transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:transform-none disabled:hover:scale-100";
  const scaleStyles = "transform scale-[0.95] hover:scale-100 active:scale-95";

  const getButtonStyles = () => {
    switch (recordingState) {
      case "processing":
        return `${baseStyles} ${scaleStyles} bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 cursor-wait`;
      case "initializing":
        return `${baseStyles} ${scaleStyles} bg-yellow-500 hover:bg-yellow-600 text-white focus:ring-yellow-500 cursor-wait`;
      case "recording":
      case "paused":
        return `${baseStyles} ${scaleStyles} bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 shadow-lg shadow-red-500/25`;
      default:
        return `${baseStyles} ${scaleStyles} bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 shadow-lg hover:shadow-green-500/25`;
    }
  };

  const getButtonContent = () => {
    switch (recordingState) {
      case "processing":
        return (
          <div className="flex items-center justify-center">
            <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            {t("audio.processing")}
          </div>
        );
      case "initializing":
        return (
          <div className="flex items-center justify-center">
            <div className={CSS_ANIMATIONS.PULSE}>
              <MicFilledIcon className="mr-2 h-5 w-5" />
            </div>
            {t("audio.initializing")}
          </div>
        );
      case "recording":
      case "paused":
        return (
          <div className="flex items-center justify-center">
            <div className="relative mr-2">
              <MicFilledIcon className={`${ICON_SIZES.SMALL} ${isPaused ? "" : CSS_ANIMATIONS.PULSE}`} />
              {!isPaused && <div className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-white" />}
            </div>
            {t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center">
            <MicFilledIcon className={`${ICON_SIZES.SMALL} mr-2`} />
            {t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)}
          </div>
        );
    }
  };

  const handleClick = () => {
    console.log("AudioRecorder: Main button clicked", { isRecording, isPaused });
    if (isRecording) {
      console.log("AudioRecorder: Calling stopRecording");
      onStop();
      return;
    }

    console.log("AudioRecorder: Calling startRecording");
    onStart();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isButtonDisabled}
      className={`${appliedVariant === "mini" ? "min-w-full px-4 py-3 text-sm font-medium" : "min-w-[200px] px-6 py-3"} rounded-xl font-medium ${getButtonStyles()}`}
      aria-label={isRecording ? t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING) : t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)}
      title={`${isRecording ? t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING) : t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)} (Ctrl+Space)`}
    >
      {getButtonContent()}
    </button>
  );
};

const MiniRecordingControls = ({
  isPaused,
  onStop,
  onPause,
  onResume,
  onCancel,
  t,
}: Omit<RecordingActionButtonsProps, "isRecording" | "appliedVariant">) => {
  return (
    <div className="flex w-full gap-2">
      <button
        type="button"
        onClick={onStop}
        className="flex-1 rounded-xl bg-rose-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-rose-500/25 transition-all duration-200 hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
        aria-label={t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}
        title={t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}
      >
        <div className="flex items-center justify-center">
          <div className="relative mr-2.5 flex items-center justify-center">
            <div className={`h-2.5 w-2.5 rounded-full bg-white ${isPaused ? "" : CSS_ANIMATIONS.PULSE}`} />
            {!isPaused && <div className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-white opacity-75" />}
          </div>
          <span className="font-semibold">{t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}</span>
        </div>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          if (isPaused) {
            console.log("AudioRecorder: Mini variant Resume button clicked");
            onResume();
            return;
          }

          console.log("AudioRecorder: Mini variant Pause button clicked");
          onPause();
        }}
        className={`rounded-xl px-3.5 py-3 transition-all duration-200 hover:scale-110 active:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 ${isPaused ? "bg-green-500 text-white hover:bg-green-600 focus:ring-green-500" : "bg-yellow-500 text-white hover:bg-yellow-600 focus:ring-yellow-500"}`}
        aria-label={isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
        title={isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
      >
        {isPaused ? (
          <svg className={ICON_SIZES.SMALL} fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg className={ICON_SIZES.SMALL} fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          console.log("AudioRecorder: Mini variant Cancel button clicked");
          onCancel();
        }}
        className="rounded-xl bg-gray-100 px-3.5 py-3 text-gray-600 transition-all duration-200 hover:scale-110 hover:bg-gray-200 active:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        aria-label={t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)}
        title={`${t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)} (Esc)`}
      >
        <svg className={ICON_SIZES.SMALL} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

const StandardRecordingControls = ({
  isPaused,
  onPause,
  onResume,
  onCancel,
  t,
}: Omit<RecordingActionButtonsProps, "isRecording" | "appliedVariant" | "onStop">) => {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => {
          if (isPaused) {
            console.log("AudioRecorder: Standard variant Resume button clicked");
            onResume();
            return;
          }

          console.log("AudioRecorder: Standard variant Pause button clicked");
          onPause();
        }}
        className={`rounded-lg border px-4 py-2 transition-all duration-200 hover:scale-105 active:scale-100 focus:outline-none focus:ring-2 ${isPaused ? "border-green-500 bg-green-50 text-green-700 hover:bg-green-100 focus:ring-green-500 dark:border-green-600 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50" : "border-yellow-500 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 focus:ring-yellow-500 dark:border-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-300 dark:hover:bg-yellow-900/50"}`}
        aria-label={isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
      >
        {isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
      </button>

      <button
        type="button"
        onClick={() => {
          console.log("AudioRecorder: Cancel button clicked");
          onCancel();
        }}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-all duration-200 hover:scale-105 hover:bg-gray-50 active:scale-100 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        aria-label={t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)}
      >
        {t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)}
      </button>
    </div>
  );
};

export const RecordingActionButtons = ({
  isRecording,
  isPaused,
  appliedVariant,
  onStop,
  onPause,
  onResume,
  onCancel,
  t,
}: RecordingActionButtonsProps) => {
  if (!isRecording) return null;

  if (appliedVariant === "mini") {
    return (
      <MiniRecordingControls
        isPaused={isPaused}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        t={t}
      />
    );
  }

  return (
    <StandardRecordingControls
      isPaused={isPaused}
      onPause={onPause}
      onResume={onResume}
      onCancel={onCancel}
      t={t}
    />
  );
};

export const RetryTranscriptionButton = ({
  show,
  onRetry,
  appliedVariant,
  retryCount,
  maxRetries,
  t,
}: RetryTranscriptionButtonProps) => {
  if (!show) return null;

  return (
    <button
      type="button"
      onClick={onRetry}
      className={`${appliedVariant === "mini" ? "px-4 py-2 text-sm font-medium" : "px-4 py-2"} rounded-lg border border-orange-300 bg-orange-50 text-orange-700 transition-colors hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:border-orange-600 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50`}
      aria-label={t("audio.retryTranscription")}
    >
      {t("audio.retryTranscription")} ({retryCount + 1}/{maxRetries})
    </button>
  );
};

export const RecordingProgress = ({
  isRecording,
  isPaused,
  appliedVariant,
  formatTime,
  recordingTime,
  maxDuration,
  progressPercentage,
  isInGracePeriod = false,
  gracePeriodRemaining = 0,
}: RecordingProgressProps) => {
  if (!isRecording) return null;

  return (
    <div className={appliedVariant === "mini" ? "flex flex-col gap-3" : "flex flex-1 items-center gap-3"}>
      {appliedVariant === "mini" && (
        <div className="w-full">
          <div className="relative">
            <div className="mb-1 flex items-center justify-center gap-1">
              {isInGracePeriod && gracePeriodRemaining > 0 ? (
                <span
                  key={gracePeriodRemaining}
                  className={`text-2xl font-black tabular-nums text-white ${CSS_ANIMATIONS.COUNTDOWN_POP} ${gracePeriodRemaining === 1 ? CSS_ANIMATIONS.PULSE_FAST : CSS_ANIMATIONS.PULSE}`}
                  style={{
                    textShadow: "0 0 8px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.5), 2px 2px 4px rgba(0,0,0,0.6)",
                    WebkitTextStroke: "1px rgba(0,0,0,0.3)",
                  }}
                >
                  {gracePeriodRemaining}
                </span>
              ) : (
                <>
                  <span className="font-mono text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                    {formatTime(recordingTime)}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">/</span>
                  <span className="font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500">
                    {formatTime(maxDuration)}
                  </span>
                </>
              )}
            </div>

            <div className="h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className={`h-full rounded-full ${isPaused ? "bg-yellow-500" : "bg-rose-500"} ${isPaused ? CSS_ANIMATIONS.PULSE : "transition-all duration-1000 ease-out"}`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {appliedVariant === "standard" && (
        <div className="min-w-[200px] flex-1">
          <div className="relative h-4 w-full overflow-hidden rounded-full bg-gray-200 shadow-inner dark:bg-gray-700">
            <div
              className={`absolute inset-y-0 left-0 h-full ${isPaused ? `bg-gradient-to-r from-yellow-500 to-yellow-600 ${CSS_ANIMATIONS.PULSE}` : "bg-gradient-to-r from-red-500 to-red-600 transition-all duration-300 ease-out"}`}
              style={{ width: `${progressPercentage}%` }}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {isInGracePeriod && gracePeriodRemaining > 0 ? (
                <span
                  key={gracePeriodRemaining}
                  className={`text-lg font-black text-white ${CSS_ANIMATIONS.COUNTDOWN_POP} ${gracePeriodRemaining === 1 ? CSS_ANIMATIONS.PULSE_FAST : CSS_ANIMATIONS.PULSE}`}
                  style={{ textShadow: "0 0 8px rgba(255,255,255,0.8), 0 1px 3px rgba(0,0,0,0.5)" }}
                >
                  {gracePeriodRemaining}
                </span>
              ) : (
                <span className="font-mono text-xs text-gray-800 dark:text-gray-200">
                  {isPaused && <span className="mr-2 text-yellow-600 dark:text-yellow-400">⏸</span>}
                  {formatTime(recordingTime)} / {formatTime(maxDuration)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const ErrorBanner = ({
  errorMessage,
  appliedVariant,
  onClose,
  t,
}: ErrorBannerProps) => {
  if (!errorMessage) return null;

  return (
    <div className={`${appliedVariant === "mini" ? "p-3" : "p-3"} rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className={`${appliedVariant === "mini" ? "text-sm" : "text-sm"} font-medium`}>{errorMessage}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-red-500 transition-colors hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:text-red-400 dark:hover:text-red-200"
          aria-label={t("audio.closeError")}
          title={t("audio.closeError")}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export const AudioLevelIndicator = ({
  isRecording,
  isPaused,
  audioLevel,
  t,
}: AudioLevelIndicatorProps) => {
  if (!isRecording || isPaused || audioLevel <= 0) return null;

  return (
    <div className="w-full">
      <div className="mt-3">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium">{t("audio.audioLevel")}:</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 transition-all duration-100"
              style={{ width: `${audioLevel}%` }}
            />
          </div>
          <span className="w-8 text-right font-mono">{Math.round(audioLevel)}%</span>
        </div>
      </div>
    </div>
  );
};

export const SplitRecordButton = ({
  splitLeft,
  isButtonDisabled,
  onStart,
  t,
}: SplitRecordButtonProps) => {
  return (
    <div className="flex w-full overflow-hidden rounded-xl shadow-lg">
      {splitLeft}
      <div className="w-px self-stretch bg-white/20" />
      <button
        type="button"
        onClick={onStart}
        disabled={isButtonDisabled}
        className="flex-1 bg-green-600 px-6 py-3 font-medium text-white transition-all duration-200 active:scale-[0.98] hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-green-600 disabled:active:scale-100"
        aria-label={t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)}
        title={`${t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)} (Ctrl+Space)`}
      >
        <div className="flex items-center justify-center">
          <MicFilledIcon className="mr-2 h-5 w-5" />
          {t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)}
        </div>
      </button>
    </div>
  );
};
