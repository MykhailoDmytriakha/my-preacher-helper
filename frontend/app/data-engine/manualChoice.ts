import { matchesSermonNoteOpening, sermonNoteChanged, withSermonNoteText } from '@/utils/sermonNoteText';

import { isUnsignedAnchoredPlacementRefusal, withoutUnsignedRowOrder } from './anchoredRowPlacement';
import { keepReviewedAuthoredLists } from './authoredListChoice';
import { isAuthoredListComparison } from './authoredStringList';
import { orderCommitRequests } from './commits';
import { captureCouncilTopicPlacement, projectCouncilTopicOnDocument } from './councilTopicPlacement';
import { autosaveFieldTargets, isOrderedSermonMetadata } from './documentFieldAction';
import { keepUncontestedDocumentText, manualSeriesTextChoiceFields } from './documentTextChoice';
import { areSameTabManualParents, editorSlot, manualChoiceRecoveryIdentity, protectSermonRecoveryEditor, readManualScopeIdentity } from './editorIdentity';
import { writeField } from './fieldValues';
import { firstGroupMeetingReview, projectFirstGroupMeetingChoice } from './groupFirstMeeting';
import { captureGroupMeetingReview } from './groupMeetingReview';
import { captureGroupStepPlacement, carryAnchoredDraftChronology, groupPlacementSteps, mergeEditsAfterAnchoredPlacement, mergeGroupFlowRebase, projectGroupStepOnDocument } from './groupStepPlacement';
import { projectHomileticReview, reviewedHomileticList } from './homileticPlanChoice';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectManualSelection, type ManualPath } from './manualScope';
import { projectOutlineParentChoice, type OutlineTitleDecision } from './outlineParentChoice';
import { projectResourceOutlinePoint } from './outlinePointPlacement';
import { chooseLocalPreachDateEdits, isOrderedPreachDateField, preachDateChoiceFrames } from './preachDateChoice';
import { preachDateNoteConflictId } from './preachDateFieldAction';
import { equalValues, mergeDocumentFields, mergeFields } from './protocol';
import { carryOutlineTitleActions, carryOrderedPreachDateFields, PREACH_DATE_REVIEW_FIELDS, restoreSavedRowFieldDrafts, stageReviewedOutlineTitleIds, stageReviewedRowFields } from './rowFieldAutosave';
import { isReturnedSeriesField, seriesReviewFrames } from './seriesFieldAction';
import { isReturnedSermonTitle, isSermonChurchReview, isSermonVerseReview, keepUncontestedSermonFields, readSermonConflictField, reviewedSermonPreparationField, sermonHeaderReviewFrames, withReviewedSermonChurchDates } from './sermonFieldChoice';
import { placementSteps } from './serviceOrderStepPlacement';
import { canReplaceSnapshot } from './snapshotFreshness';
import { matchesSourceNoteOpening, projectSourceNoteChoices } from './sourceNoteLinkCapture';
import { withoutUnsignedTemplateOrder } from './templateOutlineMerge';
import { localThoughtPlacementChoices } from './thoughtPlacementAction';
import { changedThoughtTagTarget } from './thoughtTagAction';
import { readThoughtTextConflict, thoughtTextConflictId } from './thoughtTextAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { EditorRecord } from './controller';
import type { ManualScope } from './manualScope';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

type ManualStage = ReturnType<ManualScope['getState']>;
const unanswered = (request: CommitRequest) => !['acknowledged', 'cancelled'].includes(request.state);

function hasLaterScope(request: CommitRequest, requests: ReadonlyMap<string, CommitRequest>): boolean {
  const related = [...requests.values()].filter(item => item.owner === request.owner && equalValues(item.baseline.resource, request.baseline.resource));
  const descendants = new Set([request.id]);
  for (const item of orderCommitRequests(related)) {
    if (!item.predecessor || !descendants.has(item.predecessor)) continue;
    if (unanswered(item) && item.editorId !== request.editorId) return true;
    descendants.add(item.id);
  }
  return false;
}

