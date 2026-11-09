'use client';

import { BookOpen, CheckCircle, Search, Repeat } from 'lucide-react';
import React from 'react';

import '@locales/i18n';

import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { PreparationTextarea } from './PreparationTextarea';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';

export type TextContextField = 'verse' | 'passageSummary' | 'contextNotes' | 'repeatedWords';
interface TextContextStepContentProps {
  fields?: Partial<Record<TextContextField, PreparationTextBinding>>;
  readWholeBookOnceConfirmed?: boolean;
  onToggleReadWholeBookOnce?: (checked: boolean) => Promise<void> | void;
  confirmationHistory?: React.ReactNode;
}

const TextContextStepContent: React.FC<TextContextStepContentProps> = ({ fields = {}, readWholeBookOnceConfirmed = false, onToggleReadWholeBookOnce, confirmationHistory }) => {
  const { t } = useTranslation();

  return (
    <div id="step-textcontext-panel" className="space-y-3">
      {/* Section 1: Select passage */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.selectPassage')}</h4>
        </div>
        <label htmlFor="passage-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.passageInput.label')}
        </label>
        {fields.verse && <PreparationTextarea binding={fields.verse} id="passage-input" actionsInline autoSize
          label={t('wizard.steps.textContext.passageInput.label')} placeholder={t('wizard.steps.textContext.passageInput.placeholder')} />}
        <p className="mt-2 text-xs text-gray-500">{t('wizard.steps.textContext.passageInput.help')}</p>
      </div>

      {/* Section 1.5: Passage summary in own words */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.passageSummary.title')}</h4>
        </div>
        <label htmlFor="summary-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.passageSummary.label')}
        </label>
        {fields.passageSummary && <PreparationTextarea binding={fields.passageSummary} id="summary-input" rows={3}
          label={t('wizard.steps.textContext.passageSummary.label')} placeholder={t('wizard.steps.textContext.passageSummary.placeholder')} />}
        <p className="mt-2 text-xs text-gray-500">{t('wizard.steps.textContext.passageSummary.help')}</p>
      </div>

      {/* Section 2: Read whole book once */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.readWholeBookOnce')}</h4>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={Boolean(readWholeBookOnceConfirmed)}
            onChange={(e) => onToggleReadWholeBookOnce?.(e.target.checked)}
          />
          <span className="text-sm">{t('wizard.steps.textContext.confirmation.readWholeBookOnce')}</span>
        </label>
        {confirmationHistory}
      </div>

      {/* Section 3: Find context */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.findContext')}</h4>
        </div>
        <label htmlFor="context-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.contextInput.label')}
        </label>
        {fields.contextNotes && <PreparationTextarea binding={fields.contextNotes} id="context-input" rows={4}
          label={t('wizard.steps.textContext.contextInput.label')} placeholder={t('wizard.steps.textContext.contextInput.placeholder')} />}
        <p className="mt-2 text-xs text-gray-500">{t('wizard.steps.textContext.contextInput.help')}</p>
      </div>

      {/* Section 4: Repeated words */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Repeat className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.findRepeatedWords')}</h4>
        </div>
        <label htmlFor="repeated-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.repeatedInput.label')}
        </label>
        {fields.repeatedWords && <PreparationTextarea binding={fields.repeatedWords} id="repeated-input" actionsInline singleLine
          label={t('wizard.steps.textContext.repeatedInput.label')} placeholder={t('wizard.steps.textContext.repeatedInput.placeholder')} />}
        <p className="mt-2 text-xs text-gray-500">{t('wizard.steps.textContext.repeatedInput.help')}</p>
      </div>
    </div>
  );
};

export default TextContextStepContent;
