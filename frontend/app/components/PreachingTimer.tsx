"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import DigitalTimerDisplay from './DigitalTimerDisplay';
import TimerControls from './TimerControls';
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

interface PreachingTimerProps {
  initialDuration?: number; // in seconds, optional
  className?: string;
  sermonId?: string;
  onExitPreaching?: () => void;
  onTimerFinished?: () => void; // Called when timer finishes naturally
}

const PreachingTimer: React.FC<PreachingTimerProps> = ({
  initialDuration,
  className = '',
  sermonId,
  onExitPreaching,
  onTimerFinished,
}) => {
  const { t } = useTranslation();

  // Use the preaching timer hook
  const {
    timerState,
    visualState,
    actions
  } = usePreachingTimer(initialDuration ? { totalDuration: initialDuration } : undefined);

  // Track if we've already auto-started the timer to prevent re-starting after manual stop
  const hasAutoStartedRef = useRef(false);

  // Auto-start timer when component mounts with initial duration (only once)
  useEffect(() => {
    if (initialDuration && timerState.status === 'idle' && !hasAutoStartedRef.current) {
      actions.start();
      hasAutoStartedRef.current = true;
    }
  }, [initialDuration, timerState.status, actions]);

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
            />
          </div>

          {/* Right: Timer Controls */}
          <div className="flex items-center gap-3">
            <TimerControls
              isRunning={timerState.isRunning}
              isPaused={timerState.isPaused}
              status={timerState.status}
              currentPhase={timerState.currentPhase}
              onStart={actions.start}
              onPause={actions.pause}
              onResume={actions.resume}
              onStop={actions.stop}
              onSkip={actions.skip}
            />
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
              />
            </div>
            <TimerControls
              isRunning={timerState.isRunning}
              isPaused={timerState.isPaused}
              status={timerState.status}
              currentPhase={timerState.currentPhase}
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
            />
          </div>

          {/* Timer Controls */}
          <div className="flex justify-center">
            <TimerControls
              isRunning={timerState.isRunning}
              isPaused={timerState.isPaused}
              status={timerState.status}
              currentPhase={timerState.currentPhase}
              onStart={actions.start}
              onPause={actions.pause}
              onResume={actions.resume}
              onStop={actions.stop}
              onSkip={actions.skip}
            />
          </div>
        </div>
      </div>
    </nav>
    </TimerErrorBoundary>
  );
};

export default PreachingTimer;