/** Explicit recovery grants authority only over a proved, answered ancestor of the shown form. */
export function exactManualRequest(stage: ManualStage | undefined, checkpoint: SessionCheckpoint,
  requests: ReadonlyMap<string, CommitRequest>): CommitRequest | undefined {
  if (!stage) return undefined;
  const { record } = stage;
  const visited = new Set<string>();
  let id = record.predecessor?.id;
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = requests.get(id);
    if (!request || request.owner !== record.owner || !equalValues(request.baseline.resource, record.resource)) return undefined;
    const pending = checkpoint.pending[id];
    if (pending && request.value && ['conflict', 'refused'].includes(request.state)) {
      const recovered = record.recoverySources?.some(source => source.id === request.editorId);
      const markedList = request.result?.kind === 'conflict' && (request.result.conflicts.some(({ code, path }) =>
        isAuthoredListComparison(code) && record.selection.some(selected => equalValues(selected, path)))
        || reviewedHomileticList(request.result.conflicts, record.selection));
      const meeting = request.result?.kind === 'conflict' && firstGroupMeetingReview(request.result.conflicts)
        && record.selection.some(path => equalValues(path, ['meetingDates']));
      const savedForm = meeting && readManualScopeIdentity(request.editorId);
      const shownForm = meeting && readManualScopeIdentity(record.scopeId);
      const sameMeetingForm = savedForm && shownForm && savedForm.slot === 'group-meeting' && shownForm.slot === savedForm.slot
        && savedForm.parentEditorId === shownForm.parentEditorId;
      const thoughtText = request.result?.kind === 'conflict' && request.result.conflicts.some(({ path }) => {
        const id = thoughtTextConflictId(path);
        return id && record.selection.some(selected => equalValues(selected, ['thoughts', { id }])
          || equalValues(selected, ['thoughts', { id }, 'text']));
      });
      const dateNotes = request.result?.kind === 'conflict'
        && request.result.conflicts.some(({ path }) => preachDateNoteConflictId(path)) && record.selection.some(path => equalValues(path, ['preachDates']));
      const returnedField = record.resource.collection === 'sermons' ? (conflict: ConflictDetail) =>
        isReturnedSermonTitle(conflict) || isSermonVerseReview(conflict) || isSermonChurchReview(conflict) || reviewedSermonPreparationField(conflict) !== undefined
        : record.resource.collection === 'series' ? isReturnedSeriesField : undefined;
      const savedFieldReview = returnedField && request.result?.kind === 'conflict'
        && request.result.conflicts.some(conflict => returnedField(conflict)
          && record.selection.some(path => equalValues(path, conflict.path)));
      const fieldScope = request.sermonVerseAction?.reviewed || request.sermonChurchAction?.reviewed || request.sermonGoalTypeAction?.reviewed
        || Object.values(request.sermonThesisFieldActions ?? {}).some(action => action?.reviewed)
        ? request.retentionScope ?? request.editorId : request.editorId;
      const savedFieldForm = savedFieldReview && readManualScopeIdentity(fieldScope);
      const openFieldForm = savedFieldReview && readManualScopeIdentity(record.scopeId);
      const sameTabFieldForm = savedFieldForm && openFieldForm && savedFieldForm.slot === openFieldForm.slot
        && editorSlot(savedFieldForm.parentEditorId) === editorSlot(openFieldForm.parentEditorId)
        && areSameTabManualParents(savedFieldForm.parentEditorId, openFieldForm.parentEditorId, record.resource);
      if (recovered || sameMeetingForm || sameTabFieldForm || (record.scopeId === request.editorId
          && (markedList || meeting || thoughtText || dateNotes || hasLaterScope(request, requests)))) return request;
    }
    id = request.predecessor ?? undefined;
  }
  return undefined;
}

export function exactManualWords(stage: ManualStage, request: CommitRequest): DocumentData {
  return stage.record.predecessor?.id === request.id ? stage.value : request.value!;
}

export interface ExactManualChoice {
  choice: 'local' | 'remote';
  titles?: readonly OutlineTitleDecision[];
  choiceTime?: ActionTime | null;
  request: CommitRequest;
  stored: ResourceSnapshot;
  value: DocumentData;
  selection: readonly ManualPath[];
  privateStage?: { scopeId: string; generation: number; predecessorId: string; base: DocumentData; value: DocumentData };
}

