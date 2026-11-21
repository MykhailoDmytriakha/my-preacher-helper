import { createHash } from 'node:crypto';

import { isStandaloneScriptureReference } from '@/utils/bibleLink';
import { isOrdinaryStudyNote } from '@/utils/studyNoteType';

import { boundedActionTime, compareActionTime } from './actionClock';
import { competingStringListEdits, singleStringListEdit } from './authoredStringList';
import { matchesCommentKindPlace } from './commentKindAction';
import { matchesCommentPlaceScope, placeOfCommentChange } from './commentPlaceAction';
import { commentPlaceReview, nextCommentPlaceFrames } from './commentPlaceOrder.server';
import { councilStatusOf, matchesCouncilLifecycle, sameCouncilDate } from './councilFieldAction';
import { COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED } from './councilTopicTextAction';
import { PREACH_DATE_TARGET } from './datedRowAction';
import { acceptsDocumentField, documentFieldChange, documentFieldPath, documentFieldTargets, documentFieldValue, isLongTextDocumentField, replaceOrderedDocumentField, SERMON_METADATA_QUEUED, SERMON_METADATA_SETTLED, SERMON_REPEATED_WORDS, SERMON_CHURCH_REVIEW_CHANGED, SERMON_GOAL_TYPE_REVIEW_CHANGED, SERMON_PLAN_MODE_REVIEW_CHANGED, SERMON_VERSE_REVIEW_CHANGED } from './documentFieldAction';
import { commandFingerprint, equalValues, object, readField } from './fieldValues';
import { GROUP_FLOW_TEXT_QUEUED, GROUP_FLOW_TEXT_SETTLED } from './groupFlowTitleAction';
import { PRAYER_TEXT_QUEUED, PRAYER_TEXT_SETTLED } from './prayerTextAction';
import { proofRevision, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { isReturnedSeriesField, SERIES_METADATA_QUEUED, SERIES_METADATA_SETTLED } from './seriesFieldAction';
import { rebaseSermonChurchFill } from './sermonChurchFill';

import type { ActionTime } from './actionClock';
import type { orderDatedRow } from './datedRowOrder.server';
import type { DocumentFieldObservation, DocumentFieldTarget } from './documentFieldAction';
import type { ConflictDetail, DataCommand, DocumentData, FieldChange, FieldValue, ResourceSnapshot } from './types';

export const COMMENT_KIND_HISTORY = '_commentKindHistory';
export const STUDY_NOTE_TYPE_HISTORY = '_noteTypeHistory';
export const DOCUMENT_TITLE_HISTORY = '_titleHistory';
export const GROUP_STATUS_HISTORY = '_statusHistory';
export const SERMON_VERSE_HISTORY = '_verseHistory';
export const SERMON_GOAL_TYPE_HISTORY = '_goalTypeHistory';
export const SERMON_PLAN_MODE_HISTORY = '_planModeHistory';
export const SERMON_CHURCH_HISTORY = '_churchHistory';
export const DOCUMENT_METADATA_HISTORY = '_metadataHistory';
type ListOpening = { digest: string; removed?: string; added?: string };
type FieldProof = { value: FieldValue; revision: number; time: ActionTime | null; operationId?: string; initialized?: true; listOpening?: ListOpening };
type DocumentFieldOrder = {
  command: DataCommand;
  stamp?: ActionTime | null;
  initialized?: true;
  previous?: FieldProof;
  listOpening?: { basis: ListOpening; intended: FieldValue };
  acknowledgedListChoice?: true;
  reaffirmedOpening?: true;
  displaced?: { value: FieldValue; winnerValue: FieldValue; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime };
  uncertain?: ConflictDetail[];
};

const usesDigest = (target: DocumentFieldTarget) => isLongTextDocumentField(target) || 'path' in target || target.field === 'color' || target.field === 'verse' || target.field === 'church' || target.field === 'date' || target.field === 'heldAt' || target.field === 'answeredAt' || target.action === 'seriesFieldActions' || target.action === 'studyNoteTitleAction' || target.action === 'studyNoteTypeAction' || target.action === 'commentKindAction' || target.action === 'commentPlaceAction' || target.action === 'planTemplateNameAction';
const presentWordList = (value: FieldValue): FieldValue => value.exists ? value : { exists: true, value: [] };
const sameFieldOpening = (first: FieldValue, second: FieldValue, target: DocumentFieldTarget) =>
  target.action === 'sermonRepeatedWordsAction' ? equalValues(presentWordList(first), presentWordList(second)) : equalValues(first, second);
const fieldDigest = (value: FieldValue, target: DocumentFieldTarget) => createHash('sha256')
  .update(target.field === 'verse' ? String(value.value)
    : commandFingerprint(target.action === 'sermonRepeatedWordsAction' ? presentWordList(value) : value)).digest('base64url');

const MAX_FIELD_OPENINGS = 16;

function pastFieldOpenings(raw: unknown, target: DocumentFieldTarget): string[] | null | undefined {
  const proof = object(raw) ? raw[target.proof] : undefined;
  const openings = object(proof) ? proof.pastOpenings : undefined;
  if (openings === null || (Array.isArray(openings) && openings.every(value => typeof value === 'string'))) return openings;
}

function nextFieldOpenings(raw: unknown, target: DocumentFieldTarget, opening: FieldValue, changed: boolean) {
  const past = pastFieldOpenings(raw, target);
  if (!changed || past === null) return past;
  const digest = fieldDigest(opening, target);
  if (past?.includes(digest)) return past;
  return (past?.length ?? 0) < MAX_FIELD_OPENINGS ? [...past ?? [], digest] : null;
}

const tracksScalarReturns = (target: DocumentFieldTarget) =>
  target.action === 'sermonTitleAction' || target.action === 'sermonVerseAction' || target.action === 'sermonChurchAction'
    || target.action === 'sermonGoalTypeAction' || target.action === 'sermonPlanModeAction' || target.action === 'serviceOrderTitleAction'
    || target.action === 'groupTitleAction' || target.action === 'groupStatusAction'
    || target.action === 'prayerTitleAction' || target.action === 'planTemplateNameAction'
    || target.action === 'councilTitleAction' || target.action === 'councilDateAction' || target.action === 'councilLifecycleAction'
    || target.action === 'tagColorAction'
    || (target.action === 'seriesFieldActions' && target.field !== 'description');

const tracksOpeningReturns = (target: DocumentFieldTarget) =>
  tracksScalarReturns(target) || target.action === 'sermonThesisFieldActions'
    || target.action === 'sermonRepeatedWordsAction' || isLongTextDocumentField(target);

const wordDigest = (word: string | undefined) => word === undefined ? undefined
  : createHash('sha256').update(JSON.stringify(word)).digest('base64url');
const digestText = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);

