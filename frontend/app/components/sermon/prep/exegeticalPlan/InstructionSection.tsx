'use client';

import { Info, ListTree, BookOpen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';

import type { InstructionSectionProps } from './types';

const InstructionSection: React.FC<InstructionSectionProps> = ({ isVisible, onToggle }) => {
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
          <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            {t('wizard.steps.exegeticalPlan.title')}
          </h4>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
        >
          {isVisible 
            ? (t('wizard.steps.exegeticalPlan.instruction.hide') as string) 
            : (t('wizard.steps.exegeticalPlan.instruction.show') as string)}
        </button>
      </div>
      
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {t('wizard.steps.exegeticalPlan.intro')}
      </p>

      {isVisible && (
        <div className="mt-3 p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-2">
            {t('wizard.steps.exegeticalPlan.simpleStudy.note')}
          </p>
          
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ListTree className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                <h5 className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {t('wizard.steps.exegeticalPlan.simpleStudy.title')}
                </h5>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-xs text-gray-600 dark:text-gray-400">
                <li>{t('wizard.steps.exegeticalPlan.simpleStudy.definition')}</li>
                <li>
                  {t('wizard.steps.exegeticalPlan.simpleStudy.requirementsIntro')}
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req1')}</li>
                    <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req2')}</li>
                    <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req3')}</li>
                    <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req4')}</li>
                  </ul>
                </li>
                <li>{t('wizard.steps.exegeticalPlan.simpleStudy.goal')}</li>
              </ul>
            </div>

            <div className="p-2.5 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-1.5 mb-1.5">
                <BookOpen className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <h5 className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {t('wizard.steps.exegeticalPlan.exampleTitle')}
                </h5>
              </div>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-1.5">
                {t('wizard.steps.exegeticalPlan.exampleHint')}
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                <li>{t('wizard.steps.exegeticalPlan.example.topic')}</li>
                <li>{t('wizard.steps.exegeticalPlan.example.iCommand')}</li>
                <li>{t('wizard.steps.exegeticalPlan.example.iiPurpose')}</li>
                <li>
                  {t('wizard.steps.exegeticalPlan.example.iiiCharacter')}
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                    <li>
                      {t('wizard.steps.exegeticalPlan.example.notEvidenceTitle')}
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>{t('wizard.steps.exegeticalPlan.example.notEvidenceA')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.example.notEvidenceB')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.example.notEvidenceC')}</li>
                      </ul>
                    </li>
                    <li>
                      {t('wizard.steps.exegeticalPlan.example.evidenceTitle')}
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>{t('wizard.steps.exegeticalPlan.example.evidenceA')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.example.evidenceB')}</li>
                      </ul>
                    </li>
                  </ul>
                </li>
                <li>
                  {t('wizard.steps.exegeticalPlan.example.ivExample')}
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                    <li>{t('wizard.steps.exegeticalPlan.example.holyWomen')}</li>
                    <li>{t('wizard.steps.exegeticalPlan.example.sarah')}</li>
                  </ul>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InstructionSection;
