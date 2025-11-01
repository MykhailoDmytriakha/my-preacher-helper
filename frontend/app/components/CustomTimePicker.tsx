"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface CustomTimePickerProps {
  initialHours?: number;
  initialMinutes?: number;
  initialSeconds?: number;
  onConfirm: (hours: number, minutes: number, seconds: number) => void;
  onCancel: () => void;
  onBack?: () => void; // Optional: go back to presets
}

const CustomTimePicker: React.FC<CustomTimePickerProps> = ({
  initialHours = 0,
  initialMinutes = 20,
  initialSeconds = 0,
  onConfirm,
  onCancel,
  onBack
}) => {
  const { t } = useTranslation();

  // Focus management
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [isBackdropActive, setIsBackdropActive] = useState(false);
  const mountTimeRef = useRef<number>(Date.now());
  const closeAttemptsRef = useRef<number>(0);

  const renderId = React.useRef(Math.random().toString(36).substr(2, 9));
  const [hours, setHours] = useState(initialHours);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [seconds, setSeconds] = useState(initialSeconds);

  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);
  const secondsRef = useRef<HTMLDivElement>(null);

  // Generate arrays for scroll wheels
  const hoursArray = Array.from({ length: 24 }, (_, i) => i); // 0-23
  const minutesArray = Array.from({ length: 60 }, (_, i) => i); // 0-59
  const secondsArray = Array.from({ length: 60 }, (_, i) => i); // 0-59

  const ITEM_HEIGHT = 32; // Height of each item in pixels

  // Scroll to center selected value
  const scrollToValue = useCallback((
    ref: React.RefObject<HTMLDivElement | null>,
    value: number
  ) => {
    if (!ref.current) return;
    
    const scrollContainer = ref.current;
    const targetScroll = value * ITEM_HEIGHT;
    
    scrollContainer.scrollTo({
      top: targetScroll,
      behavior: 'smooth'
    });
  }, []);

  // Initialize scroll positions
  useEffect(() => {
    scrollToValue(hoursRef, hours);
    scrollToValue(minutesRef, minutes);
    scrollToValue(secondsRef, seconds);
  }, []); // Only on mount

  // Handle scroll and update selected value
  const handleScroll = useCallback((
    ref: React.RefObject<HTMLDivElement | null>,
    setter: (value: number) => void
  ) => {
    if (!ref.current) return;

    const scrollTop = ref.current.scrollTop;
    const index = Math.round(scrollTop / ITEM_HEIGHT);
    setter(index);
  }, []);

  // Debounced scroll handler
  const createScrollHandler = (
    ref: React.RefObject<HTMLDivElement | null>,
    setter: (value: number) => void
  ) => {
    let timeout: NodeJS.Timeout;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        handleScroll(ref, setter);
        // Snap to nearest value
        if (ref.current) {
          const scrollTop = ref.current.scrollTop;
          const snappedIndex = Math.round(scrollTop / ITEM_HEIGHT);
          scrollToValue(ref, snappedIndex);
        }
      }, 150);
    };
  };

  const hoursScrollHandler = createScrollHandler(hoursRef, setHours);
  const minutesScrollHandler = createScrollHandler(minutesRef, setMinutes);
  const secondsScrollHandler = createScrollHandler(secondsRef, setSeconds);

  // Quick preset buttons
  const presets = [
    { label: '5m', hours: 0, minutes: 5, seconds: 0 },
    { label: '10m', hours: 0, minutes: 10, seconds: 0 },
    { label: '15m', hours: 0, minutes: 15, seconds: 0 },
    { label: '20m', hours: 0, minutes: 20, seconds: 0 },
    { label: '25m', hours: 0, minutes: 25, seconds: 0 },
    { label: '30m', hours: 0, minutes: 30, seconds: 0 }
  ];

  const handlePresetClick = (preset: typeof presets[0]) => {
    setHours(preset.hours);
    setMinutes(preset.minutes);
    setSeconds(preset.seconds);
    scrollToValue(hoursRef, preset.hours);
    scrollToValue(minutesRef, preset.minutes);
    scrollToValue(secondsRef, preset.seconds);
  };

  const handleConfirm = () => {
    onConfirm(hours, minutes, seconds);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  // Format time display
  const formatTime = () => {
    const h = hours.toString().padStart(2, '0');
    const m = minutes.toString().padStart(2, '0');
    const s = seconds.toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // Render wheel item
  const renderWheelItem = (value: number, isSelected: boolean) => (
    <div
      key={value}
      className={`time-picker-item ${isSelected ? 'selected' : ''}`}
      style={{
        height: `${ITEM_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: isSelected ? 600 : 500,
        color: isSelected ? 'rgb(59, 130, 246)' : 'rgb(107, 114, 128)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      {value.toString().padStart(2, '0')}
    </div>
  );

  // Track component mount/unmount lifecycle
  useEffect(() => {
    return () => {
      // Component cleanup
    };
  }, []);

  useEffect(() => {
    // Record mount time to ignore events that happened before mount
    mountTimeRef.current = Date.now();
    // Reset close attempts counter for new modal session
    closeAttemptsRef.current = 0;

    // Global mouse event listeners to track all mouse activity
    const handleGlobalMouseDown = (e: MouseEvent) => {
      // Track global mouse activity
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      // Track global mouse activity
    };

    document.addEventListener('mousedown', handleGlobalMouseDown, true); // Capture phase
    document.addEventListener('mouseup', handleGlobalMouseUp, true); // Capture phase

    // Delay backdrop click handler to prevent immediate close from bubbling click event
    // Increased delay to 300ms for more reliability
    const timer = setTimeout(() => {
      setIsBackdropActive(true);
    }, 300);

    // Focus the confirm button when modal opens
    if (confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }

    // Trap focus within modal
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = dialogRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleTabKey);
      document.removeEventListener('mousedown', handleGlobalMouseDown, true);
      document.removeEventListener('mouseup', handleGlobalMouseUp, true);
    };
  }, []);

  // Render modal

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        const timeSinceMount = Date.now() - mountTimeRef.current;

        // Enable backdrop click to close functionality
        // Close modal when clicking outside the content area
        if (isBackdropActive && e.target === e.currentTarget) {
          onCancel();
          return;
        }
      }}
      onMouseUp={(e) => {
        // Handle mouse up on backdrop
      }}
      onClick={(e) => {
        // Handle click on backdrop
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="time-picker-title"
      aria-describedby="time-picker-description"
    >
      <div
        ref={dialogRef}
        className="time-picker-container bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 sm:mx-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div className="time-picker-header flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="time-picker-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t("plan.selectTime", { defaultValue: "Select Time" })}
          </h2>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Current Time Display */}
        <div className="time-display px-6 py-4 text-center">
          <div 
            className="current-time text-3xl font-mono font-bold text-gray-900 dark:text-white"
            aria-live="polite"
            aria-atomic="true"
          >
            {formatTime()}
          </div>
          <div 
            id="time-picker-description"
            className="time-label text-sm text-gray-500 dark:text-gray-400 mt-1"
          >
            {t("plan.totalDuration", { defaultValue: "Total Duration" })}
          </div>
        </div>

        {/* Scroll Wheels */}
        <div className="wheels-container px-6 py-4">
          <div className="wheels-row flex justify-center items-center gap-4 mb-6">
            {/* Hours Wheel */}
            <div className="wheel-container flex flex-col items-center">
              <label className="wheel-label text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t("common.hours", { defaultValue: "Hours" })}
              </label>
              <div className="wheel relative h-32 w-16 overflow-hidden bg-gray-50 dark:bg-gray-700 rounded-lg touch-pan-y">
                <div className="wheel-selector absolute inset-x-0 top-1/2 h-8 bg-white dark:bg-gray-600 border-y border-gray-200 dark:border-gray-500 transform -translate-y-1/2 pointer-events-none z-10" />
                <div
                  ref={hoursRef}
                  className="wheel-scroll h-full overflow-y-auto scrollbar-hide scroll-smooth"
                  onScroll={hoursScrollHandler}
                  style={{ 
                    scrollSnapType: 'y mandatory',
                    WebkitOverflowScrolling: 'touch'
                  }}
                  role="listbox"
                  aria-label={t("common.hours", { defaultValue: "Hours" })}
                >
                  <div className="wheel-items" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
                    {hoursArray.map((hour) => renderWheelItem(hour, hour === hours))}
                  </div>
                </div>
              </div>
            </div>

            {/* Minutes Wheel */}
            <div className="wheel-container flex flex-col items-center">
              <label className="wheel-label text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t("common.minutes", { defaultValue: "Minutes" })}
              </label>
              <div className="wheel relative h-32 w-16 overflow-hidden bg-gray-50 dark:bg-gray-700 rounded-lg touch-pan-y">
                <div className="wheel-selector absolute inset-x-0 top-1/2 h-8 bg-white dark:bg-gray-600 border-y border-gray-200 dark:border-gray-500 transform -translate-y-1/2 pointer-events-none z-10" />
                <div
                  ref={minutesRef}
                  className="wheel-scroll h-full overflow-y-auto scrollbar-hide scroll-smooth"
                  onScroll={minutesScrollHandler}
                  style={{ 
                    scrollSnapType: 'y mandatory',
                    WebkitOverflowScrolling: 'touch'
                  }}
                  role="listbox"
                  aria-label={t("common.minutes", { defaultValue: "Minutes" })}
                >
                  <div className="wheel-items" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
                    {minutesArray.map((minute) => renderWheelItem(minute, minute === minutes))}
                  </div>
                </div>
              </div>
            </div>

            {/* Seconds Wheel */}
            <div className="wheel-container flex flex-col items-center">
              <label className="wheel-label text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t("common.seconds", { defaultValue: "Seconds" })}
              </label>
              <div className="wheel relative h-32 w-16 overflow-hidden bg-gray-50 dark:bg-gray-700 rounded-lg touch-pan-y">
                <div className="wheel-selector absolute inset-x-0 top-1/2 h-8 bg-white dark:bg-gray-600 border-y border-gray-200 dark:border-gray-500 transform -translate-y-1/2 pointer-events-none z-10" />
                <div
                  ref={secondsRef}
                  className="wheel-scroll h-full overflow-y-auto scrollbar-hide scroll-smooth"
                  onScroll={secondsScrollHandler}
                  style={{ 
                    scrollSnapType: 'y mandatory',
                    WebkitOverflowScrolling: 'touch'
                  }}
                  role="listbox"
                  aria-label={t("common.seconds", { defaultValue: "Seconds" })}
                >
                  <div className="wheel-items" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
                    {secondsArray.map((second) => renderWheelItem(second, second === seconds))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="presets-section mb-4">
            <div className="presets-label text-xs text-gray-500 dark:text-gray-400 mb-2 text-center">
              {t("plan.quickPresets", { defaultValue: "Quick Presets" })}
            </div>
            <div className="presets-row flex justify-center gap-2 flex-wrap">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetClick(preset)}
                  className="preset-button px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          {onBack && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              ← {t("common.back", { defaultValue: "Back" })}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              handleConfirm();
            }}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-label={t("plan.setTimeAndStart", { defaultValue: "Set time and start preaching" })}
          >
            ✓ {t("plan.setTime", { defaultValue: "Set Time" })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomTimePicker;

