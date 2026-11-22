import { isGroupStatus } from '@/utils/groupDocument';
import { isSermonGoalType, preparationConfirmationPaths, preparationTextPaths, preparationThesisPaths, repeatedWordsPath, type PreparationConfirmation, type PreparationTextField, type SermonGoalType, type SermonThesisField } from '@/utils/preparationFieldValues';
import { isOrdinaryStudyNote, isOrdinaryStudyNoteType, isStudyNoteBodyDocument, type OrdinaryStudyNoteType } from '@/utils/studyNoteType';

import { ACCOUNT_PREFERENCE_TARGETS, type AccountPreferenceField, type AccountPreferenceTarget } from './accountPreference';
import { boundedActionTime } from './actionClock';
import { isAuthoredStringList } from './authoredStringList';
import { isSermonChurch } from './churchFieldValue';
import { commentPlaceValue, leadingReferenceValue, placeOfCommentChange, replaceCommentReference } from './commentPlaceAction';
import { COUNCIL_LIFECYCLE, COUNCIL_TIMED_FIELDS, councilLifecycleValue, matchesCouncilLifecycle, withCouncilLifecycle, type CouncilFieldActions, type CouncilFieldTarget } from './councilFieldAction';
import { equalValues, object, own, readField, writeField } from './fieldValues';
import { PRAYER_STATUS_FIELDS } from './prayerStatusAction';
import { PRAYER_TEXT_TARGETS } from './prayerTextAction';
import { rowConflictValue } from './rowFieldAction';
import { SERIES_FIELD_TARGETS } from './seriesFieldAction';
import { captureSermonChurchFill } from './sermonChurchFill';

import type { ActionTime } from './actionClock';
import type { CommentKindObservation } from './commentKindAction';
import type { CommentPlaceObservation } from './commentPlaceAction';
import type { CommitRequest } from './commits';
import type { DatedRowActionEvidence } from './datedRowAction';
import type { PrayerStatusCapture, PrayerStatusObservations, PrayerStatusOpening, PrayerStatusTarget } from './prayerStatusAction';
import type { PrayerTextCapture, PrayerTextObservations, PrayerTextOpenings, PrayerTextTarget } from './prayerTextAction';
import type { SeriesFieldObservation, SeriesFieldReview, SeriesFieldTarget } from './seriesFieldAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { ConflictDetail, DataCommand, DocumentData, FieldChange, FieldValue, ResourceRef, ResourceSnapshot } from './types';
import type { Church, Group, Sermon } from '@/models/models';

export const SERMON_METADATA_SETTLED = 'sermon-metadata-settled';
export const SERMON_METADATA_QUEUED = 'sermon-metadata-queued';
export const SERMON_VERSE_REVIEW_CHANGED = 'sermon-verse-review-changed';
export const SERMON_CHURCH_REVIEW_CHANGED = 'sermon-church-review-changed';
export const SERMON_GOAL_TYPE_REVIEW_CHANGED = 'sermon-goal-type-review-changed';
export const SERMON_PLAN_MODE_REVIEW_CHANGED = 'sermon-plan-mode-review-changed';
export const SERMON_PREPARATION_CHECK_REVIEW_CHANGED = 'sermon-preparation-check-review-changed';
export const SERMON_THESIS_REVIEW_CHANGED = 'sermon-thesis-review-changed';
export function isStaleSermonFieldReview(code: string | undefined): boolean {
  return code === SERMON_VERSE_REVIEW_CHANGED || code === SERMON_CHURCH_REVIEW_CHANGED
    || code === SERMON_GOAL_TYPE_REVIEW_CHANGED || code === SERMON_PLAN_MODE_REVIEW_CHANGED
    || code === SERMON_PREPARATION_CHECK_REVIEW_CHANGED || code === SERMON_THESIS_REVIEW_CHANGED;
}
export function isOrderedSermonMetadata(conflict: ConflictDetail): boolean {
  const [field, id, leaf] = conflict.path;
  const metadata = (conflict.path.length === 1 && (field === 'title' || field === 'verse' || field === 'church'))
    || (conflict.path.length === 3 && field === 'preachDates' && id.startsWith('id:') && leaf === 'date');
  return metadata && (conflict.code === SERMON_METADATA_SETTLED || conflict.code === SERMON_METADATA_QUEUED);
}

type SermonReviewProof = Pick<DocumentFieldStamp, 'time' | 'observedRevision'>;
export type SermonMetadataReviewProofs = {
  field: 'title' | 'verse' | 'church' | 'goalType' | SermonThesisField;
  title?: SermonReviewProof;
  verse?: SermonReviewProof;
  church?: SermonReviewProof;
  date?: Pick<DatedRowActionEvidence, 'rowId' | 'after' | 'observedRevision' | 'time'>;
};

export type DocumentFieldStamp = { observedRevision: number; time: ActionTime | null; predecessorOperationId?: string };
export type ReviewedSermonFieldStamp = DocumentFieldStamp & { reviewed?: true };
export type ReviewedSermonFieldObservation<Value = string> = DocumentFieldObservation<Value> & { reviewed?: true };
export type SermonPlanModeStamp = ReviewedSermonFieldStamp & { initialize?: true };
export type SermonPlanMode = NonNullable<Sermon['planMode']>;
export type SermonPlanModeOpening = TextFieldBasis & { sermonId: string; value: FieldValue };
export type SermonPlanModeCapture = { time: ActionTime | null; seen: SermonPlanModeOpening; initialize?: true; reviewed?: true };
export type SermonPlanModeObservation = ReviewedSermonFieldObservation<FieldValue> & { initialize?: true };
export type DocumentFieldObservation<Value = string> = DocumentFieldStamp & { before: Value; after: Value };
type TextFieldBasis = { generation: string; revision: number; requestId?: string };
export type DocumentTitleSeen = TextFieldBasis & { title: string };
export type TagColorSeen = TextFieldBasis & { color: string };
export type TagColorCapture = { time: ActionTime | null; seen: TagColorSeen };
export type ServiceOrderTitleSeen = DocumentTitleSeen;
export type ServiceOrderTitleCapture = { time: ActionTime | null; seen: ServiceOrderTitleSeen };
export type StudyNoteTitleSeen = DocumentTitleSeen & { missing?: true };
export type StudyNoteTitleCapture = { time: ActionTime | null; seen: StudyNoteTitleSeen };
export type { OrdinaryStudyNoteType } from '@/utils/studyNoteType';
export type StudyNoteTypeSeen = TextFieldBasis & { type: OrdinaryStudyNoteType; missing?: true };
export type StudyNoteTypeCapture = { time: ActionTime | null; seen: StudyNoteTypeSeen };
export type StudyNoteTypeHistoryPage = {
  owner: string; noteId: string; generation: string; nextCursor: string | null;
  entries: { id: string; type: OrdinaryStudyNoteType; winnerType: OrdinaryStudyNoteType; acceptedAt: string }[];
};

