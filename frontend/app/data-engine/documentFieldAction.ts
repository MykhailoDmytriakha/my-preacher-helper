import { isGroupStatus } from '@/utils/groupDocument';

import { boundedActionTime } from './actionClock';
import { isSermonChurch } from './churchFieldValue';
import { COUNCIL_LIFECYCLE, COUNCIL_TIMED_FIELDS, councilLifecycleValue, matchesCouncilLifecycle, withCouncilLifecycle, type CouncilFieldActions, type CouncilFieldTarget } from './councilFieldAction';
import { equalValues, readField } from './fieldValues';
import { SERIES_FIELD_TARGETS } from './seriesFieldAction';
import { captureSermonChurchFill } from './sermonChurchFill';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SeriesFieldObservation, SeriesFieldTarget } from './seriesFieldAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { DataCommand, DocumentData, FieldChange, FieldValue, ResourceRef, ResourceSnapshot } from './types';
import type { Church, Group } from '@/models/models';

export type DocumentFieldStamp = { observedRevision: number; time: ActionTime | null; predecessorOperationId?: string };
export type DocumentFieldObservation<Value = string> = DocumentFieldStamp & { before: Value; after: Value };
export type DocumentFieldAction = DocumentFieldObservation & { time: ActionTime };
export type DocumentTitleSeen = { title: string; generation: string; revision: number; requestId?: string };
export type ServiceOrderTitleSeen = DocumentTitleSeen;
export type ServiceOrderTitleCapture = { time: ActionTime; seen: ServiceOrderTitleSeen };
export type PrayerTitleSeen = DocumentTitleSeen;
export type PrayerTitleCapture = { time: ActionTime | null; seen: PrayerTitleSeen };
export type DisplacedDocumentTitle = {
  title: string; winnerTitle: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type DocumentTitleHistoryEntry = DisplacedDocumentTitle & { id: string; acceptedAt: string };
export type ServiceOrderTitleHistoryPage = {
  owner: string; orderId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type GroupTimedField = 'title' | 'status';

type TextDocumentFieldTarget = {
  field: GroupTimedField | 'verse';
  action: 'serviceOrderTitleAction' | 'prayerTitleAction' | 'sermonTitleAction' | 'sermonVerseAction' | 'groupTitleAction' | 'groupStatusAction';
  proof: 'serviceOrderTitle' | 'prayerTitle' | 'sermonTitle' | 'sermonVerse' | 'groupTitle' | 'groupStatus';
  accepts: (value: unknown) => value is string;
  causal?: true;
};

export type DocumentFieldTarget = TextDocumentFieldTarget | typeof SERMON_CHURCH | SeriesFieldTarget | CouncilFieldTarget;
export type SermonChurchObservation = DocumentFieldObservation<FieldValue>;

export type GroupStatusHistoryPage = {
  owner: string; groupId: string; generation: string; nextCursor: string | null;
  entries: { id: string; status: Group['status']; winnerStatus: Group['status']; acceptedAt: string }[];
};

const SERMON_CHURCH = { field: 'church', action: 'sermonChurchAction', proof: 'sermonChurch', causal: true } as const;

const shortTitle = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;
const SERVICE_ORDER_TITLE: TextDocumentFieldTarget = { field: 'title', action: 'serviceOrderTitleAction', proof: 'serviceOrderTitle',
  accepts: (value): value is string => shortTitle(value) && value.trim().length > 0 };
const PRAYER_TITLE = { field: 'title', action: 'prayerTitleAction', proof: 'prayerTitle', causal: true,
  accepts: (value: unknown): value is string => shortTitle(value) && value.trim().length > 0,
} as const satisfies TextDocumentFieldTarget;
const SERMON_TITLE = { field: 'title', action: 'sermonTitleAction', proof: 'sermonTitle', accepts: shortTitle, causal: true } as const satisfies TextDocumentFieldTarget;
const SERMON_VERSE = { field: 'verse', action: 'sermonVerseAction', proof: 'sermonVerse', causal: true,
  accepts: (value): value is string => typeof value === 'string' } as const satisfies TextDocumentFieldTarget;
const GROUP_TITLE = { field: 'title', action: 'groupTitleAction', proof: 'groupTitle', accepts: shortTitle, draft: 'groupTitleDraft' } as const satisfies GroupFieldTarget;
const GROUP_STATUS = { field: 'status', action: 'groupStatusAction', proof: 'groupStatus', accepts: isGroupStatus, draft: 'groupStatusDraft' } as const satisfies GroupFieldTarget;
export const GROUP_TIMED_FIELDS = [GROUP_TITLE, GROUP_STATUS] as const;
const COUNCIL_FIELDS = [...COUNCIL_TIMED_FIELDS, COUNCIL_LIFECYCLE];

export function documentFieldTargets(collection: string): readonly DocumentFieldTarget[] {
  if (collection === 'serviceOrders') return [SERVICE_ORDER_TITLE];
  if (collection === 'groups') return GROUP_TIMED_FIELDS;
  if (collection === 'series') return SERIES_FIELD_TARGETS;
  if (collection === 'prayerRequests') return [PRAYER_TITLE];
  if (collection === 'councils') return COUNCIL_FIELDS;
  if (collection === 'sermons') return [SERMON_TITLE, SERMON_VERSE, SERMON_CHURCH];
  return [];
}

export function acceptsDocumentField(value: FieldValue, target: DocumentFieldTarget): boolean {
  if (target.field === 'church') return isSermonChurch(value);
  if (!value.exists) return 'optional' in target && target.optional === true;
  return target.accepts(value.value);
}

export function capturedDocumentField(record: CommitRequest, target: DocumentFieldTarget) {
  return target.action === 'seriesFieldActions' ? record.seriesFieldActions?.[target.field] : record[target.action];
}

function isShortDocumentTitle(value: unknown, target: TextDocumentFieldTarget): value is string {
  return target.accepts(value);
}

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

export function documentFieldChange(changes: readonly FieldChange[], target: DocumentFieldTarget): FieldChange | undefined {
  return changes.find(change => change.path.length === 1 && change.path[0] === target.field);
}

/** Only a displayed title from the exact pending tip can continue a submitted local edit. */
export function submittedDocumentTitle(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): DocumentTitleSeen | undefined {
  if (!checkpoint || needsAttention) return undefined;
  const { collection } = checkpoint.confirmed.resource;
  const target = collection === 'serviceOrders' ? SERVICE_ORDER_TITLE : collection === 'prayerRequests' ? PRAYER_TITLE : null;
  const shown = checkpoint.draft?.title;
  if (!target || !isShortDocumentTitle(shown, target)) return undefined;
  const tip = Object.keys(checkpoint.pending).at(-1);
  const byId = new Map(requests.map(request => [request.id, request]));
  let request = tip && byId.get(tip);
  // An unrelated queued save must not replace the exact local rename supplying this title.
  if (collection === 'prayerRequests') {
    const visited = new Set<string>();
    while (request && request.value?.title === shown && !request.prayerTitleAction && !visited.has(request.id)) {
      visited.add(request.id);
      request = request.predecessor ? byId.get(request.predecessor) : undefined;
    }
  }
  const basis = request ? request.baseline.metadata : null;
  if (!request || request.value?.title !== shown || !basis || basis.deleted || basis.generation !== checkpoint.confirmed.metadata?.generation) return undefined;
  const action = request.serviceOrderTitleAction ?? request.prayerTitleAction;
  return { title: shown, generation: basis.generation, revision: action?.observedRevision ?? basis.revision, requestId: request.id };
}

export function matchesPrayerTitleRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: PrayerTitleSeen): boolean {
  return Boolean(request && request.id === seen.requestId && request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.baseline.metadata?.generation === seen.generation && request.prayerTitleAction?.after === seen.title
    && request.prayerTitleAction.observedRevision === seen.revision && !['conflict', 'refused', 'cancelled'].includes(request.state));
}

export function validatedTitleCapture(confirmed: ResourceSnapshot, draft: DocumentData | null, next: DocumentData | null,
  capture: ServiceOrderTitleCapture, knownPredecessor: boolean): ServiceOrderTitleCapture | undefined {
  const { seen } = capture;
  const time = boundedActionTime(capture.time);
  const title = next?.title;
  if (confirmed.resource.collection === 'serviceOrders' && !confirmed.metadata?.deleted && seen.generation === confirmed.metadata?.generation
    && Number.isSafeInteger(seen.revision) && seen.revision > 0 && seen.revision <= confirmed.metadata.revision
    && (!seen.requestId || knownPredecessor || confirmed.value?.title === seen.title) && isShortDocumentTitle(seen.title, SERVICE_ORDER_TITLE) && isShortDocumentTitle(title, SERVICE_ORDER_TITLE) && time) {
    return { seen: { ...seen }, time };
  }
  // Without the shown ancestor, the normal writer may only use the title it actually sees.
  if (seen.generation !== confirmed.metadata?.generation || draft?.title !== seen.title) throw Object.assign(new Error('The service order title changed'), { code: 'stale-write' });
  return undefined;
}

export function captureServiceOrderTitle(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: ServiceOrderTitleCapture): DocumentFieldAction | undefined {
  if (!capture || baseline.resource.collection !== 'serviceOrders' || baseline.metadata?.generation !== capture.seen.generation) return undefined;
  const after = value?.title;
  if (!isShortDocumentTitle(after, SERVICE_ORDER_TITLE) || after === capture.seen.title) return undefined;
  return { before: capture.seen.title, after, observedRevision: capture.seen.revision, time: capture.time };
}

export function capturePrayerTitle(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: PrayerTitleCapture, knownPredecessor = false): DocumentFieldObservation | undefined {
  if (!capture || baseline.resource.collection !== 'prayerRequests' || baseline.metadata?.deleted
    || baseline.metadata?.generation !== capture.seen.generation || capture.seen.revision > baseline.metadata.revision
    || !Number.isSafeInteger(capture.seen.revision) || capture.seen.revision < 1
    || (capture.seen.requestId && !knownPredecessor && baseline.value?.title !== capture.seen.title)) return undefined;
  const { seen } = capture;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  const after = value?.title;
  if (time === undefined || !PRAYER_TITLE.accepts(seen.title) || !PRAYER_TITLE.accepts(after) || after === seen.title) return undefined;
  return { before: seen.title, after, observedRevision: seen.revision, time,
    ...(knownPredecessor && seen.requestId && { predecessorOperationId: seen.requestId }) };
}

type SermonTextTarget = typeof SERMON_TITLE | typeof SERMON_VERSE;
type CapturedMetadataTarget = SermonTextTarget | typeof SERMON_CHURCH | SeriesFieldTarget | CouncilFieldTarget;

function knownMetadataFieldPredecessor(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  target: CapturedMetadataTarget, value: string | FieldValue, records: readonly CommitRequest[]): string | undefined {
  if (!predecessor) return undefined;
  const requests = new Map(records.map(request => [request.id, request]));
  const visited = new Set<string>();
  for (let request: CommitRequest | undefined = predecessor; request && !visited.has(request.id);
    request = requests.get(request.predecessor ?? '')) {
    if (request.owner !== predecessor.owner || !equalValues(request.baseline.resource, baseline.resource)
      || request.baseline.metadata?.generation !== baseline.metadata?.generation || !equalValues(target.field === 'heldAt' ? councilLifecycleValue(request.value)
        : target.field === 'church' || target.field === 'date' || target.action === 'seriesFieldActions' ? readField(request.value ?? {}, [target.field]) : request.value?.[target.field], value)
      || ['cancelled', 'refused', 'conflict'].includes(request.state)) break;
    const action = capturedDocumentField(request, target);
    if (action) return equalValues(action.after, value) ? request.id : undefined;
    visited.add(request.id);
  }
}

function captureSermonField(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  target: SermonTextTarget, time: ActionTime | null, records: readonly CommitRequest[]): DocumentFieldObservation | undefined {
  const before = (predecessor ? predecessor.value : baseline.value)?.[target.field], after = draft?.[target.field];
  if (!target.accepts(before) || !target.accepts(after) || !after.trim() || before === after) return undefined;
  const predecessorOperationId = knownMetadataFieldPredecessor(baseline, predecessor, target, before, records);
  return { before, after, time, observedRevision: baseline.metadata!.revision, ...(predecessorOperationId && { predecessorOperationId }) };
}

function captureStoredMetadataField(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  target: typeof SERMON_CHURCH | SeriesFieldTarget, time: ActionTime | null, records: readonly CommitRequest[]): DocumentFieldObservation<FieldValue> | undefined {
  if (!draft) return undefined;
  const original = (predecessor ? predecessor.value : baseline.value) ?? {};
  const before = readField(original, [target.field]);
  const after = readField(draft, [target.field]);
  if (!acceptsDocumentField(before, target) || !acceptsDocumentField(after, target) || equalValues(before, after)) return undefined;
  const predecessorOperationId = knownMetadataFieldPredecessor(baseline, predecessor, target, before, records);
  return { before, after, time, observedRevision: baseline.metadata!.revision, ...(predecessorOperationId && { predecessorOperationId }) };
}

/** Selected fields share the time of one explicit Save and retain their own ancestors. */
export function captureDocumentMetadataFields(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captured: ActionTime | null | undefined, records: readonly CommitRequest[]) {
  if (captured === undefined || !baseline.metadata || baseline.metadata.deleted) return {};
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return {};
  if (baseline.resource.collection === 'series') {
    const actions = SERIES_FIELD_TARGETS.flatMap(target => {
      const action: SeriesFieldObservation | undefined = captureStoredMetadataField(baseline, predecessor, draft, target, time, records);
      if (!action) return [];
      const openingTheme = (predecessor ? predecessor.value : baseline.value)?.theme;
      const mirror = target.field === 'title' && draft?.theme === action.after.value && typeof openingTheme === 'string';
      return [[target.field, { ...action, ...(mirror && { openingTheme }) }]] as const;
    });
    return actions.length ? { seriesFieldActions: Object.fromEntries(actions) } : {};
  }
  if (baseline.resource.collection !== 'sermons') return {};
  const title = captureSermonField(baseline, predecessor, draft, SERMON_TITLE, time, records);
  const verse = captureSermonField(baseline, predecessor, draft, SERMON_VERSE, time, records);
  const church = captureStoredMetadataField(baseline, predecessor, draft, SERMON_CHURCH, time, records);
  const opening = (predecessor ? predecessor.value : baseline.value)?.preachDates;
  const fill = draft && captureSermonChurchFill(opening, draft.preachDates, readField(draft, ['church']));
  return { ...(title && { sermonTitleAction: title }), ...(verse && { sermonVerseAction: verse }),
    ...(church && { sermonChurchAction: church }), ...(fill && { sermonChurchFill: fill }) };
}

export type AutosaveFieldStamp = { field: GroupTimedField | CouncilFieldTarget['field']; time: ActionTime | null };
type AutosaveFieldValue = string | FieldValue;
type AutosaveFieldAction = DocumentFieldObservation<AutosaveFieldValue>;
export type AutosaveFieldDraft = { generation: string; action: AutosaveFieldAction };
type GroupFieldActions = { groupTitleAction?: DocumentFieldAction; groupStatusAction?: DocumentFieldAction };
export type AutosaveFieldActions = GroupFieldActions & CouncilFieldActions;
type GroupFieldTarget = TextDocumentFieldTarget & { action: keyof GroupFieldActions; draft: 'groupTitleDraft' | 'groupStatusDraft' };
type AutosaveFieldTarget = GroupFieldTarget | CouncilFieldTarget;
export type AutosaveFieldDrafts = Partial<Record<AutosaveFieldTarget['draft'], AutosaveFieldDraft>>;

export function autosaveFieldTargets(collection: string): readonly AutosaveFieldTarget[] {
  if (collection === 'groups') return GROUP_TIMED_FIELDS;
  if (collection === 'councils') return COUNCIL_FIELDS;
  return [];
}

function autosaveFieldValue(document: DocumentData | null | undefined, target: AutosaveFieldTarget): AutosaveFieldValue | undefined {
  if (target.field === 'date') return readField(document ?? {}, [target.field]);
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
  const visible = shown?.editGeneration === checkpoint.editGeneration
    && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
  const staged = checkpoint[target.draft];
  const prior = staged?.generation === metadata.generation && equalValues(staged.action.after, oldValue) ? staged.action : undefined;
  const tip = Object.values(checkpoint.pending).reduce<SessionCheckpoint['pending'][string] | undefined>((latest, item) =>
    !latest || item.generation > latest.generation ? item : latest, undefined);
  const pending = tip && equalValues(autosaveFieldValue(tip.value, target), oldValue) ? tip : undefined;
  const before = prior && !pending ? prior.before : pending ? oldValue : autosaveFieldValue(visible.draft ?? checkpoint.draft, target) ?? oldValue;
  if (!acceptsAutosaveField(before, target) || equalValues(before, nextValue)) return undefined;
  const observedRevision = prior?.observedRevision ?? pending?.[target.action]?.observedRevision ?? visible.confirmed.metadata!.revision;
  return { generation: metadata.generation, action: { before, after: nextValue, observedRevision, time } };
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
    && equalValues(left.time, right.time) && left.observedRevision === right.observedRevision);
}

