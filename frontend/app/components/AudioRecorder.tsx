"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

import { getBestSupportedFormat, getAllSupportedFormats, logAudioInfo, hasKnownIssues, createConfiguredMediaRecorder } from "@/utils/audioFormatUtils";
import { getAudioGracePeriod, getAudioRecordingDuration } from "@/utils/audioRecorderConfig";
import { MicFilledIcon } from "@components/Icons";

// Translation key constants
const AUDIO_TRANSLATION_KEYS = {
  RESUME_RECORDING: 'audio.resumeRecording',
  PAUSE_RECORDING: 'audio.pauseRecording',
  STOP_RECORDING: 'audio.stopRecording',
  CANCEL_RECORDING: 'audio.cancelRecording',
  NEW_RECORDING: 'audio.newRecording',
} as const;

// Error key constants
const ERROR_KEYS = {
  AUDIO_PROCESSING: 'errors.audioProcessing',
} as const;

// Icon size constants
const ICON_SIZES = {
  SMALL: 'w-5 h-5',
} as const;

// CSS animation constants
const CSS_ANIMATIONS = {
  PULSE: 'animate-pulse',
  PULSE_FAST: 'animate-pulse-fast',
  COUNTDOWN_POP: 'animate-countdown-pop',
} as const;

type TranslationFn = (key: string) => string;
type RecorderVariant = "standard" | "mini";
type RecordingState = "processing" | "initializing" | "paused" | "recording" | "idle";

interface MainRecordButtonProps {
  show: boolean;
  appliedVariant: RecorderVariant;
  isRecording: boolean;
  isPaused: boolean;
  isButtonDisabled: boolean;
  recordingState: RecordingState;
  onStart: () => void;
  onStop: () => void;
  t: TranslationFn;
}