export type StudyNoteTitleHistoryPage = {
  owner: string; noteId: string; generation: string; nextCursor: string | null;
  entries: (Omit<DocumentTitleHistoryEntry, 'title' | 'winnerTitle'> & { title: string | null; winnerTitle: string | null })[];
};
export type PlanTemplateNameCapture = { time: ActionTime | null; seen: DocumentTitleSeen };
export type PrayerTitleSeen = DocumentTitleSeen;
export type PrayerTitleCapture = { time: ActionTime | null; seen: PrayerTitleSeen };
export type DisplacedDocumentTitle = {
  title: string; winnerTitle: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type DocumentTitleHistoryEntry = DisplacedDocumentTitle & { id: string; acceptedAt: string };
export type ServiceOrderTitleHistoryPage = {
  owner: string; orderId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type GroupTimedField = 'title' | 'status' | 'description';

type TextDocumentFieldTarget = {
  field: Exclude<GroupTimedField, 'description'> | 'verse' | 'name' | 'color' | 'type';
  action: 'studyNoteTypeAction' | 'studyNoteTitleAction' | 'planTemplateNameAction' | 'tagColorAction' | 'serviceOrderTitleAction' | 'prayerTitleAction' | 'sermonTitleAction' | 'sermonVerseAction' | 'groupTitleAction' | 'groupStatusAction';
  proof: 'studyNoteType' | 'studyNoteTitle' | 'planTemplateName' | 'tagColor' | 'serviceOrderTitle' | 'prayerTitle' | 'sermonTitle' | 'sermonVerse' | 'groupTitle' | 'groupStatus';
  accepts: (value: unknown) => value is string;
  causal?: true;
  optional?: true;
};

export type DocumentFieldTarget = TextDocumentFieldTarget | typeof GROUP_DESCRIPTION | typeof STUDY_NOTE_CONTENT | typeof COMMENT_KIND | typeof COMMENT_PLACE | typeof SERMON_CHURCH | typeof SERMON_GOAL_TYPE | typeof SERMON_PLAN_MODE | typeof SERMON_REPEATED_WORDS | SermonThesisTarget | PreparationTextTarget | PreparationConfirmationTarget | SeriesFieldTarget | CouncilFieldTarget | PrayerStatusTarget | PrayerTextTarget | AccountPreferenceTarget;
export type SermonChurchObservation = ReviewedSermonFieldObservation<FieldValue>;

export const SERMON_REPEATED_WORDS = { field: 'repeatedWords', path: repeatedWordsPath, action: 'sermonRepeatedWordsAction',
  proof: 'sermonRepeatedWords', causal: true, optional: true, accepts: isAuthoredStringList } as const;

export type GroupStatusHistoryPage = {
  owner: string; groupId: string; generation: string; nextCursor: string | null;
  entries: { id: string; status: Group['status']; winnerStatus: Group['status']; acceptedAt: string }[];
};

const SERMON_CHURCH = { field: 'church', action: 'sermonChurchAction', proof: 'sermonChurch', causal: true } as const;

export const SERMON_GOAL_TYPE = { field: 'type', path: ['preparation', 'preachingGoal', 'type'],
  action: 'sermonGoalTypeAction', proof: 'sermonGoalType', causal: true, optional: true, accepts: isSermonGoalType } as const;

export type { SermonThesisField } from '@/utils/preparationFieldValues';
export type SermonThesisObservations = Partial<Record<SermonThesisField, ReviewedSermonFieldObservation<FieldValue>>>;

type SermonThesisTarget = {
  field: SermonThesisField;
  path: (typeof preparationThesisPaths)[SermonThesisField];
  action: 'sermonThesisFieldActions';
  proof: `thesis-${SermonThesisField}`;
  accepts: (value: unknown) => value is string;
  causal: true;
  optional: true;
};

const SERMON_THESIS_TARGETS: readonly SermonThesisTarget[] = (Object.keys(preparationThesisPaths) as SermonThesisField[]).map(field => ({
  field, path: preparationThesisPaths[field], action: 'sermonThesisFieldActions', proof: `thesis-${field}`,
  accepts: (value): value is string => typeof value === 'string', causal: true, optional: true,
}));

export type PreparationTextObservations = Partial<Record<PreparationTextField, DocumentFieldObservation<FieldValue>>>;

type PreparationTextTarget = {
  field: PreparationTextField;
  path: (typeof preparationTextPaths)[PreparationTextField];
  action: 'sermonPreparationTextActions';
  proof: `preparationText-${PreparationTextField}`;
  accepts: (value: unknown) => value is string;
  causal: true;
  optional: true;
};

const PREPARATION_TEXT_TARGETS: readonly PreparationTextTarget[] =
  (Object.keys(preparationTextPaths) as PreparationTextField[]).map(field => ({
    field, path: preparationTextPaths[field], action: 'sermonPreparationTextActions', proof: `preparationText-${field}`,
    accepts: (value): value is string => typeof value === 'string', causal: true, optional: true,
  }));

export const isSermonPlanMode = (value: unknown): value is SermonPlanMode => value === 'manual' || value === 'ai' || value === 'note';
export const SERMON_PLAN_MODE = { field: 'planMode', path: ['planMode'],
  action: 'sermonPlanModeAction', proof: 'sermonPlanMode', causal: true, optional: true, accepts: isSermonPlanMode } as const;

export type SermonPlanModeHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; planMode: SermonPlanMode; winnerPlanMode: SermonPlanMode }[];
};

type PreparationConfirmationTarget = {
  field: PreparationConfirmation;
  path: (typeof preparationConfirmationPaths)[PreparationConfirmation];
  action: 'sermonPreparationCheckActions';
  proof: PreparationConfirmation;
  accepts: (value: unknown) => value is boolean;
  causal: true;
  optional: true;
};
const PREPARATION_CONFIRMATION_TARGETS: readonly PreparationConfirmationTarget[] =
  (Object.keys(preparationConfirmationPaths) as PreparationConfirmation[]).map(field => ({
    field, path: preparationConfirmationPaths[field], action: 'sermonPreparationCheckActions', proof: field,
    accepts: (value): value is boolean => typeof value === 'boolean', causal: true, optional: true,
  }));

export type PreparationConfirmationObservations = Partial<Record<PreparationConfirmation, ReviewedSermonFieldObservation<FieldValue>>>;

export type SermonGoalTypeHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; type: SermonGoalType; winnerType: SermonGoalType }[];
};

export type SermonPreparationConfirmationHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; fields: { field: PreparationConfirmation; value: boolean; winner: boolean }[] }[];
};

const shortTitle = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;
const SERVICE_ORDER_TITLE: TextDocumentFieldTarget = { field: 'title', action: 'serviceOrderTitleAction', proof: 'serviceOrderTitle', causal: true,
  accepts: (value): value is string => shortTitle(value) && value.trim().length > 0 };
const PRAYER_TITLE = { field: 'title', action: 'prayerTitleAction', proof: 'prayerTitle', causal: true,
  accepts: (value: unknown): value is string => shortTitle(value) && value.trim().length > 0,
} as const satisfies TextDocumentFieldTarget;
const SERMON_TITLE = { field: 'title', action: 'sermonTitleAction', proof: 'sermonTitle', accepts: shortTitle, causal: true } as const satisfies TextDocumentFieldTarget;
const SERMON_VERSE = { field: 'verse', action: 'sermonVerseAction', proof: 'sermonVerse', causal: true,
  accepts: (value): value is string => typeof value === 'string' } as const satisfies TextDocumentFieldTarget;
const STUDY_NOTE_TYPE = { field: 'type', action: 'studyNoteTypeAction', proof: 'studyNoteType',
  accepts: isOrdinaryStudyNoteType, causal: true, optional: true } as const satisfies TextDocumentFieldTarget;
const COMMENT_KIND = { field: 'paragraph', action: 'commentKindAction', proof: 'commentKind',
  accepts: (value: unknown): value is boolean => typeof value === 'boolean', causal: true, optional: true } as const;
const COMMENT_PLACE = { field: 'scriptureRefs', action: 'commentPlaceAction', proof: 'commentPlace',
  accepts: object, causal: true } as const;
const STUDY_NOTE_CONTENT = { field: 'content', action: 'studyNoteContentAction', proof: 'studyNoteContent',
  accepts: (value: unknown): value is string => typeof value === 'string', causal: true,
} as const;
const STUDY_NOTE_TITLE = { field: 'title', action: 'studyNoteTitleAction', proof: 'studyNoteTitle',
  accepts: (value): value is string => typeof value === 'string', causal: true, optional: true } as const satisfies TextDocumentFieldTarget;
const PLAN_TEMPLATE_NAME = { field: 'name', action: 'planTemplateNameAction', proof: 'planTemplateName',
  accepts: (value): value is string => typeof value === 'string' && value.length > 0, causal: true,
} as const satisfies TextDocumentFieldTarget;
const TAG_COLOR = { field: 'color', action: 'tagColorAction', proof: 'tagColor',
  accepts: (value): value is string => typeof value === 'string', causal: true,
} as const satisfies TextDocumentFieldTarget;
const GROUP_TITLE = { field: 'title', action: 'groupTitleAction', proof: 'groupTitle', causal: true, accepts: shortTitle, draft: 'groupTitleDraft' } as const satisfies GroupFieldTarget;
const GROUP_STATUS = { field: 'status', action: 'groupStatusAction', proof: 'groupStatus', causal: true, accepts: isGroupStatus, draft: 'groupStatusDraft' } as const satisfies GroupFieldTarget;
const GROUP_DESCRIPTION = { field: 'description', action: 'groupDescriptionAction', proof: 'groupDescription', causal: true, optional: true,
  accepts: (value: unknown): value is string => typeof value === 'string', draft: 'groupDescriptionDraft' } as const;
export const GROUP_TIMED_FIELDS = [GROUP_TITLE, GROUP_STATUS, GROUP_DESCRIPTION] as const;
const COUNCIL_FIELDS = [...COUNCIL_TIMED_FIELDS, COUNCIL_LIFECYCLE];

export function documentFieldTargets(collection: string): readonly DocumentFieldTarget[] {
  if (collection === 'users') return ACCOUNT_PREFERENCE_TARGETS;
  if (collection === 'serviceOrders') return [SERVICE_ORDER_TITLE];
  if (collection === 'studyNotes') return [STUDY_NOTE_TITLE, STUDY_NOTE_CONTENT, STUDY_NOTE_TYPE, COMMENT_KIND, COMMENT_PLACE];
  if (collection === 'planTemplates') return [PLAN_TEMPLATE_NAME];
  if (collection === 'tags') return [TAG_COLOR];
  if (collection === 'groups') return GROUP_TIMED_FIELDS;
  if (collection === 'series') return SERIES_FIELD_TARGETS;
  if (collection === 'prayerRequests') return [PRAYER_TITLE, ...PRAYER_STATUS_FIELDS, ...PRAYER_TEXT_TARGETS];
  if (collection === 'councils') return COUNCIL_FIELDS;
  if (collection === 'sermons') return [SERMON_TITLE, SERMON_VERSE, SERMON_CHURCH, SERMON_GOAL_TYPE, SERMON_PLAN_MODE, SERMON_REPEATED_WORDS, ...SERMON_THESIS_TARGETS, ...PREPARATION_TEXT_TARGETS, ...PREPARATION_CONFIRMATION_TARGETS];
  return [];
}

type LongTextDocumentFieldTarget = typeof STUDY_NOTE_CONTENT | typeof GROUP_DESCRIPTION | PrayerTextTarget
  | Extract<SeriesFieldTarget, { field: 'description' }> | PreparationTextTarget;

export function isLongTextDocumentField(target: DocumentFieldTarget): target is LongTextDocumentFieldTarget {
  return target.action === 'studyNoteContentAction' || target.action === 'groupDescriptionAction' || target.action === 'prayerTextActions'
    || target.action === 'sermonPreparationTextActions' || (target.action === 'seriesFieldActions' && target.field === 'description');
}

