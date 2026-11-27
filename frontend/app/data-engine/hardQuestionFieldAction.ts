import { isAuthoredStringList } from './authoredStringList';
import { equalValues, readField, writeField } from './fieldValues';
import { orderedFieldChoiceFrames } from './orderedFieldChoiceFrames';

import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot } from './types';

export const HARD_QUESTION_FIELD_SETTLED = 'hard-question-field-settled';
export const HARD_QUESTION_FIELD_QUEUED = 'hard-question-field-queued';
export const HARD_QUESTION_FIELD_REVIEW = 'hard-question-field-review-changed';
export const HARD_QUESTION_LIST_PROJECTION = 'hard-question-list-projection';

export type HardQuestionTextField = 'title' | 'intro' | 'short' | 'detail' | 'differ';
export type HardQuestionListField = 'alternates' | 'scriptureRefs' | 'basisIds';
export type HardQuestionField = HardQuestionTextField | HardQuestionListField;
export type HardQuestionReviewStamp = { reviewed?: true; carriedItems?: DocumentFieldStamp & { items: string[] }; basisTheme?: string | null; confirmedItems?: readonly string[] };
export type HardQuestionFieldStamps = Partial<Record<HardQuestionField, DocumentFieldStamp & HardQuestionReviewStamp>>;
export type HardQuestionFieldObservations = Partial<Record<HardQuestionField, DocumentFieldObservation<FieldValue> & HardQuestionReviewStamp>>;
export type HardQuestionListQuestions = Partial<Record<HardQuestionListField, readonly string[]>>;
export type HardQuestionFieldReview = {
  fields: readonly HardQuestionField[];
  original: HardQuestionFieldObservations;
  undecidedLists?: HardQuestionListQuestions;
  confirmedLists?: HardQuestionListQuestions;
};
export type HardQuestionTextTarget = {
  field: HardQuestionTextField;
  action: 'hardQuestionFieldActions';
  proof: `hardQuestion-${HardQuestionTextField}`;
  accepts: (value: unknown) => value is string;
  causal: true;
  optional?: true;
};

export type HardQuestionListTarget = {
  field: HardQuestionListField;
  action: 'hardQuestionFieldActions';
  proof: `hardQuestion-${HardQuestionListField}`;
  accepts: typeof isAuthoredStringList;
  causal: true;
  optional: true;
  list: true;
};

export type HardQuestionFieldTarget = HardQuestionTextTarget | HardQuestionListTarget;

function textTarget(field: HardQuestionTextField): HardQuestionTextTarget {
  return {
    field, action: 'hardQuestionFieldActions', proof: `hardQuestion-${field}`, causal: true,
    accepts: (value): value is string => typeof value === 'string' && (field !== 'title' || value.trim().length > 0),
    ...(field !== 'title' && { optional: true }),
  };
}

function listTarget(field: HardQuestionListField): HardQuestionListTarget {
  return { field, action: 'hardQuestionFieldActions', proof: `hardQuestion-${field}`, causal: true,
    accepts: isAuthoredStringList, optional: true, list: true };
}

const title = textTarget('title');
const questionTargets = [title, textTarget('short'), textTarget('detail'), textTarget('differ'),
  listTarget('alternates'), listTarget('scriptureRefs'), listTarget('basisIds')];
const themeTargets = [title, textTarget('intro')];

export function hardQuestionFieldTargets(collection: string): readonly HardQuestionFieldTarget[] {
  if (collection === 'hardQuestions') return questionTargets;
  if (collection === 'hardQuestionThemes') return themeTargets;
  return [];
}

function fieldTarget(collection: string, path: readonly string[]) {
  if (path.length !== 1) return;
  return hardQuestionFieldTargets(collection).find(target => target.field === path[0]);
}

export function hardQuestionField(collection: string, path: readonly string[]): HardQuestionField | undefined {
  return fieldTarget(collection, path)?.field;
}

export function hardQuestionTextField(collection: string, path: readonly string[]): HardQuestionTextField | undefined {
  const target = fieldTarget(collection, path);
  if (target && !('list' in target)) return target.field;
}

export function hardQuestionBasisTheme(document: DocumentData | null | undefined): string | null {
  return typeof document?.themeId === 'string' ? document.themeId : null;
}

export function hardQuestionListItemChanges(before: FieldValue, after: FieldValue) {
  const opening = before.exists ? before.value : [], requested = after.exists ? after.value : [];
  if (!isAuthoredStringList(opening) || !isAuthoredStringList(requested)) return new Map<string, boolean>();
  const previous = new Set(opening), next = new Set(requested);
  const result = new Map<string, boolean>();
  for (const item of next) if (!previous.has(item)) result.set(item, true);
  for (const item of previous) if (!next.has(item)) result.set(item, false);
  return result;
}

export function carriedHardQuestionListItems(change: DocumentFieldObservation<FieldValue>, original: DocumentFieldObservation<FieldValue>) {
  const moved = hardQuestionListItemChanges(change.before, change.after);
  const prior = hardQuestionListItemChanges(original.before, original.after);
  return [...moved].filter(([item, present]) => prior.get(item) === present).map(([item]) => item);
}

/** A whole-document choice would drop compatible entries that belong in both versions. */
export function hasHardQuestionListReview(collection: string, conflicts: readonly ConflictDetail[]): boolean {
  return conflicts.some(({ path, hardQuestionListVersions }) => {
    const target = fieldTarget(collection, path);
    return Boolean(hardQuestionListVersions?.undecided.length && target && 'list' in target);
  });
}

export function readHardQuestionListVersions(conflicts: readonly ConflictDetail[], authored: DocumentData | null, saved: DocumentData) {
  if (!authored) return [];
  return conflicts.flatMap(({ path, mine, theirs, hardQuestionListVersions: versions }) => {
    const target = fieldTarget('hardQuestions', path);
    return versions && target && 'list' in target && equalValues(readField(authored, path), mine) && equalValues(readField(saved, path), theirs)
      ? [{ path, field: target.field, versions }] : [];
  });
}

export function hardQuestionListVersion(matches: ReturnType<typeof readHardQuestionListVersions>,
  side: 'local' | 'remote', document: DocumentData): DocumentData | undefined {
  if (matches.length) return matches.reduce((version, { path, versions }) => writeField(version, path, versions[side]), document);
}

export function hardQuestionReviewFrames(basis: ResourceSnapshot, reviewed: DocumentData | null, stored: ResourceSnapshot,
  conflicts: readonly ConflictDetail[]) {
  const framed = orderedFieldChoiceFrames(basis, reviewed, stored, conflicts, ({ path, code }) => {
    if (!hardQuestionField(basis.resource.collection, path)) return;
    if (code === HARD_QUESTION_FIELD_SETTLED) return 'settled';
    if (code === HARD_QUESTION_FIELD_QUEUED) return 'queued';
  });
  if (!framed.basis.value || !framed.reviewed || !stored.value || basis.metadata?.generation !== stored.metadata?.generation) return framed;
  let opening = framed.basis.value, mine = framed.reviewed;
  const pending = framed.conflicts.filter(({ path, code, base, mine: projected, theirs }) => {
    if (code !== HARD_QUESTION_LIST_PROJECTION || !equalValues(readField(mine, path), base)
      || !equalValues(readField(stored.value!, path), theirs)) return true;
    mine = writeField(mine, path, projected);
    opening = writeField(opening, path, theirs);
    return false;
  });
  return { basis: { ...framed.basis, value: opening }, reviewed: mine, conflicts: pending };
}
