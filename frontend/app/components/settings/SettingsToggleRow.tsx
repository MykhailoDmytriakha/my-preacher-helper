'use client';

import { useId, type ReactNode } from 'react';

import Switch from '@/components/ui/Switch';

interface SettingsToggleRowProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  loading: boolean;
  testId: string;
  disabled?: boolean;
  children?: ReactNode;
}

/** Shared presentation only; each setting retains its own persistence contract. */
export default function SettingsToggleRow({
  title, description, enabled, onToggle, loading, testId, disabled = false, children,
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
          <Switch
            checked={enabled}
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            disabled={disabled}
            onClick={onToggle}
            data-testid={`${testId}-toggle`}
          />
        </div>
      )}
      {!loading && children}
    </div>
  );
}