function listOpeningFor(change: FieldChange, target: DocumentFieldTarget): ListOpening | undefined {
  const edit = singleStringListEdit(change.before.exists ? change.before.value : [], change.after.value);
  if (!edit) return;
  const removed = wordDigest(edit.removed), added = wordDigest(edit.added);
  return { digest: fieldDigest(change.before, target), ...(removed && { removed }), ...(added && { added }) };
}

function readListOpening(value: unknown): ListOpening | undefined {
  if (!object(value) || !digestText(value.digest)) return;
  return { digest: value.digest, ...(digestText(value.removed) && { removed: value.removed }),
    ...(digestText(value.added) && { added: value.added }) };
}

function previousField(raw: unknown, current: ResourceSnapshot, target: DocumentFieldTarget): FieldProof | undefined {
  const proof = object(raw) ? raw[target.proof] : undefined;
  if (!object(proof)) return undefined;
  if (!current.value) return undefined;
  const value = documentFieldValue(current.value, target);
  if (!value || !acceptsDocumentField(value, target) || !proofRevision(proof.revision) || proof.revision > (current.metadata?.revision ?? 0)
    || (usesDigest(target) ? proof.digest !== fieldDigest(value, target) : proof[target.field] !== value.value)) return undefined;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  const listOpening = target.action === 'sermonRepeatedWordsAction' ? readListOpening(proof.listOpening) : undefined;
  return time !== undefined ? { value, revision: proof.revision, time,
    ...(listOpening && { listOpening }),
    ...(typeof proof.operationId === 'string' && { operationId: proof.operationId }),
    ...(target.action === 'sermonPlanModeAction' && proof.initialized === true && { initialized: true as const }) } : undefined;
}