export function acceptsDocumentField(value: FieldValue, target: DocumentFieldTarget): boolean {
  if (target.field === 'church') return isSermonChurch(value);
  if (!value.exists) return 'optional' in target && target.optional === true;
  return target.accepts(value.value);
}

export function capturedDocumentField(record: CommitRequest, target: DocumentFieldTarget) {
  if (target.action === 'accountPreferenceActions') return record.accountPreferenceActions?.[target.field];
  if (target.action === 'seriesFieldActions') return record.seriesFieldActions?.[target.field];
  if (target.action === 'prayerTextActions') return record.prayerTextActions?.[target.field];
  if (target.action === 'sermonPreparationCheckActions') return record.sermonPreparationCheckActions?.[target.field];
  if (target.action === 'sermonThesisFieldActions') return record.sermonThesisFieldActions?.[target.field];
  if (target.action === 'sermonPreparationTextActions') return record.sermonPreparationTextActions?.[target.field];
  return record[target.action];
}

function isShortDocumentTitle(value: unknown, target: TextDocumentFieldTarget): value is string {
  return target.accepts(value);
}

export type TagColorHistoryPage = {
  owner: string; tagId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: { field: 'color'; value: string; winner: string }[] }[];
};

export type PlanTemplateNameHistoryPage = {
  owner: string; templateId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type PrayerTitleHistoryPage = {
  owner: string; prayerId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type SermonTitleHistoryPage = {
  owner: string; sermonId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type SermonVerseHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; verse: string; winnerVerse: string; acceptedAt: string }[];
};

export type SermonChurchHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; church: Church | null; winnerChurch: Church | null; acceptedAt: string }[];
};

export type GroupTitleHistoryPage = {
  owner: string; groupId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export function documentFieldPath(target: DocumentFieldTarget): readonly string[] {
  return 'path' in target ? target.path : [target.field];
}

export function documentFieldValue(value: DocumentData | null, target: DocumentFieldTarget): FieldValue | undefined {
  if (target.action === 'commentPlaceAction') return commentPlaceValue(value);
  return target.field === 'heldAt' ? councilLifecycleValue(value) : value ? readField(value, documentFieldPath(target)) : undefined;
}

function withCommentPlace(value: DocumentData, selected: FieldValue): DocumentData {
  const rows = replaceCommentReference(value.scriptureRefs, selected);
  return rows === undefined || rows === value.scriptureRefs ? value : { ...value, scriptureRefs: rows };
}

export function documentFieldChange(changes: readonly FieldChange[], target: DocumentFieldTarget): FieldChange | undefined {
  if (target.action === 'commentPlaceAction') return placeOfCommentChange(changes);
  const path = documentFieldPath(target);
  const root = changes.find(change => change.path.length === 1 && change.path[0] === path[0]);
  if (!root || path.length === 1) return root;
  const read = (field: FieldValue) => readField(object(field.value) ? field.value : {}, path.slice(1));
  const before = read(root.before), after = read(root.after);
  return equalValues(before, after) ? undefined : { path: [...path], before, after };
}

export function replaceOrderedDocumentField(changes: FieldChange[], target: DocumentFieldTarget, before: FieldValue, after: FieldValue): FieldChange[] {
  const path = documentFieldPath(target);
  const update = (root: FieldValue, leaf: FieldValue): FieldValue => target.action === 'commentPlaceAction'
    ? { ...root, value: replaceCommentReference(root.value, leaf) }
    : path.length === 1 ? leaf
    : !root.exists && !leaf.exists ? root
      : { exists: true, value: writeField(object(root.value) ? root.value : {}, path.slice(1), leaf) };
  return changes.map(change => change.path.length === 1 && change.path[0] === path[0] ? {
    ...change, before: update(change.before, before), after: update(change.after, after),
  } : change);
}

/** An exact pending field change may be the shown basis for the next local change. */
function submittedTextField(checkpoint: SessionCheckpoint, requests: readonly CommitRequest[],
  target: TextDocumentFieldTarget, allowUntimedBasis = false): (TextFieldBasis & { value: string }) | undefined {
  const shown = checkpoint.draft?.[target.field];
  if (!isShortDocumentTitle(shown, target)) return undefined;
  const tip = Object.keys(checkpoint.pending).at(-1);
  const byId = new Map(requests.map(request => [request.id, request]));
  let request = tip && byId.get(tip);
  // An unrelated queued save must not replace the exact action supplying the field.
  const visited = new Set<string>();
  while (request && request.value?.[target.field] === shown && !capturedDocumentField(request, target) && !visited.has(request.id)) {
    visited.add(request.id);
    const earlier = request.predecessor ? byId.get(request.predecessor) : undefined;
    if (allowUntimedBasis && earlier?.value?.[target.field] !== shown) {
      // An acknowledged ancestor may already be out of the pending chain. Use the
      // confirmed title instead of treating an unrelated surviving save as its author.
      if (!earlier && checkpoint.confirmed.value?.[target.field] === shown) return undefined;
      break;
    }
    request = earlier;
  }
  const basis = request ? request.baseline.metadata : null;
  if (!request || request.value?.[target.field] !== shown || !basis || basis.deleted || basis.generation !== checkpoint.confirmed.metadata?.generation) return undefined;
  const action = capturedDocumentField(request, target);
  return { value: shown, generation: basis.generation, revision: action?.observedRevision ?? basis.revision, requestId: request.id };
}

const TITLE_TARGETS: Readonly<Partial<Record<string, TextDocumentFieldTarget>>> = {
  serviceOrders: SERVICE_ORDER_TITLE, prayerRequests: PRAYER_TITLE, studyNotes: STUDY_NOTE_TITLE, planTemplates: PLAN_TEMPLATE_NAME,
};

export function submittedDocumentTitle(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): DocumentTitleSeen | undefined {
  if (!checkpoint || needsAttention) return undefined;
  const target = TITLE_TARGETS[checkpoint.confirmed.resource.collection];
  const shown = target && submittedTextField(checkpoint, requests, target, target === SERVICE_ORDER_TITLE);
  if (!shown) return undefined;
  const { value, ...basis } = shown;
  return { ...basis, title: value };
}

export function submittedStudyNoteType(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): StudyNoteTypeSeen | undefined {
  if (!checkpoint || needsAttention || checkpoint.confirmed.resource.collection !== 'studyNotes') return undefined;
  const shown = submittedTextField(checkpoint, requests, STUDY_NOTE_TYPE);
  if (!shown || !isOrdinaryStudyNoteType(shown.value)) return undefined;
  const { value, ...basis } = shown;
  return { ...basis, type: value };
}

export function submittedTagColor(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): TagColorSeen | undefined {
  if (!checkpoint || needsAttention || checkpoint.confirmed.resource.collection !== 'tags' || checkpoint.draft?.required !== false) return undefined;
  const shown = submittedTextField(checkpoint, requests, TAG_COLOR);
  if (!shown) return undefined;
  const { value, ...basis } = shown;
  return { ...basis, color: value };
}

function matchesTextFieldRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: TextFieldBasis, value: string,
  target: TextDocumentFieldTarget): boolean {
  const action = request && capturedDocumentField(request, target);
  return Boolean(request && action && request.id === seen.requestId && request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.baseline.metadata?.generation === seen.generation && action.after === value
    && action.observedRevision === seen.revision && !['conflict', 'refused', 'cancelled'].includes(request.state));
}

export function matchesPrayerTitleRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: PrayerTitleSeen): boolean {
  return matchesTextFieldRequest(request, owner, resource, seen, seen.title, PRAYER_TITLE);
}

export function matchesPlanTemplateNameRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: DocumentTitleSeen): boolean {
  return matchesTextFieldRequest(request, owner, resource, seen, seen.title, PLAN_TEMPLATE_NAME);
}

export function matchesTagColorRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: TagColorSeen): boolean {
  return matchesTextFieldRequest(request, owner, resource, seen, seen.color, TAG_COLOR);
}

export function validatedTitleCapture(confirmed: ResourceSnapshot, draft: DocumentData | null, next: DocumentData | null,
  capture: ServiceOrderTitleCapture, knownPredecessor: boolean): ServiceOrderTitleCapture | undefined {
  const { seen } = capture;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  const title = next?.title;
  if (confirmed.resource.collection === 'serviceOrders' && !confirmed.metadata?.deleted && seen.generation === confirmed.metadata?.generation
    && Number.isSafeInteger(seen.revision) && seen.revision > 0 && seen.revision <= confirmed.metadata.revision
    && (!seen.requestId || knownPredecessor || confirmed.value?.title === seen.title)
    && isShortDocumentTitle(seen.title, SERVICE_ORDER_TITLE) && isShortDocumentTitle(title, SERVICE_ORDER_TITLE) && time !== undefined) {
    return { seen: { title: seen.title, generation: seen.generation, revision: seen.revision,
      ...(knownPredecessor && seen.requestId && { requestId: seen.requestId }) }, time };
  }
  // Without the shown ancestor, the normal writer may only use the title it actually sees.
  if (seen.generation !== confirmed.metadata?.generation || draft?.title !== seen.title) throw Object.assign(new Error('The service order title changed'), { code: 'stale-write' });
  return undefined;
}

export function captureServiceOrderTitle(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: ServiceOrderTitleCapture): DocumentFieldObservation | undefined {
  if (!capture || baseline.resource.collection !== 'serviceOrders' || baseline.metadata?.generation !== capture.seen.generation) return undefined;
  const after = value?.title;
  if (!isShortDocumentTitle(after, SERVICE_ORDER_TITLE) || after === capture.seen.title) return undefined;
  return { before: capture.seen.title, after, observedRevision: capture.seen.revision, time: capture.time,
    ...(capture.seen.requestId && { predecessorOperationId: capture.seen.requestId }) };
}

