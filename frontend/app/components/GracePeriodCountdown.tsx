"use client";

import React from 'react';

interface GracePeriodCountdownProps {
    /** Seconds remaining in grace period (3, 2, 1, 0) */
    secondsRemaining: number;
    /** Whether to show the countdown */
    show: boolean;
}

/**
 * Visual countdown overlay for recording grace period.
 * Shows large animated numbers (3, 2, 1) with color transitions.
 * 
 * Color scheme:
 * - 3 seconds: amber (warning)
 * - 2 seconds: orange (caution)
 * - 1 second: rose (stop imminent)
 */
export const GracePeriodCountdown: React.FC<GracePeriodCountdownProps> = ({
    secondsRemaining,
    show,
}) => {
    if (!show || secondsRemaining <= 0) {
        return null;
    }

    // Color based on remaining time (harmonizes with TIMER_CONTROL_COLORS)
    const getColorClass = () => {
        switch (secondsRemaining) {
            case 3: return 'text-amber-500';
            case 2: return 'text-orange-500';
            case 1: return 'text-rose-500';
            default: return 'text-rose-500';
        }
    };

    // Shadow color for glow effect
    const getShadowClass = () => {
        switch (secondsRemaining) {
            case 3: return 'drop-shadow-[0_0_15px_rgba(245,158,11,0.6)]';
            case 2: return 'drop-shadow-[0_0_15px_rgba(249,115,22,0.6)]';
            case 1: return 'drop-shadow-[0_0_15px_rgba(244,63,94,0.7)]';
            default: return 'drop-shadow-[0_0_15px_rgba(244,63,94,0.7)]';
        }
    };

    return (
        <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-lg z-10"
            role="timer"
            aria-label={`Finishing recording in ${secondsRemaining} seconds`}
        >
            {/* Status text */}
            <span className="text-white/80 text-xs font-medium mb-1 animate-pulse">
                Finishing...
            </span>

            {/* Large countdown number with scale animation */}
            <span
                key={secondsRemaining} // Key change triggers animation restart
                className={`
          text-5xl font-bold tabular-nums
          ${getColorClass()}
          ${getShadowClass()}
          animate-countdown-scale
        `}
            >
                {secondsRemaining}
            </span>
        </div>
    );
};

export default GracePeriodCountdown;
