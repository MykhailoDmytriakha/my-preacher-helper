"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from 'react-i18next';

import "@locales/i18n";
import { MicrophoneIcon } from "@/components/Icons";
import { getBestSupportedFormat, logAudioInfo, hasKnownIssues } from "@/utils/audioFormatUtils";

// Error translation key constant to avoid duplicate strings
const ERROR_AUDIO_PROCESSING = 'errors.audioProcessing';
const AUDIO_NEW_RECORDING = 'audio.newRecording';

interface FocusRecorderButtonProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  maxDuration?: number; // in seconds, default 90
  onError?: (error: string) => void;
  disabled?: boolean;
  size?: 'normal' | 'small'; // Size variant for different contexts
}

type ButtonState = 'processing' | 'initializing' | 'paused' | 'recording' | 'idle';
type TranslateFn = (key: string) => string;

type SizeVariant = NonNullable<FocusRecorderButtonProps['size']>;

type SizeConfig = {
  buttonSize: string;
  iconSize: string;
  spinnerSize: string;
  cancelSize: string;
  controlIconSize: string;
  fontSize: string;
};

const SIZE_CONFIG: Record<SizeVariant, SizeConfig> = {
  small: {
    buttonSize: 'w-10 h-10', // 40px for outline point headers
    iconSize: 'w-4 h-4',
    spinnerSize: 'h-4 w-4',
    cancelSize: 'w-4 h-4',
    controlIconSize: 'w-3 h-3',
    fontSize: 'text-xs',
  },
  normal: {
    buttonSize: 'w-16 h-16', // 64px for focus mode sidebar
    iconSize: 'w-6 h-6',
    spinnerSize: 'h-6 w-6',
    cancelSize: 'w-6 h-6',
    controlIconSize: 'w-4 h-4',
    fontSize: 'text-sm',
  },
};

const MAIN_BUTTON_STATE_STYLES: Record<ButtonState, string> = {
  idle: 'bg-gray-400 hover:bg-green-500 focus:ring-green-400',
  recording: 'bg-red-500 animate-pulse focus:ring-red-400 shadow-lg shadow-red-500/50',
  paused: 'bg-red-500 focus:ring-red-400 shadow-lg shadow-red-500/50',
  initializing: 'bg-yellow-500 focus:ring-yellow-400',
  processing: 'bg-blue-500 focus:ring-blue-400',
};

const MAIN_BUTTON_LABEL_KEYS: Record<ButtonState, string> = {
  idle: AUDIO_NEW_RECORDING,
  processing: AUDIO_NEW_RECORDING,
  initializing: AUDIO_NEW_RECORDING,
  paused: AUDIO_NEW_RECORDING,
  recording: 'audio.stopRecording',
};

const formatCountdownTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const getButtonState = ({
  isProcessing,
  isInitializing,
  isRecording,
  isPaused,
}: {
  isProcessing: boolean;
  isInitializing: boolean;
  isRecording: boolean;
  isPaused: boolean;
}): ButtonState => {
  if (isProcessing) return 'processing';
  if (isInitializing) return 'initializing';
  if (isRecording && isPaused) return 'paused';
  if (isRecording) return 'recording';
  return 'idle';
};

const RECORDING_CIRCLE_RADIUS = 46;
const RECORDING_CIRCLE_CIRCUMFERENCE = 2 * Math.PI * RECORDING_CIRCLE_RADIUS;

const ProgressIndicator = ({
  buttonState,
  progressPercentage,
}: {
  buttonState: ButtonState;
  progressPercentage: number;
}) => {
  if (buttonState !== 'recording' && buttonState !== 'paused') {
    return null;
  }

  return (
    <svg 
      className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
      viewBox="0 0 100 100"
    >
      <circle
        cx="50"
        cy="50"
        r={RECORDING_CIRCLE_RADIUS}
        fill="none"
        stroke="rgba(255, 255, 255, 0.3)"
        strokeWidth="4"
      />
      <circle
        cx="50"
        cy="50"
        r={RECORDING_CIRCLE_RADIUS}
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeDasharray={`${RECORDING_CIRCLE_CIRCUMFERENCE}`}
        strokeDashoffset={`${RECORDING_CIRCLE_CIRCUMFERENCE * (1 - progressPercentage / 100)}`}
        className={buttonState === 'paused' ? '' : 'transition-all duration-1000 ease-linear'}
      />
    </svg>
  );
};

