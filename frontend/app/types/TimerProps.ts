import { TimerMode, TimerPhase, TimerPhaseDurations, TimerStatus, TimerSettings } from './TimerState';

export interface TimerSettingsProps {
  totalDuration: number;
  introductionRatio: number;
  mainRatio: number;
  conclusionRatio: number;
  updateSettings: (settings: Partial<TimerSettings>) => void;
}

export interface TimerProgress {
  totalProgress: number; // 0-1
  phaseProgress: number; // 0-1
  phaseProgressByPhase: {
    introduction: number;
    main: number;
    conclusion: number;
  };
  timeElapsed: number; // in seconds
  timeRemaining: number; // in seconds
}

export interface TimerVisualState {
  displayTime: string; // formatted "MM:SS"
  displayColor: string; // hex color
  phaseLabel: TimerPhase;
  isEmergency: boolean; // true when < 1 minute remaining
  animationClass: string; // CSS animation class
}

export interface TimerActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skip: () => void;
  reset: () => void;
  setDuration: (seconds: number) => void;
  setPhaseDurations: (durations: TimerPhaseDurations) => void;
}

export interface TimerStateSummary {
  timeRemaining: number;
  currentPhase: TimerPhase;
  status: TimerStatus;
  isRunning: boolean;
  isPaused: boolean;
  isFinished: boolean;
}

export interface UsePreachingTimerReturn {
  // State
  timerState: {
    timeRemaining: number;
    currentPhase: TimerPhase;
    status: TimerStatus;
    isRunning: boolean;
    isPaused: boolean;
    isFinished: boolean;
  };

  // Progress
  progress: {
    totalProgress: number;
    phaseProgress: number;
    phaseProgressByPhase: {
      introduction: number;
      main: number;
      conclusion: number;
    };
    timeElapsed: number;
    timeRemaining: number;
  };

  // Visual state
  visualState: {
    displayTime: string;
    displayColor: string;
    phaseLabel: string;
    isEmergency: boolean;
    animationClass: string;
  };

  // Actions
  actions: {
    start: () => void;
    pause: () => void;
    resume: () => void;
    stop: () => void;
    skip: () => void;
    reset: () => void;
    setDuration: (seconds: number) => void;
    setPhaseDurations: (durations: TimerPhaseDurations) => void;
  };

  // Settings
  settings: {
    totalDuration: number;
    introductionRatio: number;
    mainRatio: number;
    conclusionRatio: number;
    mode: TimerMode;
    updateSettings: (settings: Partial<{
      totalDuration: number;
      introductionRatio: number;
      mainRatio: number;
      conclusionRatio: number;
    }>) => void;
  };

  // Events
  events: {
    onPhaseChange?: (phase: TimerPhase) => void;
    onFinish?: () => void;
    onEmergency?: (timeRemaining: number) => void;
  };
}
