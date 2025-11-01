"use client";

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Square, SkipForward } from 'lucide-react';

interface TimerControlsProps {
  isRunning: boolean;
  isPaused: boolean;
  status?: 'idle' | 'running' | 'paused' | 'finished';
  currentPhase?: 'introduction' | 'main' | 'conclusion' | 'finished';
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
  onStart,
  onPause,
  onResume,
  onStop,
  onSkip,
}) => {
  const { t } = useTranslation();

  const handlePauseResume = () => {
    if (status === 'idle') {
      // Timer is completely stopped, start it
      onStart?.();
    } else if (isPaused) {
      onResume();
    } else {
      onPause();
    }
  };

  // Determine button state: show play when idle, otherwise normal pause/resume logic
  const showPlayButton = status === 'idle';
  const buttonTitle = showPlayButton
    ? (t("actions.start") || "Start")
    : isPaused
      ? (t("plan.timer.resume") || "Resume")
      : (t("plan.timer.pause") || "Pause");

  return (
    <div className="timer-controls flex items-center gap-3 px-2 rounded-lg bg-gray-100 dark:bg-gray-800">
      {/* Pause/Resume/Start Button - Primary action */}
      <button
        onClick={handlePauseResume}
        disabled={status === 'finished'}
        className={`control-button pause-resume-button transition-all duration-200 transform hover:scale-110 active:scale-95 ${
          showPlayButton ? 'resume' : isPaused ? 'resume' : 'pause'
        } ${status === 'finished' ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={buttonTitle}
        aria-label={buttonTitle}
      >
        {showPlayButton || isPaused ? (
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
