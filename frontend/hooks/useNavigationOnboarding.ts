import { useState, useEffect } from 'react';

const ONBOARDING_KEY = 'triz_navigation_onboarding';
const GESTURE_COUNT_KEY = 'triz_gesture_count';
const REQUIRED_GESTURES = 3;

interface OnboardingState {
    showTooltip: boolean;
    showEscapeButton: boolean;
    gestureCount: number;
    markTooltipShown: () => void;
    incrementGestureCount: () => void;
    resetEscapeTimer: () => void;
}

export const useNavigationOnboarding = (): OnboardingState => {
    const [showTooltip, setShowTooltip] = useState(false);
    const [showEscapeButton, setShowEscapeButton] = useState(false);
    const [gestureCount, setGestureCount] = useState(0);

    useEffect(() => {
        // Check if first-time user
        const hasSeenOnboarding = localStorage.getItem(ONBOARDING_KEY);
        const savedGestureCount = parseInt(
            localStorage.getItem(GESTURE_COUNT_KEY) || '0',
            10
        );

        setGestureCount(savedGestureCount);

        if (!hasSeenOnboarding) {
            // Show tooltip for first-time users
            setShowTooltip(true);

            // Auto-hide tooltip after 3 seconds
            const timer = setTimeout(() => {
                setShowTooltip(false);
                localStorage.setItem(ONBOARDING_KEY, 'true');
            }, 3000);

            return () => clearTimeout(timer);
        }

        // Show escape button after 30 seconds if user hasn't mastered gestures
        if (savedGestureCount < REQUIRED_GESTURES) {
            const escapeTimer = setTimeout(() => {
                setShowEscapeButton(true);
            }, 30000); // 30 seconds

            return () => clearTimeout(escapeTimer);
        }
    }, []);

    const markTooltipShown = () => {
        setShowTooltip(false);
        localStorage.setItem(ONBOARDING_KEY, 'true');
    };

    const incrementGestureCount = () => {
        const newCount = gestureCount + 1;
        setGestureCount(newCount);
        localStorage.setItem(GESTURE_COUNT_KEY, newCount.toString());

        // Hide escape button after user learns gestures
        if (newCount >= REQUIRED_GESTURES) {
            setShowEscapeButton(false);
        }

        // Hide tooltip on first gesture
        if (showTooltip) {
            markTooltipShown();
        }
    };

    const resetEscapeTimer = () => {
        setShowEscapeButton(false);
    };

    return {
        showTooltip,
        showEscapeButton,
        gestureCount,
        markTooltipShown,
        incrementGestureCount,
        resetEscapeTimer,
    };
};
