'use client';

import React, { useEffect, useMemo, useState } from 'react';

export type SermonMode = 'prep' | 'classic' | 'raw';

export interface ModeToggleProps {
  currentMode: SermonMode;
  onSetMode: (mode: SermonMode) => void;
  tSwitchToClassic: string;
  tSwitchToPrep: string;
  tPrepLabel: string;
  tClassicLabel?: string;
  tRawLabel?: string;
  tSwitchToRaw?: string;
  canUsePrep?: boolean;
}

const STACK_BREAKPOINT = 560;
const STACKED_BUTTON_HEIGHT = 36;

function useIsStacked() {
  const [isStacked, setIsStacked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => setIsStacked(window.innerWidth < STACK_BREAKPOINT);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return isStacked;
}

const ModeToggle: React.FC<ModeToggleProps> = ({
  currentMode,
  onSetMode,
  tSwitchToClassic,
  tSwitchToPrep,
  tPrepLabel,
  tClassicLabel,
  tRawLabel,
  tSwitchToRaw,
  canUsePrep = true,
}) => {
  const isStacked = useIsStacked();
  const segments = useMemo(
    () => [
      {
        mode: 'prep' as const,
        label: tPrepLabel,
        title: tSwitchToPrep,
        minWidth: 170,
        disabled: !canUsePrep,
        testId: 'toggle-prep',
        roundedClass: 'sm:rounded-l-full',
      },
      {
        mode: 'classic' as const,
        label: tClassicLabel ?? tSwitchToClassic,
        title: tSwitchToClassic,
        minWidth: 150,
        disabled: false,
        testId: 'toggle-classic',
        roundedClass: '',
      },
      {
        mode: 'raw' as const,
        label: tRawLabel ?? tSwitchToRaw ?? 'Наброски',
        title: tSwitchToRaw ?? tRawLabel ?? 'Наброски',
        minWidth: 150,
        disabled: false,
        testId: 'toggle-raw',
        roundedClass: 'sm:rounded-r-full',
      },
    ],
    [canUsePrep, tClassicLabel, tPrepLabel, tRawLabel, tSwitchToClassic, tSwitchToPrep, tSwitchToRaw]
  );
  const activeIndex = Math.max(segments.findIndex((segment) => segment.mode === currentMode), 0);
  const activeSegment = segments[activeIndex];
  const activeOffset = segments
    .slice(0, activeIndex)
    .reduce((total, segment) => total + segment.minWidth, 0);
  const totalWidth = segments.reduce((total, segment) => total + segment.minWidth, 0);

  return (
    <div
      className="relative inline-flex max-w-full flex-col items-stretch overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:rounded-full"
      style={isStacked ? { width: 'min(100%, 18rem)' } : { minWidth: totalWidth }}
    >
      <span
        className="absolute left-0 top-0 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 transition-transform duration-200 ease-in-out sm:inset-y-0 sm:rounded-full"
        style={{
          width: isStacked ? '100%' : activeSegment.minWidth,
          height: isStacked ? STACKED_BUTTON_HEIGHT : undefined,
          transform: isStacked
            ? `translateY(${activeIndex * STACKED_BUTTON_HEIGHT}px)`
            : `translateX(${activeOffset}px)`,
          willChange: 'transform',
        }}
      />
      {segments.map((segment) => {
        const isActive = currentMode === segment.mode;
        return (
          <button
            key={segment.mode}
            type="button"
            onClick={() => {
              if (!segment.disabled && !isActive) onSetMode(segment.mode);
            }}
            aria-pressed={isActive}
            disabled={segment.disabled}
            className={`relative z-10 inline-flex h-9 items-center justify-center gap-2 px-4 text-sm font-semibold leading-5 transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-55 ${segment.roundedClass} ${
              isActive ? 'text-white' : 'text-gray-700 dark:text-gray-200'
            }`}
            style={isStacked ? undefined : { minWidth: segment.minWidth }}
            title={segment.title}
            data-testid={segment.testId}
          >
            <span className="truncate">{segment.label}</span>
            {segment.mode === 'prep' && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-none transition-colors duration-200 ease-in-out ${
                  isActive
                    ? 'border-white/30 bg-white/15 text-white'
                    : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300'
                }`}
              >
                beta
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ModeToggle;