function readAction(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, revision: number, serverMs: number, target: DocumentFieldTarget): DocumentFieldObservation<FieldValue> | undefined {
  const action: unknown = target.action === 'accountPreferenceActions' ? command.accountPreferenceActions?.[target.field]
    : target.action === 'seriesFieldActions' ? command.seriesFieldActions?.[target.field]
    : target.action === 'sermonPreparationCheckActions' ? command.sermonPreparationCheckActions?.[target.field]
    : target.action === 'sermonThesisFieldActions' ? command.sermonThesisFieldActions?.[target.field]
    : target.action === 'sermonPreparationTextActions' ? command.sermonPreparationTextActions?.[target.field]
    : target.action === 'prayerTextActions' ? command.prayerTextActions?.[target.field] : command[target.action];
  const { before, after } = change;
  if (!object(action) || ('path' in target && !after.exists
    && target.action !== 'accountPreferenceActions' && target.action !== 'sermonPreparationTextActions') || !acceptsDocumentField(before, target) || !acceptsDocumentField(after, target)
    || (target.action !== 'sermonPlanModeAction' && target.action !== 'commentPlaceAction' && equalValues(before, after))
    || (!usesDigest(target) && (before.value !== action.before || after.value !== action.after))
    || !proofRevision(action.observedRevision) || action.observedRevision > revision) return undefined;
  const time = target.causal && action.time === null ? null : boundedActionTime(action.time);
  if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) return undefined;
  return { before, after, observedRevision: action.observedRevision, time,
    ...(target.causal && typeof action.predecessorOperationId === 'string' && { predecessorOperationId: action.predecessorOperationId }) };
}

export function repeatedWordsObservation(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange,
  revision: number, serverMs: number) {
  return readAction(command, change, revision, serverMs, SERMON_REPEATED_WORDS);
}

export function previousRepeatedWordRemovals(raw: unknown, current: ResourceSnapshot) {
  const proof = previousField(raw, current, SERMON_REPEATED_WORDS);
  if (!proof) return;
  const earlier = pastFieldOpenings(raw, SERMON_REPEATED_WORDS);
  return (word: string) => {
    if (proof.listOpening?.removed === wordDigest(word)) {
      return { revision: proof.revision, time: proof.time, operationId: proof.operationId };
    }
    if (earlier?.includes(fieldDigest({ exists: true, value: [word] }, SERMON_REPEATED_WORDS))) {
      return { revision: proof.revision, time: null };
    }
  };
}

function decideUnobservedField(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, action: DocumentFieldObservation<FieldValue>,
  previous: FieldProof, target: DocumentFieldTarget): DocumentFieldOrder {
  const { value, time } = previous;
  const before = action.before.value, after = action.after.value, stored = value.value;
  const repeatedWords = target.action === 'sermonRepeatedWordsAction';
  if (repeatedWords) {
    const same = sameFieldOpening(action.after, value, target), returned = sameFieldOpening(action.before, value, target);
    const competing = competingStringListEdits(before, after, stored);
    if (!same && !returned && !competing) return { command, stamp: null };
    const opening = listOpeningFor(change, target), savedOpening = previous.listOpening;
    const sharedSlot = opening && savedOpening && opening.digest === savedOpening.digest
      && opening.removed === savedOpening.removed && (opening.removed !== undefined || same);
    const returnedSlot = returned && opening && savedOpening
      && ((opening.removed !== undefined && opening.removed === savedOpening.added)
        || (opening.added !== undefined && opening.added === savedOpening.removed));
    if (!sharedSlot && !returnedSlot) {
      return same ? { command, stamp: null, acknowledgedListChoice: true } : { command, uncertain: [{ path: change.path, base: change.before, mine: change.after, theirs: value }] };
    }
  }
  const standalone = target.field !== 'verse' || typeof before === 'string' && typeof after === 'string' && typeof stored === 'string'
    && (before.trim() === '' || isStandaloneScriptureReference(before))
    && isStandaloneScriptureReference(after) && isStandaloneScriptureReference(stored);
  const order = standalone && time && action.time ? compareActionTime(action.time, time) : 0;
  if (sameFieldOpening(action.after, value, target)) {
    if (order < 0) return { command, previous };
    return { command, stamp: order > 0 ? action.time : null,
      ...(!order && repeatedWords && { acknowledgedListChoice: true }),
      ...((target.action === 'sermonPreparationTextActions' || tracksScalarReturns(target)) && { reaffirmedOpening: true }) };
  }
  if (!order || !time || !action.time) {
    const needsReview = repeatedWords || target.action === 'sermonPreparationTextActions' || equalValues(action.before, value)
      || (target.action === 'sermonPlanModeAction' && equalValues(action.before, action.after));
    const uncertain = needsReview ? [{ path: change.path, base: change.before, mine: change.after, theirs: value }] : undefined;
    return { command, uncertain };
  }
  const incomingWins = order > 0;
  const changes = replaceOrderedDocumentField(command.changes, target, value, incomingWins ? change.after : value);
  return {
    command: { ...command, changes },
    ...(incomingWins ? { stamp: action.time } : { previous }),
    displaced: {
      value: incomingWins ? value : action.after,
      winnerValue: incomingWins ? action.after : value,
      generation: command.generation!,
      actionTime: incomingWins ? time : action.time,
      winnerActionTime: incomingWins ? action.time : time,
    },
  };
}