function captureRequiredText(baseline: ResourceSnapshot, value: DocumentData | null,
  capture: { time: ActionTime | null; seen: TextFieldBasis } | undefined, before: string | undefined,
  knownPredecessor: boolean, target: TextDocumentFieldTarget): DocumentFieldObservation | undefined {
  if (!capture || baseline.metadata?.deleted || baseline.metadata?.generation !== capture.seen.generation
    || capture.seen.revision > baseline.metadata.revision || !Number.isSafeInteger(capture.seen.revision) || capture.seen.revision < 1
    || (capture.seen.requestId && !knownPredecessor && baseline.value?.[target.field] !== before)) return undefined;
  const { seen } = capture;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  const after = value?.[target.field];
  if (time === undefined || !target.accepts(before) || !target.accepts(after) || after === before) return undefined;
  return { before, after, observedRevision: seen.revision, time,
    ...(knownPredecessor && seen.requestId && { predecessorOperationId: seen.requestId }) };
}

export function capturePrayerTitle(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: PrayerTitleCapture, knownPredecessor = false): DocumentFieldObservation | undefined {
  return baseline.resource.collection === 'prayerRequests'
    ? captureRequiredText(baseline, value, capture, capture?.seen.title, knownPredecessor, PRAYER_TITLE) : undefined;
}

export function capturePlanTemplateName(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: PlanTemplateNameCapture, knownPredecessor = false): DocumentFieldObservation | undefined {
  return baseline.resource.collection === 'planTemplates'
    ? captureRequiredText(baseline, value, capture, capture?.seen.title, knownPredecessor, PLAN_TEMPLATE_NAME) : undefined;
}

export function captureTagColor(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: TagColorCapture, knownPredecessor = false): DocumentFieldObservation | undefined {
  return baseline.resource.collection === 'tags' && baseline.value?.required === false && value?.required === false
    ? captureRequiredText(baseline, value, capture, capture?.seen.color, knownPredecessor, TAG_COLOR) : undefined;
}

function matchesStudyNoteRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: TextFieldBasis,
  before: FieldValue, target: typeof STUDY_NOTE_TITLE | typeof STUDY_NOTE_TYPE): boolean {
  const action = request && capturedDocumentField(request, target);
  return Boolean(request && action && request.id === seen.requestId && request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.baseline.metadata?.generation === seen.generation && equalValues(action.after, before)
    && action.observedRevision === seen.revision && !['conflict', 'refused', 'cancelled'].includes(request.state));
}

export function studyNoteTitleValue(seen: StudyNoteTitleSeen): FieldValue {
  return seen.missing ? { exists: false } : { exists: true, value: seen.title };
}

export function studyNoteTypeValue(seen: StudyNoteTypeSeen): FieldValue {
  return seen.missing ? { exists: false } : { exists: true, value: seen.type };
}

export function matchesStudyNoteTitleRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: StudyNoteTitleSeen): boolean {
  return matchesStudyNoteRequest(request, owner, resource, seen, studyNoteTitleValue(seen), STUDY_NOTE_TITLE);
}

export function matchesStudyNoteTypeRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: StudyNoteTypeSeen): boolean {
  return matchesStudyNoteRequest(request, owner, resource, seen, studyNoteTypeValue(seen), STUDY_NOTE_TYPE);
}

function captureStudyNoteField(baseline: ResourceSnapshot, value: DocumentData | null,
  capture: { time: ActionTime | null; seen: TextFieldBasis }, before: FieldValue, knownPredecessor: boolean,
  target: typeof STUDY_NOTE_TITLE | typeof STUDY_NOTE_TYPE): DocumentFieldObservation<FieldValue> | undefined {
  if (!value || !isOrdinaryStudyNote(value) || !isOrdinaryStudyNote(baseline.value)
    || baseline.resource.collection !== 'studyNotes' || !baseline.metadata || baseline.metadata.deleted) return undefined;
  const { seen } = capture;
  const after = readField(value, [target.field]);
  if (baseline.metadata.generation !== seen.generation || !Number.isSafeInteger(seen.revision)
    || seen.revision < 1 || seen.revision > baseline.metadata.revision
    || (seen.requestId && !knownPredecessor && !equalValues(readField(baseline.value ?? {}, [target.field]), before))
    || !acceptsDocumentField(before, target) || !after.exists || !acceptsDocumentField(after, target) || equalValues(before, after)) return undefined;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined) return undefined;
  return { before, after, observedRevision: seen.revision, time,
    ...(knownPredecessor && seen.requestId && { predecessorOperationId: seen.requestId }) };
}

export function captureStudyNoteTitle(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: StudyNoteTitleCapture, knownPredecessor = false): DocumentFieldObservation<FieldValue> | undefined {
  return capture && captureStudyNoteField(baseline, value, capture, studyNoteTitleValue(capture.seen), knownPredecessor, STUDY_NOTE_TITLE);
}

export function captureStudyNoteType(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: StudyNoteTypeCapture, knownPredecessor = false): DocumentFieldObservation<FieldValue> | undefined {
  return capture && captureStudyNoteField(baseline, value, capture, studyNoteTypeValue(capture.seen), knownPredecessor, STUDY_NOTE_TYPE);
}

type SermonTextTarget = typeof SERMON_TITLE | typeof SERMON_VERSE;
type CapturedMetadataTarget = typeof SERMON_PLAN_MODE | typeof SERMON_REPEATED_WORDS | SermonTextTarget | typeof SERMON_CHURCH | typeof SERMON_GOAL_TYPE | SermonThesisTarget | PreparationTextTarget | PreparationConfirmationTarget | SeriesFieldTarget | CouncilFieldTarget | GroupFieldTarget | typeof GROUP_DESCRIPTION | StudyNoteDraftField | CommentKindDraftField | CommentPlaceDraftField | PrayerStatusTarget | PrayerTextTarget | AccountPreferenceTarget;

function knownMetadataFieldPredecessor(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  target: CapturedMetadataTarget, value: string | FieldValue, records: readonly CommitRequest[]): string | undefined {
  if (!predecessor) return undefined;
  const requests = new Map(records.map(request => [request.id, request]));
  const visited = new Set<string>();
  for (let request: CommitRequest | undefined = predecessor; request && !visited.has(request.id);
    request = requests.get(request.predecessor ?? '')) {
    if (request.owner !== predecessor.owner || !equalValues(request.baseline.resource, baseline.resource)
      || request.baseline.metadata?.generation !== baseline.metadata?.generation || !equalValues(target.field === 'scriptureRefs' ? leadingReferenceValue(request.value)
        : target.field === 'heldAt' ? councilLifecycleValue(request.value)
        : target.field === 'church' || target.field === 'date' || target.field === 'description' || isStudyNoteDraftField(target) || target.field === 'paragraph' || target.field === 'answeredAt' || target.action === 'seriesFieldActions' || target.action === 'prayerTextActions' || 'path' in target ? readField(request.value ?? {}, documentFieldPath(target)) : request.value?.[target.field], value)
      || ['cancelled', 'refused', 'conflict'].includes(request.state)) break;
    const action = capturedDocumentField(request, target);
    if (action) return equalValues(action.after, value) ? request.id : undefined;
    visited.add(request.id);
  }
}

export function sermonPlanModeOpening(checkpoint: SessionCheckpoint, requests: readonly CommitRequest[]): SermonPlanModeOpening | undefined {
  const { confirmed, draft, pending } = checkpoint;
  const metadata = confirmed.metadata;
  if (confirmed.resource.collection !== 'sermons' || !draft || !metadata || metadata.deleted) return undefined;
  const value = readField(draft, SERMON_PLAN_MODE.path);
  if (!acceptsDocumentField(value, SERMON_PLAN_MODE)) return undefined;
  const tip = requests.find(request => request.id === Object.keys(pending).at(-1));
  const requestId = knownMetadataFieldPredecessor(confirmed, tip, SERMON_PLAN_MODE, value, requests);
  const request = requests.find(candidate => candidate.id === requestId);
  const action = request?.sermonPlanModeAction;
  if (!action && !equalValues(value, readField(confirmed.value ?? {}, SERMON_PLAN_MODE.path))) return undefined;
  return { sermonId: confirmed.resource.id, generation: metadata.generation, revision: action?.observedRevision ?? metadata.revision, value,
    ...(requestId && { requestId }) };
}

export function permitsSermonPlanModePredecessor(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: SermonPlanModeOpening): boolean {
  const action = request?.sermonPlanModeAction;
  // A collected receipt was pinned when the mode was shown. The server still validates its scope and field.
  if (!seen.requestId || !request) return true;
  return Boolean(action && request.id === seen.requestId && request.owner === owner
    && equalValues(request.baseline.resource, resource) && request.baseline.metadata?.generation === seen.generation
    && action.observedRevision === seen.revision && equalValues(action.after, seen.value)
    && !['conflict', 'refused', 'cancelled'].includes(request.state));
}

