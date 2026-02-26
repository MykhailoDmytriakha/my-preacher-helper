"use client";

import { SquareX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePreachingTimer } from '@/hooks/usePreachingTimer';
import { TimerPhase, TimerPhaseDurations } from '@/types/TimerState';
import { useKeyboardShortcut } from '@hooks/useKeyboardShortcut';

import CustomTimePicker from './CustomTimePicker';
import DigitalTimerDisplay from './DigitalTimerDisplay';
import SectionTimePicker from './SectionTimePicker';
import TimerControls from './TimerControls';

// Error Boundary for Timer Components
const TimerErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasError] = useState(false);
  const { t } = useTranslation();

  if (hasError) {
    return (
      <div className="flex items-center justify-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <div className="text-center">
          <div className="text-red-600 dark:text-red-400 mb-2">
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-sm text-red-800 dark:text-red-200 font-medium">
            {t("plan.timer.error.title", { defaultValue: "Timer Error" })}
          </p>
          <p className="text-xs text-red-600 dark:text-red-300 mt-1">
            {t("plan.timer.error.message", { defaultValue: "Please refresh the page to restart the timer" })}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            {t("common.refresh", { defaultValue: "Refresh" })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <React.Fragment>
      {children}
    </React.Fragment>
  );
};

// Inline Timer Presets Component
interface InlineTimerPresetsProps {
  onSelectDuration: (durationSeconds: number) => void;
  onOpenCustomPicker: () => void;
  onOpenSectionPicker: () => void;
  onClose: () => void;
}

const InlineTimerPresets: React.FC<InlineTimerPresetsProps> = ({
  onSelectDuration,
  onOpenCustomPicker,
  onOpenSectionPicker,
  onClose
}) => {
  const { t } = useTranslation();
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handlePresetSelect = useCallback((minutes: number) => {
    onSelectDuration(minutes * 60);
    onClose();
  }, [onSelectDuration, onClose]);

  const handlePresetMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCustomPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      onOpenCustomPicker();
    }, 100);
  }, [onOpenCustomPicker]);

  const handleSectionPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      onOpenSectionPicker();
    }, 100);
  }, [onOpenSectionPicker]);

  const handleCustomPickerMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={popupRef}
      className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-50 min-w-max max-w-xs"
    >
      <div className="flex flex-col gap-2 mb-3">
        {[
          [10, 15, 20, 25, 30],
          [35, 40, 45, 50, 55]
        ].map((row) => (
          <div key={row.join('-')} className="flex gap-2">
            {row.map((minutes) => (
              <button
                key={minutes}
                onClick={() => handlePresetSelect(minutes)}
                onMouseDown={handlePresetMouseDown}
                className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {minutes}m
              </button>
            ))}
          </div>
        ))}
      </div>

      <button
        onClick={handleCustomPicker}
        onMouseDown={handleCustomPickerMouseDown}
        className="w-full px-3 py-2 text-sm font-medium rounded-md border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
      >
        {t("plan.customTime", { defaultValue: "Custom Time..." })}
      </button>

      <button
        onClick={handleSectionPicker}
        onMouseDown={handleCustomPickerMouseDown}
        className="w-full mt-2 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        {t("plan.timePicker.bySections", { defaultValue: "By sections..." })}
      </button>
    </div>
  );
};

const TIMER_PHASE_DURATIONS_KEY = 'preaching-timer-phase-durations';

interface PreachingTimerProps {
  initialDuration?: number; // in seconds, optional
  className?: string;
  onSetDuration?: (durationSeconds: number) => void;
  onTimerFinished?: () => void;
  onTimerStateChange?: (timerState: {
    currentPhase: TimerPhase;
    phaseProgress: number;
    totalProgress: number;
    phaseProgressByPhase: {
      introduction: number;
      main: number;
      conclusion: number;
    };
    timeRemaining: number;
    isFinished: boolean;
    isBlinking?: boolean;
  }) => void;
  /** When provided, used as fallback when there is no history (e.g. opened in new tab). Otherwise back() returns to where the user came from. */
  exitFallbackPath?: string;
}

