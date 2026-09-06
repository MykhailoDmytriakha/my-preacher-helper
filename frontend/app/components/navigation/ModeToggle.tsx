'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
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

const COMPACT_BREAKPOINT = 640;

function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => setIsCompact(window.innerWidth < COMPACT_BREAKPOINT);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return isCompact;
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
  const isCompact = useIsCompact();
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

  if (isCompact) {
    return (
      <Listbox value={currentMode} onChange={(mode) => {
        if (mode !== currentMode) onSetMode(mode);
      }}>
        <ListboxButton className="group relative inline-flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-10 text-sm font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2">
          <span className="truncate">{activeSegment.label}</span>
          {currentMode === 'prep' && <span className="rounded-full border border-white/30 bg-white/15 px-1.5 py-0.5 text-[10px] leading-none">beta</span>}
          <svg aria-hidden="true" className="absolute right-4 h-4 w-4 transition-transform duration-200 group-data-[open]:rotate-180 motion-reduce:transition-none" viewBox="0 0 20 20" fill="none">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ListboxButton>
        <ListboxOptions anchor="bottom" transition modal={false} className="z-50 w-[var(--button-width)] origin-top rounded-2xl border border-gray-200 bg-white p-1 shadow-lg [--anchor-gap:6px] focus:outline-none transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-800">
          {segments.map((segment) => (
            <ListboxOption key={segment.mode} value={segment.mode} disabled={segment.disabled} className="group flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-gray-700 transition-colors data-[focus]:bg-violet-50 data-[selected]:bg-gradient-to-r data-[selected]:from-violet-600 data-[selected]:to-fuchsia-600 data-[selected]:text-white data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 dark:text-gray-200 dark:data-[focus]:bg-gray-700">
              <span className="truncate">{segment.label}</span>
              {segment.mode === 'prep' && <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 text-[10px] leading-none text-fuchsia-700 group-data-[selected]:border-white/30 group-data-[selected]:bg-white/15 group-data-[selected]:text-white dark:border-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">beta</span>}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    );
  }

  return (
    <div
      className="relative inline-flex max-w-full items-center overflow-hidden rounded-full border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
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
            className={`relative z-10 inline-flex h-9 items-center justify-center gap-2 px-4 text-sm font-semibold leading-5 transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-55 ${segment.roundedClass} ${
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
  );
};

export default ModeToggle;
