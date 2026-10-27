'use client';

import { Info, ListChecks, BookOpen } from 'lucide-react';
import React, { useState } from 'react';

import '@locales/i18n';

import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { PreparationPlanList } from './PreparationPlanList';
import { PreparationTextarea } from './PreparationTextarea';

import type { PreparationPlanBinding } from './PreparationPlanList';
import type { PreparationTextBinding } from '@/components/common/manualTextBinding';



interface HomileticPlanStepContentProps {
  modernTranslation?: PreparationTextBinding;
  planFields?: { updatedPlan: PreparationPlanBinding; sermonPlan: PreparationPlanBinding };
}

const HomileticPlanStepContent: React.FC<HomileticPlanStepContentProps> = ({
  modernTranslation, planFields,
}) => {
  const { t } = useTranslation();
  const [showInstruction, setShowInstruction] = useState<boolean>(false);

  return (
    <div className="space-y-4">
      {/* Header with instruction toggle */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.title')}</h4>
        <button
          type="button"
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          onClick={() => setShowInstruction(s => !s)}
          aria-expanded={showInstruction}
          title={(showInstruction ? t('wizard.steps.homileticPlan.instruction.hide') : t('wizard.steps.homileticPlan.instruction.show')) as string}
        >
          <Info className="w-4 h-4" /> {showInstruction ? (t('wizard.steps.homileticPlan.instruction.hide') as string) : (t('wizard.steps.homileticPlan.instruction.show') as string)}
        </button>
      </div>

      {showInstruction && (
        <div className={`p-3 rounded-md text-sm border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
          {/* Homiletic plan note */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.homileticPlan')}</h5>
            </div>
            <p className="text-gray-700 dark:text-gray-300">
              {t('wizard.steps.homileticPlan.homiletic.note')}
            </p>
          </div>

          {/* Modern translation */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.modernTranslation')}</h5>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('wizard.steps.homileticPlan.instructions.modernTranslation.p1')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.modernTranslation.p2')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.modernTranslation.p3')}</li>
            </ul>
          </div>

          {/* Updated plan instruction */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.updatedPlan')}</h5>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('wizard.steps.homileticPlan.instructions.updatedPlan.p1')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.updatedPlan.p2')}</li>
            </ul>
          </div>

          {/* Sermon plan guidance (short) */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.sermonPlan')}</h5>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.definition')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.unity')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.transitions')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.principles')}</li>
            </ul>
          </div>

          {/* Deep guide sections */}
          <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
            {/* Plan definition */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.planDefinition.title')}</h6>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('wizard.steps.homileticPlan.guide.planDefinition.p1')}</li>
              </ul>
              <div className="mt-2">
                <div className="text-xs font-medium mb-1">{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.basedOnStructure')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.topicSentences')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.intentRelation')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.commonAcrossPoints')}</li>
                </ul>
              </div>
            </div>

            {/* Unity, order, progress */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.unityOrderProgress.title')}</h6>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>
                  {t('wizard.steps.homileticPlan.guide.unityOrderProgress.logicalChronological')}
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.generalToSpecific')}</li>
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.focusFlow')}</li>
                  </ul>
                </li>
                <li>
                  {t('wizard.steps.homileticPlan.guide.unityOrderProgress.psychSequence')}
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.notCorner')}</li>
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.showRoad')}</li>
                  </ul>
                </li>
                <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.rule2to4')}</li>
              </ul>
            </div>

            {/* Transitions */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.transitions.title')}</h6>
            </div>

            {/* Principles */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.principles.title')}</h6>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>{t('wizard.steps.homileticPlan.guide.principles.p1')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p2')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p3')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p4')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p5')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p6')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p7')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p8')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p9')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p10')}</li>
              </ul>
            </div>

            {/* ThoughtsBySection examples */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.structureExamples.title')}</h6>
              {/* Time logic */}
              <div className="mt-1">
                <div className="text-xs font-medium">{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i1')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i2')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i3')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i4')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i5')}</li>
                </ul>
              </div>
              {/* Place logic */}
              <div className="mt-2">
                <div className="text-xs font-medium">{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i1')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i2')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i3')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i4')}</li>
                </ul>
              </div>
              {/* Qualities */}
              <div className="mt-2">
                <div className="text-xs font-medium">{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i1')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i2')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i3')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i4')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i5')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i6')}</li>
                </ul>
              </div>
            </div>

            {/* 8 basic structures */}
            <div>
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.structures8.title')}</h6>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.deductive')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.inductive')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.narrative')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.biographical')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.problemSolution')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.thematic')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.motivational')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.dramatic')}</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Modern translation field */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
        <label className="block text-xs font-medium mb-1" htmlFor="modern-translation-textarea">
          {t('wizard.steps.homileticPlan.fields.modernTranslation.label')}
        </label>
        {modernTranslation && <PreparationTextarea binding={modernTranslation} id="modern-translation-textarea" rows={4}
          label={t('wizard.steps.homileticPlan.fields.modernTranslation.label')} placeholder={t('wizard.steps.homileticPlan.fields.modernTranslation.placeholder')}
          saveLabelKey="homiletic.actions.save" cancelLabelKey="homiletic.actions.cancel" />}
      </div>

      <PreparationPlanList binding={planFields?.updatedPlan} kind="updatedPlan" />
      <PreparationPlanList binding={planFields?.sermonPlan} kind="sermonPlan" />
    </div>
  );
};

export default HomileticPlanStepContent;
