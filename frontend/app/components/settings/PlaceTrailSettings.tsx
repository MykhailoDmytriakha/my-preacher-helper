'use client';

import { useTranslation } from 'react-i18next';

import { PlaceTrailSample } from '@/components/bible/PlaceTrail';
import { saveTrailPrefs, useTrailPrefs, type TrailPrefs } from '@/components/bible/placeTrailStore';
import { ChoiceButtons, SettingRow } from '@/components/settings/SettingRow';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { TRAIL_HISTORY_CHOICES, TRAIL_RECENT_CHOICES } from '@/utils/placeTrail';

/*
 * THE TRAIL OF PLACES IN THE SETTINGS (the owner, 2026-10-20: not in the reader's "T", which is about the
 * text; these change rarely): what the trail is, shown as the reader draws it, then how many places it
 * keeps and how many of its last places a move does not repeat — it lights that place instead. Every
 * line is written for a person who knows nothing of how it works (the owner: "if you don't understand it
 * reading it, it doesn't fit"). Kept on this device, like the trail itself (`placeTrailStore.ts`); the
 * reader follows a change at once.
 */

/** The places of the sample: a move along a cross reference and on, as the owner tried it (2026-10-20). */
const SAMPLE_PLACES = [['Isaiah', '19:1'], ['Exodus', '12:12'], ['Joshua', '2:11']] as const;

const asChoices = (numbers: readonly number[]) => numbers.map((number) => ({ value: number, label: String(number) }));

export default function PlaceTrailSettings() {
  const { t, i18n } = useTranslation();
  const prefs = useTrailPrefs();
  const save = (change: Partial<TrailPrefs>) => saveTrailPrefs(change, 'settings');
  const locale = resolveAppLocale(i18n.language);
  return (
    <section aria-labelledby="place-trail-settings" className="rounded-lg bg-white shadow dark:bg-gray-800" data-testid="place-trail-settings">
      <div className="space-y-3 border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
        <h2 id="place-trail-settings" className="text-lg font-semibold text-gray-900 dark:text-white md:text-xl">{t('settings.bible.trail.title')}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('settings.bible.trail.intro')}</p>
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.bible.trail.sampleCaption')}</p>
          <PlaceTrailSample labels={SAMPLE_PLACES.map(([book, place]) => `${getLocalizedAbbrev(book, locale)} ${place}`)} />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.bible.trail.button')}</p>
      </div>
      <SettingRow below title={t('settings.bible.trail.history')} hint={t('settings.bible.trail.historyHint')}>
        {(ids) => <ChoiceButtons ids={ids} choices={asChoices(TRAIL_HISTORY_CHOICES)} value={prefs.history} onPick={(history) => save({ history })} />}
      </SettingRow>
      <SettingRow below title={t('settings.bible.trail.recent')} hint={t('settings.bible.trail.recentHint', { count: prefs.recent })}>
        {(ids) => <ChoiceButtons ids={ids} choices={asChoices(TRAIL_RECENT_CHOICES)} value={prefs.recent} onPick={(recent) => save({ recent })} />}
      </SettingRow>
    </section>
  );
}
