'use client';

import { BookOpen, Sparkles, Wrench, AlertTriangle } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { UI_COLORS } from '@/utils/themeColors';

import type { Preparation } from '@/models/models';

interface SpiritualStepContentProps {
  prepDraft: Preparation;
  setPrepDraft: (p: Preparation) => void;
  savePreparation: (p: Preparation) => void | Promise<void>;
  formatSuperscriptVerses: (text: string) => string;
}

const SpiritualStepContent: React.FC<SpiritualStepContentProps> = ({
  prepDraft,
  setPrepDraft,
  savePreparation,
  formatSuperscriptVerses,
}) => {
  const { t } = useTranslation();
  return (
    <div className={`space-y-3 relative rounded-xl transition-all duration-700 ${!prepDraft?.spiritual?.readAndPrayedConfirmed
      ? 'p-4 border-2 border-red-200 dark:border-red-900/30'
      : 'p-0 border-0'
      }`}>
      {/* Outer pulsing beacon border */}
      {!prepDraft?.spiritual?.readAndPrayedConfirmed && (
        <div className="absolute inset-0 rounded-xl border-4 border-red-500/20 dark:border-red-500/10 animate-pulse pointer-events-none shadow-[0_0_30px_rgba(239,68,68,0.15)] z-0" />
      )}

      <div className="relative z-10 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <span className="text-gray-700 dark:text-gray-300">{t('wizard.steps.spiritual.readFirst')}</span>
        </div>
        <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
          <div
            className="text-sm whitespace-pre-line leading-6 text-gray-800 dark:text-gray-100"
            // The reading in the interface language (ru Synodal, en KJV, uk Ohienko), with its key
            // verses underlined in the locale text itself; the text is ours, never a person's input.
            dangerouslySetInnerHTML={{ __html: formatSuperscriptVerses(t('wizard.steps.spiritual.passage')) }}
          />
        </div>

        <div className="mt-4">
          <h3 className="text-base font-semibold">{t('wizard.steps.spiritual.title')}</h3>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                <h4 className="text-sm font-semibold">{t('wizard.steps.spiritual.spiritualSide.title')}</h4>
              </div>
              <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                <li>
                  {t('wizard.steps.spiritual.spiritualSide.nehemiahRef')}: &ldquo;
                  <sup className="text-gray-300 dark:text-gray-800">8</sup>
                  {' '}{t('wizard.steps.spiritual.spiritualSide.nehemiahText')}&rdquo;
                </li>
                <li>{t('wizard.steps.spiritual.spiritualSide.spirit')}</li>
                <li>
                  {t('wizard.steps.spiritual.spiritualSide.word')}
                  <div className="mt-1 ml-4">
                    <div className="text-[13px] text-gray-700 dark:text-gray-300">{t('wizard.steps.spiritual.spiritualSide.wordWhy')}</div>
                  </div>
                </li>
                <li>{t('wizard.steps.spiritual.spiritualSide.afterSermon')}</li>
                <li>
                  {t('wizard.steps.spiritual.spiritualSide.effect')}
                  <div className="mt-1 ml-4">
                    <div className="text-[13px] text-gray-700 dark:text-gray-300">{t('wizard.steps.spiritual.spiritualSide.effectWhy')}</div>
                  </div>
                </li>
              </ul>
            </div>
            <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                <h4 className="text-sm font-semibold">{t('wizard.steps.spiritual.technicalSide.title')}</h4>
              </div>
              <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
                <li>{t('wizard.steps.spiritual.technicalSide.director')}</li>
                <li>{t('wizard.steps.spiritual.technicalSide.waiter')}</li>
              </ul>
            </div>
          </div>
        </div>

        <div
          className={`mt-6 transition-all duration-500 ease-in-out rounded-xl overflow-hidden ${!prepDraft?.spiritual?.readAndPrayedConfirmed
            ? `p-6 border-l-8 border-red-500 bg-red-50 dark:bg-red-900/20 shadow-[0_0_30px_rgba(239,68,68,0.15)] animate-pulse`
            : `p-4 border-l-4 border-green-500 bg-gray-50 dark:bg-gray-800/50`
            }`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {!prepDraft?.spiritual?.readAndPrayedConfirmed ? (
                <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
              ) : (
                <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
              )}

              <h3 className={`font-bold transition-all ${!prepDraft?.spiritual?.readAndPrayedConfirmed
                ? 'text-2xl text-red-700 dark:text-red-300 uppercase tracking-wide'
                : 'text-base text-gray-700 dark:text-gray-300'
                }`}>
                {t('wizard.steps.spiritual.prayer.title')}
              </h3>
            </div>

            {!prepDraft?.spiritual?.readAndPrayedConfirmed && (
              <p className="text-red-800 dark:text-red-200 font-semibold text-lg ml-1">
                {t('wizard.steps.spiritual.prayer.mustNotSkip')}
              </p>
            )}

            <div className="flex items-center gap-4 mt-2">
              <input
                id="readAndPrayed"
                type="checkbox"
                className={`cursor-pointer transition-all ${!prepDraft?.spiritual?.readAndPrayedConfirmed
                  ? 'w-6 h-6 accent-red-600 hover:accent-red-700 scale-125'
                  : 'w-5 h-5 accent-green-600'
                  }`}
                checked={Boolean(prepDraft?.spiritual?.readAndPrayedConfirmed)}
                onChange={(e) => {
                  const next: Preparation = {
                    ...prepDraft,
                    spiritual: { ...(prepDraft.spiritual ?? {}), readAndPrayedConfirmed: e.target.checked },
                  };
                  setPrepDraft(next);
                  savePreparation(next);
                }}
              />
              <label
                htmlFor="readAndPrayed"
                className={`cursor-pointer select-none transition-all ${!prepDraft?.spiritual?.readAndPrayedConfirmed
                  ? 'text-xl font-bold text-red-900 dark:text-red-100 underline decoration-red-400 underline-offset-4'
                  : 'text-sm text-gray-500 dark:text-gray-400 line-through decoration-green-500/50'
                  }`}
              >
                {prepDraft?.spiritual?.readAndPrayedConfirmed ? t('wizard.steps.spiritual.prayer.done') : t('wizard.steps.spiritual.prayer.mark')}
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


export default SpiritualStepContent;