function orderDocumentField(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number,
  target: DocumentFieldTarget): DocumentFieldOrder {
  if (command.kind !== 'update') return { command };
  if ((target.action === 'studyNoteTitleAction' || target.action === 'studyNoteTypeAction') && !isOrdinaryStudyNote(current.value)) return { command };
  if (target.action === 'commentKindAction' && (!command.commentKindAction
    || !matchesCommentKindPlace(current.value, command.commentKindAction.reference))) return { command };
  if (target.action === 'tagColorAction' && current.value?.required !== false) return { command };
  let change = target.action === 'commentPlaceAction' && !command.commentPlaceAction
    ? placeOfCommentChange(command.changes, true) : documentFieldChange(command.changes, target);
  if (!change || !current.metadata || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  const stored = documentFieldValue(current.value, target);
  if (!stored || !acceptsDocumentField(stored, target)
    || (target.action === 'councilLifecycleAction' && !matchesCouncilLifecycle(command.changes, change))) return { command, stamp: null };
  if (target.action === 'commentPlaceAction' && command.commentPlaceAction
    && !matchesCommentPlaceScope(current.value, change.before, command.commentPlaceAction.paragraph)) return { command };
  if (target.action === 'commentPlaceAction' && !command.commentPlaceAction && equalValues(change.before, change.after)) return { command };
  if (target.action === 'studyNoteContentAction' && (equalValues(change.before, change.after)
    || current.value?.type === 'analysis')) return { command };
  const previous = previousField(raw, current, target);
  // The date picker works with calendar days. Old timestamp and empty-string spellings are equivalent.
  if (target.action === 'councilDateAction' && acceptsDocumentField(change.after, target)
    && !equalValues(stored, change.after) && sameCouncilDate(stored, change.after)) {
    const before = sameCouncilDate(stored, change.before) ? stored : change.before;
    command = { ...command, changes: replaceOrderedDocumentField(command.changes, target, before, stored) };
    if (equalValues(before, stored)) return { command, previous };
    change = { ...change, before, after: stored };
  }
  const action = readAction(command, change, current.metadata.revision, serverMs, target);
  const reviewCode = target.action === 'sermonVerseAction' && command.sermonVerseAction?.reviewed ? SERMON_VERSE_REVIEW_CHANGED
    : target.action === 'sermonChurchAction' && command.sermonChurchAction?.reviewed ? SERMON_CHURCH_REVIEW_CHANGED
    : target.action === 'sermonGoalTypeAction' && command.sermonGoalTypeAction?.reviewed ? SERMON_GOAL_TYPE_REVIEW_CHANGED
    : target.action === 'sermonPlanModeAction' && command.sermonPlanModeAction?.reviewed ? SERMON_PLAN_MODE_REVIEW_CHANGED : undefined;
  if (reviewCode) {
    if (equalValues(stored, change.after)) return { command, previous };
    // A reviewed choice refers to the saved opening, even when its click is newer.
    if (!action || action.observedRevision < (previous?.revision ?? current.metadata.revision)
      || !sameFieldOpening(stored, change.before, target)) {
      return { command, uncertain: [{ path: change.path, code: reviewCode,
        base: change.before, mine: change.after, theirs: stored }] };
    }
  }
  if (target.action === 'commentPlaceAction') {
    const uncertain = commentPlaceReview(command, current, raw, stored, previous, Boolean(action));
    if (uncertain) return { command, uncertain: [uncertain] };
    if (command.commentPlaceAction?.compound || command.commentPlaceAction?.reviewed) return { command, stamp: action?.time ?? null };
  }
  // The study-note page sends no proof of the text it saw yet; until it does (BUG-20261118-note-page-codex-fixes-wait-for-engine-session)
  // an unproven note or comment text keeps the plain base check, as before this rule. A text sent with its proof
  // (the comment window, when it has one) is ordered by the action above.
  if (!action && tracksScalarReturns(target) && acceptsDocumentField(change.before, target)
    && !(target.action === 'sermonPlanModeAction' && previous?.initialized && !change.before.exists)
    && !sameFieldOpening(stored, change.before, target) && equalValues(change.after, stored)) {
    return { command, stamp: null, reaffirmedOpening: true };
  }
  if (!action && tracksOpeningReturns(target) && target.action !== 'studyNoteContentAction' && sameFieldOpening(stored, change.before, target) && !equalValues(change.after, stored)) {
    const past = pastFieldOpenings(raw, target);
    // An old queued packet cannot distinguish a restored value from an untouched opening.
    if (past === null || past?.includes(fieldDigest(stored, target))) {
      return { command, uncertain: [{ path: change.path, base: change.before, mine: change.after, theirs: stored }] };
    }
  }
  if (!action) return target.action === 'sermonPlanModeAction' && equalValues(stored, change.after)
    ? { command, previous } : { command, stamp: null };
  if (target.action === 'sermonPlanModeAction') {
    if (command.sermonPlanModeAction?.initialize === true) {
      if (change.before.exists || action.time !== null) return { command, stamp: null };
      if (!stored.exists) return { command, stamp: null, initialized: true };
      const changes = replaceOrderedDocumentField(command.changes, target, stored, stored);
      return { command: { ...command, changes }, previous };
    }
    if (previous?.initialized) {
      // A default has no competing intention. Record even a choice of the same value as explicit.
      const changes = replaceOrderedDocumentField(command.changes, target, stored, change.after);
      return { command: { ...command, changes }, stamp: action.time };
    }
  }
  if (previous && previous.revision > action.observedRevision) {
    // An exact local predecessor is causal even when its action clock was unavailable.
    if (action.predecessorOperationId && previous.operationId === action.predecessorOperationId && sameFieldOpening(previous.value, action.before, target)) {
      return { command, stamp: action.time };
    }
    const order = decideUnobservedField(command, change, action, previous, target);
    if (target.action === 'commentKindAction' && order.displaced && !equalValues(order.displaced.winnerValue, change.after)
      && command.changes.some(item => item.path[0] === 'scriptureRefs' && !equalValues(item.before, item.after))) {
      // A move was checked for the chosen kind. Keep both changes together when that kind loses.
      return { command, uncertain: [{ path: change.path, base: change.before, mine: change.after, theirs: stored }] };
    }
    return order;
  }
  if (isLongTextDocumentField(target) && !previous && action.observedRevision < current.metadata.revision
    && equalValues(action.before, stored) && !equalValues(action.after, stored)) {
    const past = pastFieldOpenings(raw, target);
    if (past === null || past?.includes(fieldDigest(stored, target))) {
      return { command, uncertain: [{ path: change.path, base: change.before, mine: change.after, theirs: stored }] };
    }
  }
  if (equalValues(action.after, stored)) {
    return (target.action === 'sermonPlanModeAction' || target.action === 'commentPlaceAction') && equalValues(action.before, action.after)
      ? { command, stamp: action.time } : { command, previous };
  }
  return { command, stamp: previous || action.observedRevision === current.metadata.revision ? action.time : null };
}

function resolvePlannedChurchFill(original: DataCommand, ordered: DataCommand, current: ResourceSnapshot): DataCommand {
  if (original.kind !== 'update' || ordered.kind !== 'update' || !original.sermonChurchFill
    || !current.value || current.metadata?.generation !== original.generation) return ordered;
  const requested = original.changes.find(change => change.path[0] === 'church');
  const accepted = ordered.changes.find(change => change.path[0] === 'church');
  const dates = ordered.changes.find(change => change.path[0] === 'preachDates');
  if (!dates?.after.exists || (requested && !equalValues(requested.after, { exists: true, value: original.sermonChurchFill.church }))) return ordered;
  const rows = rebaseSermonChurchFill(dates.before.value, dates.after.value, current.value.preachDates,
    accepted?.after ?? readField(current.value, ['church']), original.sermonChurchFill);
  if (rows === dates.after.value || rows === undefined) return ordered;
  return { ...ordered, changes: ordered.changes.map(change => change === dates ? { ...dates, after: { exists: true, value: rows } } : change) };
}

function resolveSeriesTitleMirror(original: DataCommand, order: DocumentFieldOrder, current: ResourceSnapshot): DataCommand {
  const ordered = order.command;
  if (!order.displaced || original.kind !== 'update' || ordered.kind !== 'update' || !current.value) return ordered;
  const requested = original.changes.find(change => change.path[0] === 'title');
  const mirror = original.changes.find(change => change.path[0] === 'theme');
  const openingTheme = original.seriesFieldActions?.title?.openingTheme;
  const after = requested?.after;
  if (!after?.exists || typeof after.value !== 'string') return ordered;
  if (mirror ? !equalValues(mirror.after, after) : openingTheme !== after.value) return ordered;
  const stored = readField(current.value, ['theme']);
  // A distinct legacy theme remains an ordinary conflict, even if the title has a proven order.
  if (!equalValues(stored, readField(current.value, ['title']))) return ordered;
  const resolved = { path: ['theme'], before: stored, after: order.displaced.winnerValue };
  const changes = mirror ? ordered.changes.map(change => change.path[0] === 'theme' ? resolved : change) : [...ordered.changes, resolved];
  return { ...ordered, changes };
}

function alignCouncilLifecycle(order: DocumentFieldOrder, current: ResourceSnapshot): DataCommand {
  const { command, displaced } = order;
  if (command.kind !== 'update' || !displaced || !current.value) return command;
  const before = readField(current.value, ['status']);
  const after = { exists: true, value: councilStatusOf(displaced.winnerValue) };
  const companion = { path: ['status'], before, after };
  const changes = command.changes.filter(change => change.path.length !== 1 || change.path[0] !== 'status');
  return { ...command, changes: equalValues(before, after) ? changes : [...changes, companion] };
}

export function orderDocumentFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number,
  repeatedWordsResolved = false) {
  const fields = documentFieldTargets(command.resource.collection).map(target => {
    const planned = repeatedWordsResolved && target.action === 'sermonRepeatedWordsAction'
      ? { command } : orderDocumentField(command, current, raw, serverMs, target);
    const change = target.action === 'sermonRepeatedWordsAction' && planned.stamp && command.kind === 'update'
      ? documentFieldChange(command.changes, target) : undefined;
    const basis = change && listOpeningFor(change, target);
    const order = basis && change ? { ...planned, listOpening: { basis, intended: change.after } } : planned;
    if (target.field === 'church') command = resolvePlannedChurchFill(command, order.command, current);
    else if (target.action === 'seriesFieldActions' && target.field === 'title') command = resolveSeriesTitleMirror(command, order, current);
    else if (target.field === 'heldAt') command = alignCouncilLifecycle(order, current);
    else if (target.action === 'studyNoteContentAction' && order.displaced && current.value
      && order.command.kind === 'update' && command.kind === 'update') {
      const requested = documentFieldChange(command.changes, target);
      command = requested && !equalValues(requested.after, order.displaced.winnerValue)
        ? { ...order.command, changes: order.command.changes.filter(change => change.path[0] !== 'dictationSourceIds') }
        : order.command;
    } else command = order.command;
    return { target, order };
  });
  return { command, fields, uncertain: fields.flatMap(({ order }) => order.uncertain ?? []) };
}

