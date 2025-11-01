"use client";

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Square, SkipForward } from 'lucide-react';

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

  // Логика цвета кнопки: зеленая когда нужно выбрать время ИЛИ когда можно начать/продолжить
  const showResumeButton = status === 'idle' || isPaused;

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
    <div className="timer-controls flex items-center gap-3 px-2 rounded-lg bg-gray-100 dark:bg-gray-800">
      {/* Pause/Resume/Start Button - Primary action */}
      <button
        onClick={handlePauseResume}
        disabled={buttonDisabled}
        className={`control-button pause-resume-button transition-all duration-200 transform hover:scale-110 active:scale-95 ${
          showResumeButton ? 'resume' : 'pause'
        } ${buttonDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={buttonTitle}
        aria-label={buttonTitle}
      >
        {showResumeButton ? (
          <Play className="control-icon fill-current" />
        ) : (
          <Pause className="control-icon" />
        )}
      </button>

      {/* Divider */}
      <div className="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>

      {/* Stop Button */}
      <button
        onClick={onStop}
        disabled={status === 'idle'}
        className={`control-button stop-button transition-all duration-200 transform hover:scale-110 active:scale-95 ${status === 'idle' ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={t("plan.timer.stop") || "Stop"}
        aria-label={t("plan.timer.stop") || "Stop"}
      >
        <Square className="control-icon" />
      </button>

      {/* Skip Button */}
      <button
        onClick={onSkip}
        disabled={status === 'idle' || status === 'finished' || currentPhase === 'conclusion'}
        className={`control-button skip-button transition-all duration-200 transform hover:scale-110 active:scale-95 ${(status === 'idle' || status === 'finished' || currentPhase === 'conclusion') ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={t("plan.timer.skip") || "Skip to next phase"}
        aria-label={t("plan.timer.skip") || "Skip to next phase"}
      >
        <SkipForward className="control-icon" />
      </button>
    </div>
  );
};

export default TimerControls;
