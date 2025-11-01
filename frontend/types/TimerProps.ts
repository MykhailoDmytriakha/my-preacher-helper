// Timer Component Props Types

import { TimerPhase, TimerStatus } from './TimerState';

// Base component props
export interface BaseTimerProps {
  className?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

// PreachingTimer component props
export interface PreachingTimerProps extends BaseTimerProps {
  timeRemaining: number; // in seconds
  currentPhase: TimerPhase;
  isRunning: boolean;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: () => void;
}

// DigitalTimerDisplay component props
export interface DigitalTimerDisplayProps extends BaseTimerProps {
  time: string; // formatted as "MM:SS" or "-MM:SS"
  color: string; // hex color or CSS color value
  phase: TimerPhase;
  showPhaseIndicator?: boolean;
  size?: 'small' | 'medium' | 'large';
}

// TimerControls component props
export interface TimerControlsProps extends BaseTimerProps {
  isRunning: boolean;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: () => void;
  showSkip?: boolean;
  orientation?: 'horizontal' | 'vertical';
  size?: 'small' | 'medium' | 'large';
  variant?: 'default' | 'minimal' | 'compact';
}

// Individual control button props
export interface TimerControlButtonProps extends BaseTimerProps {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
}

// TimePickerPopup component props
export interface TimePickerPopupProps extends BaseTimerProps {
  isOpen: boolean;
  onClose: () => void;
  onSetTimer: (hours: number, minutes: number, seconds: number) => void;
  onStartPreaching: (hours: number, minutes: number, seconds: number) => void;
  initialHours?: number;
  initialMinutes?: number;
  initialSeconds?: number;
  showPresets?: boolean;
  maxHours?: number;
  maxMinutes?: number;
  maxSeconds?: number;
}

// Time picker wheel props
export interface TimePickerWheelProps extends BaseTimerProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  step?: number;
  label: string;
  formatValue?: (value: number) => string;
}

// Time picker preset button props
export interface TimePickerPresetProps extends BaseTimerProps {
  minutes: number;
  onClick: () => void;
  isActive?: boolean;
  formatLabel?: (minutes: number) => string;
}

// Timer settings modal props
export interface TimerSettingsModalProps extends BaseTimerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: {
    totalDuration: number;
    introductionRatio: number;
    mainRatio: number;
    conclusionRatio: number;
  };
  onSettingsChange: (settings: {
    totalDuration: number;
    introductionRatio: number;
    mainRatio: number;
    conclusionRatio: number;
  }) => void;
}

// Timer progress bar props
export interface TimerProgressBarProps extends BaseTimerProps {
  progress: number; // 0-1
  phase: TimerPhase;
  height?: number;
  showLabels?: boolean;
  animated?: boolean;
  color?: string;
}

// Timer phase indicator props
export interface TimerPhaseIndicatorProps extends BaseTimerProps {
  phase: TimerPhase;
  progress: number; // 0-1 progress within phase
  showProgress?: boolean;
  size?: 'small' | 'medium' | 'large';
}

// Timer statistics props
export interface TimerStatsProps extends BaseTimerProps {
  totalTime: number; // in seconds
  introductionTime: number; // in seconds
  mainTime: number; // in seconds
  conclusionTime: number; // in seconds
  pausesCount: number;
  skipsCount: number;
  averagePauseDuration: number; // in seconds
}

// Timer history item props
export interface TimerHistoryItemProps extends BaseTimerProps {
  date: Date;
  duration: number; // in seconds
  phases: {
    introduction: number;
    main: number;
    conclusion: number;
  };
  completed: boolean;
  onView?: () => void;
  onDelete?: () => void;
}

// Timer hook return types
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
  };

  // Settings
  settings: {
    totalDuration: number;
    introductionRatio: number;
    mainRatio: number;
    conclusionRatio: number;
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

// Timer context props
export interface TimerContextProps {
  timer: UsePreachingTimerReturn;
  isVisible: boolean;
  showTimer: () => void;
  hideTimer: () => void;
  toggleTimer: () => void;
}

// Integration props for plan page
export interface PlanTimerIntegrationProps extends BaseTimerProps {
  sermonId: string;
  planView?: 'default' | 'immersive' | 'preaching';
  onTimerStart?: () => void;
  onTimerFinish?: () => void;
  onPhaseChange?: (phase: TimerPhase) => void;
  showTimerControls?: boolean;
  timerPosition?: 'header' | 'sidebar' | 'overlay';
}

// Export/import types for timer sessions
export interface TimerSessionExport {
  id: string;
  sermonId: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  phases: {
    introduction: number;
    main: number;
    conclusion: number;
  };
  events: Array<{
    action: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }>;
  completed: boolean;
  settings: {
    totalDuration: number;
    introductionRatio: number;
    mainRatio: number;
    conclusionRatio: number;
  };
}
