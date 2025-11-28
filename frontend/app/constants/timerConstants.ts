// Timer Constants and Configuration

import { TimerSettings, TimerPhase } from '@/types/TimerState';
import { PHASE_DEFINITIONS } from '@/types/TimerPhase';

/**
 * Default timer settings for different sermon lengths
 */
export const DEFAULT_TIMER_SETTINGS = {
  // Standard 20-minute sermon
  STANDARD: {
    totalDuration: 1200, // 20 minutes
    introductionRatio: 0.2, // 20% = 4 minutes
    mainRatio: 0.6, // 60% = 12 minutes
    conclusionRatio: 0.2 // 20% = 4 minutes
  } as TimerSettings,

  // Short 10-minute sermon
  SHORT: {
    totalDuration: 600, // 10 minutes
    introductionRatio: 0.25, // 25% = 2.5 minutes
    mainRatio: 0.65, // 65% = 6.5 minutes
    conclusionRatio: 0.1 // 10% = 1 minute
  } as TimerSettings,

  // Long 30-minute sermon
  LONG: {
    totalDuration: 1800, // 30 minutes
    introductionRatio: 0.15, // 15% = 4.5 minutes
    mainRatio: 0.8, // 80% = 24 minutes
    conclusionRatio: 0.05 // 5% = 1.5 minutes
  } as TimerSettings,

  // Very short 5-minute devotion
  DEVOTION: {
    totalDuration: 300, // 5 minutes
    introductionRatio: 0.3, // 30% = 1.5 minutes
    mainRatio: 0.6, // 60% = 3 minutes
    conclusionRatio: 0.1 // 10% = 0.5 minutes
  } as TimerSettings
};

/**
 * Preset timer durations in minutes
 */
export const TIMER_PRESETS = {
  DEVOTION: 5,
  SHORT: 10,
  STANDARD: 20,
  LONG: 30,
  EXTENDED: 45
} as const;

/**
 * Timer update intervals
 */
export const TIMER_INTERVALS = {
  // Main countdown interval (1 second)
  COUNTDOWN: 1000,

  // UI update interval (for smooth animations)
  UI_UPDATE: 100,

  // Phase transition check interval
  PHASE_CHECK: 500,

  // Emergency warning threshold (seconds before end)
  EMERGENCY_THRESHOLD: 60
} as const;

/**
 * Visual effect durations and timings
 */
export const VISUAL_EFFECTS = {
  // Phase blink duration (milliseconds per blink)
  BLINK_DURATION: 300,

  // Number of blinks for phase transitions
  PHASE_BLINK_COUNT: 4,

  // Full screen blink duration for timer end
  FULLSCREEN_BLINK_DURATION: 500,

  // Number of full screen blinks
  FULLSCREEN_BLINK_COUNT: 5,

  // Transition animation duration
  TRANSITION_DURATION: 500,

  // Emergency pulse interval
  EMERGENCY_PULSE_INTERVAL: 1000
} as const;

/**
 * Color scheme constants
 */
export const TIMER_COLORS = {
  // Phase colors (from PHASE_DEFINITIONS)
  PHASES: {
    introduction: PHASE_DEFINITIONS.introduction.color,
    main: PHASE_DEFINITIONS.main.color,
    conclusion: PHASE_DEFINITIONS.conclusion.color,
    finished: PHASE_DEFINITIONS.finished.color
  },

  // Emergency colors (when time is running low)
  EMERGENCY: {
    WARNING: '#F59E0B', // amber-500
    CRITICAL: '#EF4444', // red-500
    URGENT: '#DC2626'   // red-600
  },

  // UI element colors
  UI: {
    BACKGROUND: '#FFFFFF',
    BORDER: '#E5E7EB',
    TEXT: '#374151',
    TEXT_SECONDARY: '#6B7280',
    ACCENT: '#3B82F6'
  },

  // Dark mode colors
  DARK: {
    BACKGROUND: '#1F2937',
    BORDER: '#374151',
    TEXT: '#F9FAFB',
    TEXT_SECONDARY: '#D1D5DB',
    ACCENT: '#60A5FA'
  }
} as const;

/**
 * Timer status constants
 */
export const TIMER_STATUSES = {
  IDLE: 'idle' as const,
  RUNNING: 'running' as const,
  PAUSED: 'paused' as const,
  FINISHED: 'finished' as const
} as const;

/**
 * Phase transition rules
 */
export const PHASE_TRANSITIONS = {
  // Automatic transitions (time-based)
  AUTOMATIC: {
    introduction: { next: 'main', threshold: 'time' },
    main: { next: 'conclusion', threshold: 'time' },
    conclusion: { next: 'finished', threshold: 'time' }
  },

  // Manual transitions (user-triggered)
  MANUAL: {
    introduction: { canSkipTo: ['main'] },
    main: { canSkipTo: ['conclusion'] },
    conclusion: { canSkipTo: ['finished'] }
  }
} as const;

