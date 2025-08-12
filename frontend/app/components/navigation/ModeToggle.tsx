'use client';
import React from 'react';

export interface ModeToggleProps {
  currentMode: 'classic' | 'prep';
  onSetMode: (m: 'classic' | 'prep') => void;
  tSwitchToClassic: string;
  tSwitchToPrep: string;
  tPrepLabel: string;
}

const ModeToggle: React.FC<ModeToggleProps> = ({ currentMode, onSetMode, tSwitchToClassic, tSwitchToPrep, tPrepLabel }) => {
  const leftMinWidth = 180;
  const rightMinWidth = 220;
  return (
    <div className="relative inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <span
        className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 transition-transform duration-200 ease-in-out`}
        style={{
          width: currentMode === 'prep' ? rightMinWidth : leftMinWidth,
          transform: currentMode === 'prep' ? `translateX(${leftMinWidth}px)` : 'translateX(0)',
          willChange: 'transform',
        }}
      />
      <button
        type="button"
        onClick={() => currentMode !== 'classic' && onSetMode('classic')}
        aria-pressed={currentMode === 'classic'}
        className={`relative z-10 px-4 py-1.5 text-sm font-semibold leading-5 transition-colors duration-200 ease-in-out rounded-l-full ${currentMode === 'classic' ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}
        style={{ minWidth: leftMinWidth }}
        title={tSwitchToClassic}
        data-testid="toggle-classic"
      >
        {tSwitchToClassic}
      </button>
      <button
        type="button"
        onClick={() => currentMode !== 'prep' && onSetMode('prep')}
        aria-pressed={currentMode === 'prep'}
        className={`relative z-10 px-4 py-1.5 text-sm font-semibold leading-5 transition-colors duration-200 ease-in-out rounded-r-full ${currentMode === 'prep' ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}
        style={{ minWidth: rightMinWidth }}
        title={tSwitchToPrep}
        data-testid="toggle-prep"
      >
        <span className="inline-flex items-center gap-2">
          {tPrepLabel}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors duration-200 ease-in-out ${currentMode === 'prep' ? 'bg-white/15 text-white border-white/30' : 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-800'}`}>beta</span>
        </span>
      </button>
    </div>
  );
};

export default ModeToggle;


