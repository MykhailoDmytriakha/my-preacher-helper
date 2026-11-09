import { usePreparationField, usePreparationTextField } from '@/hooks/usePreparationTextField';
import { isSermonGoalType, preparationPlan, preparationWords, trimmedPreparationText } from '@/utils/preparationFieldValues';
import { useTranslation } from '@locales/useTranslation';

import type { ResourceRef } from '@/data-engine/types';

const captureMetadataTime = { captureMetadataTime: true } as const;

/** The preparation's 25 independently staged fields share the page's canonical document. */
export function useSermonPreparationFields(prepResource: ResourceRef | null) {
  const { t } = useTranslation();
  const mainIdeaContext = usePreparationTextField(prepResource, ['preparation', 'mainIdea', 'contextIdea'], 'wizard.steps.mainIdea.contextIdea.title');
  const mainIdeaText = usePreparationTextField(prepResource, ['preparation', 'mainIdea', 'textIdea'], 'wizard.steps.mainIdea.textIdea.title');
  const mainIdeaArgumentation = usePreparationTextField(prepResource, ['preparation', 'mainIdea', 'argumentation'], 'wizard.steps.mainIdea.argumentation.title');
  const timelessTruth = usePreparationTextField(prepResource, ['preparation', 'timelessTruth'], 'wizard.steps.goals.timelessTruth.title');
  const christConnection = usePreparationTextField(prepResource, ['preparation', 'christConnection'], 'wizard.steps.goals.christConnection.title');
  const goalStatement = usePreparationTextField(prepResource, ['preparation', 'preachingGoal', 'statement'], 'wizard.steps.goals.goal.title');
  const thesisExegetical = usePreparationTextField(prepResource, ['preparation', 'thesis', 'exegetical'], 'wizard.steps.thesis.exegetical.title');
  const thesisWhyPreach = usePreparationTextField(prepResource, ['preparation', 'thesis', 'homileticalAnswers', 'whyPreach'], 'wizard.steps.thesis.homiletical.q.why');
  const thesisImpactOnChurch = usePreparationTextField(prepResource, ['preparation', 'thesis', 'homileticalAnswers', 'impactOnChurch'], 'wizard.steps.thesis.homiletical.q.impact');
  const thesisPracticalQuestions = usePreparationTextField(prepResource, ['preparation', 'thesis', 'homileticalAnswers', 'practicalQuestions'], 'wizard.steps.thesis.homiletical.q.practical');
  const thesisHomiletical = usePreparationTextField(prepResource, ['preparation', 'thesis', 'homiletical'], 'wizard.steps.thesis.homiletical.own');
  const thesisQuestionWord = usePreparationTextField(prepResource, ['preparation', 'thesis', 'questionWord'], 'wizard.steps.thesis.oneSentence.questionLabel');
  const thesisPluralKey = usePreparationTextField(prepResource, ['preparation', 'thesis', 'pluralKey'], 'wizard.steps.thesis.oneSentence.pluralKeyLabel');
  const thesisTransitionSentence = usePreparationTextField(prepResource, ['preparation', 'thesis', 'transitionSentence'], 'wizard.steps.thesis.oneSentence.transitionLabel');
  const thesisOneSentence = usePreparationTextField(prepResource, ['preparation', 'thesis', 'oneSentence'], 'wizard.steps.thesis.oneSentence.oneLabel');
  const thesisSermonInOneSentence = usePreparationTextField(prepResource, ['preparation', 'thesis', 'sermonInOneSentence'], 'wizard.steps.thesis.oneSentence.sermonLabel');
  const authorIntentField = usePreparationTextField(prepResource, ['preparation', 'authorIntent'], 'wizard.steps.exegeticalPlan.authorIntent.title');
  const modernTranslationField = usePreparationTextField(prepResource, ['preparation', 'homileticPlan', 'modernTranslation'], 'wizard.steps.homileticPlan.fields.modernTranslation.label', value => value.trim().length > 0);
  const contextVerse = usePreparationField(prepResource, ['verse'], 'wizard.steps.textContext.passageInput.label', { ...trimmedPreparationText, valid: value => value.trim().length > 0 }, captureMetadataTime);
  const passageSummary = usePreparationField(prepResource, ['preparation', 'textContext', 'passageSummary'], 'wizard.steps.textContext.passageSummary.title', trimmedPreparationText);
  const contextNotes = usePreparationTextField(prepResource, ['preparation', 'textContext', 'contextNotes'], 'wizard.steps.textContext.actions.findContext');
  const repeatedWords = usePreparationField(prepResource, ['preparation', 'textContext', 'repeatedWords'], 'wizard.steps.textContext.actions.findRepeatedWords', preparationWords);
  const goalType = usePreparationField<string>(prepResource, ['preparation', 'preachingGoal', 'type'], 'wizard.steps.goals.goal.typeLabel', {
    ...trimmedPreparationText, valid: isSermonGoalType,
    describe: value => t(value ? `wizard.steps.goals.goal.types.${value}` : 'wizard.steps.goals.goal.typePlaceholder'),
  }, captureMetadataTime);
  const updatedPlan = usePreparationField(prepResource, ['preparation', 'homileticPlan', 'updatedPlan'], 'wizard.steps.homileticPlan.fields.updatedPlan.label', preparationPlan);
  const sermonPlan = usePreparationField(prepResource, ['preparation', 'homileticPlan', 'sermonPlan'], 'wizard.steps.homileticPlan.fields.sermonPlan.label', preparationPlan);
  const decision = mainIdeaContext.decision ?? mainIdeaText.decision ?? mainIdeaArgumentation.decision
    ?? timelessTruth.decision ?? christConnection.decision ?? goalStatement.decision
    ?? thesisExegetical.decision
    ?? thesisWhyPreach.decision
    ?? thesisImpactOnChurch.decision
    ?? thesisPracticalQuestions.decision
    ?? thesisHomiletical.decision
    ?? thesisQuestionWord.decision
    ?? thesisPluralKey.decision
    ?? thesisTransitionSentence.decision
    ?? thesisOneSentence.decision
    ?? thesisSermonInOneSentence.decision ?? authorIntentField.decision ?? modernTranslationField.decision ?? contextVerse.decision ?? passageSummary.decision ?? contextNotes.decision ?? repeatedWords.decision ?? goalType.decision ?? updatedPlan.decision ?? sermonPlan.decision;
  return { decision,
    mainIdeaFields: { contextIdea: mainIdeaContext, textIdea: mainIdeaText, argumentation: mainIdeaArgumentation },
    authorIntentField, modernTranslationField,
    homileticPlanFields: { updatedPlan, sermonPlan },
    textContextFields: { verse: contextVerse, passageSummary, contextNotes, repeatedWords },
    thesisFields: { exegetical: thesisExegetical, whyPreach: thesisWhyPreach, impactOnChurch: thesisImpactOnChurch, practicalQuestions: thesisPracticalQuestions, homiletical: thesisHomiletical, questionWord: thesisQuestionWord, pluralKey: thesisPluralKey, transitionSentence: thesisTransitionSentence, oneSentence: thesisOneSentence, sermonInOneSentence: thesisSermonInOneSentence },
    goalFields: { timelessTruth, christConnection, statement: goalStatement, type: goalType },
  };
}