function afterChoice(confirmed: ResourceSnapshot, draft: DocumentData | null, generation: number): SessionCheckpoint {
  return { confirmed, draft, dirty: !equalValues(draft, confirmed.value), editGeneration: generation,
    pending: {}, conflicts: [], remoteCandidate: null };
}

export function manualChoiceFrames(request: CommitRequest, value: DocumentData, stored: ResourceSnapshot) {
  const prepared = request.initialized && request.command;
  const basis = prepared ? request.working : request.baseline;
  const reviewed = prepared ? replaySavedChoiceDelta(stored.resource, request.value, value, request.intended) : value;
  const conflicts = request.result?.kind === 'conflict' ? request.result.conflicts : [];
  const ordered = conflicts.filter(isOrderedSermonMetadata);
  if (ordered.length) return { ...sermonHeaderReviewFrames(basis, reviewed, stored, ordered, request.sermonChurchFill),
    conflicts: conflicts.filter(conflict => !isOrderedSermonMetadata(conflict)) };
  return seriesReviewFrames(basis, reviewed, stored, conflicts);
}

/** The comparison decides its one Save. Later branches remain separate drafts until explicitly recovered. */
export function projectExactManualChoice(record: EditorRecord, decision: ExactManualChoice, retired: CommitRequest[]): EditorRecord[] {
  const { checkpoint } = record;
  const ids = new Set(retired.map(request => request.id));
  const pending = Object.entries(checkpoint.pending);
  const latest = pending.reduce((generation, [, intent]) => Math.max(generation, intent.generation), -1);
  if (record.prepared || !checkpoint.pending[decision.request.id] || pending.some(([id]) => !ids.has(id))
    || !pending.some(([, intent]) => intent.generation === latest && equalValues(intent.value, checkpoint.draft))) {
    throw Object.assign(new Error('Save or resolve other document changes before resolving this form'), { code: 'other-changes-first' });
  }
  if (decision.choice === 'local' && (!decision.stored.value || decision.stored.metadata?.deleted)) {
    throw Object.assign(new Error('Remote document was deleted; use a new copy to preserve this draft'), { code: 'use-new-copy' });
  }
  const { request, stored } = decision;
  let draft = stored.value;
  const prepared = request.initialized && request.command;
  const { basis, reviewed: intended, conflicts: reviewedConflicts } = manualChoiceFrames(request, decision.value, stored);
  const churchReview = reviewedConflicts.length === 1 && isSermonChurchReview(reviewedConflicts[0])
    && request.baseline.resource.collection === 'sermons' && decision.selection.some(path => equalValues(path, ['church']));
  const chosenChurch = churchReview ? readSermonConflictField(decision.choice === 'local' ? intended ?? {} : stored.value ?? {}, ['church']) : undefined;
  const reviewed = chosenChurch ? withReviewedSermonChurchDates(basis.value, intended, stored.value, chosenChurch, request.sermonChurchFill) : intended;
  const homiletic = request.result?.kind === 'conflict' && reviewedHomileticList(request.result.conflicts, decision.selection);
  const meeting = request.result?.kind === 'conflict' && decision.selection.some(path => equalValues(path, ['meetingDates']))
    && firstGroupMeetingReview(request.result.conflicts);
  const outline = request.result?.kind === 'conflict'
    ? projectOutlineParentChoice(basis, reviewed, stored, request.result.conflicts, decision.choice, decision.titles) : undefined;
  if (outline && stored.value) {
    draft = projectManualSelection(stored.value, outline, decision.selection);
  } else if (meeting && stored.value) {
    const amendment = decision.choice === 'local' ? { before: request.value, after: decision.value } : undefined;
    const chosen = projectFirstGroupMeetingChoice(stored.value, meeting, decision.choice, amendment);
    if (!chosen) throw Object.assign(new Error('The first meeting comparison changed'), { code: 'decision-changed' });
    draft = projectManualSelection(stored.value, chosen, decision.selection);
  } else if (homiletic && stored.value && request.result?.kind === 'conflict') {
    const chosen = projectHomileticReview(basis.value, reviewed, stored.value, request.result.snapshot.value,
      homiletic, request.result.conflicts, decision.choice, prepared ? request.intended : request.value);
    if (!chosen) throw Object.assign(new Error('The Homiletic plan comparison changed'), { code: 'decision-changed' });
    draft = projectManualSelection(stored.value, chosen, decision.selection);
  } else if (decision.choice === 'local') {
    if (stored.value && changedThoughtTagTarget(stored.value, request)) {
      throw Object.assign(new Error('The thought that was edited is gone'), { code: 'decision-changed' });
    }
    if (request.result?.kind === 'conflict' && stored.value && request.result.conflicts.some(({ path }) => {
      const id = thoughtTextConflictId(path);
      return id && (!reviewed || !readThoughtTextConflict(id, reviewed, stored.value!));
    })) throw Object.assign(new Error('The thought that was compared has changed'), { code: 'decision-changed' });
    const note = preachDateChoiceFrames(basis.value, reviewed, stored.value,
      request.result?.kind === 'conflict' ? request.result.conflicts : []);
    const dateEdits = chooseLocalPreachDateEdits({ ...basis, value: note.basis }, note.draft, stored, request.preachStatusActions);
    const explicit = request.result?.kind === 'conflict'
      ? localThoughtPlacementChoices(request.result.conflicts, basis.value, reviewed, stored.value) : undefined;
    const rebased = replaySavedChoiceDelta(stored.resource, note.basis, note.draft, stored.value, explicit);
    const chosen = keepReviewedAuthoredLists(stored.resource.collection, dateEdits ?? rebased ?? stored.value!,
      request.result?.kind === 'conflict' ? request.result.conflicts : [], decision.value);
    const chosenFields = chosenChurch && chosen ? writeField(chosen, ['church'], chosenChurch) : chosen;
    draft = projectManualSelection(stored.value!, chosenFields!, decision.selection);
  } else if (request.result?.kind === 'conflict') {
    const conflicts = reviewedConflicts;
    const seriesFields = manualSeriesTextChoiceFields(request.baseline, stored, conflicts, decision.selection, reviewed);
    const retained = basis.value && reviewed && stored.value && seriesFields
      ? keepUncontestedDocumentText(basis.value, reviewed, stored.value, seriesFields)
      : keepUncontestedSermonFields(basis, reviewed, stored, conflicts);
    if (retained) draft = projectManualSelection(stored.value!, retained, decision.selection);
  }
  const resolved = afterChoice(decision.stored, draft, checkpoint.editGeneration + 1);
  if (meeting && request.result?.kind === 'conflict') {
    const review = captureGroupMeetingReview(stored, draft, meeting, request.result.conflicts, decision.choiceTime ?? null, request);
    if (review) resolved.groupMeetingReview = review;
  }
  carryOrderedPreachDateFields(resolved, request);
  if (outline && request.result?.kind === 'conflict') {
    const held = checkpoint.pending[request.id];
    carryOutlineTitleActions({ ...checkpoint, confirmed: basis, conflicts: request.result.conflicts,
      pending: { [request.id]: { ...held, outlineTitleActions: request.outlineTitleActions ?? held.outlineTitleActions } } }, resolved);
  }
  if (decision.choice === 'local' && request.result?.kind === 'conflict') {
    const selectedPaths = request.result.conflicts.filter(conflict => !isOrderedPreachDateField(conflict)).map(({ path }) => path);
    stageReviewedRowFields(resolved, selectedPaths, decision.choiceTime ?? null, ['thought-text', ...PREACH_DATE_REVIEW_FIELDS]);
  }
  if (decision.titles) stageReviewedOutlineTitleIds(resolved, decision.titles.filter(title => title.side === 'local' && !title.field).map(title => title.id), null);
  const decided = { ...record, checkpoint: resolved,
    completedCommits: [...new Set([...(record.completedCommits ?? []), ...ids])] };
  return [decided, ...projectSavedChoiceDependents(record.owner, decision.request, decision.stored, draft, retired,
    decision.choice === 'local' ? record.editorId : undefined, decision.privateStage)];
}

