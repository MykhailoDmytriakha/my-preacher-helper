"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { MicrophoneIcon } from "@/components/Icons";

interface FocusRecorderButtonProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  maxDuration?: number; // in seconds, default 90
  onError?: (error: string) => void;
  disabled?: boolean;
  size?: 'normal' | 'small'; // Size variant for different contexts
}

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
    setIsInitializing(false);
  }, [t, onError, cleanup]);

  // Start recording function
  const startRecording = useCallback(async () => {
    if (disabled || isProcessing || isInitializing || isRecording) return;

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
      cleanup();
    } catch (error) {
      console.error("Error canceling recording:", error);
      cleanup();
      setIsRecording(false);
      setRecordingTime(0);
    }
  }, [isRecording, cleanup]);

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

  // Calculate remaining time (countdown)
  const remainingTime = maxDuration - recordingTime;
  
  // Format time for display (countdown from maxDuration)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Calculate progress percentage (fills up as time progresses)
  const progressPercentage = (recordingTime / maxDuration) * 100;

  // Determine button state
  const getButtonState = () => {
    if (isProcessing) return 'processing';
    if (isInitializing) return 'initializing';
    if (isRecording) return 'recording';
    return 'idle';
  };

  const buttonState = getButtonState();
  const isButtonDisabled = disabled || isProcessing || isInitializing;

  // Size configurations
  const sizeConfig = size === 'small'
    ? {
        buttonSize: 'w-10 h-10', // 40px for outline point headers
        iconSize: 'w-4 h-4',
        spinnerSize: 'h-4 w-4',
        cancelSize: 'w-4 h-4',
        fontSize: 'text-xs',
      }
    : {
        buttonSize: 'w-16 h-16', // 64px for focus mode sidebar
        iconSize: 'w-6 h-6',
        spinnerSize: 'h-6 w-6',
        cancelSize: 'w-6 h-6',
        fontSize: 'text-sm',
      };

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Main circular button */}
      <button
        type="button"
        onClick={() => {
          if (isRecording) {
            stopRecording();
          } else if (!isProcessing && !isInitializing) {
            startRecording();
          }
        }}
        disabled={isButtonDisabled}
        className={`relative ${sizeConfig.buttonSize} rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
          buttonState === 'idle' 
            ? 'bg-gray-400 hover:bg-green-500 focus:ring-green-400' 
            : buttonState === 'recording'
            ? 'bg-red-500 animate-pulse focus:ring-red-400 shadow-lg shadow-red-500/50'
            : buttonState === 'initializing'
            ? 'bg-yellow-500 focus:ring-yellow-400'
            : 'bg-blue-500 focus:ring-blue-400'
        }`}
        aria-label={
          buttonState === 'recording' 
            ? t('audio.stopRecording') 
            : t('audio.newRecording')
        }
        title={
          buttonState === 'recording' 
            ? t('audio.stopRecording') 
            : t('audio.newRecording')
        }
      >
        {/* Circular progress indicator */}
        {buttonState === 'recording' && (
          <svg 
            className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
            viewBox="0 0 100 100"
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="rgba(255, 255, 255, 0.3)"
              strokeWidth="4"
            />
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="white"
              strokeWidth="4"
              strokeDasharray={`${2 * Math.PI * 46}`}
              strokeDashoffset={`${2 * Math.PI * 46 * (1 - progressPercentage / 100)}`}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
        )}

        {/* Icon or timer */}
        <div className="relative z-10 flex items-center justify-center w-full h-full text-white">
          {buttonState === 'recording' ? (
            // Show countdown timer
            <span className={`${sizeConfig.fontSize} font-mono font-bold`}>
              {formatTime(remainingTime)}
            </span>
          ) : buttonState === 'processing' ? (
            // Show spinner
            <div className={`animate-spin rounded-full ${sizeConfig.spinnerSize} border-2 border-white border-t-transparent`}></div>
          ) : buttonState === 'initializing' ? (
            // Show pulsing mic
            <MicrophoneIcon className={`${sizeConfig.iconSize} animate-pulse`} />
          ) : (
            // Show static mic icon
            <MicrophoneIcon className={sizeConfig.iconSize} />
          )}
        </div>
      </button>

      {/* Cancel button (top right) - only show when recording */}
      {buttonState === 'recording' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cancelRecording();
          }}
          className={`absolute -top-1 -right-1 ${sizeConfig.cancelSize} rounded-full bg-white hover:bg-gray-100 shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 flex items-center justify-center group`}
          aria-label={t('audio.cancelRecording')}
          title={t('audio.cancelRecording')}
        >
          <svg 
            className={`${size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} text-gray-700 group-hover:text-red-600 transition-colors`}
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
      )}
    </div>
  );
};

