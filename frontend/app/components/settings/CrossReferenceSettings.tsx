'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { saveCrossReferencePrefs, useCrossReferencePrefs, type CrossReferenceMode } from '@/components/bible/crossReferencePrefs';
import Switch from '@/components/ui/Switch';

/**
 * CROSS REFERENCES IN THE SETTINGS' "BIBLE" SECTION (the owner, 2026-10-20: out of the reader's "T", which
 * is about the text): shown or not, also in a passage window or not, the main links or all, and a verse's
 * other links as verses or only references — the same choice as the switch in the window's "others" row.
 * The sub-rows hang under the first and rest while it is off. Kept on this device (`crossReferencePrefs.ts`).
 */
export default function CrossReferenceSettings() {
  const { t } = useTranslation();
  const prefs = useCrossReferencePrefs();
  const id = useId();
  const modes: CrossReferenceMode[] = ['main', 'all'];

  return (
    <section aria-labelledby={`${id}-show`} className="rounded-lg bg-white shadow dark:bg-gray-800" data-testid="cross-reference-settings">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
        <div className="min-w-0">
          <h2 id={`${id}-show`} className="text-lg font-semibold text-gray-900 dark:text-white md:text-xl">{t('bible.crossRefs.title')}</h2>
          <p id={`${id}-show-hint`} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('bible.crossRefs.hint')}</p>
        </div>
        <Switch
          checked={prefs.show}
          aria-labelledby={`${id}-show`}
          aria-describedby={`${id}-show-hint`}
          onClick={() => saveCrossReferencePrefs({ show: !prefs.show }, 'settings')}
        />
      </div>

      <div className={prefs.show ? '' : 'opacity-50'}>
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
          <div className="min-w-0">
            <h3 id={`${id}-window`} className="font-semibold text-gray-900 dark:text-white">{t('bible.crossRefs.inWindow')}</h3>
            <p id={`${id}-window-hint`} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('bible.crossRefs.inWindowHint')}</p>
          </div>
          <Switch
            checked={prefs.show && prefs.inWindow}
            disabled={!prefs.show}
            aria-labelledby={`${id}-window`}
            aria-describedby={`${id}-window-hint`}
            onClick={() => saveCrossReferencePrefs({ inWindow: !prefs.inWindow }, 'settings')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 p-4 dark:border-gray-700 md:px-6">
          <h3 id={`${id}-mode`} className="font-semibold text-gray-900 dark:text-white">{t('bible.crossRefs.show')}</h3>
          <div role="group" aria-labelledby={`${id}-mode`} className="flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!prefs.show}
                aria-pressed={prefs.mode === mode}
                onClick={() => saveCrossReferencePrefs({ mode }, 'settings')}
                className={`min-h-9 rounded-[10px] px-3 text-sm font-semibold transition-colors ${
                  prefs.mode === mode
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-gray-600 enabled:hover:text-gray-900 dark:text-gray-300 dark:enabled:hover:text-white'
                }`}
              >
                {mode === 'main' ? t('bible.crossRefs.main') : t('bible.crossRefs.all')}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 p-4 md:px-6">
          <div className="min-w-0">
            <h3 id={`${id}-others`} className="font-semibold text-gray-900 dark:text-white">{t('bible.crossRefs.othersAsVersesSetting')}</h3>
            <p id={`${id}-others-hint`} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('bible.crossRefs.othersAsVersesHint')}</p>
          </div>
          <Switch
            checked={prefs.othersAsVerses}
            disabled={!prefs.show}
            aria-labelledby={`${id}-others`}
            aria-describedby={`${id}-others-hint`}
            onClick={() => saveCrossReferencePrefs({ othersAsVerses: !prefs.othersAsVerses }, 'settings')}
          />
        </div>
      </div>
    </section>
  );
}
