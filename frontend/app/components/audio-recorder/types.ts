import type { ReactNode } from "react";

export type TranslationFn = (key: string) => string;
export type RecorderVariant = "standard" | "mini";
export type RecordingState = "processing" | "initializing" | "paused" | "recording" | "idle";

export interface AudioRecorderProps {
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
  variant?: RecorderVariant;
  autoStart?: boolean;
  hideKeyboardShortcuts?: boolean;
  onRecordingStateChange?: (isActive: boolean) => void;
  splitLeft?: ReactNode;
}

export interface MainRecordButtonProps {
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

export interface RecordingActionButtonsProps {
  isRecording: boolean;
  isPaused: boolean;
  appliedVariant: RecorderVariant;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  t: TranslationFn;
}

export interface RetryTranscriptionButtonProps {
  show: boolean;
  onRetry: () => void;
  appliedVariant: RecorderVariant;
  retryCount: number;
  maxRetries: number;
  t: TranslationFn;
}

export interface RecordingProgressProps {
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

export interface ErrorBannerProps {
  errorMessage: string | null;
  appliedVariant: RecorderVariant;
  onClose: () => void;
  t: TranslationFn;
}

export interface AudioLevelIndicatorProps {
  isRecording: boolean;
  isPaused: boolean;
  audioLevel: number;
  t: TranslationFn;
}

export interface SplitRecordButtonProps {
  splitLeft: ReactNode;
  isButtonDisabled: boolean;
  onStart: () => void;
  t: TranslationFn;
}

export interface UseAudioRecorderLifecycleArgs {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing: boolean;
  maxDuration: number;
  onError?: (error: string) => void;
  disabled: boolean;
  onRetry?: () => void;
  transcriptionError?: string | null;
  onClearError?: () => void;
  autoStart: boolean;
  hideKeyboardShortcuts: boolean;
  onRecordingStateChange?: (isActive: boolean) => void;
  t: TranslationFn;
}

export interface UseAudioRecorderLifecycleResult {
  recordingTime: number;
  isRecording: boolean;
  isPaused: boolean;
  audioLevel: number;
  isInitializing: boolean;
  isInGracePeriod: boolean;
  gracePeriodRemaining: number;
  recordingState: RecordingState;
  transcriptionErrorMessage: string | null;
  hasStoredAudio: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  retryTranscription: () => void;
  closeError: () => void;
}
