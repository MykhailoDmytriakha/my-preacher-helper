'use client';

import { useId, type ReactNode } from 'react';

/*
 * A ROW OF A SETTINGS CARD (Settings → Bible): what the setting is and what it does, then its control —
 * a switch on the right of the words, a choice of a few answers (`below`) always under them, so every such
 * row looks the same and its words keep the card's width whatever their length. The control gets the
 * row's ids, so a screen reader names it by the row's title and reads its hint.
 */
export function SettingRow({ title, hint, below = false, children }: {
  title: string; hint: string; below?: boolean; children: (ids: { name: string; hint: string }) => ReactNode;
}) {
  const id = useId();
  const ids = { name: `${id}-name`, hint: `${id}-hint` };
  const words = (
    <div className="min-w-0 flex-1">
      <h3 id={ids.name} className="font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p id={ids.hint} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{hint}</p>
    </div>
  );
  return below ? (
    <div className="space-y-3 border-b border-gray-200 p-4 last:border-b-0 dark:border-gray-700 md:px-6">
      {words}
      {children(ids)}
    </div>
  ) : (
    <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-4 last:border-b-0 dark:border-gray-700 md:px-6">
      {words}
      {children(ids)}
    </div>
  );
}

/** One of a few answers, each a word or a number on its own button; the chosen one stands pressed. */
export function ChoiceButtons<T extends string | number>({ ids, choices, value, disabled = false, onPick }: {
  ids: { name: string; hint: string };
  choices: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div role="group" aria-labelledby={ids.name} aria-describedby={ids.hint} className="inline-flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-900">
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === choice.value}
          onClick={() => onPick(choice.value)}
          className={`min-h-9 min-w-11 rounded-[10px] px-3 text-sm font-semibold tabular-nums transition-colors ${
            value === choice.value
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-600 enabled:hover:text-gray-900 dark:text-gray-300 dark:enabled:hover:text-white'
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