/**
 * Timer validation constants
 */
export const TIMER_VALIDATION = {
  // Duration limits (in seconds)
  DURATION: {
    MIN: 60,    // 1 minute
    MAX: 7200,  // 2 hours
    DEFAULT: 1200 // 20 minutes
  },

  // Phase ratio limits
  RATIOS: {
    INTRODUCTION: { MIN: 0.05, MAX: 0.4, DEFAULT: 0.2 },
    MAIN: { MIN: 0.4, MAX: 0.9, DEFAULT: 0.75 },
    CONCLUSION: { MIN: 0.05, MAX: 0.3, DEFAULT: 0.05 }
  },

  // Ratio tolerance for floating point comparisons
  RATIO_TOLERANCE: 0.001,

  // Phase duration warnings (in seconds)
  PHASE_WARNINGS: {
    TOO_SHORT: 60, // Less than 1 minute
    TOO_LONG: 1800 // More than 30 minutes
  }
} as const;

/**
 * UI layout constants
 */
export const TIMER_LAYOUT = {
  // Component sizes
  SIZES: {
    SMALL: { width: 320, height: 80 },
    MEDIUM: { width: 400, height: 100 },
    LARGE: { width: 480, height: 120 }
  },

  // Spacing
  SPACING: {
    PADDING: 16,
    MARGIN: 8,
    GAP: 12
  },

  // Font sizes
  FONT_SIZES: {
    TIME_DISPLAY: 36,
    PHASE_LABEL: 14,
    CONTROLS: 12
  },

  // Border radius
  BORDER_RADIUS: {
    SMALL: 4,
    MEDIUM: 8,
    LARGE: 12
  }
} as const;

/**
 * Accessibility constants
 */
export const TIMER_ACCESSIBILITY = {
  // ARIA labels
  LABELS: {
    TIMER_DISPLAY: 'Current time remaining',
    PHASE_INDICATOR: 'Current preaching phase',
    START_BUTTON: 'Start timer',
    PAUSE_BUTTON: 'Pause timer',
    RESUME_BUTTON: 'Resume timer',
    STOP_BUTTON: 'Stop timer',
    SKIP_BUTTON: 'Skip to next phase'
  },

  // Keyboard shortcuts
  SHORTCUTS: {
    START: 'Space',
    PAUSE: 'Space',
    STOP: 'Escape',
    SKIP: 'Enter'
  },

  // Focus management
  FOCUS_ORDER: [
    'start-button',
    'pause-button',
    'stop-button',
    'skip-button'
  ] as const
} as const;

/**
 * Error messages and codes
 */
export const TIMER_ERRORS = {
  INVALID_DURATION: 'TIMER_001',
  INVALID_RATIOS: 'TIMER_002',
  PHASE_OVERLAP: 'TIMER_003',
  TIMER_NOT_STARTED: 'TIMER_004',
  TIMER_ALREADY_RUNNING: 'TIMER_005'
} as const;

export const TIMER_ERROR_MESSAGES = {
  [TIMER_ERRORS.INVALID_DURATION]: 'Timer duration must be between 1 minute and 2 hours',
  [TIMER_ERRORS.INVALID_RATIOS]: 'Phase ratios must be valid percentages that sum to 100%',
  [TIMER_ERRORS.PHASE_OVERLAP]: 'Phase time ranges cannot overlap',
  [TIMER_ERRORS.TIMER_NOT_STARTED]: 'Timer must be started before this operation',
  [TIMER_ERRORS.TIMER_ALREADY_RUNNING]: 'Timer is already running'
} as const;

/**
 * Success messages
 */
export const TIMER_SUCCESS_MESSAGES = {
  TIMER_STARTED: 'Timer started successfully',
  TIMER_PAUSED: 'Timer paused',
  TIMER_RESUMED: 'Timer resumed',
  TIMER_STOPPED: 'Timer stopped and reset',
  PHASE_SKIPPED: 'Skipped to next phase',
  TIMER_FINISHED: 'Preaching session completed!'
} as const;

/**
 * Export utility functions
 */
export const getDefaultSettings = (preset: keyof typeof DEFAULT_TIMER_SETTINGS = 'STANDARD'): TimerSettings => {
  return { ...DEFAULT_TIMER_SETTINGS[preset] };
};

export const getTimerPreset = (key: keyof typeof TIMER_PRESETS): number => {
  return TIMER_PRESETS[key];
};

export const getPhaseColor = (phase: TimerPhase): string => {
  return TIMER_COLORS.PHASES[phase];
};

export const getEmergencyColor = (timeRemaining: number): string => {
  if (timeRemaining <= 10) return TIMER_COLORS.EMERGENCY.CRITICAL;
  if (timeRemaining <= 30) return TIMER_COLORS.EMERGENCY.URGENT;
  return TIMER_COLORS.EMERGENCY.WARNING;
};