export function orderedPrayerText(command: DataCommand, current: ResourceSnapshot,
  orders: ReturnType<typeof orderDocumentFields>, conflicts: readonly ConflictDetail[]): ConflictDetail[] {
  if (command.kind !== 'update' || command.resource.collection !== 'prayerRequests'
    || !conflicts.some(({ path }) => path.length === 1 && ['title', 'description', 'answerText'].includes(path[0]))) return [];
  return orders.fields.flatMap(({ target, order }) => {
    if ((target.action !== 'prayerTextActions' && target.action !== 'prayerTitleAction') || !order.displaced) return [];
    const change = documentFieldChange(command.changes, target);
    const stored = documentFieldValue(current.value, target);
    if (!change || !stored) return [];
    const code = equalValues(order.displaced.winnerValue, stored) ? PRAYER_TEXT_SETTLED : PRAYER_TEXT_QUEUED;
    return [{ path: change.path, code, base: change.before, mine: change.after, theirs: stored }];
  });
}

function orderedMetadataComparisons(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot,
  orders: ReturnType<typeof orderDocumentFields>, includes: (target: DocumentFieldTarget) => boolean,
  codes: { settled: string; queued: string }): ConflictDetail[] {
  return orders.fields.flatMap(({ target, order }) => {
    if (!order.displaced || !includes(target)) return [];
    const change = documentFieldChange(command.changes, target);
    const stored = documentFieldValue(current.value, target);
    if (!change || !stored) return [];
    const code = equalValues(order.displaced.winnerValue, stored) ? codes.settled : codes.queued;
    return [{ path: change.path, code, base: change.before, mine: change.after, theirs: stored }];
  });
}

