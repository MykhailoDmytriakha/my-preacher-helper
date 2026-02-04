"use client";

import { X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TimerPhaseDurations } from '@/types/TimerState';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

const TRANSLATION_KEYS = {
  HOURS: 'common.hours',
  MINUTES: 'common.minutes',
  SECONDS: 'common.seconds',
} as const;

type PhaseKey = 'introduction' | 'main' | 'conclusion';

interface SectionTimePickerProps {
  initialDurations: TimerPhaseDurations;
  onConfirm: (durations: TimerPhaseDurations) => void;
  onCancel: () => void;
  onBack?: () => void;
}

const SectionTimePicker: React.FC<SectionTimePickerProps> = ({
  initialDurations,
  onConfirm,
  onCancel,
  onBack
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const [activePhase, setActivePhase] = useState<PhaseKey>('introduction');
  const [phaseDurations, setPhaseDurations] = useState<TimerPhaseDurations>({
    introduction: initialDurations.introduction,
    main: initialDurations.main,
    conclusion: initialDurations.conclusion
  });

  const [timeParts, setTimeParts] = useState({
    hours: Math.floor(initialDurations.introduction / 3600),
    minutes: Math.floor((initialDurations.introduction % 3600) / 60),
    seconds: initialDurations.introduction % 60
  });

  const { hours, minutes, seconds } = timeParts;

  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);
  const secondsRef = useRef<HTMLDivElement>(null);

  const hoursArray = Array.from({ length: 24 }, (_, i) => i);
  const minutesArray = Array.from({ length: 60 }, (_, i) => i);
  const secondsArray = Array.from({ length: 60 }, (_, i) => i);

  const ITEM_HEIGHT = 32;
  const SCROLL_SNAP_TYPE = 'y mandatory';
  const WEBKIT_OVERFLOW_SCROLLING = 'touch';

  const scrollToValue = useCallback((ref: React.RefObject<HTMLDivElement | null>, value: number) => {
    if (!ref.current) return;
    ref.current.scrollTo({ top: value * ITEM_HEIGHT, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const phaseSeconds = phaseDurations[activePhase];
    const nextHours = Math.floor(phaseSeconds / 3600);
    const nextMinutes = Math.floor((phaseSeconds % 3600) / 60);
    const nextSeconds = phaseSeconds % 60;

    setTimeParts(prev => {
      if (
        prev.hours === nextHours &&
        prev.minutes === nextMinutes &&
        prev.seconds === nextSeconds
      ) {
        return prev;
      }
      return { hours: nextHours, minutes: nextMinutes, seconds: nextSeconds };
    });
  }, [activePhase, phaseDurations]);

  useEffect(() => {
    scrollToValue(hoursRef, hours);
    scrollToValue(minutesRef, minutes);
    scrollToValue(secondsRef, seconds);
  }, [hours, minutes, seconds, scrollToValue]);

  useEffect(() => {
    if (confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, []);

  const handleConfirm = () => {
    onConfirm(phaseDurations);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  const createScrollHandler = (
    ref: React.RefObject<HTMLDivElement | null>,
    key: 'hours' | 'minutes' | 'seconds'
  ) => {
    let timeout: NodeJS.Timeout;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!ref.current) return;
        const scrollTop = ref.current.scrollTop;
        const index = Math.round(scrollTop / ITEM_HEIGHT);
        setTimeParts(prev => {
          if (prev[key] === index) {
            return prev;
          }
          const next = { ...prev, [key]: index };
          const totalSeconds = next.hours * 3600 + next.minutes * 60 + next.seconds;
          setPhaseDurations(prevDurations => ({
            ...prevDurations,
            [activePhase]: totalSeconds
          }));
          return next;
        });
        scrollToValue(ref, index);
      }, 150);
    };
  };

  const hoursScrollHandler = createScrollHandler(hoursRef, 'hours');
  const minutesScrollHandler = createScrollHandler(minutesRef, 'minutes');
  const secondsScrollHandler = createScrollHandler(secondsRef, 'seconds');

  const formatTime = (total: number): string => {
    const h = Math.floor(total / 3600).toString().padStart(2, '0');
    const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handlePresetSelect = (totalSeconds: number) => {
    const nextHours = Math.floor(totalSeconds / 3600);
    const nextMinutes = Math.floor((totalSeconds % 3600) / 60);
    const nextSeconds = totalSeconds % 60;

    setTimeParts({
      hours: nextHours,
      minutes: nextMinutes,
      seconds: nextSeconds
    });

    setPhaseDurations(prev => {
      if (prev[activePhase] === totalSeconds) {
        return prev;
      }
      return {
        ...prev,
        [activePhase]: totalSeconds
      };
    });
  };

  const totalSeconds = phaseDurations.introduction + phaseDurations.main + phaseDurations.conclusion;
  const activeThemeKey = activePhase === 'main' ? 'mainPart' : activePhase;
  const activeTheme = SERMON_SECTION_COLORS[activeThemeKey];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-time-picker-title"
      aria-describedby="section-time-picker-description"
    >
      <div
        ref={dialogRef}
        className="time-picker-container bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 sm:mx-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="time-picker-header flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="section-time-picker-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t('plan.timePicker.sectionsTitle', { defaultValue: 'Section times' })}
          </h2>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="flex gap-2 mb-4" role="tablist" aria-label={t('plan.timePicker.sectionsTitle', { defaultValue: 'Section times' })}>
            {(['introduction', 'main', 'conclusion'] as PhaseKey[]).map((phase) => {
              const themeKey = phase === 'main' ? 'mainPart' : phase;
              const theme = SERMON_SECTION_COLORS[themeKey];
              const isActive = activePhase === phase;
              const baseClasses = `${theme.border} dark:${theme.darkBorder} ${theme.text} dark:${theme.darkText}`;
              const activeClasses = `${theme.bg} dark:${theme.darkBg} font-semibold`;
              const inactiveClasses = `bg-white dark:bg-gray-800 ${theme.hover} dark:${theme.darkHover}`;

              return (
              <button
                key={phase}
                type="button"
                onClick={() => setActivePhase(phase)}
                className={`flex-1 px-3 py-2 text-sm rounded-md border transition-colors flex flex-col items-center gap-1 ${baseClasses} ${
                  isActive ? activeClasses : inactiveClasses
                }`}
              >
                <span className="leading-tight">{t(`sections.${phase}`)}</span>
                <span className="text-xs leading-none opacity-70">
                  {formatTime(phaseDurations[phase])}
                </span>
              </button>
              );
            })}
          </div>

          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              {t('plan.timePicker.presets', { defaultValue: 'Quick presets' })}
            </div>
            <div className="flex flex-col gap-2">
              {[
                [
                  { label: '30s', seconds: 30 },
                  { label: '1m', seconds: 60 },
                  { label: '2m', seconds: 120 },
                  { label: '3m', seconds: 180 },
                  { label: '4m', seconds: 240 },
                  { label: '5m', seconds: 300 },
                ],
                [
                  { label: '10m', seconds: 600 },
                  { label: '15m', seconds: 900 },
                  { label: '20m', seconds: 1200 },
                  { label: '25m', seconds: 1500 },
                  { label: '30m', seconds: 1800 },
                ],
              ].map((row, rowIndex) => (
                <div key={`preset-row-${rowIndex}`} className="flex gap-2">
                  {row.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handlePresetSelect(preset.seconds)}
                      className={`flex-1 px-2 py-2 text-xs sm:text-sm font-semibold rounded-md border transition-colors ${activeTheme.border} dark:${activeTheme.darkBorder} ${activeTheme.text} dark:${activeTheme.darkText} ${activeTheme.hover} dark:${activeTheme.darkHover} bg-white dark:bg-gray-800`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="time-display text-center mb-4" aria-live="polite" aria-atomic="true">
            <div className="current-time text-3xl font-mono font-bold text-gray-900 dark:text-white">
              {formatTime(hours * 3600 + minutes * 60 + seconds)}
            </div>
            <div id="section-time-picker-description" className="time-label text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('plan.timePicker.totalSum', { defaultValue: 'Total' })}: {formatTime(totalSeconds)}
            </div>
          </div>
        </div>

        <div className="wheels-container px-6 py-4">
          <div className="wheels-row flex justify-center items-center gap-4 mb-6">
            <div className="wheel-container flex flex-col items-center">
              <label className="wheel-label text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t(TRANSLATION_KEYS.HOURS, { defaultValue: 'Hours' })}
              </label>
              <div className="wheel relative h-32 w-16 overflow-hidden bg-gray-50 dark:bg-gray-700 rounded-lg touch-pan-y">
                <div className="wheel-selector absolute inset-x-0 top-1/2 h-8 bg-white dark:bg-gray-600 border-y border-gray-200 dark:border-gray-500 transform -translate-y-1/2 pointer-events-none z-10" />
                <div
                  ref={hoursRef}
                  className="wheel-scroll h-full overflow-y-auto scrollbar-hide scroll-smooth"
                  onScroll={hoursScrollHandler}
                  style={{ scrollSnapType: SCROLL_SNAP_TYPE, WebkitOverflowScrolling: WEBKIT_OVERFLOW_SCROLLING }}
                  role="listbox"
                  aria-label={t('common.hours', { defaultValue: 'Hours' })}
                >
                  <div className="wheel-items" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
                    {hoursArray.map((hour) => (
                      <div
                        key={hour}
                        className={`time-picker-item ${hour === hours ? 'selected' : ''}`}
                        style={{ height: `${ITEM_HEIGHT}px` }}
                      >
                        {hour.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="wheel-container flex flex-col items-center">
              <label className="wheel-label text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t(TRANSLATION_KEYS.MINUTES, { defaultValue: 'Minutes' })}
              </label>
              <div className="wheel relative h-32 w-16 overflow-hidden bg-gray-50 dark:bg-gray-700 rounded-lg touch-pan-y">
                <div className="wheel-selector absolute inset-x-0 top-1/2 h-8 bg-white dark:bg-gray-600 border-y border-gray-200 dark:border-gray-500 transform -translate-y-1/2 pointer-events-none z-10" />
                <div
                  ref={minutesRef}
                  className="wheel-scroll h-full overflow-y-auto scrollbar-hide scroll-smooth"
                  onScroll={minutesScrollHandler}
                  style={{ scrollSnapType: SCROLL_SNAP_TYPE, WebkitOverflowScrolling: WEBKIT_OVERFLOW_SCROLLING }}
                  role="listbox"
                  aria-label={t('common.minutes', { defaultValue: 'Minutes' })}
                >
                  <div className="wheel-items" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
                    {minutesArray.map((minute) => (
                      <div
                        key={minute}
                        className={`time-picker-item ${minute === minutes ? 'selected' : ''}`}
                        style={{ height: `${ITEM_HEIGHT}px` }}
                      >
                        {minute.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="wheel-container flex flex-col items-center">
              <label className="wheel-label text-xs text-gray-500 dark:text-gray-400 mb-2">
                {t(TRANSLATION_KEYS.SECONDS, { defaultValue: 'Seconds' })}
              </label>
              <div className="wheel relative h-32 w-16 overflow-hidden bg-gray-50 dark:bg-gray-700 rounded-lg touch-pan-y">
                <div className="wheel-selector absolute inset-x-0 top-1/2 h-8 bg-white dark:bg-gray-600 border-y border-gray-200 dark:border-gray-500 transform -translate-y-1/2 pointer-events-none z-10" />
                <div
                  ref={secondsRef}
                  className="wheel-scroll h-full overflow-y-auto scrollbar-hide scroll-smooth"
                  onScroll={secondsScrollHandler}
                  style={{ scrollSnapType: SCROLL_SNAP_TYPE, WebkitOverflowScrolling: WEBKIT_OVERFLOW_SCROLLING }}
                  role="listbox"
                  aria-label={t('common.seconds', { defaultValue: 'Seconds' })}
                >
                  <div className="wheel-items" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
                    {secondsArray.map((second) => (
                      <div
                        key={second}
                        className={`time-picker-item ${second === seconds ? 'selected' : ''}`}
                        style={{ height: `${ITEM_HEIGHT}px` }}
                      >
                        {second.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="action-buttons flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          {onBack && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              ← {t('common.back', { defaultValue: 'Back' })}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              handleConfirm();
            }}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            ✓ {t('plan.setTime', { defaultValue: 'Set Time' })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SectionTimePicker;