/** Replay a captured delta without treating the entire captured document as a new edit. */
export function replaySavedChoiceDelta(resource: ResourceSnapshot['resource'], base: DocumentData | null,
  value: DocumentData | null, target: DocumentData | null, explicit?: ReadonlySet<string>): DocumentData | null {
  const merged = resource.collection === 'groups' ? mergeGroupFlowRebase(base, value, target) : mergeDocumentFields(base, value, target);
  return chooseLocalPlacement(resource.collection, base, value, target,
    merged.value.exists ? merged.value.value as DocumentData : null, mergeFields, explicit);
}

type RetainedAction = Pick<NonNullable<EditorRecord['retainedManualChoice']>,
  'groupStepPlacement' | 'councilTopicPlacement' | 'outlinePointPlacement' | 'sourceNoteLinks' | 'sermonNoteText' | 'commentText'>;

function retainedChoiceDraft(owner: string, chosenId: string, draftId: string, stored: ResourceSnapshot,
  base: DocumentData | null, value: DocumentData | null, decidingEditorId?: string,
  action?: RetainedAction): EditorRecord {
  return {
    owner, editorId: manualChoiceRecoveryIdentity(chosenId, draftId, action?.sermonNoteText && 'sermon-note'), prepared: null, unfinalized: [],
    retainedManualChoice: { base, ...(decidingEditorId && { decidingEditorId }), ...action },
    checkpoint: { ...afterChoice(stored, value, 1), dirty: true },
  };
}

