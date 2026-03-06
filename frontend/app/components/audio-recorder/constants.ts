export const AUDIO_TRANSLATION_KEYS = {
  RESUME_RECORDING: "audio.resumeRecording",
  PAUSE_RECORDING: "audio.pauseRecording",
  STOP_RECORDING: "audio.stopRecording",
  CANCEL_RECORDING: "audio.cancelRecording",
  NEW_RECORDING: "audio.newRecording",
} as const;

export const ERROR_KEYS = {
  AUDIO_PROCESSING: "errors.audioProcessing",
  MICROPHONE_UNAVAILABLE: "errors.microphoneUnavailable",
} as const;

export const ICON_SIZES = {
  SMALL: "w-5 h-5",
} as const;

export const CSS_ANIMATIONS = {
  PULSE: "animate-pulse",
  PULSE_FAST: "animate-pulse-fast",
  COUNTDOWN_POP: "animate-countdown-pop",
} as const;

export const MOBILE_MAX_WIDTH = 767;
