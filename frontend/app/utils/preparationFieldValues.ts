import type { Json } from '@/data-engine/types';
import type { Preparation } from '@/models/models';

export type SermonGoalType = NonNullable<NonNullable<Preparation['preachingGoal']>['type']>;
export const isSermonGoalType = (value: unknown): value is SermonGoalType =>
  value === 'informative' || value === 'proclamation' || value === 'didactic' || value === 'exhortative';

export const preparationTextPaths = {
  authorIntent: ['preparation', 'authorIntent'],
  timelessTruth: ['preparation', 'timelessTruth'],
  christConnection: ['preparation', 'christConnection'],
  statement: ['preparation', 'preachingGoal', 'statement'],
  contextIdea: ['preparation', 'mainIdea', 'contextIdea'],
  textIdea: ['preparation', 'mainIdea', 'textIdea'],
  argumentation: ['preparation', 'mainIdea', 'argumentation'],
  exegetical: ['preparation', 'thesis', 'exegetical'],
  homiletical: ['preparation', 'thesis', 'homiletical'],
  transitionSentence: ['preparation', 'thesis', 'transitionSentence'],
  oneSentence: ['preparation', 'thesis', 'oneSentence'],
  sermonInOneSentence: ['preparation', 'thesis', 'sermonInOneSentence'],
  whyPreach: ['preparation', 'thesis', 'homileticalAnswers', 'whyPreach'],
  impactOnChurch: ['preparation', 'thesis', 'homileticalAnswers', 'impactOnChurch'],
  practicalQuestions: ['preparation', 'thesis', 'homileticalAnswers', 'practicalQuestions'],
  modernTranslation: ['preparation', 'homileticPlan', 'modernTranslation'],
  passageSummary: ['preparation', 'textContext', 'passageSummary'],
  contextNotes: ['preparation', 'textContext', 'contextNotes'],
} as const;
export type PreparationTextField = keyof typeof preparationTextPaths;

export function preparationTextField(path: readonly string[]): PreparationTextField | undefined {
  const field = path.at(-1) as PreparationTextField;
  if (!Object.hasOwn(preparationTextPaths, field)) return undefined;
  const target = preparationTextPaths[field];
  return target.length === path.length && target.every((part, index) => part === path[index]) ? field : undefined;
}

export const preparationThesisPaths = {
  questionWord: ['preparation', 'thesis', 'questionWord'],
  pluralKey: ['preparation', 'thesis', 'pluralKey'],
} as const;
export type SermonThesisField = keyof typeof preparationThesisPaths;

export function preparationThesisField(path: readonly string[]): SermonThesisField | undefined {
  const field = path[2] as SermonThesisField;
  if (path.length !== 3 || !Object.hasOwn(preparationThesisPaths, field)) return undefined;
  return preparationThesisPaths[field].every((part, index) => part === path[index]) ? field : undefined;
}

export const preparationConfirmationPaths = {
  readAndPrayedConfirmed: ['preparation', 'spiritual', 'readAndPrayedConfirmed'],
  readWholeBookOnceConfirmed: ['preparation', 'textContext', 'readWholeBookOnceConfirmed'],
} as const;
export type PreparationConfirmation = keyof typeof preparationConfirmationPaths;

export function preparationConfirmationField(path: readonly string[]): PreparationConfirmation | undefined {
  const field = path[2] as PreparationConfirmation;
  if (path.length !== 3 || !Object.hasOwn(preparationConfirmationPaths, field)) return undefined;
  return preparationConfirmationPaths[field].every((part, index) => part === path[index]) ? field : undefined;
}

/** Raw field views and explicit-save normalization; no storage or delivery ownership. */
export interface PreparationValue<T> {
  read(value: Json | undefined): T;
  save(value: T, opening?: T): Json;
  describe(value: T): string;
  valid?(value: T): boolean;
}

export type PreparationPlanItem = { id: string; title: string };
export const trimmedPreparationText: PreparationValue<string> = {
  read: value => typeof value === 'string' ? value : '', save: value => value.trim(), describe: value => value,
};
export const repeatedWordsPath = ['preparation', 'textContext', 'repeatedWords'] as const;
export const preparationWords: PreparationValue<string> = {
  read: value => typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '',
  save: value => value.split(',').map(word => word.trim()).filter(Boolean), describe: value => value,
};
export const preparationPlan: PreparationValue<PreparationPlanItem[]> = {
  read: value => Array.isArray(value) ? value as PreparationPlanItem[] : [],
  save: (value, opening) => {
    const original = new Map(opening?.map(row => [row.id, row.title]));
    return value.map(row => original.get(row.id) === row.title ? row : { ...row, title: row.title.trim() }) as Json;
  },
  describe: value => value.map((item, index) => `${index + 1}. ${item.title}`).join('\n'),
  valid: value => value.every(item => item.title.trim().length > 0),
};
