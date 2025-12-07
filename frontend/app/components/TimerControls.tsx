"use client";

import React, { CSSProperties, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Square, SkipForward } from 'lucide-react';
import { SERMON_SECTION_COLORS, TIMER_CONTROL_COLORS } from '../utils/themeColors';

interface TimerControlsProps {
  isRunning: boolean;
  isPaused: boolean;
  status?: 'idle' | 'running' | 'paused' | 'finished';
  currentPhase?: 'introduction' | 'main' | 'conclusion' | 'finished';
  hasTime?: boolean; // Whether timer has a duration set (> 0)
  onStart?: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: () => void;
}

const TimerControls: React.FC<TimerControlsProps> = ({
  isRunning,
  isPaused,
  status = 'idle',
  currentPhase = 'introduction',
  hasTime = false,
  onStart,
  onPause,
  onResume,
  onStop,
  onSkip,
}) => {
  const { t } = useTranslation();

  const showPlayButton = status === 'idle' && hasTime;
  const buttonDisabled = status === 'finished' || (status === 'idle' && !hasTime);

  const showResumeButton = status === 'idle' || isPaused;

  const phaseKey = currentPhase === 'conclusion' || currentPhase === 'finished'
    ? 'conclusion'
    : currentPhase === 'introduction'
      ? 'introduction'
      : 'mainPart';
  const phaseColors = SERMON_SECTION_COLORS[phaseKey];

  const primaryGradient = showResumeButton
    ? (status === 'idle' ? TIMER_CONTROL_COLORS.play : TIMER_CONTROL_COLORS.resume)
    : TIMER_CONTROL_COLORS.pause;

  const controlStyles = useMemo(() => ({
    '--timer-accent-start': phaseColors.light,
    '--timer-accent-end': phaseColors.base,
    '--timer-surface-light': TIMER_CONTROL_COLORS.surface.light,
    '--timer-surface-dark': TIMER_CONTROL_COLORS.surface.dark,
    '--timer-border-light': TIMER_CONTROL_COLORS.border.light,
    '--timer-border-dark': TIMER_CONTROL_COLORS.border.dark,
    '--timer-divider': TIMER_CONTROL_COLORS.divider.light,
    '--timer-divider-dark': TIMER_CONTROL_COLORS.divider.dark,
    '--btn-primary-start': primaryGradient.start,
    '--btn-primary-end': primaryGradient.end,
    '--btn-stop-start': TIMER_CONTROL_COLORS.stop.start,
    '--btn-stop-end': TIMER_CONTROL_COLORS.stop.end,
    '--btn-skip-start': TIMER_CONTROL_COLORS.skip.start,
    '--btn-skip-end': TIMER_CONTROL_COLORS.skip.end,
    '--btn-disabled': TIMER_CONTROL_COLORS.disabled,
  } as CSSProperties), [phaseColors.base, phaseColors.light, primaryGradient.end, primaryGradient.start]);

  const handlePauseResume = () => {
    if (status === 'idle') {
      onStart?.();
    } else if (isPaused) {
      onResume();
    } else {
      onPause();
    }
  };

  // Determine button text based on state
  const buttonTitle = showResumeButton
    ? (buttonDisabled
        ? (t("plan.selectTime", { defaultValue: "Select time..." }) || "Select time...")
        : showPlayButton
          ? (t("actions.start") || "Start")
          : (t("plan.timer.resume") || "Resume")
      )
    : (t("plan.timer.pause") || "Pause");

  return (
    <div className="timer-controls-card" style={controlStyles}>
      <div className="timer-controls flex flex-nowrap items-center justify-center gap-2 sm:gap-3 overflow-x-auto sm:overflow-visible px-1">
        {/* Pause/Resume/Start Button - Primary action */}
        <button
          onClick={handlePauseResume}
          disabled={buttonDisabled}
          className={`control-button pause-resume-button transition-all duration-200 transform hover:scale-105 active:scale-95 ${
            showResumeButton ? 'resume' : 'pause'
          } ${buttonDisabled ? 'is-disabled' : ''}`}
          title={buttonTitle}
          aria-label={buttonTitle}
        >
          <div className="control-inner">
            {showResumeButton ? (
              <Play className="control-icon fill-current" />
            ) : (
              <Pause className="control-icon" />
            )}
          </div>
        </button>

        {/* Stop Button */}
        <button
          onClick={onStop}
          disabled={status === 'idle'}
          className={`control-button stop-button transition-all duration-200 transform hover:scale-105 active:scale-95 ${status === 'idle' ? 'is-disabled' : ''}`}
          title={t("plan.timer.stop") || "Stop"}
          aria-label={t("plan.timer.stop") || "Stop"}
        >
          <div className="control-inner">
            <Square className="control-icon" />
          </div>
        </button>

        {/* Skip Button */}
        <button
          onClick={onSkip}
          disabled={status === 'idle' || status === 'finished' || currentPhase === 'conclusion'}
          className={`control-button skip-button transition-all duration-200 transform hover:scale-105 active:scale-95 ${(status === 'idle' || status === 'finished' || currentPhase === 'conclusion') ? 'is-disabled' : ''}`}
          title={t("plan.timer.skip") || "Skip to next phase"}
          aria-label={t("plan.timer.skip") || "Skip to next phase"}
        >
          <div className="control-inner">
            <SkipForward className="control-icon" />
          </div>
        </button>
      </div>
    </div>
  );
};

export default TimerControls;