export function captureSermonPlanMode(baseline: ResourceSnapshot, value: DocumentData | null,
  capture: SermonPlanModeCapture, permittedPredecessor: boolean): SermonPlanModeObservation | undefined {
  const { seen, initialize, reviewed } = capture;
  const metadata = baseline.metadata;
  if (baseline.resource.collection !== 'sermons' || baseline.resource.id !== seen.sermonId || !value || !metadata || metadata.deleted
    || metadata.generation !== seen.generation || !Number.isSafeInteger(seen.revision) || seen.revision < 1 || seen.revision > metadata.revision) return undefined;
  const before = seen.value;
  const after = readField(value, SERMON_PLAN_MODE.path);
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (!acceptsDocumentField(before, SERMON_PLAN_MODE) || !after.exists || !acceptsDocumentField(after, SERMON_PLAN_MODE)
    || time === undefined || (initialize && (before.exists || time !== null || reviewed)) || !permittedPredecessor) return undefined;
  return { before, after, observedRevision: seen.revision, time,
    ...(seen.requestId && { predecessorOperationId: seen.requestId }), ...(initialize && { initialize }), ...(reviewed && { reviewed }) };
}

export function submittedPrayerStatus(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): PrayerStatusOpening | undefined {
  if (!checkpoint || needsAttention || checkpoint.confirmed.resource.collection !== 'prayerRequests') return undefined;
  const { metadata } = checkpoint.confirmed;
  const status = checkpoint.draft?.status;
  const tip = requests.find(request => request.id === Object.keys(checkpoint.pending).at(-1));
  if (!metadata || metadata.deleted || !PRAYER_STATUS_FIELDS[0].accepts(status) || !tip) return undefined;
  const answeredAt = readField(checkpoint.draft!, ['answeredAt']);
  const submitted = Object.fromEntries(PRAYER_STATUS_FIELDS.flatMap(target => {
    const before = target.field === 'status' ? status : answeredAt;
    const requestId = knownMetadataFieldPredecessor(checkpoint.confirmed, tip, target, before, requests);
    const request = requests.find(candidate => candidate.id === requestId);
    const action = request && capturedDocumentField(request, target);
    return requestId && action ? [[target.field, { requestId, revision: action.observedRevision }]] : [];
  }));
  if (!Object.keys(submitted).length) return undefined;
  return { generation: metadata.generation, revision: metadata.revision, status, answeredAt, submitted };
}

export function submittedPrayerText(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): PrayerTextOpenings | undefined {
  if (!checkpoint || needsAttention || checkpoint.confirmed.resource.collection !== 'prayerRequests') return undefined;
  const { metadata } = checkpoint.confirmed;
  const draft = checkpoint.draft;
  const tip = requests.find(request => request.id === Object.keys(checkpoint.pending).at(-1));
  if (!draft || !metadata || metadata.deleted || !tip) return undefined;
  const submitted = PRAYER_TEXT_TARGETS.flatMap(target => {
    const value = readField(draft, [target.field]);
    const requestId = knownMetadataFieldPredecessor(checkpoint.confirmed, tip, target, value, requests);
    const action = requestId && requests.find(request => request.id === requestId)?.prayerTextActions?.[target.field];
    return action ? [[target.field, { value, generation: metadata.generation, revision: action.observedRevision, requestId }]] : [];
  });
  return submitted.length ? Object.fromEntries(submitted) : undefined;
}

export function capturePrayerText(baseline: ResourceSnapshot, draft: DocumentData | null, capture: PrayerTextCapture,
  records: readonly CommitRequest[], owner: string): PrayerTextObservations | undefined {
  const { metadata } = baseline;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (!draft || !metadata || metadata.deleted || baseline.resource.collection !== 'prayerRequests' || time === undefined) return undefined;
  const actions = PRAYER_TEXT_TARGETS.flatMap(target => {
    const seen = capture.openings[target.field];
    const after = readField(draft, [target.field]);
    const original = capture.originalTimes;
    const fieldTime = original && own(original, target.field) ? original[target.field] : time;
    if ((fieldTime !== null && !boundedActionTime(fieldTime)) || fieldTime === undefined || !seen || seen.generation !== metadata.generation || !Number.isSafeInteger(seen.revision)
      || seen.revision < 1 || seen.revision > metadata.revision || !acceptsDocumentField(seen.value, target)
      || !acceptsDocumentField(after, target) || equalValues(seen.value, after)) return [];
    const request = seen.requestId && records.find(row => row.id === seen.requestId);
    const action = request && request.prayerTextActions?.[target.field];
    const known = action && request && request.owner === owner && equalValues(request.baseline.resource, baseline.resource)
      && request.baseline.metadata?.generation === seen.generation && action.observedRevision === seen.revision
      && equalValues(action.after, seen.value) && !['conflict', 'refused', 'cancelled'].includes(request.state);
    if (seen.requestId && !known && !equalValues(readField(baseline.value ?? {}, [target.field]), seen.value)) return [];
    return [[target.field, { before: seen.value, after, observedRevision: seen.revision, time: fieldTime,
      ...(known && { predecessorOperationId: seen.requestId }) }]];
  });
  return actions.length ? Object.fromEntries(actions) : undefined;
}

export function matchesPrayerStatusOpening(snapshot: ResourceSnapshot, opening: PrayerStatusOpening): boolean {
  const metadata = snapshot.metadata;
  return snapshot.resource.collection === 'prayerRequests' && Boolean(metadata && !metadata.deleted && metadata.generation === opening.generation
    && Number.isSafeInteger(opening.revision) && opening.revision > 0 && opening.revision <= metadata.revision);
}

export function capturePrayerStatusFields(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  capture: PrayerStatusCapture | undefined, records: readonly CommitRequest[], owner: string): PrayerStatusObservations {
  const metadata = baseline.metadata;
  if (!capture || !draft || baseline.resource.collection !== 'prayerRequests' || !metadata || metadata.deleted
    || (capture.opening && !matchesPrayerStatusOpening(baseline, capture.opening))) return {};
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined) return {};
  const previous = predecessor ? predecessor.value : baseline.value;
  const openingRevision = capture.opening?.revision ?? metadata.revision;
  return Object.fromEntries(PRAYER_STATUS_FIELDS.flatMap(target => {
    const { field } = target;
    const after = field === 'answeredAt' ? readField(draft, [field]) : draft.status;
    if (!capture.fields.includes(field)) {
      const original = capture.original?.[target.action];
      return original && equalValues(original.after, after) && original.observedRevision <= metadata.revision
        ? [[target.action, original]] : [];
    }
    const before = field === 'answeredAt' ? capture.opening?.answeredAt ?? readField(previous ?? {}, [field])
      : capture.opening?.status ?? previous?.status;
    if (before === undefined || after === undefined || equalValues(before, after)) return [];
    if (field === 'status' ? !target.accepts(before) || !target.accepts(after)
      : !objectFieldValue(before, target) || !objectFieldValue(after, target)) return [];
    const submitted = capture.opening?.submitted?.[field];
    const submittedRevision = submitted && Number.isSafeInteger(submitted.revision) && submitted.revision > 0
      && submitted.revision <= openingRevision ? submitted.revision : undefined;
    const request = submittedRevision === undefined ? undefined : records.find(candidate => candidate.id === submitted?.requestId);
    const action = request && capturedDocumentField(request, target);
    const exact = request && request.owner === owner && equalValues(request.baseline.resource, baseline.resource)
      && request.baseline.metadata?.generation === metadata.generation && !['conflict', 'refused', 'cancelled'].includes(request.state)
      && action && action.observedRevision === submittedRevision && equalValues(action.after, before);
    const predecessorOperationId = exact ? request.id
      : knownMetadataFieldPredecessor(baseline, predecessor, target, before as string | FieldValue, records);
    const observedRevision = submittedRevision ?? openingRevision;
    return [[target.action, { before, after, observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }),
      ...(capture.reviewed && { reviewed: true }) }]];
  }));
}

function objectFieldValue(value: unknown, target: PrayerStatusTarget): boolean {
  return value !== null && typeof value === 'object' && 'exists' in value
    && acceptsDocumentField(value as FieldValue, target);
}

function captureSermonField(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  target: SermonTextTarget, time: ActionTime | null, records: readonly CommitRequest[]): DocumentFieldObservation | undefined {
  const before = (predecessor ? predecessor.value : baseline.value)?.[target.field], after = draft?.[target.field];
  if (!target.accepts(before) || !target.accepts(after) || !after.trim() || before === after) return undefined;
  const predecessorOperationId = knownMetadataFieldPredecessor(baseline, predecessor, target, before, records);
  return { before, after, time, observedRevision: baseline.metadata!.revision, ...(predecessorOperationId && { predecessorOperationId }) };
}

function captureStoredMetadataField(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  target: typeof SERMON_CHURCH | typeof SERMON_GOAL_TYPE | typeof SERMON_REPEATED_WORDS | SermonThesisTarget | PreparationTextTarget | PreparationConfirmationTarget | SeriesFieldTarget | AccountPreferenceTarget, time: ActionTime | null, records: readonly CommitRequest[]): DocumentFieldObservation<FieldValue> | undefined {
  if (!draft) return undefined;
  const original = (predecessor ? predecessor.value : baseline.value) ?? {};
  const before = readField(original, documentFieldPath(target));
  const after = readField(draft, documentFieldPath(target));
  if (!acceptsDocumentField(before, target) || !acceptsDocumentField(after, target) || equalValues(before, after)) return undefined;
  const predecessorOperationId = knownMetadataFieldPredecessor(baseline, predecessor, target, before, records);
  return { before, after, time, observedRevision: baseline.metadata!.revision, ...(predecessorOperationId && { predecessorOperationId }) };
}

