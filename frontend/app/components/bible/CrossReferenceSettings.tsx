'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import Switch from '@/components/ui/Switch';

import { saveCrossReferencePrefs, useCrossReferencePrefs, type CrossReferenceMode } from './crossReferencePrefs';

/**
 * The cross-reference section of the reader's "T" menu, under the text size: shown or not, also in a
 * passage window or not, the main links or all, and a verse's other links as verses or only references —
 * the same choice as the switch in the window's "others" row. The sub-rows hang under the first and rest
 * while it is off.
 */
export function CrossReferenceSettings() {
  const { t } = useTranslation();
  const prefs = useCrossReferencePrefs();
  const id = useId();
  const modes: CrossReferenceMode[] = ['main', 'all'];

  return (
    <div className="flex flex-col" data-testid="cross-reference-settings">
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0">
          <p id={`${id}-show`} className="text-sm font-semibold text-gray-900 dark:text-white">{t('bible.crossRefs.title')}</p>
          <p id={`${id}-show-hint`} className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{t('bible.crossRefs.hint')}</p>
        </div>
        <Switch
          checked={prefs.show}
          aria-labelledby={`${id}-show`}
          aria-describedby={`${id}-show-hint`}
          onClick={() => saveCrossReferencePrefs({ show: !prefs.show })}
        />
      </div>

      <div className={`ml-1 border-l-2 border-gray-200 pl-3 dark:border-gray-700 ${prefs.show ? '' : 'opacity-50'}`}>
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <p id={`${id}-window`} className="text-sm font-medium text-gray-900 dark:text-white">{t('bible.crossRefs.inWindow')}</p>
            <p id={`${id}-window-hint`} className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{t('bible.crossRefs.inWindowHint')}</p>
          </div>
          <Switch
            checked={prefs.show && prefs.inWindow}
            disabled={!prefs.show}
            aria-labelledby={`${id}-window`}
            aria-describedby={`${id}-window-hint`}
            onClick={() => saveCrossReferencePrefs({ inWindow: !prefs.inWindow })}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-2">
          <p id={`${id}-mode`} className="text-sm font-medium text-gray-900 dark:text-white">{t('bible.crossRefs.show')}</p>
          <div role="group" aria-labelledby={`${id}-mode`} className="flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!prefs.show}
                aria-pressed={prefs.mode === mode}
                onClick={() => saveCrossReferencePrefs({ mode })}
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
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <p id={`${id}-others`} className="text-sm font-medium text-gray-900 dark:text-white">{t('bible.crossRefs.othersAsVersesSetting')}</p>
            <p id={`${id}-others-hint`} className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{t('bible.crossRefs.othersAsVersesHint')}</p>
          </div>
          <Switch
            checked={prefs.othersAsVerses}
            disabled={!prefs.show}
            aria-labelledby={`${id}-others`}
            aria-describedby={`${id}-others-hint`}
            onClick={() => saveCrossReferencePrefs({ othersAsVerses: !prefs.othersAsVerses })}
          />
        </div>
      </div>
    </div>
  );
}