const MainRecordButton = ({
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

  // Keep transitions/rings consistent across variants
  const baseStyles = "relative overflow-hidden transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:transform-none disabled:hover:scale-100";

  // Reduce default size by 5% for BOTH variants and allow hover up to 100%.
  const scaleStyles = "transform scale-[0.95] hover:scale-100 active:scale-95";

  const getButtonStyles = () => {
    switch (recordingState) {
      case 'processing':
        return `${baseStyles} ${scaleStyles} bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 cursor-wait`;
      case 'initializing':
        return `${baseStyles} ${scaleStyles} bg-yellow-500 hover:bg-yellow-600 text-white focus:ring-yellow-500 cursor-wait`;
      case 'recording':
      case 'paused':
        // Both recording and paused show red Stop button
        return `${baseStyles} ${scaleStyles} bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 shadow-lg shadow-red-500/25`;
      default:
        return `${baseStyles} ${scaleStyles} bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 shadow-lg hover:shadow-green-500/25`;
    }
  };

  const getButtonContent = () => {
    switch (recordingState) {
      case 'processing':
        return (
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"></div>
            {t('audio.processing')}
          </div>
        );
      case 'initializing':
        return (
          <div className="flex items-center justify-center">
            <div className={CSS_ANIMATIONS.PULSE}>
              <MicFilledIcon className="w-5 h-5 mr-2" />
            </div>
            {t('audio.initializing')}
          </div>
        );
      case 'recording':
      case 'paused':
        // Both recording and paused show Stop button
        return (
          <div className="flex items-center justify-center">
            <div className="relative mr-2">
              <MicFilledIcon className={`${ICON_SIZES.SMALL} ${isPaused ? '' : CSS_ANIMATIONS.PULSE}`} />
              {!isPaused && <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-ping"></div>}
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
    console.log('AudioRecorder: Main button clicked', { isRecording, isPaused });
    if (isRecording) {
      // Main button always stops recording (even when paused)
      console.log('AudioRecorder: Calling stopRecording');
      onStop();
    } else {
      console.log('AudioRecorder: Calling startRecording');
      onStart();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isButtonDisabled}
      className={`${appliedVariant === "mini" ? "min-w-full px-4 py-3 text-sm font-medium" : "min-w-[200px] px-6 py-3"} rounded-xl font-medium ${getButtonStyles()}`}
      aria-label={
        isRecording
          ? t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)
          : t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)
      }
      title={`${isRecording ? t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING) : t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)} (Ctrl+Space)`}
    >
      {getButtonContent()}
    </button>
  );
};

interface MiniRecordingControlsProps {
  isPaused: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  t: TranslationFn;
}

const MiniRecordingControls = ({
  isPaused,
  onStop,
  onPause,
  onResume,
  onCancel,
  t,
}: MiniRecordingControlsProps) => {
  return (
    <div className="flex gap-2 w-full">
      {/* Main stop button - takes most width */}
      <button
        type="button"
        onClick={onStop}
        className="flex-1 px-4 py-3 text-sm font-medium rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 shadow-lg shadow-rose-500/25"
        aria-label={t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}
        title={t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}
      >
        <div className="flex items-center justify-center">
          {/* Recording indicator dot */}
          <div className="relative mr-2.5 flex items-center justify-center">
            <div className={`w-2.5 h-2.5 bg-white rounded-full ${isPaused ? '' : CSS_ANIMATIONS.PULSE}`} />
            {!isPaused && <div className="absolute w-2.5 h-2.5 bg-white rounded-full animate-ping opacity-75" />}
          </div>
          <span className="font-semibold">{t(AUDIO_TRANSLATION_KEYS.STOP_RECORDING)}</span>
        </div>
      </button>

      {/* Pause/Resume button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          if (isPaused) {
            console.log('AudioRecorder: Mini variant Resume button clicked');
            onResume();
          } else {
            console.log('AudioRecorder: Mini variant Pause button clicked');
            onPause();
          }
        }}
        className={`px-3.5 py-3 rounded-xl ${isPaused
          ? 'bg-green-500 hover:bg-green-600 text-white'
          : 'bg-yellow-500 hover:bg-yellow-600 text-white'
          } transition-all duration-200 hover:scale-110 active:scale-105 focus:outline-none focus:ring-2 ${isPaused ? 'focus:ring-green-500' : 'focus:ring-yellow-500'
          } focus:ring-offset-2`}
        aria-label={isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
        title={isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
      >
        {isPaused ? (
          // Play/Resume icon
          <svg
            className={ICON_SIZES.SMALL}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          // Pause icon
          <svg
            className={ICON_SIZES.SMALL}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        )}
      </button>

      {/* Cancel button - separate, clearly distinct */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          console.log('AudioRecorder: Mini variant Cancel button clicked');
          onCancel();
        }}
        className="px-3.5 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-all duration-200 hover:scale-110 active:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
        aria-label={t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)}
        title={`${t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)} (Esc)`}
      >
        <svg
          className={ICON_SIZES.SMALL}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
};

interface StandardRecordingControlsProps {
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  t: TranslationFn;
}

const StandardRecordingControls = ({
  isPaused,
  onPause,
  onResume,
  onCancel,
  t,
}: StandardRecordingControlsProps) => {
  return (
    <div className="flex gap-2">
      {/* Pause/Resume button */}
      <button
        type="button"
        onClick={() => {
          if (isPaused) {
            console.log('AudioRecorder: Standard variant Resume button clicked');
            onResume();
          } else {
            console.log('AudioRecorder: Standard variant Pause button clicked');
            onPause();
          }
        }}
        className={`px-4 py-2 rounded-lg border ${isPaused
          ? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-600 dark:hover:bg-green-900/50'
          : 'border-yellow-500 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-600 dark:hover:bg-yellow-900/50'
          } transition-all duration-200 hover:scale-105 active:scale-100 focus:outline-none focus:ring-2 ${isPaused ? 'focus:ring-green-500' : 'focus:ring-yellow-500'
          }`}
        aria-label={isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
      >
        {isPaused ? t(AUDIO_TRANSLATION_KEYS.RESUME_RECORDING) : t(AUDIO_TRANSLATION_KEYS.PAUSE_RECORDING)}
      </button>

      {/* Cancel button */}
      <button
        type="button"
        onClick={() => {
          console.log('AudioRecorder: Cancel button clicked');
          onCancel();
        }}
        className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 transition-all duration-200 hover:scale-105 active:scale-100 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        aria-label={t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)}
      >
        {t(AUDIO_TRANSLATION_KEYS.CANCEL_RECORDING)}
      </button>
    </div>
  );
};

interface RecordingActionButtonsProps {
  isRecording: boolean;
  isPaused: boolean;
  appliedVariant: RecorderVariant;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  t: TranslationFn;
}

const RecordingActionButtons = ({
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

interface RetryTranscriptionButtonProps {
  show: boolean;
  onRetry: () => void;
  appliedVariant: RecorderVariant;
  retryCount: number;
  maxRetries: number;
  t: TranslationFn;
}

const RetryTranscriptionButton = ({
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
      onClick={onRetry}
      className={`${appliedVariant === "mini" ? "px-4 py-2 text-sm font-medium" : "px-4 py-2"} rounded-lg border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-600 dark:hover:bg-orange-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2`}
      aria-label={t('audio.retryTranscription')}
    >
      {t('audio.retryTranscription')} ({retryCount + 1}/{maxRetries})
    </button>
  );
};

interface RecordingProgressProps {
  isRecording: boolean;
  isPaused: boolean;
  appliedVariant: RecorderVariant;
  formatTime: (seconds: number) => string;
  recordingTime: number;
  maxDuration: number;
  progressPercentage: number;
  isInGracePeriod?: boolean;
  gracePeriodRemaining?: number;
}

const RecordingProgress = ({
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
    <div className={`${appliedVariant === "mini" ? "flex flex-col gap-3" : "flex items-center gap-3 flex-1"}`}>
      {/* MINI: Compact timer with thin progress */}
      {appliedVariant === "mini" && (
        <div className="w-full">
          {/* Single line: progress bar with time on top */}
          <div className="relative">
            {/* Time display - centered above the bar */}
            <div className="flex items-center justify-center gap-1 mb-1">
              {isInGracePeriod && gracePeriodRemaining > 0 ? (
                <span
                  key={gracePeriodRemaining}
                  className={`text-2xl font-black tabular-nums text-white ${CSS_ANIMATIONS.COUNTDOWN_POP} ${gracePeriodRemaining === 1 ? CSS_ANIMATIONS.PULSE_FAST : CSS_ANIMATIONS.PULSE}`}
                  style={{
                    textShadow: '0 0 8px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.5), 2px 2px 4px rgba(0,0,0,0.6)',
                    WebkitTextStroke: '1px rgba(0,0,0,0.3)'
                  }}
                >
                  {gracePeriodRemaining}
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold font-mono text-gray-700 dark:text-gray-200 tabular-nums">
                    {formatTime(recordingTime)}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">/</span>
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500 tabular-nums">
                    {formatTime(maxDuration)}
                  </span>
                </>
              )}
            </div>

            {/* Ultra-thin progress bar */}
            <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-rose-500'} ${isPaused ? CSS_ANIMATIONS.PULSE : 'transition-all duration-1000 ease-out'}`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* STANDARD: long progress bar that expands and shows timer inside */}
      {appliedVariant === "standard" && (
        <div className="flex-1 min-w-[200px]">
          <div className="relative w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner h-4">
            <div
              className={`absolute inset-y-0 left-0 h-full ${isPaused
                ? `bg-gradient-to-r from-yellow-500 to-yellow-600 ${CSS_ANIMATIONS.PULSE}`
                : 'transition-all duration-300 ease-out bg-gradient-to-r from-red-500 to-red-600'
                }`}
              style={{ width: `${progressPercentage}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {isInGracePeriod && gracePeriodRemaining > 0 ? (
                <span
                  key={gracePeriodRemaining}
                  className={`font-black text-lg text-white ${CSS_ANIMATIONS.COUNTDOWN_POP} ${gracePeriodRemaining === 1 ? CSS_ANIMATIONS.PULSE_FAST : CSS_ANIMATIONS.PULSE}`}
                  style={{ textShadow: '0 0 8px rgba(255,255,255,0.8), 0 1px 3px rgba(0,0,0,0.5)' }}
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

interface ErrorBannerProps {
  errorMessage: string | null;
  appliedVariant: RecorderVariant;
  onClose: () => void;
  t: TranslationFn;
}

const ErrorBanner = ({
  errorMessage,
  appliedVariant,
  onClose,
  t,
}: ErrorBannerProps) => {
  if (!errorMessage) return null;

  return (
    <div className={`${appliedVariant === "mini" ? "p-3" : "p-3"} bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className={`${appliedVariant === "mini" ? "text-sm" : "text-sm"} font-medium`}>{errorMessage}</span>
        </div>
        <button
          onClick={onClose}
          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded-full p-1"
          aria-label={t('audio.closeError')}
          title={t('audio.closeError')}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
};

interface AudioLevelIndicatorProps {
  isRecording: boolean;
  isPaused: boolean;
  audioLevel: number;
  t: TranslationFn;
}

const AudioLevelIndicator = ({
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
          <span className="font-medium">{t('audio.audioLevel')}:</span>
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
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

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  maxDuration?: number; // in seconds, default 90
  onError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
  onRetry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  transcriptionError?: string | null;
  onClearError?: () => void;
  variant?: "standard" | "mini"; // New prop for mini version
  autoStart?: boolean; // Auto-start recording on mount (useful for popovers)
  hideKeyboardShortcuts?: boolean; // Hide keyboard shortcuts when true
  onRecordingStateChange?: (isActive: boolean) => void; // Callback when recording starts/stops
  splitLeft?: React.ReactNode; // Amber left part of split button (shown only in idle state)
}

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
  variant = "standard", // Default to standard version
  autoStart = false,
  hideKeyboardShortcuts = false,
  onRecordingStateChange,
  splitLeft,
}: AudioRecorderProps) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [storedAudioBlob, setStoredAudioBlob] = useState<Blob | null>(null);
  const [transcriptionErrorState, setTranscriptionErrorState] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);

  // Notify parent of recording state
  useEffect(() => {
    onRecordingStateChange?.(isRecording || isInitializing);
  }, [isRecording, isInitializing, onRecordingStateChange]);


  // Grace period state
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
  const { t } = useTranslation();
  // Track if we've already auto-started to avoid unintended restarts after stop
  const hasAutoStartedRef = useRef(false);

  // Track viewport width to switch variants on mobile
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(max-width: 767px)');

      const updateIsMobile = (event: MediaQueryList | MediaQueryListEvent) => {
        setIsMobileView(event.matches);
      };

      updateIsMobile(mediaQuery);

      const listener = (event: MediaQueryListEvent) => updateIsMobile(event);

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
        return () => {
          mediaQuery.removeEventListener('change', listener);
        };
      }

      const legacyListener = (event: MediaQueryListEvent) => updateIsMobile(event);
      mediaQuery.addListener(legacyListener as unknown as (this: MediaQueryList, ev: MediaQueryListEvent) => void);
      return () => {
        mediaQuery.removeListener(legacyListener as unknown as (this: MediaQueryList, ev: MediaQueryListEvent) => void);
      };
    }

    const MOBILE_MAX_WIDTH = 767;
    const checkIsMobile = () => {
      setIsMobileView(window.innerWidth <= MOBILE_MAX_WIDTH);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);

    return () => {
      window.removeEventListener('resize', checkIsMobile);
    };
  }, []);

  // Cleanup function to properly dispose of resources
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
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorder.current = null;
    chunks.current = [];
    setAudioLevel(0);
  }, []);

  // Error handler
  const handleError = useCallback((error: Error, messageKey: string) => {
    console.error("AudioRecorder error:", error);
    const errorMessage = t(messageKey);
    if (onError) {
      onError(errorMessage);
    } else {
      alert(errorMessage);
    }
    cleanup();
    setIsRecording(false);
    setIsPaused(false); // Reset pause state on error
    setIsInitializing(false);
  }, [t, onError, cleanup]);

  // Audio level monitoring - pause monitoring when recording is paused
  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    setAudioLevel(Math.min(100, (average / 128) * 100));

    if (isRecording && !isPaused) {
      animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
    }
  }, [isRecording, isPaused]);

  // Helper function to validate recording prerequisites
  const validateRecordingPrerequisites = useCallback(() => {
    console.log('AudioRecorder: startRecording called', { disabled, isProcessing, isInitializing });

    if (disabled || isProcessing || isInitializing) {
      console.log('AudioRecorder: Start conditions not met - returning early');
      return false;
    }

    console.log('AudioRecorder: Starting new recording...');
    return true;
  }, [disabled, isProcessing, isInitializing]);

  // Helper function to initialize recording state
  const initializeRecordingState = useCallback(() => {
    // CRITICAL: Clear any leftover chunks from previous recording
    chunks.current = [];
    console.log('AudioRecorder: Cleared chunks array before starting');

    setIsInitializing(true);
    setTranscriptionErrorState(null);
  }, []);

  // Helper function to acquire media stream
  const acquireMediaStream = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    streamRef.current = stream;
    return stream;
  }, []);

  // Helper function to setup audio monitoring
  const setupAudioMonitoring = useCallback((stream: MediaStream) => {
    // Setup audio context for level monitoring
    try {
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
    } catch (audioContextError) {
      console.warn("Could not create audio context for level monitoring:", audioContextError);
    }
  }, []);


  // Helper function to initiate recording
  const initiateRecording = useCallback(() => {
    // CRITICAL FIX: Don't use frequent timeslice to avoid WebM header corruption
    // Collect entire recording in one chunk to maintain proper file structure
    // This prevents multiple WebM headers from being concatenated incorrectly
    mediaRecorder.current!.start(); // Collect entire recording as single chunk
    setIsRecording(true);
    setIsInitializing(false);

    // Start audio level monitoring
    if (analyserRef.current) {
      monitorAudioLevel();
    }
  }, [monitorAudioLevel]);

  // Start recording function
  const startRecording = useCallback(async () => {
    // Step 1: Validate prerequisites
    if (!validateRecordingPrerequisites()) {
      return;
    }

    // Step 2: Initialize recording state
    initializeRecordingState();

    try {
      // Step 3: Acquire media stream
      const stream = await acquireMediaStream();

      // Step 4: Setup audio monitoring
      setupAudioMonitoring(stream);

      // Setup MediaRecorder with best supported format
      const bestFormat = getBestSupportedFormat();
      const allSupported = getAllSupportedFormats();

      console.log(`AudioRecorder: Selected format: ${bestFormat}`);
      console.log(`AudioRecorder: Browser supports: ${allSupported.join(', ')}`);
      console.log(`AudioRecorder: Browser: ${navigator.userAgent}`);

      // Warn if using problematic format
      if (hasKnownIssues(bestFormat)) {
        console.warn(`⚠️ AudioRecorder: Format ${bestFormat} has known compatibility issues with OpenAI`);
        console.warn(`⚠️ AudioRecorder: Your browser doesn't support better formats (MP4/MP3/WAV)`);
        console.warn(`⚠️ AudioRecorder: Consider using Chrome/Firefox latest version for better compatibility`);
      }

      // Step 5: Configure MediaRecorder
      const handleDataAvailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      const handleStop = async () => {
        if (chunks.current.length > 0) {
          const mimeType = mediaRecorder.current?.mimeType || bestFormat;

          // Create blob from chunks
          const blob = new Blob(chunks.current, {
            type: mimeType
          });

          // Log detailed audio information for debugging (async now)
          await logAudioInfo(blob, 'AudioRecorder Output');
          console.log(`AudioRecorder: Chunks count: ${chunks.current.length}`);

          // Validate blob before sending
          if (blob.size === 0) {
            console.error('AudioRecorder: Empty blob created');
            handleError(new Error('Recording failed - empty audio'), ERROR_KEYS.AUDIO_PROCESSING);
            cleanup();
            return;
          }

          if (blob.size < 1000) {
            console.warn(`AudioRecorder: Very small blob (${blob.size} bytes) - recording might be too short`);
          }

          setStoredAudioBlob(blob);
          onRecordingComplete(blob);
        } else {
          console.error('AudioRecorder: No chunks recorded');
          handleError(new Error('Recording failed - no data'), ERROR_KEYS.AUDIO_PROCESSING);
        }
        cleanup();
      };

      const handleRecorderError = () => {
        handleError(new Error('MediaRecorder error'), ERROR_KEYS.AUDIO_PROCESSING);
      };

      mediaRecorder.current = createConfiguredMediaRecorder(
        stream,
        bestFormat,
        handleDataAvailable,
        handleStop,
        handleRecorderError
      );

      // Step 6: Initiate recording
      initiateRecording();

    } catch (error) {
      handleError(error as Error, 'errors.microphoneUnavailable');
    }
  }, [validateRecordingPrerequisites, initializeRecordingState, acquireMediaStream, setupAudioMonitoring, initiateRecording, handleError, cleanup, onRecordingComplete]);

  // Stop recording function
  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorder.current) return;

    try {
      mediaRecorder.current.stop();
      setIsRecording(false);
      setIsPaused(false); // Reset pause state when stopping
    } catch (error) {
      handleError(error as Error, ERROR_KEYS.AUDIO_PROCESSING);
    }
  }, [isRecording, handleError]);

  // Cancel recording function
  const cancelRecording = useCallback(() => {
    console.log('AudioRecorder: cancelRecording called', { isRecording, hasMediaRecorder: !!mediaRecorder.current, variant });

    if (!isRecording || !mediaRecorder.current) {
      console.log('AudioRecorder: Cancel conditions not met - returning early');
      return;
    }

    console.log('AudioRecorder: Canceling recording...');

    try {
      // CRITICAL: Clear chunks BEFORE stopping to prevent contamination
      chunks.current = [];
      console.log('AudioRecorder: Cleared chunks array');

      // Prevent both onstop and ondataavailable from processing canceled data
      // CRITICAL: ondataavailable can fire AFTER stop() is called (async race condition)
      mediaRecorder.current.onstop = null;
      mediaRecorder.current.ondataavailable = null;
      mediaRecorder.current.stop();

      // Reset all state
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
      setStoredAudioBlob(null);
      setTranscriptionErrorState(null);

      // Cleanup resources
      cleanup();

      console.log('AudioRecorder: Recording canceled successfully');
    } catch (error) {
      console.error("Error canceling recording:", error);

      // Force cleanup even on error
      chunks.current = [];
      cleanup();
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
      setStoredAudioBlob(null);
      setTranscriptionErrorState(null);
    }
  }, [isRecording, cleanup, variant]);

  // Pause recording function
  const pauseRecording = useCallback(() => {
    console.log('AudioRecorder: pauseRecording called', { isRecording, isPaused, hasMediaRecorder: !!mediaRecorder.current });

    if (!isRecording || isPaused || !mediaRecorder.current) {
      console.log('AudioRecorder: Pause conditions not met - returning early');
      return;
    }

    console.log('AudioRecorder: Pausing recording...');

    try {
      mediaRecorder.current.pause();
      setIsPaused(true);
      console.log('AudioRecorder: Recording paused successfully');
    } catch (error) {
      console.error("Error pausing recording:", error);
      handleError(error as Error, ERROR_KEYS.AUDIO_PROCESSING);
    }
  }, [isRecording, isPaused, handleError]);

  // Resume recording function
  const resumeRecording = useCallback(() => {
    console.log('AudioRecorder: resumeRecording called', { isRecording, isPaused, hasMediaRecorder: !!mediaRecorder.current });

    if (!isRecording || !isPaused || !mediaRecorder.current) {
      console.log('AudioRecorder: Resume conditions not met - returning early');
      return;
    }

    console.log('AudioRecorder: Resuming recording...');

    try {
      mediaRecorder.current.resume();
      setIsPaused(false);
      console.log('AudioRecorder: Recording resumed successfully');
    } catch (error) {
      console.error("Error resuming recording:", error);
      handleError(error as Error, ERROR_KEYS.AUDIO_PROCESSING);
    }
  }, [isRecording, isPaused, handleError]);

  // Retry transcription function
  const retryTranscription = useCallback(() => {
    if (storedAudioBlob && onRetry) {
      setTranscriptionErrorState(null);
      onRetry();
    }
  }, [storedAudioBlob, onRetry]);

  // Close error function
  const closeError = useCallback(() => {
    setTranscriptionErrorState(null);
    setStoredAudioBlob(null);
    if (onClearError) {
      onClearError();
    }
  }, [onClearError]);

  // Clear stored audio when transcription succeeds
  const clearStoredAudio = useCallback(() => {
    setStoredAudioBlob(null);
    setTranscriptionErrorState(null);
  }, []);

  // Expose clearStoredAudio to parent component
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).clearAudioRecorderStorage = clearStoredAudio;
    }
  }, [clearStoredAudio]);

  // Sync external transcription error with internal state
  useEffect(() => {
    if (transcriptionError) {
      setTranscriptionErrorState(transcriptionError);
    }
  }, [transcriptionError]);

  // Timer effect - pause timer when recording is paused, includes grace period logic
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        // If in grace period, count down
        if (isInGracePeriod) {
          setGracePeriodRemaining((prev) => {
            const newRemaining = prev - 1;
            if (newRemaining <= 0) {
              // Grace period ended, stop recording
              stopRecording();
              return 0;
            }
            return newRemaining;
          });
        } else {
          // Normal recording time
          setRecordingTime((prev) => {
            const newTime = prev + 1;
            if (newTime >= maxDuration) {
              // Enter grace period instead of stopping immediately
              if (gracePeriodDuration > 0) {
                setIsInGracePeriod(true);
                setGracePeriodRemaining(gracePeriodDuration);
                return maxDuration; // Cap at maxDuration
              } else {
                // No grace period configured, stop immediately
                stopRecording();
                return maxDuration;
              }
            }
            return newTime;
          });
        }
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
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
  }, [isRecording, isPaused, maxDuration, stopRecording, recordingTime, isProcessing, isInGracePeriod, gracePeriodDuration]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Keyboard shortcuts
  useEffect(() => {
    if (hideKeyboardShortcuts) return; // Skip keyboard shortcuts when disabled

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't trigger when typing in inputs
      }

      if (e.code === 'Space' && e.ctrlKey) {
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
      } else if (e.code === 'Escape' && isRecording) {
        e.preventDefault();
        cancelRecording();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isRecording, startRecording, stopRecording, cancelRecording, hideKeyboardShortcuts]);

  // Auto-start exactly once per mount (avoid auto-restarting after stop)
  useEffect(() => {
    if (!autoStart) return;
    if (hasAutoStartedRef.current) return;
    hasAutoStartedRef.current = true;
    const id = setTimeout(() => {
      startRecording();
    }, 0);
    return () => clearTimeout(id);
  }, [autoStart, startRecording]);

  // Memoized values
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const progressPercentage = useMemo(() =>
    Math.min(100, (recordingTime / maxDuration) * 100)
    , [recordingTime, maxDuration]);

  const isButtonDisabled = disabled || isProcessing || isInitializing;

  const recordingState = useMemo<RecordingState>(() => {
    if (isProcessing) return 'processing';
    if (isInitializing) return 'initializing';
    if (isRecording && isPaused) return 'paused';
    if (isRecording) return 'recording';
    return 'idle';
  }, [isProcessing, isInitializing, isRecording, isPaused]);

  const appliedVariant = useMemo<RecorderVariant>(() => {
    if (variant === "mini") {
      return "mini";
    }
    return isMobileView ? "mini" : "standard";
  }, [variant, isMobileView]);

  const transcriptionErrorMessage = transcriptionErrorState || transcriptionError || null;
  const shouldShowRetry = Boolean(transcriptionErrorMessage && storedAudioBlob && retryCount < maxRetries);

  const isIdle = recordingState === 'idle';

  return (
    <div className={`space-y-4 ${className} ${appliedVariant === "mini" ? "space-y-3" : ""}`}>
      {/* Split button: when splitLeft provided and idle — render as one unified button */}
      {splitLeft && isIdle ? (
        <div className="flex rounded-xl overflow-hidden shadow-lg w-full">
          {splitLeft}
          <div className="w-px bg-white/20 self-stretch" />
          <button
            type="button"
            onClick={startRecording}
            disabled={isButtonDisabled}
            className="flex-1 px-6 py-3 font-medium bg-green-600 hover:bg-green-700 text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-200 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-green-600 disabled:active:scale-100"
            aria-label={t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)}
            title={`${t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)} (Ctrl+Space)`}
          >
            <div className="flex items-center justify-center">
              <MicFilledIcon className="w-5 h-5 mr-2" />
              {t(AUDIO_TRANSLATION_KEYS.NEW_RECORDING)}
            </div>
          </button>
        </div>
      ) : (
        /* Standard / recording / processing mode */
        <div className={`${appliedVariant === "mini" ? "flex flex-col gap-3" : "flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full"}`}>
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

          <RetryTranscriptionButton
            show={shouldShowRetry}
            onRetry={retryTranscription}
            appliedVariant={appliedVariant}
            retryCount={retryCount}
            maxRetries={maxRetries}
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

      {/* Error message */}
      <ErrorBanner
        errorMessage={transcriptionErrorMessage}
        appliedVariant={appliedVariant}
        onClose={closeError}
        t={t}
      />

      {/* Audio level indicator (kept below) - hide when paused */}
      <AudioLevelIndicator
        isRecording={isRecording}
        isPaused={isPaused}
        audioLevel={audioLevel}
        t={t}
      />
    </div>
  );
};