function uncapturedAutosaveField(checkpoint: SessionCheckpoint, target: AutosaveFieldTarget): AutosaveFieldAction | undefined {
  const action = autosaveDraftAction(checkpoint, target);
  return action && !Object.values(checkpoint.pending).some(request => sameAutosaveCapture(request[target.action], action)) ? action : undefined;
}

export function uncapturedAutosaveFields(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[]): AutosaveFieldActions {
  return Object.fromEntries(autosaveFieldTargets(checkpoint.confirmed.resource.collection).flatMap(target => {
    const action = uncapturedAutosaveField(checkpoint, target);
    if (!action) return [];
    const predecessorOperationId = target.action === 'councilTitleAction' || target.action === 'councilDateAction' || target.action === 'councilLifecycleAction'
      ? knownMetadataFieldPredecessor(baseline, predecessor, target, action.before, records) : undefined;
    return [[target.action, { ...action, ...(predecessorOperationId && { predecessorOperationId }) }]];
  }));
}

export function hasUncapturedAutosaveField(checkpoint: SessionCheckpoint): boolean {
  return autosaveFieldTargets(checkpoint.confirmed.resource.collection).some(target => Boolean(uncapturedAutosaveField(checkpoint, target)));
}

export function autosaveAcknowledgementAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
  checkpoint: SessionCheckpoint): DocumentData | null {
  if (!ancestor) return ancestor;
  return autosaveFieldTargets(checkpoint.confirmed.resource.collection).reduce((before, target) => {
    const action = autosaveDraftAction(checkpoint, target);
    const value = autosaveFieldValue(accepted.value, target);
    if (!action || !equalValues(action.before, autosaveFieldValue(before, target))
      || accepted.metadata?.generation !== checkpoint[target.draft]?.generation || !acceptsAutosaveField(value, target)) return before;
    return withDocumentFieldValue(before, target.field, observedValue(value));
  }, ancestor);
}