const PreachingTimer: React.FC<PreachingTimerProps> = ({
  initialDuration,
  className = '',
  onSetDuration,
  onTimerFinished,
  onTimerStateChange,
  exitFallbackPath,
}) => {
  const { t } = useTranslation();
  const router = useRouter();

  const handleExitPreaching = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(exitFallbackPath ?? '/sermons');
    }
  }, [router, exitFallbackPath]);

  const handleDashboardNavigation = useCallback(() => {
    router.push('/sermons');
  }, [router]);

  // Timer Logic
  const initialTimerSettings = useMemo(() => {
    if (typeof initialDuration === 'number' && initialDuration > 0) {
      return { totalDuration: initialDuration };
    }
    return undefined;
  }, [initialDuration]);

  const {
    timerState,
    progress,
    visualState,
    actions,
    settings
  } = usePreachingTimer(initialTimerSettings, {
    onFinish: onTimerFinished,
  });

  useEffect(() => {
    if (onTimerStateChange && progress) {
      onTimerStateChange({
        currentPhase: timerState.currentPhase,
        phaseProgress: progress.phaseProgress,
        totalProgress: progress.totalProgress,
        phaseProgressByPhase: progress.phaseProgressByPhase,
        timeRemaining: progress.timeRemaining,
        isFinished: timerState.isFinished,
      });
    }
  }, [timerState.currentPhase, timerState.isFinished, progress, onTimerStateChange]);

  const [showInlinePresets, setShowInlinePresets] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [pendingCustomPickerOpen, setPendingCustomPickerOpen] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [pendingSectionPickerOpen, setPendingSectionPickerOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<number>(settings.totalDuration);
  const keyboardShortcutsEnabled = !showCustomPicker && !showInlinePresets && !showSectionPicker;

  const computeDurationsFromTotal = useCallback((totalSeconds: number): TimerPhaseDurations => {
    const intro = Math.floor(totalSeconds * settings.introductionRatio);
    const main = Math.floor(totalSeconds * settings.mainRatio);
    const conclusion = Math.max(0, totalSeconds - intro - main);
    return { introduction: intro, main, conclusion };
  }, [settings.introductionRatio, settings.mainRatio]);

  const loadStoredPhaseDurations = useCallback((): TimerPhaseDurations | null => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem(TIMER_PHASE_DURATIONS_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as TimerPhaseDurations;
      if (
        parsed &&
        Number.isInteger(parsed.introduction) && parsed.introduction >= 0 &&
        Number.isInteger(parsed.main) && parsed.main >= 0 &&
        Number.isInteger(parsed.conclusion) && parsed.conclusion >= 0
      ) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }, []);

  const [sectionDurations, setSectionDurations] = useState<TimerPhaseDurations>(() => {
    const stored = loadStoredPhaseDurations();
    return stored ?? computeDurationsFromTotal(settings.totalDuration);
  });

  // Keyboard Shortcuts (disabled when modal or presets are open)
  useKeyboardShortcut({
    onEscape: handleDashboardNavigation,
    onBackspace: handleExitPreaching,
    enabled: keyboardShortcutsEnabled,
  });

  useEffect(() => {
    if (settings.totalDuration !== selectedDuration) {
      setSelectedDuration(settings.totalDuration);
    }
  }, [settings.totalDuration, selectedDuration]);

  useEffect(() => {
    const stored = loadStoredPhaseDurations();
    if (stored) {
      setSectionDurations(stored);
      return;
    }
    setSectionDurations(computeDurationsFromTotal(settings.totalDuration));
  }, [settings.totalDuration, loadStoredPhaseDurations, computeDurationsFromTotal]);

  const prevInitialDurationRef = useRef(initialDuration);

  // Effect: Open custom picker AFTER inline presets finish closing
  useEffect(() => {
    if (pendingCustomPickerOpen && !showInlinePresets) {
      const timer = setTimeout(() => {
        setShowCustomPicker(true);
        setPendingCustomPickerOpen(false);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pendingCustomPickerOpen, showInlinePresets]);

  useEffect(() => {
    if (pendingSectionPickerOpen && !showInlinePresets) {
      const timer = setTimeout(() => {
        setShowSectionPicker(true);
        setPendingSectionPickerOpen(false);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pendingSectionPickerOpen, showInlinePresets]);

  useEffect(() => {
    if (
      settings.mode === 'total' &&
      initialDuration !== undefined &&
      initialDuration > 0 &&
      prevInitialDurationRef.current !== undefined &&
      prevInitialDurationRef.current !== initialDuration
    ) {
      actions.setDuration(initialDuration);
    }
    prevInitialDurationRef.current = initialDuration;
  }, [initialDuration, actions, settings.mode]);

  const handleOpenDurationPicker = useCallback(() => {
    setShowInlinePresets(true);
  }, []);

  const handleCloseInlinePresets = useCallback(() => {
    setShowInlinePresets(false);
  }, []);

  const handleSelectDuration = useCallback((durationSeconds: number) => {
    setSelectedDuration(durationSeconds);
    actions.setDuration(durationSeconds);
    onSetDuration?.(durationSeconds);
    setShowInlinePresets(false);
  }, [actions, onSetDuration]);

  const handleOpenCustomPicker = useCallback(() => {
    setShowInlinePresets(false);
    setPendingCustomPickerOpen(true);
  }, []);

  const handleOpenSectionPicker = useCallback(() => {
    setShowInlinePresets(false);
    setPendingSectionPickerOpen(true);
  }, []);

  const handleCloseCustomPicker = useCallback(() => {
    setShowCustomPicker(false);
  }, []);

  const handleCloseSectionPicker = useCallback(() => {
    setShowSectionPicker(false);
  }, []);

  const handleBackToPresets = useCallback(() => {
    setShowCustomPicker(false);
    setShowInlinePresets(true);
  }, []);

  const handleBackToPresetsFromSections = useCallback(() => {
    setShowSectionPicker(false);
    setShowInlinePresets(true);
  }, []);

  const handleConfirmCustomTime = useCallback((hours: number, minutes: number, seconds: number) => {
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    actions.setDuration(totalSeconds);
    onSetDuration?.(totalSeconds);
    setShowCustomPicker(false);
  }, [actions, onSetDuration]);

  const handleConfirmSectionTimes = useCallback((durations: TimerPhaseDurations) => {
    const totalSeconds = durations.introduction + durations.main + durations.conclusion;
    actions.setPhaseDurations(durations);
    setSectionDurations(durations);
    setSelectedDuration(totalSeconds);
    onSetDuration?.(totalSeconds);
    setShowSectionPicker(false);
  }, [actions, onSetDuration]);

  return (
    <TimerErrorBoundary>
      <nav
        className={`preaching-timer z-40 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-lg ${className}`}
        role="region"
        aria-label={t("plan.timer.regionLabel", { defaultValue: "Preaching Timer Controls" })}
      >
        <div className="w-full px-2 sm:px-4 md:px-6 lg:px-8">
          {/* Desktop Layout - Timer & Controls */}
          <div className="hidden lg:flex lg:items-center lg:justify-between lg:h-16 lg:px-4">
            {/* Left: Exit preaching mode */}
            <div className="flex items-center flex-1 min-w-0">
              <button
                type="button"
                onClick={handleExitPreaching}
                className="flex items-center justify-center p-2 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors shrink-0"
                aria-label={t('plan.exitPreachingMode', { defaultValue: 'Exit Preaching Mode' })}
                data-testid="exit-preaching"
              >
                <SquareX className="h-5 w-5 shrink-0" />
              </button>
            </div>

            {/* Center: Timer Display */}
            <div className="flex items-center justify-center mx-8" data-testid="timer-center-section">
              <DigitalTimerDisplay
                time={visualState.displayTime}
                color={visualState.displayColor}
                phase={timerState.currentPhase}
                isEmergency={visualState.isEmergency}
                animationClass={visualState.animationClass}
                isInteractive={timerState.status === 'idle'}
                onClick={timerState.status === 'idle' ? handleOpenDurationPicker : undefined}
              />
            </div>

            {/* Right: Timer Controls */}
            <div className="flex items-center justify-end gap-3 flex-1">
              <TimerControls
                isPaused={timerState.isPaused}
                status={timerState.status}
                currentPhase={timerState.currentPhase}
                hasTime={selectedDuration > 0 || settings.totalDuration > 0}
                onStart={actions.start}
                onPause={actions.pause}
                onResume={actions.resume}
                onStop={actions.stop}
                onSkip={actions.skip}
              />
            </div>
          </div>

          {/* Tablet/Mobile Layout - Timer & Controls */}
          <div className="lg:hidden flex flex-col py-2 space-y-2">
            {/* Exit button - left edge */}
            <div className="flex justify-start px-0 pb-1">
              <button
                type="button"
                onClick={handleExitPreaching}
                className="flex items-center justify-center p-2 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                aria-label={t('plan.exitPreachingMode', { defaultValue: 'Exit Preaching Mode' })}
                data-testid="exit-preaching"
              >
                <SquareX className="h-5 w-5 shrink-0" />
              </button>
            </div>
            {/* Timer Display and Controls (Centered) */}
            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 pb-2">
              <div className="flex items-center justify-center">
                <DigitalTimerDisplay
                  time={visualState.displayTime}
                  color={visualState.displayColor}
                  phase={timerState.currentPhase}
                  isEmergency={visualState.isEmergency}
                  animationClass={visualState.animationClass}
                  isInteractive={timerState.status === 'idle'}
                  onClick={timerState.status === 'idle' ? handleOpenDurationPicker : undefined}
                />
              </div>
              <TimerControls
                isPaused={timerState.isPaused}
                status={timerState.status}
                currentPhase={timerState.currentPhase}
                hasTime={settings.totalDuration > 0}
                onStart={actions.start}
                onPause={actions.pause}
                onResume={actions.resume}
                onStop={actions.stop}
                onSkip={actions.skip}
              />
            </div>
          </div>
        </div>

        {/* Inline Timer Presets */}
        {showInlinePresets && (
          <InlineTimerPresets
            onSelectDuration={handleSelectDuration}
            onOpenCustomPicker={handleOpenCustomPicker}
            onOpenSectionPicker={handleOpenSectionPicker}
            onClose={handleCloseInlinePresets}
          />
        )}
      </nav>

      {/* Custom Time Picker Modal */}
      {showCustomPicker && (
        <CustomTimePicker
          initialHours={Math.floor(settings.totalDuration / 3600)}
          initialMinutes={Math.floor((settings.totalDuration % 3600) / 60)}
          initialSeconds={settings.totalDuration % 60}
          onConfirm={handleConfirmCustomTime}
          onCancel={handleCloseCustomPicker}
          onBack={handleBackToPresets}
        />
      )}

      {showSectionPicker && (
        <SectionTimePicker
          initialDurations={sectionDurations}
          onConfirm={handleConfirmSectionTimes}
          onCancel={handleCloseSectionPicker}
          onBack={handleBackToPresetsFromSections}
        />
      )}
    </TimerErrorBoundary>
  );
};

export default PreachingTimer;
