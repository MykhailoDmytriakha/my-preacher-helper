import { orderedFieldChoiceFrames } from './orderedFieldChoiceFrames';

import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot } from './types';

export const HARD_QUESTION_FIELD_SETTLED = 'hard-question-field-settled';
export const HARD_QUESTION_FIELD_QUEUED = 'hard-question-field-queued';
export const HARD_QUESTION_FIELD_REVIEW = 'hard-question-field-review-changed';

export type HardQuestionTextField = 'title' | 'intro' | 'short' | 'detail' | 'differ';
export type HardQuestionFieldStamps = Partial<Record<HardQuestionTextField, DocumentFieldStamp & { reviewed?: true }>>;
export type HardQuestionFieldObservations = Partial<Record<HardQuestionTextField, DocumentFieldObservation<FieldValue> & { reviewed?: true }>>;
export type HardQuestionFieldReview = { fields: readonly HardQuestionTextField[]; original: HardQuestionFieldObservations };
export type HardQuestionFieldTarget = {
  field: HardQuestionTextField;
  action: 'hardQuestionFieldActions';
  proof: `hardQuestion-${HardQuestionTextField}`;
  accepts: (value: unknown) => value is string;
  causal: true;
  optional?: true;
};

function textTarget(field: HardQuestionTextField): HardQuestionFieldTarget {
  return {
    field, action: 'hardQuestionFieldActions', proof: `hardQuestion-${field}`, causal: true,
    accepts: (value): value is string => typeof value === 'string' && (field !== 'title' || value.trim().length > 0),
    ...(field !== 'title' && { optional: true }),
  };
}

const title = textTarget('title');
const questionTargets = [title, textTarget('short'), textTarget('detail'), textTarget('differ')];
const themeTargets = [title, textTarget('intro')];

export function hardQuestionFieldTargets(collection: string): readonly HardQuestionFieldTarget[] {
  if (collection === 'hardQuestions') return questionTargets;
  if (collection === 'hardQuestionThemes') return themeTargets;
  return [];
}

export function hardQuestionTextField(collection: string, path: readonly string[]): HardQuestionTextField | undefined {
  if (path.length !== 1) return;
  return hardQuestionFieldTargets(collection).find(target => target.field === path[0])?.field;
}

export function hardQuestionReviewFrames(basis: ResourceSnapshot, reviewed: DocumentData | null, stored: ResourceSnapshot,
  conflicts: readonly ConflictDetail[]) {
  return orderedFieldChoiceFrames(basis, reviewed, stored, conflicts, ({ path, code }) => {
    if (!hardQuestionTextField(basis.resource.collection, path)) return;
    if (code === HARD_QUESTION_FIELD_SETTLED) return 'settled';
    if (code === HARD_QUESTION_FIELD_QUEUED) return 'queued';
  });
}
