'use client';

import React from 'react';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import { Lightbulb, Info, BookText, ListChecks } from 'lucide-react';

const MainIdeaStepContent: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {/* Title is shown by PrepStepCard. First card: note */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Info className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.note.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
          <li>{t('wizard.steps.mainIdea.note.text')}</li>
        </ul>
      </div>

      {/* Context main idea */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <BookText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.contextIdea.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
          <li>{t('wizard.steps.mainIdea.contextIdea.instruction')}</li>
        </ul>
      </div>

      {/* Text main idea */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.textIdea.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
          <li>{t('wizard.steps.mainIdea.textIdea.instruction1')}</li>
          <li>{t('wizard.steps.mainIdea.textIdea.instruction2')}</li>
        </ul>
      </div>

      {/* Argumentation */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.argumentation.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
          <li>{t('wizard.steps.mainIdea.argumentation.instruction')}</li>
        </ul>
      </div>
    </div>
  );
};

export default MainIdeaStepContent;