const MainButtonContent = ({
  buttonState,
  formattedRemainingTime,
  sizeConfig,
}: {
  buttonState: ButtonState;
  formattedRemainingTime: string;
  sizeConfig: SizeConfig;
}) => {
  if (buttonState === 'recording' || buttonState === 'paused') {
    return (
      <span className={`${sizeConfig.fontSize} font-mono font-bold`}>
        {formattedRemainingTime}
      </span>
    );
  }

  if (buttonState === 'processing') {
    return (
      <div className={`animate-spin rounded-full ${sizeConfig.spinnerSize} border-2 border-white border-t-transparent`}></div>
    );
  }

  if (buttonState === 'initializing') {
    return <MicrophoneIcon className={`${sizeConfig.iconSize} animate-pulse`} />;
  }

  return <MicrophoneIcon className={sizeConfig.iconSize} />;
};

const PauseResumeButton = ({
  buttonState,
  isPaused,
  onPause,
  onResume,
  sizeConfig,
  t,
}: {
  buttonState: ButtonState;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  sizeConfig: SizeConfig;
  t: TranslateFn;
}) => {
  if (buttonState !== 'recording' && buttonState !== 'paused') {
    return null;
  }

  const label = isPaused ? t('audio.resumeRecording') : t('audio.pauseRecording');
  const stateClasses = isPaused
    ? 'bg-green-500 hover:bg-green-600 focus:ring-green-400'
    : 'bg-yellow-500 hover:bg-yellow-600 focus:ring-yellow-400';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (isPaused) {
          console.log('FocusRecorderButton: Resume button clicked');
          onResume();
        } else {
          console.log('FocusRecorderButton: Pause button clicked');
          onPause();
        }
      }}
      className={`absolute -top-1 -left-1 ${sizeConfig.cancelSize} rounded-full ${stateClasses} shadow-md transition-all duration-200 hover:scale-125 active:scale-110 focus:outline-none focus:ring-2 flex items-center justify-center group z-10`}
      aria-label={label}
      title={label}
    >
      {isPaused ? (
        // Play/Resume icon
        <svg 
          className={`${sizeConfig.controlIconSize} text-white`}
          fill="currentColor" 
          viewBox="0 0 24 24"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      ) : (
        // Pause icon
        <svg 
          className={`${sizeConfig.controlIconSize} text-white`}
          fill="currentColor" 
          viewBox="0 0 24 24"
        >
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
        </svg>
      )}
    </button>
  );
};

const CancelButton = ({
  buttonState,
  onCancel,
  sizeConfig,
  t,
}: {
  buttonState: ButtonState;
  onCancel: () => void;
  sizeConfig: SizeConfig;
  t: TranslateFn;
}) => {
  if (buttonState !== 'recording' && buttonState !== 'paused') {
    return null;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        console.log('FocusRecorderButton: Cancel button (X) clicked');
        onCancel();
      }}
      className={`absolute -top-1 -right-1 ${sizeConfig.cancelSize} rounded-full bg-white hover:bg-gray-100 shadow-md transition-all duration-200 hover:scale-125 active:scale-110 focus:outline-none focus:ring-2 focus:ring-red-400 flex items-center justify-center group z-10`}
      aria-label={t('audio.cancelRecording')}
      title={t('audio.cancelRecording')}
    >
      <svg 
        className={`${sizeConfig.controlIconSize} text-gray-700 group-hover:text-red-600 transition-colors`}
        fill="currentColor" 
        viewBox="0 0 20 20"
      >
        <path 
          fillRule="evenodd" 
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" 
          clipRule="evenodd" 
        />
      </svg>
    </button>
  );
};