export function capturePreparationConfirmation(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: { field: PreparationConfirmation; time: ActionTime | null; reviewed?: true }, records: readonly CommitRequest[]): PreparationConfirmationObservations | undefined {
  if (baseline.resource.collection !== 'sermons' || !baseline.metadata || baseline.metadata.deleted) return;
  const target = PREPARATION_CONFIRMATION_TARGETS.find(item => item.field === capture.field);
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (!target || time === undefined) return;
  const observation = captureStoredMetadataField(baseline, predecessor, draft, target, time, records);
  if (observation && (observation.after.exists || capture.reviewed)) {
    return { [target.field]: { ...observation, ...(capture.reviewed && { reviewed: true as const }) } };
  }
}

/** Selected fields share the time of one explicit Save and retain their own ancestors. */
export function captureDocumentMetadataFields(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captured: ActionTime | null | undefined, records: readonly CommitRequest[],
  preferenceFields?: readonly AccountPreferenceField[], sermonMetadataReview?: SermonMetadataReviewProofs, seriesFieldReview?: SeriesFieldReview) {
  if (captured === undefined || !baseline.metadata || baseline.metadata.deleted) return {};
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return {};
  if (baseline.resource.collection === 'users') {
    const actions = ACCOUNT_PREFERENCE_TARGETS.flatMap(target => {
      if (preferenceFields ? !preferenceFields.includes(target.field) : target.path[0] === 'reading') return [];
      const action = captureStoredMetadataField(baseline, predecessor, draft, target, time, records);
      return action ? [[target.field, action] as const] : [];
    });
    return actions.length ? { accountPreferenceActions: Object.fromEntries(actions) } : {};
  }
  if (baseline.resource.collection === 'series') {
    const actions = SERIES_FIELD_TARGETS.flatMap(target => {
      const reviewingSibling = seriesFieldReview && !seriesFieldReview.fields.includes(target.field);
      const action: SeriesFieldObservation | undefined = captureStoredMetadataField(
        baseline, predecessor, draft, target, reviewingSibling ? null : time, records);
      if (!action) return [];
      const earlier = reviewingSibling ? seriesFieldReview.original[target.field] : undefined;
      if (earlier && equalValues(earlier.after, action.after)) return [[target.field, earlier]] as const;
      const openingTheme = (predecessor ? predecessor.value : baseline.value)?.theme;
      const mirror = target.field === 'title' && draft?.theme === action.after.value && typeof openingTheme === 'string';
      return [[target.field, { ...action, ...(mirror && { openingTheme }) }]] as const;
    });
    return actions.length ? { seriesFieldActions: Object.fromEntries(actions) } : {};
  }
  if (baseline.resource.collection !== 'sermons') return {};
  const timeFor = (field: 'title' | 'verse' | 'church') => sermonMetadataReview && sermonMetadataReview.field !== field
    ? sermonMetadataReview[field]?.time ?? null : time;
  const title = captureSermonField(baseline, predecessor, draft, SERMON_TITLE, timeFor('title'), records);
  const verse = captureSermonField(baseline, predecessor, draft, SERMON_VERSE, timeFor('verse'), records);
  const church = captureStoredMetadataField(baseline, predecessor, draft, SERMON_CHURCH, timeFor('church'), records);
  const goalType = captureStoredMetadataField(baseline, predecessor, draft, SERMON_GOAL_TYPE, time, records);
  const repeatedWords = captureStoredMetadataField(baseline, predecessor, draft, SERMON_REPEATED_WORDS, time, records);
  const thesis = SERMON_THESIS_TARGETS.flatMap(target => {
    const action = captureStoredMetadataField(baseline, predecessor, draft, target, time, records);
    const reviewed = sermonMetadataReview?.field === target.field;
    return action && (action.after.exists || reviewed)
      ? [[target.field, { ...action, ...(reviewed && { reviewed: true as const }) }] as const] : [];
  });
  const preparationText = PREPARATION_TEXT_TARGETS.flatMap(target => {
    const action = captureStoredMetadataField(baseline, predecessor, draft, target, time, records);
    return action ? [[target.field, action] as const] : [];
  });
  const opening = (predecessor ? predecessor.value : baseline.value)?.preachDates;
  const fill = draft && captureSermonChurchFill(opening, draft.preachDates, readField(draft, ['church']));
  return { ...(title && { sermonTitleAction: { ...title, ...sermonMetadataReview?.title } }),
    ...(verse && { sermonVerseAction: { ...verse, ...sermonMetadataReview?.verse,
      ...(sermonMetadataReview?.field === 'verse' && { reviewed: true as const }) } }),
    ...(church && { sermonChurchAction: { ...church, ...sermonMetadataReview?.church,
      ...(sermonMetadataReview?.field === 'church' && { reviewed: true as const }) } }),
    ...(goalType?.after.exists && { sermonGoalTypeAction: { ...goalType,
      ...(sermonMetadataReview?.field === 'goalType' && { reviewed: true as const }) } }),
    ...(repeatedWords?.after.exists && { sermonRepeatedWordsAction: repeatedWords }),
    ...(thesis.length && { sermonThesisFieldActions: Object.fromEntries(thesis) }),
    ...(preparationText.length && { sermonPreparationTextActions: Object.fromEntries(preparationText) }),
    ...(fill && { sermonChurchFill: fill }) };
}

export type StudyNoteTimedField = 'content' | 'title' | 'type';
export type AutosaveFieldStamp = { field: GroupTimedField | CouncilFieldTarget['field'] | StudyNoteTimedField | 'paragraph' | 'scriptureRefs'; time: ActionTime | null }
  | import('./rowFieldAutosave').RowFieldStamp | import('./exegeticalPointCapture').ExegeticalPointEditStamp;
type AutosaveFieldValue = string | FieldValue;
type AutosaveFieldAction = DocumentFieldObservation<AutosaveFieldValue> & { reference?: FieldValue; paragraph?: FieldValue };
export type AutosaveFieldDraft = { generation: string; action: AutosaveFieldAction };
type GroupFieldActions = { groupTitleAction?: DocumentFieldObservation; groupStatusAction?: DocumentFieldObservation; groupDescriptionAction?: DocumentFieldObservation<FieldValue> };
type StudyNoteFieldActions = {
  studyNoteContentAction?: DocumentFieldObservation<FieldValue>;
  studyNoteTitleAction?: DocumentFieldObservation<FieldValue>;
  studyNoteTypeAction?: DocumentFieldObservation<FieldValue>;
};
export type AutosaveFieldActions = GroupFieldActions & CouncilFieldActions & StudyNoteFieldActions & { commentKindAction?: CommentKindObservation; commentPlaceAction?: CommentPlaceObservation };
type GroupFieldTarget = TextDocumentFieldTarget & { action: keyof GroupFieldActions; draft: 'groupTitleDraft' | 'groupStatusDraft' };
const STUDY_NOTE_DRAFT_FIELDS = [
  { ...STUDY_NOTE_CONTENT, draft: 'studyNoteContentDraft' },
  { ...STUDY_NOTE_TITLE, draft: 'studyNoteTitleDraft' },
  { ...STUDY_NOTE_TYPE, draft: 'studyNoteTypeDraft' },
] as const;
const COMMENT_KIND_DRAFT = { ...COMMENT_KIND, draft: 'commentKindDraft' } as const;
const COMMENT_PLACE_DRAFT = { ...COMMENT_PLACE, draft: 'commentPlaceDraft' } as const;
type CommentKindDraftField = typeof COMMENT_KIND_DRAFT;
type CommentPlaceDraftField = typeof COMMENT_PLACE_DRAFT;
type StudyNoteDraftField = typeof STUDY_NOTE_DRAFT_FIELDS[number];
type AutosaveFieldTarget = GroupFieldTarget | typeof GROUP_DESCRIPTION | StudyNoteDraftField | CommentKindDraftField | CommentPlaceDraftField | CouncilFieldTarget;
export type AutosaveFieldDrafts = Partial<Record<AutosaveFieldTarget['draft'], AutosaveFieldDraft>>;

function isStudyNoteDraftField(target: AutosaveFieldTarget | CapturedMetadataTarget): target is StudyNoteDraftField {
  return target.action === 'studyNoteContentAction' || target.action === 'studyNoteTitleAction' || target.action === 'studyNoteTypeAction';
}

export function autosaveFieldTargets(collection: string): readonly AutosaveFieldTarget[] {
  if (collection === 'groups') return GROUP_TIMED_FIELDS;
  if (collection === 'councils') return COUNCIL_FIELDS;
  if (collection === 'studyNotes') return [...STUDY_NOTE_DRAFT_FIELDS, COMMENT_KIND_DRAFT, COMMENT_PLACE_DRAFT];
  return [];
}

function autosaveFieldValue(document: DocumentData | null | undefined, target: AutosaveFieldTarget): AutosaveFieldValue | undefined {
  if (isStudyNoteDraftField(target)) {
    const acceptsDocument = target.field === 'content' ? isStudyNoteBodyDocument : isOrdinaryStudyNote;
    return document && acceptsDocument(document) ? readField(document, [target.field]) : undefined;
  }
  if (target.field === 'paragraph') return document?.type === 'comment' ? readField(document, ['paragraph']) : undefined;
  if (target.field === 'scriptureRefs') return leadingReferenceValue(document ?? null);
  if (target.field === 'date' || target.field === 'description') return readField(document ?? {}, [target.field]);
  if (target.field === 'heldAt') return councilLifecycleValue(document);
  const value = document?.[target.field];
  return typeof value === 'string' ? value : undefined;
}

