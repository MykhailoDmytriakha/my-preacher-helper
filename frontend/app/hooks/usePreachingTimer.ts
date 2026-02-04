"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import {
  UsePreachingTimerReturn
} from '@/types/TimerProps';
import {
  TimerMode,
  TimerPhase,
  TimerPhaseDurations,
  TimerSettings,
  TimerState,
  DEFAULT_TIMER_SETTINGS,
  TIMER_PHASE_COLORS
} from '@/types/TimerState';
import {
  triggerScreenBlink
} from '@/utils/visualEffects';

const TIMER_MODE_KEY = 'preaching-timer-mode';
const TIMER_DURATION_KEY = 'preaching-timer-duration';
const TIMER_PHASE_DURATIONS_KEY = 'preaching-timer-phase-durations';

export const usePreachingTimer = (
  initialSettings?: Partial<TimerSettings>,
  events?: {
    onFinish?: () => void;
    onPhaseChange?: (phase: TimerPhase) => void;
    onEmergency?: (timeRemaining: number) => void;
  }
): UsePreachingTimerReturn => {
  // Merge default settings with provided settings
  const settings: TimerSettings = useMemo(() => ({
    ...DEFAULT_TIMER_SETTINGS,
    ...initialSettings
  }), [initialSettings]);

  const isValidDuration = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value) && value >= 0;

  const computeDurationsFromTotal = useCallback((total: number): TimerPhaseDurations => {
    const intro = Math.floor(total * settings.introductionRatio);
    const main = Math.floor(total * settings.mainRatio);
    const conclusion = Math.max(0, total - intro - main);
    return { introduction: intro, main, conclusion };
  }, [settings.introductionRatio, settings.mainRatio]);

  // Load saved timer duration from localStorage
  const loadSavedDuration = (): number => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(TIMER_DURATION_KEY);
        const parsed = saved ? parseInt(saved, 10) : NaN;
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
        return settings.totalDuration;
      } catch (error) {
        console.warn('Failed to load saved timer duration:', error);
        return settings.totalDuration;
      }
    }
    return settings.totalDuration;
  };

  const loadSavedMode = (): TimerMode => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return 'total';
    }
    try {
      const saved = localStorage.getItem(TIMER_MODE_KEY);
      return saved === 'sections' ? 'sections' : 'total';
    } catch (error) {
      console.warn('Failed to load timer mode:', error);
      return 'total';
    }
  };

  const loadSavedPhaseDurations = (): TimerPhaseDurations | null => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return null;
    }
    try {
      const saved = localStorage.getItem(TIMER_PHASE_DURATIONS_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as TimerPhaseDurations;
      if (
        parsed &&
        isValidDuration(parsed.introduction) &&
        isValidDuration(parsed.main) &&
        isValidDuration(parsed.conclusion)
      ) {
        return parsed;
      }
    } catch (error) {
      console.warn('Failed to load phase durations:', error);
    }
    return null;
  };

  const saveDuration = (duration: number): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(TIMER_DURATION_KEY, duration.toString());
      } catch (error) {
        console.warn('Failed to save timer duration:', error);
      }
    }
  };

  const saveMode = (mode: TimerMode): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(TIMER_MODE_KEY, mode);
      } catch (error) {
        console.warn('Failed to save timer mode:', error);
      }
    }
  };

  const savePhaseDurations = (durations: TimerPhaseDurations): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(TIMER_PHASE_DURATIONS_KEY, JSON.stringify(durations));
      } catch (error) {
        console.warn('Failed to save phase durations:', error);
      }
    }
  };

  const savedMode = loadSavedMode();
  const savedPhaseDurations = loadSavedPhaseDurations();
  const savedTotalDuration = loadSavedDuration();

  const initialMode: TimerMode = savedMode === 'sections' && savedPhaseDurations ? 'sections' : 'total';
  const initialDurations = initialMode === 'sections' && savedPhaseDurations
    ? savedPhaseDurations
    : computeDurationsFromTotal(savedTotalDuration);
  const initialTotalDuration = initialMode === 'sections'
    ? (initialDurations.introduction + initialDurations.main + initialDurations.conclusion)
    : savedTotalDuration;

  const [timerMode, setTimerMode] = useState<TimerMode>(initialMode);

  // Timer state
  const [timerState, setTimerState] = useState<TimerState>({
    totalDuration: initialTotalDuration,
    timeRemaining: initialTotalDuration,
    startTime: null,
    pausedTime: null,
    currentPhase: 'introduction',
    phaseStartTime: 0,
    introductionDuration: initialDurations.introduction,
    mainDuration: initialDurations.main,
    conclusionDuration: initialDurations.conclusion,
    status: 'idle',
    isRunning: false,
    isPaused: false,
    isFinished: false,
    lastPhaseChange: null,
    blinkCount: 0,
  });

  const timerStateRef = useRef(timerState);

  // Refs for interval management
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsRef = useRef<typeof events>(events);

  useEffect(() => {
    timerStateRef.current = timerState;
  }, [timerState]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  // Calculate current phase and progress
  const calculateCurrentPhase = useCallback((elapsedSeconds: number): TimerPhase => {
    const introDuration = timerState.introductionDuration;
    const mainDuration = timerState.mainDuration;
    const introEnd = introDuration;
    const mainEnd = introDuration + mainDuration;

    if (elapsedSeconds < introEnd) {
      return 'introduction';
    } else if (elapsedSeconds < mainEnd) {
      return 'main';
    } else {
      return 'conclusion';
    }
  }, [timerState.introductionDuration, timerState.mainDuration]);

  // Calculate phase progress (0-1)
  const calculatePhaseProgress = useCallback((elapsedSeconds: number, phase: TimerPhase): number => {
    // Calculate the correct phase start time for each phase independently
    const introDuration = timerState.introductionDuration;
    const mainDuration = timerState.mainDuration;
    const conclusionDuration = timerState.conclusionDuration;

    let phaseStartTime: number;
    let phaseDuration: number;

    switch (phase) {
      case 'introduction':
        phaseStartTime = 0;
        phaseDuration = introDuration;
        break;
      case 'main':
        phaseStartTime = introDuration;
        phaseDuration = mainDuration;
        break;
      case 'conclusion':
        phaseStartTime = introDuration + mainDuration;
        phaseDuration = conclusionDuration;
        break;
      default:
        return 0;
    }

    if (phaseDuration === 0) {
      return elapsedSeconds >= phaseStartTime ? 1 : 0;
    }

    const phaseElapsed = elapsedSeconds - phaseStartTime;
    return Math.max(0, Math.min(phaseElapsed / phaseDuration, 1));
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


  // Update timer every second
  useEffect(() => {
    if (timerState.isRunning && !timerState.isPaused && timerState.startTime) {
      intervalRef.current = setInterval(() => {
        setTimerState((prevState: TimerState) => {
          if (!prevState.startTime) return prevState;

          const now = Date.now();
          const elapsedMs = now - prevState.startTime;
          const elapsedSeconds = Math.floor(elapsedMs / 1000);

          // Calculate total time remaining (can go negative)
          const timeRemaining = prevState.totalDuration - elapsedSeconds;

          // Check if timer just finished (only set finished status once when reaching 0)
          if (timeRemaining <= 0 && prevState.status !== 'finished' && prevState.timeRemaining > 0) {
            // Don't clear interval - let timer continue showing negative values
            // Trigger full screen blink
            triggerCompletionBlink();

            // Call the finish event callback
            eventsRef.current?.onFinish?.();

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
            // Calculate the correct phaseStartTime for the new phase
            const introDuration = prevState.introductionDuration;
            const mainDuration = prevState.mainDuration;
            let newPhaseStartTime: number;

            switch (currentPhase) {
              case 'introduction':
                newPhaseStartTime = 0;
                break;
              case 'main':
                newPhaseStartTime = introDuration;
                break;
              case 'conclusion':
                newPhaseStartTime = introDuration + mainDuration;
                break;
              default:
                newPhaseStartTime = 0;
            }

            return {
              ...prevState,
              timeRemaining,
              currentPhase,
              phaseStartTime: newPhaseStartTime,
              lastPhaseChange: now,
              blinkCount: 0
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
  }, [timerState.isRunning, timerState.isPaused, timerState.startTime, timerState.totalDuration, calculateCurrentPhase, triggerCompletionBlink]);

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
      timeRemaining: prevState.totalDuration, // Total remaining time
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
    }));
  }, []);

  const skip = useCallback(() => {
    setTimerState((prevState: TimerState) => {
      if (!prevState.startTime) return prevState;

      const now = Date.now();
      const elapsedSeconds = Math.floor((now - prevState.startTime) / 1000);

      // Determine current phase based on elapsed time and current durations
      let actualCurrentPhase: TimerPhase;
      const totalDuration = prevState.totalDuration;
      const introDuration = prevState.introductionDuration;
      const mainDuration = prevState.mainDuration;
      const introEnd = introDuration;
      const mainEnd = introDuration + mainDuration;

      if (elapsedSeconds < introEnd) {
        actualCurrentPhase = 'introduction';
      } else if (elapsedSeconds < mainEnd) {
        actualCurrentPhase = 'main';
      } else {
        actualCurrentPhase = 'conclusion';
      }

      let newPhase: TimerPhase;
      let elapsedAtPhaseStart: number; // How much time should have elapsed when new phase starts

      switch (actualCurrentPhase) {
        case 'introduction':
          newPhase = 'main';
          elapsedAtPhaseStart = introDuration; // Main starts after introduction
          break;
        case 'main':
          newPhase = 'conclusion';
          elapsedAtPhaseStart = introDuration + mainDuration; // Conclusion starts after intro + main
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

      // Calculate new startTime so that elapsed time matches the start of the new phase
      // This gives the user the full allocated time for the new phase
      const newStartTime = now - (elapsedAtPhaseStart * 1000);

      return {
        ...prevState,
        startTime: newStartTime,
        currentPhase: newPhase,
        phaseStartTime: elapsedAtPhaseStart,
        timeRemaining: totalDuration - elapsedAtPhaseStart, // Total remaining time after skip
        lastPhaseChange: now,
        blinkCount: 0
      };
    });
  }, []);

  const reset = useCallback(() => {
    setTimerState((prevState: TimerState) => ({
      ...prevState,
      totalDuration: prevState.totalDuration,
      timeRemaining: prevState.totalDuration,
      startTime: null,
      pausedTime: null,
      currentPhase: 'introduction',
      phaseStartTime: 0,
      introductionDuration: prevState.introductionDuration,
      mainDuration: prevState.mainDuration,
      conclusionDuration: prevState.conclusionDuration,
      status: 'idle',
      isRunning: false,
      isPaused: false,
      isFinished: false,
      lastPhaseChange: null,
      blinkCount: 0,
    }));
  }, []);

  const setDuration = useCallback((seconds: number) => {
    if (timerStateRef.current.status !== 'idle') {
      return;
    }

    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const durations = computeDurationsFromTotal(safeSeconds);

    setTimerState((prevState: TimerState) => ({
      ...prevState,
      totalDuration: safeSeconds,
      timeRemaining: safeSeconds,
      introductionDuration: durations.introduction,
      mainDuration: durations.main,
      conclusionDuration: durations.conclusion
    }));

    setTimerMode('total');
    saveMode('total');
    saveDuration(safeSeconds);
  }, [computeDurationsFromTotal]);

  const setPhaseDurations = useCallback((durations: TimerPhaseDurations) => {
    if (timerStateRef.current.status !== 'idle') {
      return;
    }

    if (
      !isValidDuration(durations.introduction) ||
      !isValidDuration(durations.main) ||
      !isValidDuration(durations.conclusion)
    ) {
      return;
    }

    const safeDurations: TimerPhaseDurations = {
      introduction: durations.introduction,
      main: durations.main,
      conclusion: durations.conclusion
    };
    const total = safeDurations.introduction + safeDurations.main + safeDurations.conclusion;

    setTimerState((prevState: TimerState) => ({
      ...prevState,
      totalDuration: total,
      timeRemaining: total,
      introductionDuration: safeDurations.introduction,
      mainDuration: safeDurations.main,
      conclusionDuration: safeDurations.conclusion
    }));

    setTimerMode('sections');
    saveMode('sections');
    savePhaseDurations(safeDurations);
    saveDuration(total);
  }, []);

  // Calculate progress information
  const elapsedSeconds = timerState.startTime
    ? Math.floor((Date.now() - timerState.startTime) / 1000)
    : 0;

  const totalProgress = timerState.totalDuration > 0
    ? Math.min(elapsedSeconds / timerState.totalDuration, 1)
    : 0;

  const phaseProgressByPhase = useMemo(() => {
    const introDuration = timerState.introductionDuration;
    const mainDuration = timerState.mainDuration;
    const conclusionDuration = timerState.conclusionDuration;
    const introStart = 0;
    const mainStart = introDuration;
    const conclusionStart = introDuration + mainDuration;

    const computeProgress = (start: number, duration: number): number => {
      if (duration === 0) {
        return elapsedSeconds >= start ? 1 : 0;
      }
      if (elapsedSeconds <= start) return 0;
      const end = start + duration;
      if (elapsedSeconds >= end) return 1;
      return (elapsedSeconds - start) / duration;
    };

    return {
      introduction: computeProgress(introStart, introDuration),
      main: computeProgress(mainStart, mainDuration),
      conclusion: computeProgress(conclusionStart, conclusionDuration)
    };
  }, [elapsedSeconds, timerState.introductionDuration, timerState.mainDuration, timerState.conclusionDuration]);

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
      phaseProgressByPhase,
      timeElapsed: elapsedSeconds,
      timeRemaining: timerState.timeRemaining
    },

    // Visual state
    visualState: {
      displayTime: formatTime(timerState.timeRemaining),
      displayColor: getDisplayColor(),
      phaseLabel: timerState.currentPhase,
      isEmergency: timerState.timeRemaining < 60 && timerState.isRunning, // Last minute warning
      animationClass: ''
    },

    // Actions
    actions: {
      start,
      pause,
      resume,
      stop,
      skip,
      reset,
      setDuration,
      setPhaseDurations
    },

  // Settings
  settings: {
    totalDuration: timerState.totalDuration,
    introductionRatio: settings.introductionRatio,
    mainRatio: settings.mainRatio,
    conclusionRatio: settings.conclusionRatio,
    mode: timerMode,
    updateSettings: () => {
      // This would update settings and recalculate durations
      // TODO: Implement settings persistence
    }
  },

    // Events
    events: events || {}
  };
};
