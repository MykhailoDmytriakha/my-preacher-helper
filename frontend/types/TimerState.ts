// Timer State Management Types

export type TimerPhase = 'introduction' | 'main' | 'conclusion' | 'finished';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerSettings {
  totalDuration: number; // total time in seconds
  introductionRatio: number; // percentage (0-1) for introduction phase
  mainRatio: number; // percentage (0-1) for main phase
  conclusionRatio: number; // percentage (0-1) for conclusion phase
}

export interface TimerState {
  // Time management
  totalDuration: number; // total timer duration in seconds
  timeRemaining: number; // current time remaining in seconds
  startTime: number | null; // timestamp when timer started
  pausedTime: number | null; // timestamp when timer was paused

  // Phase management
  currentPhase: TimerPhase;
  phaseStartTime: number; // time when current phase started (in seconds from start)
  introductionDuration: number; // duration of introduction phase in seconds
  mainDuration: number; // duration of main phase in seconds
  conclusionDuration: number; // duration of conclusion phase in seconds

  // Status management
  status: TimerStatus;
  isRunning: boolean;
  isPaused: boolean;
  isFinished: boolean;

  // Visual feedback
  lastPhaseChange: number | null; // timestamp of last phase change
  blinkCount: number; // current blink count for visual effects
  isBlinking: boolean; // whether screen/section is currently blinking
}

export interface TimerPhaseInfo {
  phase: TimerPhase;
  startTime: number; // start time in seconds from timer start
  endTime: number; // end time in seconds from timer start
  duration: number; // duration in seconds
  color: string; // hex color code
  label: string; // display label
}

export interface TimerProgress {
  totalProgress: number; // 0-1 progress through total timer
  phaseProgress: number; // 0-1 progress through current phase
  timeElapsed: number; // total elapsed time in seconds
  timeRemaining: number; // total remaining time in seconds
}

export interface TimerVisualState {
  displayTime: string; // formatted time string (MM:SS or -MM:SS)
  displayColor: string; // current color for time display
  phaseLabel: string; // current phase label
  isEmergency: boolean; // whether timer is in emergency mode (low time)
  animationClass: string; // CSS class for animations
}

// Default timer settings
export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  totalDuration: 1200, // 20 minutes
  introductionRatio: 0.2, // 20%
  mainRatio: 0.8, // 80%
  conclusionRatio: 0.0, // 0% (calculated as remainder)
};

// Phase color mapping
export const TIMER_PHASE_COLORS = {
  introduction: '#FCD34D', // yellow-300
  main: '#3B82F6', // blue-500
  conclusion: '#10B981', // emerald-500
  finished: '#EF4444', // red-500
} as const;

// Phase labels
export const TIMER_PHASE_LABELS = {
  introduction: 'Introduction',
  main: 'Main Part',
  conclusion: 'Conclusion',
  finished: 'Finished',
} as const;

// Timer status transitions
export type TimerAction =
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'STOP'
  | 'SKIP'
  | 'RESET'
  | 'FINISH';

export interface TimerEvent {
  action: TimerAction;
  timestamp: number;
  previousState: Partial<TimerState>;
  newState: Partial<TimerState>;
  metadata?: Record<string, unknown>;
}