export function retainedAnchoredPlacementDraft(owner: string, editorId: string, requestId: string, phase: 'unqueued' | 'during-choice' | 'removed-topic',
  source: SessionCheckpoint, accepted: ResourceSnapshot, base: DocumentData, draft: DocumentData): EditorRecord {
  const record = retainedChoiceDraft(owner, requestId, JSON.stringify([phase, editorId]), accepted, base, draft, editorId);
  return protectPlacementFields(record, source);
}

function protectPlacementFields(record: EditorRecord, source: SessionCheckpoint): EditorRecord {
  const { collection } = record.checkpoint.confirmed.resource;
  const field = collection === 'groups' ? 'groupFieldsGeneration' : collection === 'planTemplates' ? 'templateFieldsGeneration'
    : collection === 'sermons' ? 'sermonFieldsGeneration' : 'councilFieldsGeneration';
  if (collection === 'sermons') record.editorId = protectSermonRecoveryEditor(record.editorId, 'sermon-thought-removal');
  record.retainedManualChoice![field] = source.confirmed.metadata?.generation ?? null;
  carryAnchoredDraftChronology(source, record.checkpoint);
  return record;
}

function savedPlacementFields(request: CommitRequest): SessionCheckpoint {
  const source = afterChoice(request.baseline, request.value, request.editGeneration);
  const generation = request.baseline.metadata?.generation;
  if (!generation) return source;
  for (const { action, draft } of autosaveFieldTargets(request.baseline.resource.collection)) {
    const saved = request[action];
    if (saved) source[draft] = { generation, action: saved };
  }
  restoreSavedRowFieldDrafts(request, source);
  return source;
}

function unsignedPlacementLists(collection: string, opening: unknown, proposed: unknown) {
  if (collection === 'planTemplates') return withoutUnsignedTemplateOrder(opening, proposed);
  const group = collection === 'groups';
  const openingFlow = group ? groupPlacementSteps(opening) : undefined;
  const before = group ? openingFlow : placementSteps(opening);
  const after = group ? groupPlacementSteps(proposed) : placementSteps(proposed);
  if (!before || !after) return undefined;
  const rows = withoutUnsignedRowOrder(before, after);
  if (!openingFlow) return { before, after: rows };
  const slots = new Map(openingFlow.map(row => [row.id, row.order]));
  const sameMembership = rows.length === before.length && rows.every((row, index) => row.id === before[index].id);
  return { before, after: rows.map((row, index) => ({ ...row, order: sameMembership ? slots.get(row.id)! : index + 1 })) };
}

