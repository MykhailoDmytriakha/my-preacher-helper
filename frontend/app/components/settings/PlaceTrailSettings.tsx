'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { saveTrailPrefs, useTrailPrefs, type TrailPrefs } from '@/components/bible/placeTrailStore';
import { TRAIL_HISTORY_CHOICES, TRAIL_RECENT_CHOICES } from '@/utils/placeTrail';

/*
 * THE TRAIL OF PLACES IN THE SETTINGS (the owner, 2026-10-20: not in the reader's "T", which is about the
 * text; these change rarely): how many places the trail keeps and how many of the last ones are recent —
 * a move to a recent place lights its link instead of adding one. Kept on this device, like the trail
 * itself (`components/bible/placeTrailStore.ts`); the reader follows a change at once.
 */
function Choice({ name, hint, value, choices, onPick }: {
  name: string; hint: string; value: number; choices: readonly number[]; onPick: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 p-4 last:border-b-0 dark:border-gray-700 md:px-6">
      <div className="min-w-0 flex-1 basis-56">
        <h3 id={`${id}-name`} className="font-semibold text-gray-900 dark:text-white">{name}</h3>
        <p id={`${id}-hint`} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{hint}</p>
      </div>
      <div role="group" aria-labelledby={`${id}-name`} aria-describedby={`${id}-hint`} className="flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={value === choice}
            onClick={() => onPick(choice)}
            className={`min-h-9 min-w-11 rounded-[10px] px-3 text-sm font-semibold tabular-nums transition-colors ${
              value === choice
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
            }`}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PlaceTrailSettings() {
  const { t } = useTranslation();
  const prefs = useTrailPrefs();
  const save = (change: Partial<TrailPrefs>) => saveTrailPrefs(change, 'settings');
  return (
    <section aria-labelledby="place-trail-settings" className="rounded-lg bg-white shadow dark:bg-gray-800" data-testid="place-trail-settings">
      <div className="border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
        <h2 id="place-trail-settings" className="text-lg font-semibold text-gray-900 dark:text-white md:text-xl">{t('settings.bible.trail.title')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('settings.bible.trail.description')}</p>
      </div>
      <Choice
        name={t('settings.bible.trail.history')}
        hint={t('settings.bible.trail.historyHint')}
        value={prefs.history}
        choices={TRAIL_HISTORY_CHOICES}
        onPick={(history) => save({ history })}
      />
      <Choice
        name={t('settings.bible.trail.recent')}
        hint={t('settings.bible.trail.recentHint')}
        value={prefs.recent}
        choices={TRAIL_RECENT_CHOICES}
        onPick={(recent) => save({ recent })}
      />
    </section>
  );
}
