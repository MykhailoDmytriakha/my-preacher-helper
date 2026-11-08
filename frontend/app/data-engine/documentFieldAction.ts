import { isGroupStatus } from '@/utils/groupDocument';

import { boundedActionTime } from './actionClock';
import { equalValues } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from './types';
import type { Group } from '@/models/models';

export type DocumentFieldAction = { before: string; after: string; observedRevision: number; time: ActionTime };
export type ServiceOrderTitleSeen = { title: string; generation: string; revision: number; requestId?: string };
export type ServiceOrderTitleCapture = { time: ActionTime; seen: ServiceOrderTitleSeen };
export type DisplacedDocumentTitle = {
  title: string; winnerTitle: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type DocumentTitleHistoryEntry = DisplacedDocumentTitle & { id: string; acceptedAt: string };
export type ServiceOrderTitleHistoryPage = {
  owner: string; orderId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type GroupTimedField = 'title' | 'status';

export type DocumentFieldTarget = {
  field: GroupTimedField;
  action: 'serviceOrderTitleAction' | 'groupTitleAction' | 'groupStatusAction';
  proof: 'serviceOrderTitle' | 'groupTitle' | 'groupStatus';
  accepts: (value: unknown) => value is string;
};

export type GroupStatusHistoryPage = {
  owner: string; groupId: string; generation: string; nextCursor: string | null;
  entries: { id: string; status: Group['status']; winnerStatus: Group['status']; acceptedAt: string }[];
};

const shortTitle = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;
const SERVICE_ORDER_TITLE: DocumentFieldTarget = { field: 'title', action: 'serviceOrderTitleAction', proof: 'serviceOrderTitle',
  accepts: (value): value is string => shortTitle(value) && value.trim().length > 0 };
const GROUP_TITLE = { field: 'title', action: 'groupTitleAction', proof: 'groupTitle', accepts: shortTitle, draft: 'groupTitleDraft' } as const satisfies GroupFieldTarget;
const GROUP_STATUS = { field: 'status', action: 'groupStatusAction', proof: 'groupStatus', accepts: isGroupStatus, draft: 'groupStatusDraft' } as const satisfies GroupFieldTarget;
export const GROUP_TIMED_FIELDS = [GROUP_TITLE, GROUP_STATUS] as const;

export function documentFieldTargets(collection: string): readonly DocumentFieldTarget[] {
  if (collection === 'serviceOrders') return [SERVICE_ORDER_TITLE];
  if (collection === 'groups') return GROUP_TIMED_FIELDS;
  return [];
}

function isShortDocumentTitle(value: unknown, target: DocumentFieldTarget): value is string {
  return target.accepts(value);
}

export type GroupTitleHistoryPage = {
  owner: string; groupId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export function documentFieldChange(changes: readonly FieldChange[], target: DocumentFieldTarget): FieldChange | undefined {
  return changes.find(change => change.path.length === 1 && change.path[0] === target.field);
}

/** Only a displayed title from the exact pending tip can continue a submitted local edit. */
export function submittedServiceOrderTitle(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): ServiceOrderTitleSeen | undefined {
  const shown = checkpoint?.draft?.title;
  if (checkpoint?.confirmed.resource.collection !== 'serviceOrders' || needsAttention || !isShortDocumentTitle(shown, SERVICE_ORDER_TITLE)) return undefined;
  const tip = Object.keys(checkpoint.pending).at(-1);
  const request = requests.find(candidate => candidate.id === tip);
  const basis = request?.baseline.metadata;
  if (!request || request.value?.title !== shown || !basis || basis.deleted || basis.generation !== checkpoint.confirmed.metadata?.generation) return undefined;
  return { title: shown, generation: basis.generation,
    revision: request.serviceOrderTitleAction?.observedRevision ?? basis.revision, requestId: request.id };
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

export type GroupFieldStamp = { field: GroupTimedField; time: ActionTime };
export type GroupFieldDraft = { generation: string; action: DocumentFieldAction };
export type GroupFieldActions = { groupTitleAction?: DocumentFieldAction; groupStatusAction?: DocumentFieldAction };
type GroupFieldTarget = DocumentFieldTarget & { action: keyof GroupFieldActions; draft: 'groupTitleDraft' | 'groupStatusDraft' };

/** An autosaved field retains the displayed ancestor across keystrokes and unrelated edits. */
export function stageGroupField(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined,
  target: GroupFieldTarget, stamp: GroupFieldStamp | undefined): GroupFieldDraft | undefined {
  const oldValue = checkpoint.draft?.[target.field], nextValue = value?.[target.field];
  if (oldValue === nextValue) return checkpoint[target.draft];
  const metadata = checkpoint.confirmed.metadata;
  const time = stamp?.field === target.field ? boundedActionTime(stamp.time) : undefined;
  if (!metadata || metadata.deleted || !time || !target.accepts(nextValue)) return undefined;
  const visible = shown?.editGeneration === checkpoint.editGeneration
    && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
  const staged = checkpoint[target.draft];
  const prior = staged?.generation === metadata.generation && staged.action.after === oldValue ? staged.action : undefined;
  const tip = Object.values(checkpoint.pending).reduce<SessionCheckpoint['pending'][string] | undefined>((latest, item) =>
    !latest || item.generation > latest.generation ? item : latest, undefined);
  const pending = tip?.value?.[target.field] === oldValue ? tip : undefined;
  const before = prior && !pending ? prior.before : pending ? oldValue : visible.draft?.[target.field] ?? oldValue;
  if (!target.accepts(before) || before === nextValue) return undefined;
  const observedRevision = prior?.observedRevision ?? pending?.[target.action]?.observedRevision ?? visible.confirmed.metadata!.revision;
  return { generation: metadata.generation, action: { before, after: nextValue, observedRevision, time } };
}

function groupFieldDraftAction(checkpoint: SessionCheckpoint, target: GroupFieldTarget): DocumentFieldAction | undefined {
  const staged = checkpoint[target.draft];
  const metadata = checkpoint.confirmed.metadata;
  if (checkpoint.confirmed.resource.collection !== 'groups' || !staged || !metadata || metadata.deleted
    || staged.generation !== metadata.generation || staged.action.observedRevision > metadata.revision
    || staged.action.after !== checkpoint.draft?.[target.field]) return undefined;
  return staged.action;
}

function uncapturedGroupField(checkpoint: SessionCheckpoint, target: GroupFieldTarget): DocumentFieldAction | undefined {
  const action = groupFieldDraftAction(checkpoint, target);
  return action && !Object.values(checkpoint.pending).some(request => equalValues(request[target.action] ?? null, action)) ? action : undefined;
}

export function uncapturedGroupFields(checkpoint: SessionCheckpoint): GroupFieldActions {
  return Object.fromEntries(GROUP_TIMED_FIELDS.flatMap(target => {
    const action = uncapturedGroupField(checkpoint, target);
    return action ? [[target.action, action]] : [];
  }));
}

export function hasUncapturedGroupField(checkpoint: SessionCheckpoint): boolean {
  return GROUP_TIMED_FIELDS.some(target => Boolean(uncapturedGroupField(checkpoint, target)));
}

export function groupFieldAcknowledgementAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
  checkpoint: SessionCheckpoint): DocumentData | null {
  if (!ancestor) return ancestor;
  return GROUP_TIMED_FIELDS.reduce((before, target) => {
    const action = groupFieldDraftAction(checkpoint, target);
    const value = accepted.value?.[target.field];
    if (!action || action.before !== before[target.field] || accepted.metadata?.generation !== checkpoint[target.draft]?.generation
      || !target.accepts(value)) return before;
    return { ...before, [target.field]: value };
  }, ancestor);
}

export function pendingDocumentFieldAncestor(record: CommitRequest, before: DocumentData | null, accepted: ResourceSnapshot): DocumentData | null {
  if (!before || accepted.metadata?.generation !== record.baseline.metadata?.generation) return before;
  return documentFieldTargets(record.baseline.resource.collection).reduce((value, target) => {
    const stored = accepted.value?.[target.field];
    return record[target.action] && target.accepts(stored) ? { ...value, [target.field]: stored } : value;
  }, before);
}

export function documentFieldCommandAncestor(working: ResourceSnapshot, action: DocumentFieldAction, field: GroupTimedField): ResourceSnapshot {
  if (!working.value || working.metadata?.deleted) return working;
  return { ...working, value: { ...working.value, [field]: action.before } };
}

export function withDocumentFieldAction(command: DataCommand, target: DocumentFieldTarget, action?: DocumentFieldAction): DataCommand {
  if (!action || command.kind !== 'update') return command;
  const change = documentFieldChange(command.changes, target);
  return change?.before.exists && change.before.value === action.before && change.after.exists && change.after.value === action.after
    ? { ...command, [target.action]: action }
    : command;
}
