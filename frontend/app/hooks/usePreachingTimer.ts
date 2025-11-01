"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TimerState,
  TimerPhase,
  TimerStatus,
  TimerSettings,
  DEFAULT_TIMER_SETTINGS,
  TIMER_PHASE_COLORS
} from '../types/TimerState';
import {
  UsePreachingTimerReturn
} from '../types/TimerProps';
import {
  triggerScreenBlink,
  triggerTextHighlight,
  triggerPhaseTransition,
  cancelVisualEffects
} from '../utils/visualEffects';

export const usePreachingTimer = (
  initialSettings?: Partial<TimerSettings>
): UsePreachingTimerReturn => {
  // Merge default settings with provided settings
  const settings: TimerSettings = {
    ...DEFAULT_TIMER_SETTINGS,
    ...initialSettings
  };

  // Timer state
  const [timerState, setTimerState] = useState<TimerState>({
    totalDuration: settings.totalDuration,
    timeRemaining: settings.totalDuration,
    startTime: null,
    pausedTime: null,
    currentPhase: 'introduction',
    phaseStartTime: 0,
    introductionDuration: Math.floor(settings.totalDuration * settings.introductionRatio),
    mainDuration: Math.floor(settings.totalDuration * settings.mainRatio),
    conclusionDuration: Math.floor(settings.totalDuration * settings.conclusionRatio),
    status: 'idle',
    isRunning: false,
    isPaused: false,
    isFinished: false,
    lastPhaseChange: null,
    blinkCount: 0,
    isBlinking: false
  });

  // Refs for interval management
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calculate current phase and progress
  const calculateCurrentPhase = useCallback((elapsedSeconds: number): TimerPhase => {
    // Use consistent ratios to match skip logic (20-60-20)
    const totalDuration = timerState.totalDuration;
    const introDuration = Math.floor(totalDuration * 0.2);  // 20%
    const mainDuration = Math.floor(totalDuration * 0.6);   // 60%

    if (elapsedSeconds < introDuration) {
      return 'introduction';
    } else if (elapsedSeconds < introDuration + mainDuration) {
      return 'main';
    } else {
      return 'conclusion';
    }
  }, [timerState.totalDuration]);

  // Calculate phase progress (0-1)
  const calculatePhaseProgress = useCallback((elapsedSeconds: number, phase: TimerPhase): number => {
    const introDuration = timerState.introductionDuration;
    const mainDuration = timerState.mainDuration;

    switch (phase) {
      case 'introduction':
        return Math.min(elapsedSeconds / introDuration, 1);
      case 'main':
        return Math.min((elapsedSeconds - introDuration) / mainDuration, 1);
      case 'conclusion':
        return Math.min((elapsedSeconds - introDuration - mainDuration) / timerState.conclusionDuration, 1);
      default:
        return 0;
    }
  }, [timerState.introductionDuration, timerState.mainDuration, timerState.conclusionDuration]);

  // Trigger screen blink effect for timer completion
  const triggerCompletionBlink = useCallback(async () => {
    try {
      await triggerScreenBlink({
        duration: 500,
        intensity: 0.8,
        repeat: 3,
        color: TIMER_PHASE_COLORS.finished
      });
    } catch (error) {
      console.warn('Failed to trigger completion blink effect:', error);
    }
  }, []);

  // Trigger phase transition effect
  const triggerPhaseTransitionEffect = useCallback(async (phase: TimerPhase) => {
    try {
      // Highlight the timer display area
      await triggerPhaseTransition('.preaching-timer-display', {
        duration: 200,
        repeat: 3,
        color: TIMER_PHASE_COLORS[phase] || TIMER_PHASE_COLORS.introduction
      });
    } catch (error) {
      console.warn('Failed to trigger phase transition effect:', error);
    }
  }, []);

  // Update timer every second
  useEffect(() => {
    if (timerState.isRunning && !timerState.isPaused && timerState.startTime) {
      intervalRef.current = setInterval(() => {
        setTimerState((prevState: TimerState) => {
          if (!prevState.startTime) return prevState;

          const now = Date.now();
          const elapsedMs = now - prevState.startTime;
          const elapsedSeconds = Math.floor(elapsedMs / 1000);
          const timeRemaining = prevState.totalDuration - elapsedSeconds;

          // Check if timer just finished (only set finished status once when reaching 0)
          if (timeRemaining <= 0 && prevState.status !== 'finished' && prevState.timeRemaining > 0) {
            // Don't clear interval - let timer continue showing negative values
            // Trigger full screen blink
            triggerCompletionBlink();

            return {
              ...prevState,
              timeRemaining: timeRemaining, // Allow negative values
              status: 'finished',
              isRunning: true, // Keep running to show negative countdown
              isFinished: true,
              currentPhase: 'finished',
              lastPhaseChange: now
            };
          }

          // Stop timer if it has been in negative territory for more than 5 minutes (300 seconds)
          if (timeRemaining <= -300 && prevState.status === 'finished') {
            return {
              ...prevState,
              timeRemaining: -300, // Cap at -5 minutes
              isRunning: false, // Stop the timer
              isPaused: false,
              status: 'finished'
            };
          }

          // Check for phase changes
          const currentPhase = calculateCurrentPhase(elapsedSeconds);
          const phaseChanged = currentPhase !== prevState.currentPhase;

          if (phaseChanged && prevState.status !== 'finished') {
            // Trigger phase transition effect
            triggerPhaseTransitionEffect(currentPhase);

            return {
              ...prevState,
              timeRemaining,
              currentPhase,
              phaseStartTime: elapsedSeconds,
              lastPhaseChange: now,
              blinkCount: 0,
              isBlinking: true
            };
          }

          return {
            ...prevState,
            timeRemaining,
            currentPhase: phaseChanged ? currentPhase : prevState.currentPhase
          };
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timerState.isRunning, timerState.isPaused, timerState.startTime, calculateCurrentPhase, triggerCompletionBlink, triggerPhaseTransitionEffect]);

  // Timer actions
  const start = useCallback(() => {
    const now = Date.now();
    setTimerState((prevState: TimerState) => ({
      ...prevState,
      status: 'running',
      isRunning: true,
      isPaused: false,
      isFinished: false,
      startTime: prevState.startTime || now,
      pausedTime: null,
      currentPhase: 'introduction',
      phaseStartTime: 0,
      lastPhaseChange: now
    }));
  }, []);

  const pause = useCallback(() => {
    setTimerState((prevState: TimerState) => ({
      ...prevState,
      status: 'paused',
      isRunning: false,
      isPaused: true,
      pausedTime: Date.now()
    }));
  }, []);

  const resume = useCallback(() => {
    setTimerState((prevState: TimerState) => {
      if (!prevState.pausedTime || !prevState.startTime) return prevState;

      const pauseDuration = Date.now() - prevState.pausedTime;
      const newStartTime = prevState.startTime + pauseDuration;

      return {
        ...prevState,
        status: 'running',
        isRunning: true,
        isPaused: false,
        startTime: newStartTime,
        pausedTime: null
      };
    });
  }, []);

  const stop = useCallback(() => {
    setTimerState((prevState: TimerState) => ({
      ...prevState,
      status: 'idle',
      isRunning: false,
      isPaused: false,
      isFinished: false,
      // Reset timeRemaining back to totalDuration (selected time)
      timeRemaining: prevState.totalDuration,
      startTime: null,
      pausedTime: null,
      // Reset to introduction phase
      currentPhase: 'introduction',
      phaseStartTime: 0,
      lastPhaseChange: null,
      blinkCount: 0,
      isBlinking: false
    }));
  }, []);

  const skip = useCallback(() => {
    setTimerState((prevState: TimerState) => {
      if (!prevState.startTime) return prevState;

      const now = Date.now();
      const elapsedSeconds = Math.floor((now - prevState.startTime) / 1000);

      // Determine current phase based on elapsed time using consistent ratios
      // to avoid any race conditions with stored durations
      let actualCurrentPhase: TimerPhase;
      const totalDuration = prevState.totalDuration;
      const introDuration = Math.floor(totalDuration * 0.2);  // 20%
      const mainDuration = Math.floor(totalDuration * 0.6);   // 60%

      if (elapsedSeconds < introDuration) {
        actualCurrentPhase = 'introduction';
      } else if (elapsedSeconds < introDuration + mainDuration) {
        actualCurrentPhase = 'main';
      } else {
        actualCurrentPhase = 'conclusion';
      }

      let newPhase: TimerPhase;
      let newTimeRemaining: number;

      switch (actualCurrentPhase) {
        case 'introduction':
          newPhase = 'main';
          newTimeRemaining = mainDuration; // Set to full main duration
          break;
        case 'main':
          newPhase = 'conclusion';
          newTimeRemaining = Math.floor(totalDuration * 0.2); // Set to full conclusion duration (20%)
          break;
        case 'conclusion':
        // Skip from conclusion immediately finishes the preaching session
        return {
          ...prevState,
          timeRemaining: 0,
          status: 'finished',
          isRunning: false,
          isPaused: false,
          isFinished: true,
          currentPhase: 'finished',
          lastPhaseChange: now
        };
        default:
        return prevState;
      }

      // Calculate new startTime to give the new phase its full allocated time
      const newStartTime = now - ((totalDuration - newTimeRemaining) * 1000);

      return {
        ...prevState,
        startTime: newStartTime,
        currentPhase: newPhase,
        phaseStartTime: totalDuration - newTimeRemaining,
        timeRemaining: newTimeRemaining,
        lastPhaseChange: now,
        blinkCount: 0,
        isBlinking: true
      };
    });
  }, []);

  const reset = useCallback(() => {
    setTimerState((prevState: TimerState) => ({
      ...prevState,
      totalDuration: settings.totalDuration,
      timeRemaining: settings.totalDuration,
      startTime: null,
      pausedTime: null,
      currentPhase: 'introduction',
      phaseStartTime: 0,
      introductionDuration: Math.floor(settings.totalDuration * settings.introductionRatio),
      mainDuration: Math.floor(settings.totalDuration * settings.mainRatio),
      conclusionDuration: Math.floor(settings.totalDuration * settings.conclusionRatio),
      status: 'idle',
      isRunning: false,
      isPaused: false,
      isFinished: false,
      lastPhaseChange: null,
      blinkCount: 0,
      isBlinking: false
    }));
  }, [settings]);

  const setDuration = useCallback((seconds: number) => {
    setTimerState((prevState: TimerState) => ({
      ...prevState,
      totalDuration: seconds,
      timeRemaining: prevState.status === 'idle' ? seconds : prevState.timeRemaining,
      introductionDuration: Math.floor(seconds * settings.introductionRatio),
      mainDuration: Math.floor(seconds * settings.mainRatio),
      conclusionDuration: Math.floor(seconds * settings.conclusionRatio)
    }));
  }, [settings]);

  // Calculate progress information
  const elapsedSeconds = timerState.startTime
    ? Math.floor((Date.now() - timerState.startTime) / 1000)
    : 0;

  const totalProgress = timerState.totalDuration > 0
    ? Math.min(elapsedSeconds / timerState.totalDuration, 1)
    : 0;

  const phaseProgress = calculatePhaseProgress(elapsedSeconds, timerState.currentPhase);

  // Format time for display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    const sign = seconds < 0 ? '-' : '';
    return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get current display color
  const getDisplayColor = (): string => {
    // Show red color for negative time (finished state with negative values)
    if (timerState.timeRemaining < 0 && timerState.status === 'finished') {
      return '#EF4444'; // Red color for negative time
    }
    return TIMER_PHASE_COLORS[timerState.currentPhase as TimerPhase] || TIMER_PHASE_COLORS.introduction;
  };

  // Return hook interface
  return {
    // State
    timerState: {
      timeRemaining: timerState.timeRemaining,
      currentPhase: timerState.currentPhase,
      status: timerState.status,
      isRunning: timerState.isRunning,
      isPaused: timerState.isPaused,
      isFinished: timerState.isFinished
    },

    // Progress
    progress: {
      totalProgress,
      phaseProgress,
      timeElapsed: elapsedSeconds,
      timeRemaining: timerState.timeRemaining
    },

    // Visual state
    visualState: {
      displayTime: formatTime(timerState.timeRemaining),
      displayColor: getDisplayColor(),
      phaseLabel: timerState.currentPhase,
      isEmergency: timerState.timeRemaining < 60 && timerState.isRunning, // Last minute warning
      animationClass: timerState.isBlinking ? 'timer-blink' : ''
    },

    // Actions
    actions: {
      start,
      pause,
      resume,
      stop,
      skip,
      reset,
      setDuration
    },

  // Settings
  settings: {
    totalDuration: timerState.totalDuration,
    introductionRatio: settings.introductionRatio,
    mainRatio: settings.mainRatio,
    conclusionRatio: settings.conclusionRatio,
    updateSettings: (newSettings: Partial<TimerSettings>) => {
      // This would update settings and recalculate durations
      // TODO: Implement settings persistence
    }
  },

    // Events (placeholders for future implementation)
    events: {}
  };
};