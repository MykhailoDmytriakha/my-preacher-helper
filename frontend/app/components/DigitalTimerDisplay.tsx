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
    >
      <div className="timer-content-wrapper">
        {/* Time Display - Center */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
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

        {/* Phase Indicator - Center */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
          <div className="phase-indicator" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              className="phase-dot"
              style={{ backgroundColor: color }}
            />
            <span className="phase-label" style={{ fontWeight: 600, letterSpacing: '0.05em', margin: 0, padding: 0, lineHeight: 1 }}>
              {phaseLabel}
            </span>
          </div>
          {isEmergency && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#DC2626', padding: '4px 8px', backgroundColor: '#FEF2F2', borderRadius: '6px' }}>
              <svg style={{ width: '14px', height: '14px' }} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Finishing soon!</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DigitalTimerDisplay;
