"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import DigitalTimerDisplay from './DigitalTimerDisplay';
import TimerControls from './TimerControls';
import CustomTimePicker from './CustomTimePicker';
import { usePreachingTimer } from '../hooks/usePreachingTimer';

// Error Boundary for Timer Components
const TimerErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { t } = useTranslation();

  const handleError = useCallback((error: Error) => {
    console.error('Timer Error:', error);
    setError(error);
    setHasError(true);
  }, []);

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
  currentDuration: number;
  onSelectDuration: (durationSeconds: number) => void;
  onOpenCustomPicker: () => void;
  onClose: () => void;
}

const InlineTimerPresets: React.FC<InlineTimerPresetsProps> = ({
  currentDuration,
  onSelectDuration,
  onOpenCustomPicker,
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
    // Prevent mousedown event from bubbling up to prevent backdrop click issues
    e.stopPropagation();
  }, []);

  const handleCustomPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // Prevent default action
    e.stopPropagation(); // Prevent event from bubbling up

    // Use setTimeout with longer delay to ensure ALL events have finished propagating
    // The mousedown event from the button click takes time to fully resolve
    setTimeout(() => {
      onOpenCustomPicker();
    }, 100); // Increased from 0 to 100ms to allow mousedown event to fully resolve
    // Don't call onClose() - handleOpenCustomPicker already handles closing inline presets
  }, [onOpenCustomPicker]);

  const handleCustomPickerMouseDown = useCallback((e: React.MouseEvent) => {
    // Prevent mousedown event from bubbling up to prevent backdrop click
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={popupRef}
      className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-50 min-w-max max-w-xs"
>
      {/* Quick Presets */}
      <div className="flex gap-2 mb-3">
        {[10, 15, 20, 25, 30].map((minutes) => (
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

      {/* Custom Time Picker Button */}
      <button
        onClick={handleCustomPicker}
        onMouseDown={handleCustomPickerMouseDown}
        className="w-full px-3 py-2 text-sm font-medium rounded-md border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
      >
        {t("plan.customTime", { defaultValue: "Custom Time..." })}
      </button>
    </div>
  );
};

interface PreachingTimerProps {
  initialDuration?: number; // in seconds, optional
  className?: string;
  sermonId?: string;
  onExitPreaching?: () => void;
  onTimerFinished?: () => void; // Called when timer finishes naturally
  onSetDuration?: (durationSeconds: number) => void; // Called when user selects new duration
  onSwitchToDurationSelector?: () => void; // Called when user wants to go back to main duration selector
}

const PreachingTimer: React.FC<PreachingTimerProps> = ({
  initialDuration,
  className = '',
  sermonId,
  onExitPreaching,
  onTimerFinished,
  onSetDuration,
  onSwitchToDurationSelector,
}) => {

  const { t } = useTranslation();

  // Use the preaching timer hook with fixed initial settings
  const initialTimerSettings = useMemo(() => {
    if (typeof initialDuration === 'number' && initialDuration > 0) {
      return { totalDuration: initialDuration };
    }
    return undefined;
  }, [initialDuration]);

  const {
    timerState,
    visualState,
    actions,
    settings
  } = usePreachingTimer(initialTimerSettings);

  // State for duration pickers
  const [showInlinePresets, setShowInlinePresets] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  // Track if we need to open custom picker after inline presets close
  const [pendingCustomPickerOpen, setPendingCustomPickerOpen] = useState(false);

  // Локальное состояние для отслеживания выбранного времени
  // Инициализируем значением из settings, которое может быть восстановлено из localStorage
  const [selectedDuration, setSelectedDuration] = useState<number>(settings.totalDuration);

  // Синхронизируем selectedDuration с settings.totalDuration
  useEffect(() => {
    if (settings.totalDuration !== selectedDuration) {
      setSelectedDuration(settings.totalDuration);
    }
  }, [settings.totalDuration, selectedDuration]);

  // Comprehensive logging for modal state debugging
  const logModalState = useCallback((action: string, details?: any) => {
    // Debug logging removed
  }, [showInlinePresets, showCustomPicker, pendingCustomPickerOpen, timerState, initialDuration]);

  // Periodic logging every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      logModalState('PERIODIC_STATUS_CHECK');
    }, 5000);

    return () => clearInterval(interval);
  }, [logModalState]);


  // Track previous initialDuration to detect changes
  const prevInitialDurationRef = useRef(initialDuration);

  // Enhanced state setters with logging
  const setShowInlinePresetsLogged = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShowInlinePresets((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      if (prev !== newValue) {
        logModalState('SET_INLINE_PRESETS', { from: prev, to: newValue, stack: new Error().stack?.split('\n')[2] });
      }
      return newValue;
    });
  }, [logModalState]);

  const setShowCustomPickerLogged = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShowCustomPicker((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      if (prev !== newValue) {
        const stack = new Error().stack?.split('\n').slice(2, 8).join('\n') || 'no stack';
        logModalState('SET_CUSTOM_PICKER', {
          from: prev,
          to: newValue,
          stack: stack,
          timestamp: Date.now()
        });
      }
      return newValue;
    });
  }, [logModalState]);

  const setPendingCustomPickerOpenLogged = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setPendingCustomPickerOpen((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      if (prev !== newValue) {
        logModalState('SET_PENDING_CUSTOM_PICKER', { from: prev, to: newValue, stack: new Error().stack?.split('\n')[2] });
      }
      return newValue;
    });
  }, [logModalState]);

  // Effect: Open custom picker AFTER inline presets finish closing
  useEffect(() => {
    logModalState('EFFECT_CUSTOM_PICKER_CHECK', {
      pendingCustomPickerOpen,
      showInlinePresets,
      effectTrigger: 'pendingCustomPickerOpen or showInlinePresets changed'
    });

    if (pendingCustomPickerOpen && !showInlinePresets) {
      logModalState('EFFECT_OPENING_CUSTOM_PICKER');
      const timer = setTimeout(() => {
        logModalState('TIMEOUT_EXECUTING_SET_CUSTOM_PICKER_TRUE');
        setShowCustomPickerLogged(true);
        setPendingCustomPickerOpenLogged(false);
      }, 50); // Small delay to ensure proper sequencing
      return () => {
        logModalState('TIMEOUT_CLEANUP');
        clearTimeout(timer);
      };
    }
  }, [pendingCustomPickerOpen, showInlinePresets, logModalState, setShowCustomPickerLogged, setPendingCustomPickerOpenLogged]);

  // Update timer duration when initialDuration changes (but not on first render)
  // Only update if initialDuration > 0 to avoid resetting saved duration
  useEffect(() => {
    if (initialDuration !== undefined && initialDuration > 0 &&
        prevInitialDurationRef.current !== undefined &&
        prevInitialDurationRef.current !== initialDuration) {
      actions.setDuration(initialDuration);
    }
    prevInitialDurationRef.current = initialDuration;
  }, [initialDuration, actions]);

  // Handlers for duration selection
  const handleOpenDurationPicker = useCallback(() => {
    logModalState('HANDLE_OPEN_DURATION_PICKER');
    setShowInlinePresetsLogged(true);
  }, [logModalState, setShowInlinePresetsLogged]);

  const handleCloseInlinePresets = useCallback(() => {
    logModalState('HANDLE_CLOSE_INLINE_PRESETS');
    setShowInlinePresetsLogged(false);
  }, [logModalState, setShowInlinePresetsLogged]);

  const handleSelectDuration = useCallback((durationSeconds: number) => {
    logModalState('HANDLE_SELECT_DURATION', { durationSeconds });

    // Устанавливаем локальное состояние сразу для немедленного обновления UI
    setSelectedDuration(durationSeconds);

    // Обновляем состояние таймера
    actions.setDuration(durationSeconds);
    onSetDuration?.(durationSeconds);
    setShowInlinePresetsLogged(false);
  }, [actions, onSetDuration, logModalState, setShowInlinePresetsLogged]);

  const handleOpenCustomPicker = useCallback(() => {
    logModalState('HANDLE_OPEN_CUSTOM_PICKER_START');
    // Close inline presets and flag to open custom picker
    // This ensures proper sequencing: inline presets close first, then modal opens
    setShowInlinePresetsLogged(false);
    setPendingCustomPickerOpenLogged(true);
    logModalState('HANDLE_OPEN_CUSTOM_PICKER_END');
  }, [logModalState, setShowInlinePresetsLogged, setPendingCustomPickerOpenLogged]);

  const handleCloseCustomPicker = useCallback(() => {
    logModalState('HANDLE_CLOSE_CUSTOM_PICKER');
    setShowCustomPickerLogged(false);
  }, [logModalState, setShowCustomPickerLogged]);

  const handleBackToPresets = useCallback(() => {
    logModalState('HANDLE_BACK_TO_PRESETS');
    // Go back from custom picker to inline presets
    setShowCustomPickerLogged(false);
    setShowInlinePresetsLogged(true);
  }, [logModalState, setShowCustomPickerLogged, setShowInlinePresetsLogged]);

  const handleConfirmCustomTime = useCallback((hours: number, minutes: number, seconds: number) => {
    logModalState('HANDLE_CONFIRM_CUSTOM_TIME', { hours, minutes, seconds });
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    actions.setDuration(totalSeconds);
    onSetDuration?.(totalSeconds);
    setShowCustomPickerLogged(false);
  }, [actions, logModalState, onSetDuration, setShowCustomPickerLogged]);


  // REMOVED: Auto-start timer functionality
  // Timer should only start when user explicitly clicks the play button
  // Not automatically when duration is set

  // Timer now shows negative values in finished state - no automatic callback needed
  // User manually exits via "Exit Preaching Mode" button

  return (
    <TimerErrorBoundary>
      <nav
        className={`preaching-timer sticky top-0 z-40 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-lg ${className}`}
        role="region"
        aria-label={t("plan.timer.regionLabel", { defaultValue: "Preaching Timer Controls" })}
      >
      <div className="w-full px-2 sm:px-4 md:px-6 lg:px-8">
        {/* Desktop Layout - 3-column flexbox with perfect alignment */}
        <div className="hidden lg:flex lg:items-center lg:justify-between lg:h-16 lg:px-4">
          {/* Left: Navigation Links */}
          <div className="flex items-center gap-2">
            {sermonId && (
              <Link
                href={`/sermons/${sermonId}/plan`}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md h-12"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t("actions.backToPlan", { defaultValue: "Back to Plan" })}</span>
              </Link>
            )}
            {sermonId && (
              <Link
                href={`/sermons/${sermonId}`}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md h-12"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t("actions.backToSermon", { defaultValue: "Back to Sermon" })}</span>
              </Link>
            )}
            {onExitPreaching && (
              <button
                onClick={() => {
                  // Stop timer if it's still running (showing negative values)
                  if (timerState.isRunning) {
                    actions.stop();
                  }
                  onExitPreaching();
                }}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md h-12"
              >
                <span>{t("plan.exitPreachingMode", { defaultValue: "Exit Preaching Mode" })}</span>
              </button>
            )}
          </div>

          {/* Center: Timer Display */}
          <div className="flex-1 flex items-center justify-center mx-8">
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
          <div className="flex items-center gap-3">
            {(() => {
              // Рассчитываем hasTime на основе локального состояния или настроек таймера
              const hasTimeCalculated = selectedDuration > 0 || settings.totalDuration > 0;

              return (
                <TimerControls
                  isRunning={timerState.isRunning}
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
              );
            })()}
          </div>
        </div>

        {/* Tablet Layout - Navigation on top, timer and controls on bottom */}
        <div className="hidden md:flex lg:hidden flex-col py-3 space-y-2">
          {/* Top Row: Navigation Links */}
          <div className="flex items-center justify-center gap-2">
            {sermonId && (
              <Link
                href={`/sermons/${sermonId}/plan`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t("actions.backToPlan", { defaultValue: "Back to Plan" })}</span>
              </Link>
            )}
            {sermonId && (
              <Link
                href={`/sermons/${sermonId}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t("actions.backToSermon", { defaultValue: "Back to Sermon" })}</span>
              </Link>
            )}
            {onExitPreaching && (
              <button
                onClick={onExitPreaching}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
              >
                <span>{t("plan.exitPreachingMode", { defaultValue: "Exit Preaching Mode" })}</span>
              </button>
            )}
          </div>

          {/* Bottom Row: Timer Display and Controls */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 flex justify-center">
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
              isRunning={timerState.isRunning}
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

        {/* Mobile Layout */}
        <div className="md:hidden py-3 space-y-2">
          {/* Navigation Links */}
          <div className="flex flex-wrap items-center gap-2">
            {sermonId && (
              <Link
                href={`/sermons/${sermonId}/plan`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t("actions.backToPlan", { defaultValue: "Back to Plan" })}</span>
              </Link>
            )}
            {sermonId && (
              <Link
                href={`/sermons/${sermonId}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{t("actions.backToSermon", { defaultValue: "Back to Sermon" })}</span>
              </Link>
            )}
            {onExitPreaching && (
              <button
                onClick={() => {
                  // Stop timer if it's still running (showing negative values)
                  if (timerState.isRunning) {
                    actions.stop();
                  }
                  onExitPreaching();
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 hover:shadow-lg active:scale-95 transition-all duration-200 shadow-md"
              >
                <span>{t("plan.exitPreachingMode", { defaultValue: "Exit" })}</span>
              </button>
            )}
          </div>

          {/* Timer Display */}
          <div className="flex justify-center py-1">
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

          {/* Timer Controls */}
          <div className="flex justify-center">
            <TimerControls
              isRunning={timerState.isRunning}
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
          currentDuration={settings.totalDuration}
          onSelectDuration={handleSelectDuration}
          onOpenCustomPicker={handleOpenCustomPicker}
          onClose={handleCloseInlinePresets}
        />
      )}

    </nav>

    {/* Custom Time Picker Modal */}
    {(() => {
      if (showCustomPicker) {
        const totalDuration = settings.totalDuration;
        const initialHours = Math.floor(totalDuration / 3600);
        const initialMinutes = Math.floor((totalDuration % 3600) / 60);
        const initialSeconds = totalDuration % 60;

        return (
          <CustomTimePicker
            initialHours={initialHours}
            initialMinutes={initialMinutes}
            initialSeconds={initialSeconds}
            onConfirm={handleConfirmCustomTime}
            onCancel={handleCloseCustomPicker}
            onBack={handleBackToPresets}
          />
        );
      }

      return null;
    })()}
    </TimerErrorBoundary>
  );
};

export default PreachingTimer;