function withDocumentFieldValue(value: DocumentData, field: string, selected: FieldValue): DocumentData {
  if (field === 'heldAt') return withCouncilLifecycle(value, selected);
  const next = { ...value };
  if (selected.exists) next[field] = selected.value!;
  else delete next[field];
  return next;
}

export function pendingDocumentFieldAncestor(record: CommitRequest, before: DocumentData | null, accepted: ResourceSnapshot): DocumentData | null {
  if (!before || !accepted.value || accepted.metadata?.generation !== record.baseline.metadata?.generation) return before;
  return documentFieldTargets(record.baseline.resource.collection).reduce((value, target) => {
    if (!capturedDocumentField(record, target)) return value;
    const stored = target.field === 'heldAt' ? councilLifecycleValue(accepted.value) : readField(accepted.value!, [target.field]);
    if (!stored || !acceptsDocumentField(stored, target)) return value;
    const rebased = withDocumentFieldValue(value, target.field, stored);
    if (target.action !== 'seriesFieldActions' || target.field !== 'title' || record.value?.title !== record.value?.theme) return rebased;
    const mirror = readField(accepted.value!, ['theme']);
    return equalValues(mirror, stored) ? withDocumentFieldValue(rebased, 'theme', mirror) : rebased;
  }, before);
}

