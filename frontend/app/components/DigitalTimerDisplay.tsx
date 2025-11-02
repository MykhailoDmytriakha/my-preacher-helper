"use client";

import React from 'react';
import { useTranslation } from 'react-i18next';

interface DigitalTimerDisplayProps {
  time: string; // formatted as "MM:SS" or "-MM:SS"
  color: string;
  phase: 'introduction' | 'main' | 'conclusion' | 'finished';
  isEmergency?: boolean; // true when less than 1 minute remaining
  animationClass?: string; // CSS class for animations (e.g., blinking)
  onClick?: () => void; // Called when timer display is clicked (for duration change)
  isInteractive?: boolean; // true when timer can be clicked to change duration
}

const DigitalTimerDisplay: React.FC<DigitalTimerDisplayProps> = ({
  time,
  color,
  phase,
  isEmergency = false,
  animationClass = '',
  onClick,
  isInteractive = false,
}) => {
  const { t } = useTranslation();

  // Get phase label
  const getPhaseLabel = (): string => {
    // Show "READY TO START" when timer is at 0:00 and clickable
    if (isInteractive && time === '00:00') {
      return t("plan.timer.readyToStart", { defaultValue: "READY TO START" });
    }
    
    switch (phase) {
      case 'introduction':
        return t("sections.introduction") || "Introduction";
      case 'main':
        return t("sections.main") || "Main Part";
      case 'conclusion':
        return t("sections.conclusion") || "Conclusion";
      case 'finished':
        return t("plan.timer.finished") || "Finished";
      default:
        return '';
    }
  };

  const phaseLabel = getPhaseLabel();

  return (
    <div
      className={`preaching-timer-display ${animationClass}`}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${phaseLabel} phase: ${time} remaining${isEmergency ? ', emergency time remaining' : ''}${isInteractive ? ', click to change duration' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
    >
      <div
        className={`time-display ${isEmergency ? 'emergency pulse-animation' : ''} ${isInteractive ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        style={{
          color: isEmergency ? '#EF4444' : color,
          margin: 0,
          padding: 0,
          lineHeight: 1
        }}
        aria-hidden={isInteractive ? undefined : "true"}
        onClick={isInteractive ? onClick : undefined}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onKeyDown={isInteractive ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        } : undefined}
      >
        {time}
      </div>
    </div>
  );
};

export default DigitalTimerDisplay;