export const FocusRecorderButton = ({
  onRecordingComplete,
  isProcessing = false,
  maxDuration = 90,
  onError,
  disabled = false,
  size = 'normal',
}: FocusRecorderButtonProps) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const { t } = useTranslation();

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
  }, []);

  // Error handler
  const handleError = useCallback((error: Error, messageKey: string) => {
    console.error("FocusRecorderButton error:", error);
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

  // Start recording function
  const startRecording = useCallback(async () => {
    console.log('FocusRecorderButton: startRecording called', { disabled, isProcessing, isInitializing, isRecording });

    if (disabled || isProcessing || isInitializing || isRecording) {
      console.log('FocusRecorderButton: Start conditions not met - returning early');
      return;
    }

    console.log('FocusRecorderButton: Starting recording...');
    setIsInitializing(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      
      streamRef.current = stream;

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

      // Setup MediaRecorder with best supported format
      const bestFormat = getBestSupportedFormat();
      console.log(`FocusRecorderButton: Selected audio format: ${bestFormat}`);
      
      if (hasKnownIssues(bestFormat)) {
        console.warn(`⚠️ FocusRecorderButton: Format ${bestFormat} has known compatibility issues with OpenAI`);
        console.warn(`⚠️ FocusRecorderButton: Your browser doesn't support better formats (MP4/MP3/WAV)`);
      }
      
      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType: bestFormat
      });

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        if (chunks.current.length > 0) {
          const mimeType = mediaRecorder.current?.mimeType || bestFormat;
          const blob = new Blob(chunks.current, { type: mimeType });
          
          // Log audio information for debugging
          logAudioInfo(blob, 'FocusRecorderButton Output');
          
          onRecordingComplete(blob);
        }
        cleanup();
      };

      mediaRecorder.current.onerror = () => {
        handleError(new Error('MediaRecorder error'), ERROR_AUDIO_PROCESSING);
      };

      mediaRecorder.current.start(100); // Collect data every 100ms
      setIsRecording(true);
      setIsInitializing(false);

    } catch (error) {
      handleError(error as Error, 'errors.microphoneUnavailable');
    }
  }, [disabled, isProcessing, isInitializing, isRecording, onRecordingComplete, handleError, cleanup]);

  // Stop recording function
  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorder.current) return;

    try {
      mediaRecorder.current.stop();
      setIsRecording(false);
      setIsPaused(false); // Reset pause state when stopping
    } catch (error) {
      handleError(error as Error, ERROR_AUDIO_PROCESSING);
    }
  }, [isRecording, handleError]);

  // Cancel recording function
  const cancelRecording = useCallback(() => {
    console.log('FocusRecorderButton: cancelRecording called', { isRecording, hasMediaRecorder: !!mediaRecorder.current });

    if (!isRecording || !mediaRecorder.current) {
      console.log('FocusRecorderButton: Cancel conditions not met - returning early');
      return;
    }

    console.log('FocusRecorderButton: Canceling recording...');

    try {
      // CRITICAL FIX: Clear chunks BEFORE stopping to prevent race condition
      // The issue: mediaRecorder.stop() is async and fires ondataavailable AFTER cleanup
      // This causes old chunks to remain in array, mixing with new recording → corrupted blob
      chunks.current = [];
      
      // Prevent both onstop and ondataavailable from processing canceled data
      mediaRecorder.current.onstop = null;
      mediaRecorder.current.ondataavailable = null;
      mediaRecorder.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
      cleanup();
      console.log('FocusRecorderButton: Recording canceled successfully');
    } catch (error) {
      console.error("FocusRecorderButton: Error canceling recording:", error);
      cleanup();
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
    }
  }, [isRecording, cleanup]);

  // Pause recording function
  const pauseRecording = useCallback(() => {
    console.log('FocusRecorderButton: pauseRecording called', { isRecording, isPaused, hasMediaRecorder: !!mediaRecorder.current });

    if (!isRecording || isPaused || !mediaRecorder.current) {
      console.log('FocusRecorderButton: Pause conditions not met - returning early');
      return;
    }

    console.log('FocusRecorderButton: Pausing recording...');
    
    try {
      mediaRecorder.current.pause();
      setIsPaused(true);
      console.log('FocusRecorderButton: Recording paused successfully');
    } catch (error) {
      console.error("Error pausing recording:", error);
      handleError(error as Error, ERROR_AUDIO_PROCESSING);
    }
  }, [isRecording, isPaused, handleError]);

  // Resume recording function
  const resumeRecording = useCallback(() => {
    console.log('FocusRecorderButton: resumeRecording called', { isRecording, isPaused, hasMediaRecorder: !!mediaRecorder.current });

    if (!isRecording || !isPaused || !mediaRecorder.current) {
      console.log('FocusRecorderButton: Resume conditions not met - returning early');
      return;
    }

    console.log('FocusRecorderButton: Resuming recording...');
    
    try {
      mediaRecorder.current.resume();
      setIsPaused(false);
      console.log('FocusRecorderButton: Recording resumed successfully');
    } catch (error) {
      console.error("Error resuming recording:", error);
      handleError(error as Error, ERROR_AUDIO_PROCESSING);
    }
  }, [isRecording, isPaused, handleError]);

  // Timer effect - pause timer when recording is paused
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1;
          if (newTime >= maxDuration) {
            stopRecording();
            return maxDuration;
          }
          return newTime;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (!isRecording && recordingTime > 0 && !isProcessing) {
        setRecordingTime(0);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRecording, isPaused, maxDuration, stopRecording, recordingTime, isProcessing]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Calculate remaining time (countdown)
  const remainingTime = maxDuration - recordingTime;
  const formattedRemainingTime = formatCountdownTime(remainingTime);

  // Calculate progress percentage (fills up as time progresses)
  const progressPercentage = (recordingTime / maxDuration) * 100;

  const buttonState = getButtonState({ isProcessing, isInitializing, isRecording, isPaused });
  const isButtonDisabled = disabled || isProcessing || isInitializing;

  const sizeConfig = SIZE_CONFIG[size];
  const mainButtonLabel = t(MAIN_BUTTON_LABEL_KEYS[buttonState]);

  const handleMainButtonClick = useCallback(() => {
    console.log('FocusRecorderButton: Main button clicked', { isRecording, isPaused, isProcessing, isInitializing });
    if (isRecording) {
      // Main button always stops recording (even when paused)
      console.log('FocusRecorderButton: Calling stopRecording');
      stopRecording();
      return;
    }

    if (!isProcessing && !isInitializing) {
      console.log('FocusRecorderButton: Calling startRecording');
      startRecording();
      return;
    }

    console.log('FocusRecorderButton: Button disabled - not calling any function');
  }, [isRecording, isPaused, isProcessing, isInitializing, stopRecording, startRecording]);

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Main circular button */}
      <button
        type="button"
        onClick={handleMainButtonClick}
        disabled={isButtonDisabled}
        className={`relative ${sizeConfig.buttonSize} rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
          MAIN_BUTTON_STATE_STYLES[buttonState]
        }`}
        aria-label={mainButtonLabel}
        title={mainButtonLabel}
      >
        {/* Circular progress indicator */}
        <ProgressIndicator buttonState={buttonState} progressPercentage={progressPercentage} />

        {/* Icon or timer */}
        <div className="relative z-10 flex items-center justify-center w-full h-full text-white">
          <MainButtonContent
            buttonState={buttonState}
            formattedRemainingTime={formattedRemainingTime}
            sizeConfig={sizeConfig}
          />
        </div>
      </button>

      {/* Pause/Resume button (top left) - only show when recording or paused */}
      <PauseResumeButton
        buttonState={buttonState}
        isPaused={isPaused}
        onPause={pauseRecording}
        onResume={resumeRecording}
        sizeConfig={sizeConfig}
        t={t}
      />

      {/* Cancel button (top right) - only show when recording or paused */}
      <CancelButton
        buttonState={buttonState}
        onCancel={cancelRecording}
        sizeConfig={sizeConfig}
        t={t}
      />
    </div>
  );
};
