"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MicrophoneIcon } from "@components/Icons";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  maxDuration?: number; // in seconds, default 60
  onError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
}

export const AudioRecorder = ({
  onRecordingComplete,
  isProcessing = false,
  maxDuration = 60,
  onError,
  disabled = false,
  className = "",
}: AudioRecorderProps) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
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

      mediaRecorder.current.onerror = (e) => {
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
  }, [disabled, isProcessing, isInitializing, onRecordingComplete, handleError, monitorAudioLevel]);

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
    const baseStyles = "relative overflow-hidden transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:transform-none disabled:hover:scale-100";
    
    switch (recordingState) {
      case 'processing':
        return `${baseStyles} bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 cursor-wait`;
      case 'initializing':
        return `${baseStyles} bg-yellow-500 hover:bg-yellow-600 text-white focus:ring-yellow-500 cursor-wait`;
      case 'recording':
        return `${baseStyles} bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 shadow-lg shadow-red-500/25`;
      default:
        return `${baseStyles} bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 shadow-lg hover:shadow-green-500/25`;
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
              <MicrophoneIcon className="w-5 h-5 mr-2" fill="white" />
            </div>
            {t('audio.initializing')}
          </div>
        );
      case 'recording':
        return (
          <div className="flex items-center justify-center">
            <div className="relative mr-2">
              <MicrophoneIcon className="w-5 h-5 animate-pulse" fill="white" />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-ping"></div>
            </div>
            {t('audio.stopRecording')}
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center">
            <MicrophoneIcon className="w-5 h-5 mr-2" fill="white" />
            {t('audio.newRecording')}
          </div>
        );
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Main controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <button
          onClick={() => {
            if (isRecording) {
              stopRecording();
            } else {
              startRecording();
            }
          }}
          disabled={isButtonDisabled}
          className={`min-w-[200px] px-6 py-3 rounded-xl font-medium ${getButtonStyles()}`}
          aria-label={
            isRecording 
              ? t('audio.stopRecording') 
              : t('audio.newRecording')
          }
          title={`${isRecording ? t('audio.stopRecording') : t('audio.newRecording')} (Ctrl+Space)`}
        >
          {getButtonContent()}
        </button>
        
        {isRecording && (
          <button
            onClick={cancelRecording}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            aria-label={t('audio.cancelRecording')}
            title={`${t('audio.cancelRecording')} (Esc)`}
          >
            {t('audio.cancelRecording')}
          </button>
        )}
        
        {/* Timer and audio level indicator */}
        <div className="flex items-center gap-3">
          <div className="text-sm font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
            {formatTime(recordingTime)} / {formatTime(maxDuration)}
          </div>
          
          {isRecording && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('audio.recording')}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full">
        <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700 overflow-hidden shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${
              isRecording 
                ? 'bg-gradient-to-r from-red-500 to-red-600' 
                : 'bg-gradient-to-r from-blue-500 to-blue-600'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        
        {/* Audio level indicator */}
        {isRecording && audioLevel > 0 && (
          <div className="mt-2">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{t('audio.audioLevel')}:</span>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 h-1 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 transition-all duration-100"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
              <span className="w-8 text-right">{Math.round(audioLevel)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts hint */}
      {!isRecording && (
        <div className="text-xs text-gray-400 dark:text-gray-500 text-center">
          {t('audio.keyboardShortcuts')}: Ctrl+Space {t('audio.toRecord')}, Esc {t('audio.toCancel')}
        </div>
      )}
    </div>
  );
};
