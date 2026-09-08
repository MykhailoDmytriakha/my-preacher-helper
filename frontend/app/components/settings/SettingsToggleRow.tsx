'use client';

import { useId } from 'react';

interface SettingsToggleRowProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  loading: boolean;
  testId: string;
  disabled?: boolean;
}

/** Shared presentation only; each setting retains its own persistence contract. */
export default function SettingsToggleRow({
  title, description, enabled, onToggle, loading, testId, disabled = false,
}: SettingsToggleRowProps) {
  const id = useId();
  return (
    <div className="border-b border-gray-200 p-4 last:border-b-0 dark:border-gray-700 md:px-6">
      {loading ? (
        <div className="animate-pulse" data-testid={`${testId}-loading`}>
          <div className="mb-4 h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 id={`${id}-title`} className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            <p id={`${id}-description`} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            disabled={disabled}
            onClick={onToggle}
            data-testid={`${testId}-toggle`}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60 ${enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      )}
    </div>
  );
}
