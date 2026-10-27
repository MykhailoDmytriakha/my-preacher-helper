'use client';

import { Lightbulb, BookText, ListChecks } from 'lucide-react';
import React from 'react';

import '@locales/i18n';

import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { PreparationTextarea } from './PreparationTextarea';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';

interface MainIdeaStepContentProps {
  contextIdea?: PreparationTextBinding;
  textIdea?: PreparationTextBinding;
  argumentation?: PreparationTextBinding;
}

const MainIdeaStepContent: React.FC<MainIdeaStepContentProps> = ({ contextIdea, textIdea, argumentation }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {/* Context main idea */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <BookText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.contextIdea.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm mb-3">
          <li>{t('wizard.steps.mainIdea.contextIdea.instruction')}</li>
        </ul>
        
        {contextIdea && <PreparationTextarea binding={contextIdea} placeholder={t('wizard.steps.mainIdea.contextIdea.placeholder')} />}
      </div>

      {/* Text main idea */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.textIdea.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm mb-3">
          <li>{t('wizard.steps.mainIdea.textIdea.instruction1')}</li>
          <li>{t('wizard.steps.mainIdea.textIdea.instruction2')}</li>
        </ul>
        
        {textIdea && <PreparationTextarea binding={textIdea} placeholder={t('wizard.steps.mainIdea.textIdea.placeholder')} />}
        
        {/* Note moved inside text main idea section */}
        <div className={`mt-3 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
          <div className="flex items-center gap-2 mb-1">
            <h5 className="text-sm font-semibold">{t('wizard.steps.mainIdea.note.title')}</h5>
          </div>
          <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
            <li>{t('wizard.steps.mainIdea.note.text')}</li>
          </ul>
        </div>
      </div>

      {/* Argumentation */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.argumentation.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm mb-3">
          <li>{t('wizard.steps.mainIdea.argumentation.instruction')}</li>
        </ul>
        
        {argumentation && <PreparationTextarea binding={argumentation} placeholder={t('wizard.steps.mainIdea.argumentation.placeholder')} />}
      </div>
    </div>
  );
};

export default MainIdeaStepContent;