export function orderedSeriesMetadata(command: DataCommand, current: ResourceSnapshot, orders: ReturnType<typeof orderDocumentFields>): ConflictDetail[] {
  if (command.kind !== 'update' || command.resource.collection !== 'series'
    || !orders.uncertain.some(isReturnedSeriesField)) return [];
  const comparisons = orderedMetadataComparisons(command, current, orders, target => target.action === 'seriesFieldActions',
    { settled: SERIES_METADATA_SETTLED, queued: SERIES_METADATA_QUEUED });
  const title = comparisons.find(({ path }) => path[0] === 'title');
  const theme = command.changes.find(({ path }) => equalValues(path, ['theme']));
  const orderedTheme = orders.command.kind === 'update' && orders.command.changes.find(({ path }) => equalValues(path, ['theme']));
  if (title && theme && orderedTheme && current.value && equalValues(theme.after, title.mine)) {
    const saved = readField(current.value, ['theme']);
    const winner = title.code === SERIES_METADATA_SETTLED ? title.theirs : title.mine;
    if (equalValues(saved, title.theirs) && equalValues(orderedTheme.before, saved) && equalValues(orderedTheme.after, winner)) {
      comparisons.push({ path: theme.path, code: title.code, base: theme.before, mine: theme.after, theirs: saved });
    }
  }
  return comparisons;
}

