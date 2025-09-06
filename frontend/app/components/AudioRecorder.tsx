"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MicFilledIcon } from "@components/Icons";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

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
  hideKeyboardShortcuts?: boolean; // New prop to hide keyboard shortcuts text
  autoStart?: boolean; // Auto-start recording on mount (useful for popovers)
}

export const AudioRecorder = ({
  onRecordingComplete,
  isProcessing = false,
  maxDuration = 90,
  onError,
  disabled = false,
  className = "",
  onRetry,
  retryCount = 0,
  maxRetries = 3,
  transcriptionError,
  onClearError,
  variant = "standard", // Default to standard version
  hideKeyboardShortcuts = false,
  autoStart = false,
}: AudioRecorderProps) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [storedAudioBlob, setStoredAudioBlob] = useState<Blob | null>(null);
  const [transcriptionErrorState, setTranscriptionErrorState] = useState<string | null>(null);

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
    setIsInitializing(false);
  }, [t, onError, cleanup]);

  // Audio level monitoring
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

    if (isRecording) {
      animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
    }
  }, [isRecording]);

  // Start recording function
  const startRecording = useCallback(async () => {
    if (disabled || isProcessing || isInitializing) return;

    setIsInitializing(true);
    setTranscriptionErrorState(null);
    
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

      // Setup MediaRecorder
      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus' 
          : 'audio/webm'
      });

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        if (chunks.current.length > 0) {
          const blob = new Blob(chunks.current, { 
            type: mediaRecorder.current?.mimeType || "audio/webm" 
          });
          setStoredAudioBlob(blob);
          onRecordingComplete(blob);
        }
        cleanup();
      };

      mediaRecorder.current.onerror = () => {
        handleError(new Error('MediaRecorder error'), 'errors.audioProcessing');
      };

      mediaRecorder.current.start(100); // Collect data every 100ms
      setIsRecording(true);
      setIsInitializing(false);
      
      // Start audio level monitoring
      if (analyserRef.current) {
        monitorAudioLevel();
      }

    } catch (error) {
      handleError(error as Error, 'errors.microphoneUnavailable');
    }
  }, [disabled, isProcessing, isInitializing, onRecordingComplete, handleError, monitorAudioLevel, cleanup]);

  // Stop recording function
  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorder.current) return;

    try {
      mediaRecorder.current.stop();
      setIsRecording(false);
    } catch (error) {
      handleError(error as Error, 'errors.audioProcessing');
    }
  }, [isRecording, handleError]);

  // Cancel recording function
  const cancelRecording = useCallback(() => {
    if (!isRecording || !mediaRecorder.current) return;

    try {
      // Prevent the onstop event from calling onRecordingComplete
      mediaRecorder.current.onstop = null;
      mediaRecorder.current.stop();
      setIsRecording(false);
      setRecordingTime(0);
      setStoredAudioBlob(null);
      setTranscriptionErrorState(null);
      cleanup();
    } catch (error) {
      console.error("Error canceling recording:", error);
      cleanup();
      setIsRecording(false);
      setRecordingTime(0);
      setStoredAudioBlob(null);
      setTranscriptionErrorState(null);
    }
  }, [isRecording, cleanup]);

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

  // Timer effect
  useEffect(() => {
    if (isRecording) {
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
  }, [isRecording, maxDuration, stopRecording, recordingTime, isProcessing]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Keyboard shortcuts
  useEffect(() => {
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
  }, [isRecording, startRecording, stopRecording, cancelRecording]);

  // Auto-start on mount (e.g., when opened from a popover after a user click)
  useEffect(() => {
    if (autoStart && !isRecording && !isProcessing && !isInitializing) {
      // Delay a tick to ensure mount and layout are stable
      const id = setTimeout(() => {
        startRecording();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [autoStart, isRecording, isProcessing, isInitializing, startRecording]);

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

  const recordingState = useMemo(() => {
    if (isProcessing) return 'processing';
    if (isInitializing) return 'initializing';
    if (isRecording) return 'recording';
    return 'idle';
  }, [isProcessing, isInitializing, isRecording]);

  // Button styles based on state
  const getButtonStyles = () => {
    // Keep transitions/rings consistent across variants
    const baseStyles = "relative overflow-hidden transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:transform-none disabled:hover:scale-100";

    // Reduce default size by 5% for BOTH variants and allow hover up to 100%.
    const scaleStyles = "transform scale-[0.95] hover:scale-100 active:scale-95";
    
    switch (recordingState) {
      case 'processing':
        return `${baseStyles} ${scaleStyles} bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 cursor-wait`;
      case 'initializing':
        return `${baseStyles} ${scaleStyles} bg-yellow-500 hover:bg-yellow-600 text-white focus:ring-yellow-500 cursor-wait`;
      case 'recording':
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
            <div className="animate-pulse">
              <MicFilledIcon className="w-5 h-5 mr-2" />
            </div>
            {t('audio.initializing')}
          </div>
        );
      case 'recording':
        return (
          <div className="flex items-center justify-center">
            <div className="relative mr-2">
              <MicFilledIcon className="w-5 h-5 animate-pulse" />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-ping"></div>
            </div>
            {t('audio.stopRecording')}
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center">
            <MicFilledIcon className="w-5 h-5 mr-2" />
            {t('audio.newRecording')}
          </div>
        );
    }
  };

  return (
    <div className={`space-y-4 ${className} ${variant === "mini" ? "space-y-3" : ""}`}>
      {/* Main controls */}
      <div className={`${variant === "mini" ? "flex flex-col gap-3" : "flex flex-col sm:flex-row items-start sm:items-center gap-4"}`}>
        {/* Show main button only when not recording in mini variant, or always in standard variant */}
        {(!isRecording || variant === "standard") && (
          <button
            onClick={() => {
              if (isRecording) {
                stopRecording();
              } else {
                startRecording();
              }
            }}
            disabled={isButtonDisabled}
            className={`${variant === "mini" ? "min-w-full px-4 py-3 text-sm font-medium" : "min-w-[200px] px-6 py-3"} rounded-xl font-medium ${getButtonStyles()}`}
            aria-label={
              isRecording 
                ? t('audio.stopRecording') 
                : t('audio.newRecording')
            }
            title={`${isRecording ? t('audio.stopRecording') : t('audio.newRecording')} (Ctrl+Space)`}
          >
            {getButtonContent()}
          </button>
        )}
        
        {/* Show cancel button only when recording */}
        {isRecording && (
          variant === "mini" ? (
            // Combined button for mini variant
            <div className="relative w-full">
              <button
                onClick={stopRecording}
                className="w-full px-4 py-3 text-sm font-medium rounded-xl bg-red-500 hover:bg-red-600 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 relative overflow-hidden"
                aria-label={t('audio.stopRecording')}
                title={t('audio.stopRecording')}
              >
                <div className="flex items-center justify-center w-4/5">
                  <div className="relative mr-2">
                    <MicFilledIcon className="w-5 h-5 animate-pulse" />
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-ping"></div>
                  </div>
                  {t('audio.stopRecording')}
                </div>
                
                {/* Cancel button overlay on the right */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelRecording();
                  }}
                  className="absolute right-0 top-0 h-full w-1/5 bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center group"
                  aria-label={t('audio.cancelRecording')}
                  title={`${t('audio.cancelRecording')} (Esc)`}
                >
                  <svg 
                    className="w-4 h-4 text-white group-hover:text-red-100 transition-colors" 
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
              </button>
            </div>
          ) : (
            // Standard separate buttons for standard variant
            <button
              onClick={cancelRecording}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              aria-label={t('audio.cancelRecording')}
              title={`${t('audio.cancelRecording')} (Esc)`}
            >
              {t('audio.cancelRecording')}
            </button>
          )
        )}

        {/* Retry button for transcription errors */}
        {(transcriptionErrorState || transcriptionError) && storedAudioBlob && retryCount < maxRetries && (
          <button
            onClick={retryTranscription}
            className={`${variant === "mini" ? "px-4 py-2 text-sm font-medium" : "px-4 py-2"} rounded-lg border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-600 dark:hover:bg-orange-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2`}
            aria-label={t('audio.retryTranscription')}
          >
            {t('audio.retryTranscription')} ({retryCount + 1}/{maxRetries})
          </button>
        )}
        
        {/* Timer and audio level indicator - show only when recording or in standard variant */}
        {(isRecording || variant === "standard") && (
          <div className={`${variant === "mini" ? "flex flex-col gap-3" : "flex items-center gap-3"}`}>
            <div className={`${variant === "mini" ? "w-full" : ""}`}>
              <div className={`${variant === "mini" ? "text-sm px-3 py-2 font-medium" : "text-sm px-3 py-1"} font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg text-center relative overflow-hidden`}>
                <span className="relative z-10">{formatTime(recordingTime)} / {formatTime(maxDuration)}</span>
                {/* Progress bar overlay - only for mini variant */}
                {variant === "mini" && isRecording && (
                  <div 
                    className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-600/20 transition-all duration-1000 ease-out"
                    style={{ width: `${progressPercentage}%` }}
                  />
                )}
              </div>
            </div>
            
            {isRecording && variant === "standard" && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {t('audio.recording')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {(transcriptionErrorState || transcriptionError) && (
        <div className={`${variant === "mini" ? "p-3" : "p-3"} bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className={`${variant === "mini" ? "text-sm" : "text-sm"} font-medium`}>{transcriptionErrorState || transcriptionError}</span>
            </div>
            <button
              onClick={closeError}
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
      )}

      {/* Progress bar - show only when recording or in standard variant */}
      {(isRecording || variant === "standard") && variant === "standard" && (
        <div className="w-full">
          <div className="w-full bg-gray-200 rounded-full dark:bg-gray-700 overflow-hidden shadow-inner h-3">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out bg-gradient-to-r from-red-500 to-red-600"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          
          {/* Audio level indicator */}
          {isRecording && audioLevel > 0 && (
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
          )}
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      {!isRecording && !hideKeyboardShortcuts && (
        <div className={`${variant === "mini" ? "text-sm" : "text-xs"} text-gray-400 dark:text-gray-500 text-center`}>
          {t('audio.keyboardShortcuts')}: Ctrl+Space {t('audio.toRecord')}, Esc {t('audio.toCancel')}
        </div>
      )}
    </div>
  );
};
