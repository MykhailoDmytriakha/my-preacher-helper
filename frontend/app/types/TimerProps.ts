import { TimerPhase, TimerStatus, TimerSettings, TimerState } from './TimerState';

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
}

export interface TimerStateSummary {
  timeRemaining: number;
  currentPhase: TimerPhase;
  status: TimerStatus;
  isRunning: boolean;
  isPaused: boolean;
  isFinished: boolean;
}

export interface TimerEvents {
  // Placeholder for future event handling
}

export interface UsePreachingTimerReturn {
  timerState: TimerStateSummary;
  progress: TimerProgress;
  visualState: TimerVisualState;
  actions: TimerActions;
  settings: TimerSettingsProps;
  events: TimerEvents;
}
