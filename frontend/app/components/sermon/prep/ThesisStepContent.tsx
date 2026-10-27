'use client';

import { Quote, BookOpen, HelpCircle } from 'lucide-react';
import React from 'react';

import '@locales/i18n';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { PreparationTextarea } from './PreparationTextarea';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';

export type ThesisField = 'exegetical' | 'whyPreach' | 'impactOnChurch' | 'practicalQuestions' | 'homiletical' | 'questionWord' | 'pluralKey' | 'transitionSentence' | 'oneSentence' | 'sermonInOneSentence';
interface ThesisStepContentProps { fields?: Partial<Record<ThesisField, PreparationTextBinding>> }

const ThesisStepContent: React.FC<ThesisStepContentProps> = ({ fields = {} }) => {
  const { t } = useTranslation();

  const [showInstruction, setShowInstruction] = React.useState(false);

  return (
    <div className="space-y-3">
      {/* Instruction */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <HelpCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.title')}</h4>
          <button
            type="button"
            onClick={() => setShowInstruction(s => !s)}
            className={`ml-auto inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          >
            {showInstruction ? (t('wizard.steps.thesis.instruction.hide') as string) : (t('wizard.steps.thesis.instruction.show') as string)}
          </button>
        </div>
        {showInstruction && (
          <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
            <div className="space-y-3 text-sm">
              <div className={`text-xs ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText}`}>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.note.usingTBT')}</li>
                  <li>{t('wizard.steps.thesis.note.mainMessage')}</li>
                  <li>{t('wizard.steps.thesis.note.naming')}</li>
                  <li>{t('wizard.steps.thesis.note.verb')}</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-semibold mb-1">{t('wizard.steps.thesis.exegetical.title')}</h5>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.exegetical.definition')}</li>
                  <li>{t('wizard.steps.thesis.exegetical.whereFound')}</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-semibold mb-1">{t('wizard.steps.thesis.homiletical.title')}</h5>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.homiletical.q.why')}</li>
                  <li>{t('wizard.steps.thesis.homiletical.q.impact')}</li>
                  <li>{t('wizard.steps.thesis.homiletical.q.practical')}</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-semibold mb-1">{t('wizard.steps.thesis.oneSentence.title')}</h5>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.oneSentence.question')}</li>
                  <li>{t('wizard.steps.thesis.oneSentence.pluralKey')}</li>
                  <li>{t('wizard.steps.thesis.oneSentence.transition')}</li>
                  <li>{t('wizard.steps.thesis.oneSentence.sermon')}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Exegetical Thesis */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.exegetical.title')}</h4>
        </div>
        {fields.exegetical && <PreparationTextarea binding={fields.exegetical} placeholder={t('wizard.steps.thesis.exegetical.placeholder')} rows={3} />}
      </div>

      {/* Homiletical Q&A */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Quote className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.homiletical.title')}</h4>
        </div>
        <label className="block text-xs font-medium mb-1">{t('wizard.steps.thesis.homiletical.q.why')}</label>
        {fields.whyPreach && <PreparationTextarea binding={fields.whyPreach} placeholder={t('wizard.steps.thesis.homiletical.q.whyPh')} rows={2} />}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.homiletical.q.impact')}</label>
        {fields.impactOnChurch && <PreparationTextarea binding={fields.impactOnChurch} placeholder={t('wizard.steps.thesis.homiletical.q.impactPh')} rows={2} />}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.homiletical.q.practical')}</label>
        {fields.practicalQuestions && <PreparationTextarea binding={fields.practicalQuestions} placeholder={t('wizard.steps.thesis.homiletical.q.practicalPh')} rows={2} />}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.homiletical.own')}</label>
        {fields.homiletical && <PreparationTextarea binding={fields.homiletical} placeholder={t('wizard.steps.thesis.homiletical.ownPh')} rows={3} />}
      </div>

      {/* One-sentence thesis & related */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <HelpCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.oneSentence.title')}</h4>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t('wizard.steps.thesis.oneSentence.questionLabel')}</label>
            {fields.questionWord && <PreparationTextarea binding={fields.questionWord} placeholder={t('wizard.steps.thesis.oneSentence.questionPh')} singleLine />}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t('wizard.steps.thesis.oneSentence.pluralKeyLabel')}</label>
            {fields.pluralKey && <PreparationTextarea binding={fields.pluralKey} placeholder={t('wizard.steps.thesis.oneSentence.pluralKeyPh')} singleLine />}
          </div>
        </div>
        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.oneSentence.transitionLabel')}</label>
        {fields.transitionSentence && <PreparationTextarea binding={fields.transitionSentence} placeholder={t('wizard.steps.thesis.oneSentence.transitionPh')} rows={2} />}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.oneSentence.oneLabel')}</label>
        {fields.oneSentence && <PreparationTextarea binding={fields.oneSentence} placeholder={t('wizard.steps.thesis.oneSentence.onePh')} rows={2} />}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.oneSentence.sermonLabel')}</label>
        {fields.sermonInOneSentence && <PreparationTextarea binding={fields.sermonInOneSentence} placeholder={t('wizard.steps.thesis.oneSentence.sermonPh')} rows={2} />}
      </div>
    </div>
  );
};

export default ThesisStepContent;

