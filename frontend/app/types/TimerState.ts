export type TimerPhase = 'introduction' | 'main' | 'conclusion' | 'finished';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerSettings {
  totalDuration: number; // in seconds
  introductionRatio: number; // 0-1
  mainRatio: number; // 0-1
  conclusionRatio: number; // 0-1
}

export interface TimerState {
  totalDuration: number;
  timeRemaining: number;
  startTime: number | null;
  pausedTime: number | null;
  currentPhase: TimerPhase;
  phaseStartTime: number;
  introductionDuration: number;
  mainDuration: number;
  conclusionDuration: number;
  status: TimerStatus;
  isRunning: boolean;
  isPaused: boolean;
  isFinished: boolean;
  lastPhaseChange: number | null;
  blinkCount: number;
  isBlinking: boolean;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  totalDuration: 1200, // 20 minutes
  introductionRatio: 0.2, // 20%
  mainRatio: 0.6, // 60%
  conclusionRatio: 0.2 // 20%
};

export const TIMER_PHASE_COLORS: Record<TimerPhase, string> = {
  introduction: '#FCD34D', // yellow-300
  main: '#3B82F6', // blue-500
  conclusion: '#10B981', // emerald-500
  finished: '#EF4444' // red-500
};
