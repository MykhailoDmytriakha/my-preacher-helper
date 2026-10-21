'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { CrossRefsChip } from '@/components/bible/BookRibbon';
import { saveCrossReferencePrefs, useCrossReferencePrefs, type CrossReferenceMode } from '@/components/bible/crossReferencePrefs';
import { ChoiceButtons, SettingRow } from '@/components/settings/SettingRow';
import Switch from '@/components/ui/Switch';
import { resolveAppLocale } from '@/utils/appLocale';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';

/**
 * CROSS REFERENCES IN THE SETTINGS' "BIBLE" SECTION (the owner, 2026-10-20: out of the reader's "T", which
 * is about the text; then "it is not clear — until a person who knows neither code nor its logic
 * understands it, it doesn't fit"). What they are, and a verse as the reader draws it, its chip following
 * the choices here; then the chips beside verses, also in a passage window or not, what the chip counts,
 * and how the list a chip opens shows the places beyond the main ones — the same choice as the switch in
 * that list. Every row says what the person sees and where; a choice between two things is two words.
 * While the chips are off the rest is dimmed, and a line says why. Kept on this device (`crossReferencePrefs.ts`).
 */

/**
 * The verse the sample shows and the hint for the chip's number counts, with its real numbers — the same
 * in every Bible of the app (a person who looks it up finds what the settings said; a test holds them
 * to the set, `CrossReferenceSettings.test.tsx`).
 */
export const CROSS_REFERENCE_SAMPLE = { book: 'John', chapter: 3, verse: 16, main: 13, total: 92 } as const;

type OthersLook = 'addresses' | 'verses';

export default function CrossReferenceSettings() {
  const { t, i18n } = useTranslation();
  const prefs = useCrossReferencePrefs();
  const id = useId();
  const save = (change: Parameters<typeof saveCrossReferencePrefs>[0]) => saveCrossReferencePrefs(change, 'settings');
  const { book, chapter, verse, main, total } = CROSS_REFERENCE_SAMPLE;
  const place = `${getLocalizedAbbrev(book, resolveAppLocale(i18n.language))} ${chapter}:${verse}`;
  const modes: { value: CrossReferenceMode; label: string }[] = [
    { value: 'main', label: t('settings.bible.crossRefs.countMain') },
    { value: 'all', label: t('settings.bible.crossRefs.countAll') },
  ];
  const looks: { value: OthersLook; label: string }[] = [
    { value: 'addresses', label: t('settings.bible.crossRefs.othersAddresses') },
    { value: 'verses', label: t('settings.bible.crossRefs.othersVerses') },
  ];

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg bg-white shadow dark:bg-gray-800" data-testid="cross-reference-settings">
      <div className="space-y-3 border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-gray-900 dark:text-white md:text-xl">{t('settings.bible.crossRefs.title')}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('settings.bible.crossRefs.intro')}</p>
        {/* The words above say what it is; the sample only shows it, so a screen reader is not read the picture. */}
        <div aria-hidden="true" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900" data-testid="cross-reference-sample">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.bible.crossRefs.sampleCaption', { place })}</p>
          <p className="mt-1 font-serif text-[17px] leading-relaxed text-gray-800 dark:text-gray-100">
            <span className="mr-1.5 font-sans text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500">{verse}</span>
            {t('settings.bible.crossRefs.sampleVerse')}
            {prefs.show ? <>{' '}<CrossRefsChip count={prefs.mode === 'all' ? total : main} testId="cross-reference-sample-chip" /></> : null}
          </p>
        </div>
      </div>

      <SettingRow title={t('settings.bible.crossRefs.marks')} hint={t('settings.bible.crossRefs.marksHint')}>
        {(ids) => (
          <Switch checked={prefs.show} aria-labelledby={ids.name} aria-describedby={ids.hint} onClick={() => save({ show: !prefs.show })} />
        )}
      </SettingRow>
      {prefs.show ? null : (
        <p className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 md:px-6">
          {t('settings.bible.crossRefs.off')}
        </p>
      )}

      <div className={prefs.show ? '' : 'opacity-50'}>
        <SettingRow title={t('settings.bible.crossRefs.inWindow')} hint={t('settings.bible.crossRefs.inWindowHint')}>
          {(ids) => (
            <Switch
              checked={prefs.show && prefs.inWindow}
              disabled={!prefs.show}
              aria-labelledby={ids.name}
              aria-describedby={ids.hint}
              onClick={() => save({ inWindow: !prefs.inWindow })}
            />
          )}
        </SettingRow>
        <SettingRow below title={t('settings.bible.crossRefs.count')} hint={t('settings.bible.crossRefs.countHint', { place, main, total })}>
          {(ids) => <ChoiceButtons ids={ids} choices={modes} value={prefs.mode} disabled={!prefs.show} onPick={(mode) => save({ mode })} />}
        </SettingRow>
        <SettingRow below title={t('settings.bible.crossRefs.others')} hint={t('settings.bible.crossRefs.othersHint', { switch: t('bible.crossRefs.othersAsVerses') })}>
          {(ids) => (
            <ChoiceButtons
              ids={ids}
              choices={looks}
              value={prefs.othersAsVerses ? 'verses' : 'addresses'}
              disabled={!prefs.show}
              onPick={(look) => save({ othersAsVerses: look === 'verses' })}
            />
          )}
        </SettingRow>
      </div>
    </section>
  );
}