function acceptsAutosaveField(value: AutosaveFieldValue | undefined, target: AutosaveFieldTarget): value is AutosaveFieldValue {
  return value !== undefined && acceptsDocumentField(observedValue(value), target);
}

/** An autosaved field retains the displayed ancestor across keystrokes and unrelated edits. */
export function stageAutosaveField(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined,
  target: AutosaveFieldTarget, stamp: AutosaveFieldStamp | undefined): AutosaveFieldDraft | undefined {
  const oldValue = autosaveFieldValue(checkpoint.draft, target), nextValue = autosaveFieldValue(value, target);
  if (equalValues(oldValue, nextValue)) return checkpoint[target.draft];
  const metadata = checkpoint.confirmed.metadata;
  const time = stamp?.field === target.field
    ? ('causal' in target && target.causal && stamp.time === null ? null : boundedActionTime(stamp.time)) : undefined;
  if (!metadata || metadata.deleted || time === undefined || !acceptsAutosaveField(nextValue, target)) return undefined;
  const visible = shown?.confirmed.metadata?.generation === metadata.generation
    && (isStudyNoteDraftField(target) || target.field === 'paragraph' || target.field === 'scriptureRefs' || shown.editGeneration === checkpoint.editGeneration) ? shown : checkpoint;
  const staged = checkpoint[target.draft];
  // A matched stored value is the opening of the next gesture. Its earlier proof
  // remains eligible for delivery until the person actually changes this field again.
  const prior = staged?.generation === metadata.generation && equalValues(staged.action.after, oldValue)
    && !equalValues(oldValue, autosaveFieldValue(checkpoint.confirmed.value, target)) ? staged.action : undefined;
  const tip = Object.values(checkpoint.pending).reduce<SessionCheckpoint['pending'][string] | undefined>((latest, item) =>
    !latest || item.generation > latest.generation ? item : latest, undefined);
  const pending = tip && equalValues(autosaveFieldValue(tip.value, target), oldValue) ? tip : undefined;
  const before = prior && !pending ? prior.before : pending ? oldValue : autosaveFieldValue(visible.draft ?? checkpoint.draft, target) ?? oldValue;
  if (!acceptsAutosaveField(before, target) || equalValues(before, nextValue)) return undefined;
  const observedRevision = prior?.observedRevision ?? pending?.[target.action]?.observedRevision ?? visible.confirmed.metadata!.revision;
  const reference = target.field === 'paragraph'
    ? prior?.reference ?? readField(visible.draft ?? {}, ['scriptureRefs']) : undefined;
  if (target.field !== 'scriptureRefs') {
    return { generation: metadata.generation, action: { before, after: nextValue, observedRevision, time, ...(reference && { reference }) } };
  }
  const opening = observedValue(before).value, destination = observedValue(nextValue).value;
  if (visible.confirmed.value?.type !== 'comment' || !object(opening) || !object(destination) || opening.id !== destination.id) return undefined;
  const paragraph = prior?.paragraph ?? readField(visible.confirmed.value, ['paragraph']);
  return { generation: metadata.generation, action: { before, after: nextValue, observedRevision, time, paragraph } };
}

export function withQueuedGroupScalarProofs(source: SessionCheckpoint,
  fields: readonly { path: string[]; before: string | null; mine: string | null }[]): SessionCheckpoint {
  const { resource, metadata } = source.confirmed;
  if (!fields.length || resource.collection !== 'groups' || !metadata
    || metadata.generation !== source.remoteCandidate?.metadata?.generation) return source;
  const retained = { ...source };
  for (const target of GROUP_TIMED_FIELDS) {
    const field = fields.find(choice => choice.path.length === 1 && choice.path[0] === target.field);
    if (!field) continue;
    const before = rowConflictValue(field.before), after = rowConflictValue(field.mine);
    const action = Object.values(source.pending).map(request => request[target.action]).find(item =>
      item?.time && equalValues(observedValue(item.before), before) && equalValues(observedValue(item.after), after));
    const staged = retained[target.draft];
    if (action && (!staged || !equalValues(observedValue(staged.action.after), after))) {
      retained[target.draft] = { generation: metadata.generation, action };
    }
  }
  return retained;
}

/** Keep the submitted proof of a sibling that already belongs to the projected result. */
export function withSubmittedScalarProofs(source: SessionCheckpoint, requestId: string, chosen: DocumentData): SessionCheckpoint {
  const { resource, metadata } = source.confirmed;
  const submitted = source.pending[requestId];
  if (!submitted || !metadata || metadata.generation !== source.remoteCandidate?.metadata?.generation) return source;
  const retained = { ...source };
  for (const target of autosaveFieldTargets(resource.collection)) {
    const action = submitted[target.action];
    const after = autosaveFieldValue(chosen, target);
    if (!action || !equalValues(action.after, after) || equalValues(after, autosaveFieldValue(source.remoteCandidate.value, target))) continue;
    const staged = retained[target.draft];
    if (staged?.generation !== metadata.generation || !equalValues(staged.action.after, after)) {
      retained[target.draft] = { generation: metadata.generation, action };
    }
  }
  return retained;
}

/** A step choice can replay this separate status only with the evidence captured by its Save. */
export function groupStatusOutsideChoice(source: SessionCheckpoint, requestId: string) {
  const { confirmed, remoteCandidate, conflicts, draft, pending, groupStatusDraft } = source;
  const metadata = confirmed.metadata;
  const submitted = pending[requestId];
  const action = submitted?.groupStatusAction;
  if (confirmed.resource.collection !== 'groups' || !metadata || metadata.deleted || !remoteCandidate?.value
    || metadata.generation !== remoteCandidate.metadata?.generation || !conflicts.length
    || conflicts.some(({ path }) => !path.length || path[0] === 'status')
    || !action || !isGroupStatus(action.before) || !isGroupStatus(action.after)
    || submitted.value?.status !== action.after || draft?.status !== action.after
    || (groupStatusDraft && submitted.generation < source.editGeneration && !sameAutosaveCapture(groupStatusDraft.action, action))) return undefined;
  return { generation: metadata.generation, action };
}

export function carryAutosaveFieldDrafts(source: SessionCheckpoint, target: SessionCheckpoint,
  keep: (path: readonly string[]) => boolean): void {
  for (const field of autosaveFieldTargets(target.confirmed.resource.collection)) {
    if (!source[field.draft] || !keep([field.field])) continue;
    target[field.draft] = source[field.draft];
    if (!autosaveDraftAction(target, field)) delete target[field.draft];
  }
}

function autosaveDraftAction(checkpoint: SessionCheckpoint, target: AutosaveFieldTarget): AutosaveFieldAction | undefined {
  const staged = checkpoint[target.draft];
  const metadata = checkpoint.confirmed.metadata;
  if (!staged || !metadata || metadata.deleted || staged.generation !== metadata.generation
    || staged.action.observedRevision > metadata.revision
    || !equalValues(staged.action.after, autosaveFieldValue(checkpoint.draft, target))) return undefined;
  return staged.action;
}

export function sameAutosaveCapture(left: AutosaveFieldAction | undefined, right: AutosaveFieldAction | undefined): boolean {
  return Boolean(left && right && equalValues(left.before, right.before) && equalValues(left.after, right.after)
    && equalValues(left.time, right.time) && equalValues(left.reference, right.reference) && equalValues(left.paragraph, right.paragraph) && left.observedRevision === right.observedRevision);
}

function uncapturedAutosaveField(checkpoint: SessionCheckpoint, target: AutosaveFieldTarget): AutosaveFieldAction | undefined {
  const action = autosaveDraftAction(checkpoint, target);
  return action && !Object.values(checkpoint.pending).some(request => sameAutosaveCapture(request[target.action], action)) ? action : undefined;
}

export function uncapturedAutosaveFields(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[], editorId?: string): AutosaveFieldActions {
  const actions: AutosaveFieldActions = Object.fromEntries(autosaveFieldTargets(checkpoint.confirmed.resource.collection).flatMap(target => {
    const action = uncapturedAutosaveField(checkpoint, target);
    if (!action) return [];
    const opening = isStudyNoteDraftField(target)
      ? unregisteredNotePredecessor(checkpoint, predecessor, target, action, editorId) ?? action.before : action.before;
    const predecessorOperationId = target.causal
      ? knownMetadataFieldPredecessor(baseline, predecessor, target, opening, records) : undefined;
    return [[target.action, { ...action, before: predecessorOperationId ? opening : action.before,
      ...(predecessorOperationId && { predecessorOperationId }) }]];
  }));
  if (actions.commentPlaceAction && checkpoint.draft) {
    const represented = predecessor?.value ?? baseline.value;
    const changesKind = represented?.type !== checkpoint.draft.type || represented?.paragraph !== checkpoint.draft.paragraph;
    if (changesKind) {
      // Keep both captured edits for local acknowledgement. The command uses the compound place guard.
      return { ...actions, commentPlaceAction: { ...actions.commentPlaceAction, compound: true } };
    }
  }
  return actions;
}

/** Both captures can belong to the same typing sequence while the first local Save is still being written. */
function unregisteredNotePredecessor(checkpoint: SessionCheckpoint, predecessor: CommitRequest | undefined,
  target: StudyNoteDraftField, action: AutosaveFieldAction, editorId: string | undefined): FieldValue | undefined {
  if (!predecessor || predecessor.editorId !== editorId || predecessor.editGeneration >= checkpoint.editGeneration
    || Object.hasOwn(checkpoint.pending, predecessor.id) || checkpoint.conflicts.length
    || !equalValues(predecessor.baseline.resource, checkpoint.confirmed.resource)
    || predecessor.baseline.metadata?.generation !== checkpoint.confirmed.metadata?.generation) return undefined;
  const earlier = predecessor[target.action];
  if (!earlier || earlier.observedRevision !== action.observedRevision || !equalValues(earlier.before, action.before)
    || !equalValues(earlier.after, autosaveFieldValue(predecessor.value, target))) return undefined;
  return earlier.after;
}