export function orderedCouncilMetadata(command: DataCommand, current: ResourceSnapshot, orders: ReturnType<typeof orderDocumentFields>): ConflictDetail[] {
  if (command.kind !== 'update' || command.resource.collection !== 'councils') return [];
  return orderedMetadataComparisons(command, current, orders,
    target => target.action === 'councilTitleAction' || target.action === 'councilDateAction' || target.action === 'councilLifecycleAction',
    { settled: COUNCIL_TOPIC_TEXT_SETTLED, queued: COUNCIL_TOPIC_TEXT_QUEUED });
}

export function orderedSermonMetadata(command: DataCommand, current: ResourceSnapshot,
  orders: ReturnType<typeof orderDocumentFields>, dateOrder: ReturnType<typeof orderDatedRow>, conflicts: readonly ConflictDetail[]): ConflictDetail[] {
  if (command.kind !== 'update' || command.resource.collection !== 'sermons'
    || ![...orders.uncertain, ...conflicts].some(({ path, base, theirs, code }) => path.length === 1
      && (path[0] === 'church' || code === SERMON_VERSE_REVIEW_CHANGED
        || ((path[0] === 'title' || path[0] === 'verse') && equalValues(base, theirs))))) return [];
  const fields = orderedMetadataComparisons(command, current, orders,
    target => target.action === 'sermonTitleAction' || target.action === 'sermonVerseAction' || target.action === 'sermonChurchAction',
    { settled: SERMON_METADATA_SETTLED, queued: SERMON_METADATA_QUEUED });
  const date = command.preachDateAction, displaced = dateOrder.displaced;
  if (date && dateOrder.target === PREACH_DATE_TARGET && displaced?.rowId === date.rowId) {
    const settled = displaced.date === date.after;
    fields.push({
      path: rowConflictPath(date.rowId, PREACH_DATE_TARGET),
      code: settled ? SERMON_METADATA_SETTLED : SERMON_METADATA_QUEUED,
      base: rowConflictValue(date.before), mine: rowConflictValue(date.after),
      theirs: rowConflictValue(settled ? displaced.winnerDate : displaced.date),
    });
  }
  return fields;
}

export function isGroupScalarText(target: DocumentFieldTarget): boolean {
  return target.action === 'groupDescriptionAction' || target.action === 'groupTitleAction';
}

export function orderedGroupScalarText(command: DataCommand, current: ResourceSnapshot,
  orders: ReturnType<typeof orderDocumentFields>): ConflictDetail[] {
  if (command.kind !== 'update' || command.resource.collection !== 'groups') return [];
  return orders.fields.flatMap(({ target, order }) => {
    if (!order.displaced || !isGroupScalarText(target)) return [];
    const change = documentFieldChange(command.changes, target);
    const stored = documentFieldValue(current.value, target);
    if (!change || !stored) return [];
    const { value, winnerValue } = order.displaced;
    const code = equalValues(stored, winnerValue) && equalValues(change.after, value) ? GROUP_FLOW_TEXT_SETTLED
      : equalValues(stored, value) && equalValues(change.after, winnerValue) ? GROUP_FLOW_TEXT_QUEUED : undefined;
    return code ? [{ path: change.path, code, base: change.before, mine: change.after, theirs: stored }] : [];
  });
}