/** Retain edits bundled by an old client with a position we cannot safely replay. */
function unsignedPlacementFields(owner: string, request: CommitRequest, stored: ResourceSnapshot, decidingEditorId?: string): EditorRecord[] {
  const { command, working } = request;
  if (!isUnsignedAnchoredPlacementRefusal(request) || command?.kind !== 'update' || !working.value) return [];
  const { collection } = command.resource;
  const field = collection === 'groups' ? 'flow' : collection === 'planTemplates' ? 'structure' : 'topics';
  const change = command.changes.find(item => item.path[0] === field);
  const lists = unsignedPlacementLists(collection, change?.before.value, change?.after.value);
  if (!lists) return [];
  let base: DocumentData = { ...working.value, [field]: lists.before };
  let draft: DocumentData = { ...base, [field]: lists.after };
  for (const edit of command.changes) {
    if ([field, 'updatedAt', 'rev'].includes(edit.path[0])) continue;
    base = writeField(base, edit.path, edit.before);
    draft = writeField(draft, edit.path, edit.after);
  }
  if (equalValues(base, draft)) return [];
  const copy = retainedChoiceDraft(owner, request.id, 'unsigned-placement-fields', stored, base, draft, decidingEditorId);
  return [protectPlacementFields(copy, { ...savedPlacementFields(request), confirmed: working })];
}

/** A choice retires blocked request identities while retaining each later branch's own delta. */
export function projectSavedChoiceDependents(owner: string, chosen: CommitRequest, stored: ResourceSnapshot,
  draft: DocumentData | null, retired: readonly CommitRequest[], decidingEditorId?: string,
  privateStage?: ExactManualChoice['privateStage'], formRequests?: ReadonlySet<string>): EditorRecord[] {
  const byId = new Map(retired.map(request => [request.id, request]));
  const predecessors = new Set(retired.map(request => request.predecessor));
  const projected = new Map<string, DocumentData | null>([[chosen.id, draft]]);
  const editors = new Map<string, string>();
  const retained = new Set<string>();
  const retain = (id: string, value: DocumentData | null, base = draft,
    action?: RetainedAction) => retainedChoiceDraft(owner, chosen.id, id, stored, base, value, decidingEditorId, action);
  const templateMove = (request: CommitRequest) => stored.resource.collection === 'planTemplates' ? request.outlinePointPlacement : undefined;
  const isPlacement = (request: CommitRequest) => request.groupFlowStepPlacement || request.councilTopicPlacement || templateMove(request);
  const separatePlacementSaves = isPlacement(chosen) || isUnsignedAnchoredPlacementRefusal(chosen)
    || retired.some(request => request.retainedAfterChoice && isPlacement(request));
  const later = orderCommitRequests([...retired]).flatMap(request => {
    if (!request.retainedAfterChoice || !request.predecessor) return [];
    const ancestor = byId.get(request.predecessor);
    if (!ancestor || !projected.has(ancestor.id)) throw new Error('The later Save lost its reviewed ancestor');
    const basis = projected.get(ancestor.id)!;
    const formOwned = formRequests?.has(request.id);
    const groupMove = formOwned ? undefined : request.groupFlowStepPlacement;
    const councilMove = formOwned ? undefined : request.councilTopicPlacement;
    const outlineMove = formOwned ? undefined : templateMove(request);
    const sourceNotes = formOwned ? undefined : request.sourceNoteLink;
    if (sourceNotes && basis) {
      const linked = projectSourceNoteChoices(basis, sourceNotes.action.changes);
      projected.set(request.id, linked);
      return [retain(request.id, linked, basis, { sourceNoteLinks: sourceNotes })];
    }
    if (outlineMove) {
      const placed = projectResourceOutlinePoint(stored.resource.collection, basis, outlineMove);
      projected.set(request.id, placed ?? basis);
      return [retain(request.id, placed ?? request.value, basis, { outlinePointPlacement: outlineMove })];
    }
    if (groupMove || councilMove) {
      const placed = groupMove ? projectGroupStepOnDocument(basis, groupMove) : projectCouncilTopicOnDocument(basis, councilMove!);
      projected.set(request.id, placed);
      // Keep exact moves separate. A missing anchor leaves a readable draft, never a list replacement.
      return [retain(request.id, placed === basis ? request.value : placed, basis,
        groupMove ? { groupStepPlacement: groupMove } : { councilTopicPlacement: councilMove })];
    }
    const laterDraft = formOwned ? basis : replaySavedChoiceDelta(stored.resource, ancestor.value, request.value, basis);
    projected.set(request.id, laterDraft);
    if (!formOwned && request.sermonNoteText && !equalValues(laterDraft, basis)) {
      return [retain(request.id, laterDraft, basis, { sermonNoteText: request.sermonNoteText })];
    }
    const hasCouncilText = stored.resource.collection === 'councils' && request.councilTopicTextActions?.length;
    if ((separatePlacementSaves || hasCouncilText) && !formOwned) {
      if (equalValues(laterDraft, basis)) return [];
      return request.value && ancestor.value ? [protectPlacementFields(retain(request.id, request.value, ancestor.value), savedPlacementFields(request))]
        : [retain(request.id, laterDraft, basis)];
    }
    const editor = formOwned ? editors.get(ancestor.id) : request.id;
    if (editor) editors.set(request.id, editor);
    if (!editor || predecessors.has(request.id) || retained.has(editor) || equalValues(draft, laterDraft)) return [];
    retained.add(editor);
    const commentText = (chosen.commentPlaceAction || chosen.commentTextOpening) && typeof laterDraft?.content === 'string'
      && !equalValues(draft?.content, laterDraft.content);
    return [retain(editor, laterDraft, draft, commentText ? { commentText: true } : undefined)];
  });
  if (privateStage) {
    const basis = projected.get(privateStage.predecessorId);
    if (basis === undefined) throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
    const value = replaySavedChoiceDelta(stored.resource, privateStage.base, privateStage.value, basis);
    later.push(retain(JSON.stringify(['stage', privateStage.scopeId, privateStage.generation]), value));
  }
  return [...unsignedPlacementFields(owner, chosen, stored, decidingEditorId), ...later];
}

