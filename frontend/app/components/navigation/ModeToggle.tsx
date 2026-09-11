'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  compactBreakpoint?: number;
}

const COMPACT_BREAKPOINT = 640;

function useIsCompact(breakpoint: number, expandedWidth: number) {
  const [isCompact, setIsCompact] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => {
      const available = containerRef.current?.clientWidth ?? 0;
      setIsCompact(window.innerWidth < breakpoint || (available > 0 && available < expandedWidth));
    };
    sync();
    window.addEventListener('resize', sync);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    if (containerRef.current) observer?.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', sync);
      observer?.disconnect();
    };
  }, [breakpoint, expandedWidth]);

  return { isCompact, containerRef };
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
  compactBreakpoint = COMPACT_BREAKPOINT,
}) => {
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
        label: tRawLabel ?? tSwitchToRaw ?? 'Scratch notes',
        title: tSwitchToRaw ?? tRawLabel ?? 'Scratch notes',
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
  const { isCompact, containerRef } = useIsCompact(compactBreakpoint, totalWidth + 2);

  return (
    <div ref={containerRef} className="flex w-full min-w-0 justify-center">
      {isCompact ? (
        <Listbox value={currentMode} onChange={(mode) => {
          if (mode !== currentMode) onSetMode(mode);
        }}>
          <ListboxButton className="group relative inline-flex h-12 w-full max-w-xs items-center justify-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 pl-3 pr-8 text-sm font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2">
            <span className="truncate">{activeSegment.label}</span>
            {currentMode === 'prep' && <span className="rounded-full border border-white/30 bg-white/15 px-1.5 py-0.5 text-[10px] leading-none">beta</span>}
            <svg aria-hidden="true" className="absolute right-3 h-4 w-4 transition-transform duration-200 group-data-[open]:rotate-180 motion-reduce:transition-none" viewBox="0 0 20 20" fill="none">
              <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ListboxButton>
          <ListboxOptions anchor="bottom" transition modal={false} className="z-50 w-[var(--button-width)] origin-top rounded-[28px] border border-gray-200 bg-white p-1 shadow-lg [--anchor-gap:6px] focus:outline-none transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-800">
            {segments.map((segment) => (
              <ListboxOption key={segment.mode} value={segment.mode} disabled={segment.disabled} className="group flex h-12 cursor-pointer items-center justify-center gap-1 rounded-full px-4 text-sm font-semibold text-gray-700 transition-colors data-[focus]:bg-violet-50 data-[selected]:bg-gradient-to-r data-[selected]:from-violet-600 data-[selected]:to-fuchsia-600 data-[selected]:text-white data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 dark:text-gray-200 dark:data-[focus]:bg-gray-700">
                <span className="truncate">{segment.label}</span>
                {segment.mode === 'prep' && <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 text-[10px] leading-none text-fuchsia-700 group-data-[selected]:border-white/30 group-data-[selected]:bg-white/15 group-data-[selected]:text-white dark:border-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">beta</span>}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </Listbox>
      ) : (
        <div
          className="relative inline-flex h-12 max-w-full items-center overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-inset ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
          style={{ minWidth: totalWidth }}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 transition-transform duration-200 ease-in-out"
            style={{
              width: activeSegment.minWidth,
              transform: `translateX(${activeOffset}px)`,
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
                className={`relative z-10 inline-flex h-12 items-center justify-center gap-1 px-4 text-sm font-semibold leading-5 transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-55 ${segment.roundedClass} ${
                  isActive ? 'text-white' : 'text-gray-700 dark:text-gray-200'
                }`}
                style={{ minWidth: segment.minWidth }}
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
      )}
    </div>
  );
};

export default ModeToggle;
