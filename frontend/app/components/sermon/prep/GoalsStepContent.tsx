'use client';

import { BookOpen, Info, Link as LinkIcon, ScrollText, Target } from 'lucide-react';
import React from 'react';

import '@locales/i18n';

import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { PreparationSelect } from './PreparationSelect';
import { PreparationTextarea } from './PreparationTextarea';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';

export type GoalType = '' | 'informative' | 'proclamation' | 'didactic' | 'exhortative';

interface GoalsStepContentProps {
  timelessTruth?: PreparationTextBinding;
  christConnection?: PreparationTextBinding;
  goalStatement?: PreparationTextBinding;
  goalType?: PreparationTextBinding;
}

const GoalsStepContent: React.FC<GoalsStepContentProps> = ({
  timelessTruth,
  christConnection,
  goalStatement,
  goalType,
}) => {
  const { t } = useTranslation();

  const [showInstruction, setShowInstruction] = React.useState<boolean>(false);


  return (
    <div className="space-y-3">
      {/* Instruction block (collapsible) */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Info className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.title')}</h4>
          <button
            type="button"
            onClick={() => setShowInstruction((s) => !s)}
            className={`ml-auto inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          >
            {showInstruction ? (t('wizard.steps.goals.instruction.hide') as string) : (t('wizard.steps.goals.instruction.show') as string)}
          </button>
        </div>
        {showInstruction && (
          <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
            <div className="space-y-4 text-sm">
              {/* Timeless Truth Guide */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ScrollText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <h5 className="text-sm font-semibold">{t('wizard.steps.goals.timelessTruth.title')}</h5>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.goals.instruction.tt.definition1')}</li>
                  <li>{t('wizard.steps.goals.instruction.tt.definition2')}</li>
                  <li>{t('wizard.steps.goals.instruction.tt.question')}</li>
                  <li>{t('wizard.steps.goals.instruction.tt.otNt')}</li>
                  <li>
                    {t('wizard.steps.goals.instruction.tt.warningTitle')}
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>{t('wizard.steps.goals.instruction.tt.warning1')}</li>
                    </ul>
                  </li>
                  <li>
                    {t('wizard.steps.goals.instruction.tt.howToFind.title')}
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>{t('wizard.steps.goals.instruction.tt.howToFind.scan')}</li>
                      <li>{t('wizard.steps.goals.instruction.tt.howToFind.fromKeyVerse')}</li>
                    </ul>
                  </li>
                </ul>
                <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className={`w-4 h-4 ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText}`} />
                    <h6 className="text-sm font-semibold">{t('wizard.steps.goals.instruction.tt.examplePhilip.title')}</h6>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.key')}</li>
                    <li>
                      {t('wizard.steps.goals.instruction.tt.examplePhilip.explains')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q1')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q2')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q3')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q4')}</li>
                      </ul>
                    </li>
                  </ul>
                </div>
                <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className={`w-4 h-4 ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText}`} />
                    <h6 className="text-sm font-semibold">{t('wizard.steps.goals.instruction.tt.example2Peter.title')}</h6>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t('wizard.steps.goals.instruction.tt.example2Peter.summary')}</li>
                    <li>{t('wizard.steps.goals.instruction.tt.example2Peter.key')}</li>
                    <li>
                      {t('wizard.steps.goals.instruction.tt.example2Peter.explains')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>{t('wizard.steps.goals.instruction.tt.example2Peter.q1')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.example2Peter.q2')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.example2Peter.q3')}</li>
                      </ul>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Christ Connection Guide */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <LinkIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <h5 className="text-sm font-semibold">{t('wizard.steps.goals.christConnection.title')}</h5>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.goals.instruction.cc.road')}</li>
                  <li>{t('wizard.steps.goals.christConnection.warning')}</li>
                </ul>
              </div>

              {/* Goal Guide */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <h5 className="text-sm font-semibold">{t('wizard.steps.goals.goal.title')}</h5>
                </div>
                <div className={`text-xs ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} mb-1`}>
                  {t('wizard.steps.goals.goal.note')}
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.goals.instruction.goal.purpose')}</li>
                  <li>{t('wizard.steps.goals.instruction.goal.keepSearching')}</li>
                  <li>
                    {t('wizard.steps.goals.instruction.goal.typesTitle')}
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>{t('wizard.steps.goals.instruction.goal.typeInformative')}</li>
                      <li>{t('wizard.steps.goals.instruction.goal.typeProclamation')}</li>
                      <li>{t('wizard.steps.goals.instruction.goal.typeDidactic')}</li>
                      <li>{t('wizard.steps.goals.instruction.goal.typeExhortative')}</li>
                    </ul>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Timeless Biblical Truth */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.timelessTruth.title')}</h4>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('wizard.steps.goals.timelessTruth.instruction')}</p>
        {timelessTruth && <PreparationTextarea binding={timelessTruth} placeholder={t('wizard.steps.goals.timelessTruth.placeholder')} />}

      </div>

      {/* Christ Connection */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <LinkIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.christConnection.title')}</h4>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('wizard.steps.goals.christConnection.instruction')}</p>
        {christConnection && <PreparationTextarea binding={christConnection} placeholder={t('wizard.steps.goals.christConnection.placeholder')} />}
        <div className={`mt-2 p-2 rounded border text-xs ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-gray-500" />
            <span className="text-gray-600 dark:text-gray-400">{t('wizard.steps.goals.christConnection.warning')}</span>
          </div>
        </div>

      </div>

      {/* Goal */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Target className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.goal.title')}</h4>
        </div>
        <div className="grid sm:grid-cols-3 gap-2 mb-2">
          <label className="text-sm font-medium sm:col-span-1 flex items-center">{t('wizard.steps.goals.goal.typeLabel')}</label>
          <div className="sm:col-span-2">
            {goalType && <PreparationSelect binding={goalType} label={t('wizard.steps.goals.goal.typeLabel')}>
              <option value="">{t('wizard.steps.goals.goal.typePlaceholder')}</option>
              <option value="informative">{t('wizard.steps.goals.goal.types.informative')}</option>
              <option value="proclamation">{t('wizard.steps.goals.goal.types.proclamation')}</option>
              <option value="didactic">{t('wizard.steps.goals.goal.types.didactic')}</option>
              <option value="exhortative">{t('wizard.steps.goals.goal.types.exhortative')}</option>
            </PreparationSelect>}
          </div>
        </div>
        {goalStatement && <PreparationTextarea binding={goalStatement} placeholder={t('wizard.steps.goals.goal.placeholder')} />}
        <div className={`mt-2 p-2 rounded border text-xs ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-gray-500" />
            <span className="text-gray-600 dark:text-gray-400">{t('wizard.steps.goals.goal.note')}</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GoalsStepContent;