type StoredObservation = DocumentFieldObservation<string | FieldValue> & { openingTheme?: string };

function observedValue(value: string | FieldValue): FieldValue {
  return typeof value === 'string' ? { exists: true, value } : value;
}

export function documentFieldCommandAncestor(working: ResourceSnapshot, action: StoredObservation, field: DocumentFieldTarget['field']): ResourceSnapshot {
  if (!working.value || working.metadata?.deleted) return working;
  const value = withDocumentFieldValue(working.value, field, observedValue(action.before));
  return { ...working, value: field === 'title' && action.openingTheme !== undefined ? { ...value, theme: action.openingTheme } : value };
}

export function withDocumentFieldAction(command: DataCommand, target: DocumentFieldTarget, action?: StoredObservation): DataCommand {
  if (!action || command.kind !== 'update') return command;
  const change = documentFieldChange(command.changes, target);
  if (!change || !equalValues(change.before, observedValue(action.before)) || !equalValues(change.after, observedValue(action.after))) return command;
  const { observedRevision, time, predecessorOperationId } = action;
  const stamp = { observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) };
  if (target.action === 'seriesFieldActions') {
    return { ...command, seriesFieldActions: { ...command.seriesFieldActions,
      [target.field]: { ...stamp, ...(action.openingTheme !== undefined && { openingTheme: action.openingTheme }) } } };
  }
  if (target.field === 'heldAt' && !matchesCouncilLifecycle(command.changes, change)) return command;
  if (target.field === 'verse' || target.field === 'church' || target.field === 'date' || target.field === 'heldAt') return { ...command, [target.action]: stamp };
  if (typeof action.before !== 'string' || typeof action.after !== 'string') return command;
  return { ...command, [target.action]: action };
}