export function observedAutosaveFieldsMatch(checkpoint: SessionCheckpoint, merged: DocumentData, awaitingOrder: boolean): boolean {
  return autosaveFieldTargets(checkpoint.confirmed.resource.collection).every(target => {
    const action = autosaveDraftAction(checkpoint, target);
    return !action || equalValues(action.after, autosaveFieldValue(merged, target))
      || (awaitingOrder && action.time !== null && equalValues(action.after, autosaveFieldValue(checkpoint.confirmed.value, target)));
  });
}

/** Matching words can retire an untimed edit. A timed action still records its place in the order. */
export function retireObservedAutosaveFields(checkpoint: SessionCheckpoint): void {
  for (const target of autosaveFieldTargets(checkpoint.confirmed.resource.collection)) {
    const action = autosaveDraftAction(checkpoint, target);
    if (action?.time === null && !equalValues(action.before, action.after)
      && equalValues(action.after, autosaveFieldValue(checkpoint.confirmed.value, target))) delete checkpoint[target.draft];
  }
}

export function hasUncapturedAutosaveField(checkpoint: SessionCheckpoint): boolean {
  return autosaveFieldTargets(checkpoint.confirmed.resource.collection).some(target => Boolean(uncapturedAutosaveField(checkpoint, target)));
}

/** A later local edit may be staged while its own predecessor is still being captured. */
export function adoptAcknowledgedStudyNoteFields(checkpoint: SessionCheckpoint, submitted: StudyNoteFieldActions,
  accepted: ResourceSnapshot, operationId: string): void {
  const metadata = accepted.metadata;
  if (accepted.resource.collection !== 'studyNotes' || metadata?.operationId !== operationId || metadata.deleted) return;
  for (const target of STUDY_NOTE_DRAFT_FIELDS) {
    const captured = submitted[target.action];
    if (captured) adoptAcknowledgedStudyNoteField(checkpoint, target, captured, accepted, metadata);
  }
}

function adoptAcknowledgedStudyNoteField(checkpoint: SessionCheckpoint, target: StudyNoteDraftField,
  submitted: DocumentFieldObservation<FieldValue>, accepted: ResourceSnapshot, metadata: NonNullable<ResourceSnapshot['metadata']>): void {
  const action = uncapturedAutosaveField(checkpoint, target);
  const opening = autosaveFieldValue(accepted.value, target);
  if (!action || !acceptsAutosaveField(opening, target) || !equalValues(opening, submitted.after)
    || metadata.generation !== checkpoint[target.draft]?.generation
    || !(equalValues(action.before, submitted.before) || equalValues(action.before, opening))) return;
  if (equalValues(opening, action.after)) {
    delete checkpoint[target.draft];
    return;
  }
  checkpoint[target.draft] = { generation: metadata.generation, action: {
    before: opening, after: action.after, observedRevision: metadata.revision, time: action.time,
  } };
}

export function autosaveAcknowledgementAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
  checkpoint: SessionCheckpoint): DocumentData | null {
  if (!ancestor) return ancestor;
  return autosaveFieldTargets(checkpoint.confirmed.resource.collection).reduce((before, target) => {
    // A returned note field can differ from the predecessor the person kept editing.
    if (isStudyNoteDraftField(target)) return before;
    const action = autosaveDraftAction(checkpoint, target);
    const value = autosaveFieldValue(accepted.value, target);
    if (!action || !equalValues(action.before, autosaveFieldValue(before, target))
      || accepted.metadata?.generation !== checkpoint[target.draft]?.generation || !acceptsAutosaveField(value, target)) return before;
    const stored = observedValue(value);
    return target.action === 'commentPlaceAction' ? withCommentPlace(before, stored) : withDocumentFieldValue(before, target.field, stored);
  }, ancestor);
}

function withDocumentFieldValue(value: DocumentData, field: string, selected: FieldValue): DocumentData {
  return field === 'heldAt' ? withCouncilLifecycle(value, selected) : writeField(value, [field], selected);
}

export function pendingDocumentFieldAncestor(record: CommitRequest, before: DocumentData | null, accepted: ResourceSnapshot): DocumentData | null {
  if (!before || !accepted.value || accepted.metadata?.generation !== record.baseline.metadata?.generation) return before;
  return documentFieldTargets(record.baseline.resource.collection).reduce((value, target) => {
    if (!capturedDocumentField(record, target)) return value;
    const stored = documentFieldValue(accepted.value, target);
    if (!stored || !acceptsDocumentField(stored, target)) return value;
    const rebased = target.action === 'commentPlaceAction' ? withCommentPlace(value, stored)
      : 'path' in target ? writeField(value, target.path, stored) : withDocumentFieldValue(value, target.field, stored);
    if (target.action !== 'seriesFieldActions' || target.field !== 'title' || record.value?.title !== record.value?.theme) return rebased;
    const mirror = readField(accepted.value!, ['theme']);
    return equalValues(mirror, stored) ? withDocumentFieldValue(rebased, 'theme', mirror) : rebased;
  }, before);
}

type StoredObservation = DocumentFieldObservation<string | FieldValue> & { openingTheme?: string; reference?: FieldValue; paragraph?: FieldValue; compound?: true; reviewed?: true; initialize?: true };

function observedValue(value: string | FieldValue): FieldValue {
  return typeof value === 'string' ? { exists: true, value } : value;
}

export function documentFieldCommandAncestor(working: ResourceSnapshot, action: StoredObservation, target: DocumentFieldTarget): ResourceSnapshot {
  if (!working.value || working.metadata?.deleted) return working;
  const selected = observedValue(action.before);
  const value = target.action === 'commentPlaceAction' ? withCommentPlace(working.value, selected)
    : 'path' in target ? writeField(working.value, target.path, selected) : withDocumentFieldValue(working.value, target.field, selected);
  return { ...working, value: target.field === 'title' && action.openingTheme !== undefined ? { ...value, theme: action.openingTheme } : value };
}

export function withDocumentFieldAction(command: DataCommand, target: DocumentFieldTarget, action?: StoredObservation): DataCommand {
  if (!action || command.kind !== 'update') return command;
  const change = documentFieldChange(command.changes, target);
  if (!change || !equalValues(change.before, observedValue(action.before)) || !equalValues(change.after, observedValue(action.after))) return command;
  const { observedRevision, time, predecessorOperationId } = action;
  const stamp = { observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) };
  if (target.action === 'accountPreferenceActions') {
    return { ...command, accountPreferenceActions: { ...command.accountPreferenceActions, [target.field]: stamp } };
  }
  if (target.action === 'seriesFieldActions') {
    return { ...command, seriesFieldActions: { ...command.seriesFieldActions,
      [target.field]: { ...stamp, ...(action.openingTheme !== undefined && { openingTheme: action.openingTheme }) } } };
  }
  if (target.action === 'sermonPreparationCheckActions' || target.action === 'sermonThesisFieldActions') {
    return { ...command, [target.action]: { ...command[target.action],
      [target.field]: { ...stamp, ...(action.reviewed && { reviewed: true }) } } };
  }
  if (target.action === 'prayerTextActions' || target.action === 'sermonPreparationTextActions') {
    return { ...command, [target.action]: { ...command[target.action], [target.field]: stamp } };
  }
  if (target.action === 'sermonPlanModeAction') {
    return { ...command, sermonPlanModeAction: { ...stamp, ...(action.initialize && { initialize: true }),
      ...(action.reviewed && { reviewed: true }) } };
  }
  if (target.action === 'commentKindAction') {
    return action.reference ? { ...command, commentKindAction: { ...stamp, reference: action.reference } } : command;
  }
  if (target.action === 'commentPlaceAction') {
    return action.paragraph ? { ...command, commentPlaceAction: { ...stamp, paragraph: action.paragraph, ...(action.compound && { compound: true }), ...(action.reviewed && { reviewed: true }) } } : command;
  }
  if (target.action === 'sermonVerseAction' || target.action === 'sermonChurchAction' || target.action === 'sermonGoalTypeAction') {
    return { ...command, [target.action]: { ...stamp, ...(action.reviewed && { reviewed: true }) } };
  }
  if (target.action === 'prayerAnsweredAtAction') return { ...command, prayerAnsweredAtAction: { ...stamp, ...(action.reviewed && { reviewed: true }) } };
  if (target.field === 'heldAt' && !matchesCouncilLifecycle(command.changes, change)) return command;
  if (target.action === 'groupDescriptionAction' || 'path' in target || target.field === 'date' || target.field === 'heldAt') return { ...command, [target.action]: stamp };
  if (target.action === 'studyNoteContentAction') return { ...command, studyNoteContentAction: { ...stamp, ...(action.reviewed && { reviewed: true }) } };
  if (target.action === 'studyNoteTitleAction' || target.action === 'studyNoteTypeAction' || target.action === 'planTemplateNameAction' || target.action === 'tagColorAction') return { ...command, [target.action]: stamp };
  if (typeof action.before !== 'string' || typeof action.after !== 'string') return command;
  return { ...command, [target.action]: action };
}