/** Apply the later draft's actual delta only on explicit recovery, over the latest accepted copy. */
export function recoverManualChoiceCopy(record: EditorRecord, known?: ResourceSnapshot): EditorRecord {
  const retained = record.retainedManualChoice;
  if (!retained) return record;
  const original = record.checkpoint.confirmed;
  const confirmed = known && canReplaceSnapshot(original, known) ? known : original;
  const sourceNotes = retained.sourceNoteLinks;
  if (sourceNotes) {
    if (!confirmed.value || !matchesSourceNoteOpening(confirmed, sourceNotes)) throw Object.assign(
      new Error('The retained sermon source selection is unavailable'), { code: 'decision-changed' });
    const draft = projectSourceNoteChoices(confirmed.value, sourceNotes.action.changes);
    const checkpoint = afterChoice(confirmed, draft, record.checkpoint.editGeneration);
    checkpoint.sourceNoteLinkRetry = sourceNotes;
    checkpoint.dirty = true;
    return { ...record, checkpoint };
  }
  const move = retained.groupStepPlacement;
  if (move) {
    const unavailable = () => Object.assign(new Error('The retained step position is unavailable'), { code: 'decision-changed' });
    const generation = confirmed.metadata?.generation ?? null;
    if (confirmed.resource.collection !== 'groups' || (move.generation !== null && generation !== move.generation)) throw unavailable();
    const draft = projectGroupStepOnDocument(confirmed.value, move);
    if (!draft || draft === confirmed.value) throw unavailable();
    const checkpoint = afterChoice(confirmed, draft, record.checkpoint.editGeneration);
    // A versionless draft may enter the first engine generation for review.
    // Keeping revision zero lets the server ask before changing the now-versioned list.
    const retry = captureGroupStepPlacement(confirmed.value?.flow, draft.flow, move.placement.stepId, generation,
      move.placement.observedRevision, move.placement.time);
    if (retry) checkpoint.groupFlowStepPlacementRetry = retry;
    return { ...record, checkpoint };
  }
  const councilMove = retained.councilTopicPlacement;
  if (councilMove) {
    const unavailable = () => Object.assign(new Error('The retained section position is unavailable'), { code: 'decision-changed' });
    const generation = confirmed.metadata?.generation ?? null;
    if (confirmed.resource.collection !== 'councils' || confirmed.value?.status === 'held'
      || (councilMove.generation !== null && generation !== councilMove.generation)) throw unavailable();
    const draft = projectCouncilTopicOnDocument(confirmed.value, councilMove);
    if (!draft || draft === confirmed.value) throw unavailable();
    const checkpoint = afterChoice(confirmed, draft, record.checkpoint.editGeneration);
    const retry = captureCouncilTopicPlacement(confirmed.value?.topics, draft.topics, councilMove.placement.stepId, generation,
      councilMove.placement.observedRevision, councilMove.placement.time);
    if (retry) checkpoint.councilTopicPlacementRetry = retry;
    return { ...record, checkpoint };
  }
  const outlineMove = retained.outlinePointPlacement;
  if (outlineMove) {
    const generation = confirmed.metadata?.generation ?? null;
    const unavailable = () => Object.assign(new Error('The retained point position is unavailable'), { code: 'decision-changed' });
    if (confirmed.resource.collection !== 'planTemplates' || confirmed.metadata?.deleted
      || (outlineMove.generation !== null && outlineMove.generation !== generation)) throw unavailable();
    const draft = projectResourceOutlinePoint(confirmed.resource.collection, confirmed.value, outlineMove);
    if (!draft) throw unavailable();
    const checkpoint = afterChoice(confirmed, draft, record.checkpoint.editGeneration);
    // Even if the position already matches, its original gesture still needs a receipt.
    const { predecessorOperationId: _retired, ...placement } = outlineMove.placement;
    checkpoint.outlinePointPlacementRetry = { ...outlineMove, generation, placement };
    checkpoint.dirty = true;
    return { ...record, checkpoint };
  }
  const fieldsGeneration = [retained.groupFieldsGeneration, retained.councilFieldsGeneration,
    retained.templateFieldsGeneration, retained.sermonFieldsGeneration].find(value => value !== undefined);
  if (fieldsGeneration !== undefined && retained.base && record.checkpoint.draft) {
    const generation = confirmed.metadata?.generation ?? null;
    if (!confirmed.value || confirmed.metadata?.deleted || generation !== fieldsGeneration) {
      throw Object.assign(new Error('The retained record is no longer available'), { code: 'decision-changed' });
    }
    if (confirmed.resource.collection === 'councils' && confirmed.value.status === 'held') {
      throw Object.assign(new Error('Reopen the council before recovering these edits'), { code: 'reopen-council-to-recover' });
    }
    const checkpoint = afterChoice(confirmed, confirmed.value, record.checkpoint.editGeneration);
    const merged = mergeEditsAfterAnchoredPlacement(record.checkpoint, retained.base, record.checkpoint.draft, checkpoint);
    checkpoint.draft = merged.value.exists ? merged.value.value as DocumentData : null;
    checkpoint.dirty = !equalValues(checkpoint.draft, confirmed.value);
    checkpoint.conflicts = merged.conflicts;
    if (merged.conflicts.length) checkpoint.remoteCandidate = confirmed;
    carryAnchoredDraftChronology(record.checkpoint, checkpoint);
    return { ...record, checkpoint };
  }
  const draft = replaySavedChoiceDelta(confirmed.resource, retained.base, record.checkpoint.draft, confirmed.value);
  const note = retained.sermonNoteText;
  const checkpoint = afterChoice(confirmed, draft, record.checkpoint.editGeneration);
  if (note) {
    const opening = matchesSermonNoteOpening(confirmed, note) && withSermonNoteText(confirmed.value, note.target, note.text);
    if (!opening) throw sermonNoteChanged();
    const merged = mergeDocumentFields(opening, draft, confirmed.value);
    checkpoint.draft = merged.value.exists ? merged.value.value as DocumentData : null;
    checkpoint.dirty = !equalValues(checkpoint.draft, confirmed.value);
    checkpoint.conflicts = merged.conflicts;
    if (merged.conflicts.length) checkpoint.remoteCandidate = confirmed;
  }
  return { ...record, checkpoint };
}