export function metadataAfterDocumentFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, fields?: ReturnType<typeof orderDocumentFields>) {
  const metadata = snapshot.metadata;
  if (!metadata) return metadata;
  const proofs = documentFieldTargets(snapshot.resource.collection).flatMap(target => {
    if (!snapshot.value || (target.action === 'commentKindAction' && snapshot.value.type !== 'comment')) return [];
    const value = documentFieldValue(snapshot.value, target);
    if (!value || !acceptsDocumentField(value, target)) return [];
    const referenceChanged = target.action === 'commentKindAction' && raw?.type === 'comment'
      && !matchesCommentKindPlace(raw as DocumentData, readField(snapshot.value, ['scriptureRefs']));
    const placeScopeChanged = target.action === 'commentPlaceAction'
      && !matchesCommentPlaceScope((raw ?? {}) as DocumentData, value, readField(snapshot.value, ['paragraph']));
    // Changing the role or kind ends a place proof. Moving ends the kind's passage proof.
    const scopeChanged = referenceChanged || placeScopeChanged;
    const order = scopeChanged ? undefined : fields?.fields.find(item => item.target === target)?.order;
    const rawMetadata = raw?._dataEngine;
    const rawValue = target.action === 'commentPlaceAction' ? documentFieldValue((raw ?? {}) as DocumentData, target)
      : readField((raw ?? {}) as DocumentData, documentFieldPath(target));
    const changed = target.causal === true && (scopeChanged || !equalValues(rawValue, value));
    if (target.action === 'sermonPreparationTextActions' && !value.exists && !changed
      && (!object(rawMetadata) || rawMetadata[target.proof] === undefined)) return [];
    const previous = scopeChanged ? undefined : order?.previous ?? previousField(rawMetadata, snapshot, target);
    // The first unrelated write to an older sermon, including a secondary effect,
    // observes the same field at the original revision.
    const revision = target.causal && !changed && order?.stamp === undefined && object(rawMetadata)
      && rawMetadata.generation === metadata.generation && proofRevision(rawMetadata.revision)
      ? rawMetadata.revision : metadata.revision;
    const sameWordWon = tracksOpeningReturns(target) && (order?.stamp != null || order?.acknowledgedListChoice
      || (target.action === 'sermonPreparationTextActions' && order?.reaffirmedOpening));
    const listOpening = order?.listOpening && equalValues(order.listOpening.intended, value) ? order.listOpening.basis : undefined;
    const time = target.action === 'sermonRepeatedWordsAction' && !listOpening ? null : order?.stamp ?? null;
    const proof: FieldProof = order?.stamp === undefined && previous ? previous : {
      value, revision, time,
      ...(listOpening && { listOpening }),
      ...((changed || sameWordWon || ((target.action === 'sermonPlanModeAction' || target.action === 'commentPlaceAction') && order?.stamp !== undefined)) && metadata.operationId
        && { operationId: metadata.operationId }),
      ...(order?.initialized && { initialized: true as const }),
    };
    const match = usesDigest(target) ? { digest: fieldDigest(proof.value, target) } : { [target.field]: proof.value.value };
    const pastOpenings = tracksOpeningReturns(target) && rawValue && object(rawMetadata)
      && rawMetadata.generation === metadata.generation
      ? nextFieldOpenings(rawMetadata, target, rawValue, changed || order?.reaffirmedOpening === true) : undefined;
    return [[target.proof, { ...match, revision: proof.revision, time: proof.time,
      ...(target.causal && proof.operationId && { operationId: proof.operationId }),
      ...(proof.initialized && { initialized: true as const }),
      ...(proof.listOpening && { listOpening: proof.listOpening }),
      ...(pastOpenings !== undefined && { pastOpenings }) }]] as const;
  });
  const commentPlaceFrames = nextCommentPlaceFrames(snapshot, raw as DocumentData | undefined);
  return { ...metadata, ...Object.fromEntries(proofs), ...(commentPlaceFrames !== undefined && { commentPlaceFrames }) };
}
