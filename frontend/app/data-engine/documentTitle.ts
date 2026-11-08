import { boundedActionTime } from './actionClock';
import { equalValues } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from './types';

export type DocumentTitleAction = { before: string; after: string; observedRevision: number; time: ActionTime };
export type ServiceOrderTitleSeen = { title: string; generation: string; revision: number; requestId?: string };
export type ServiceOrderTitleCapture = { time: ActionTime; seen: ServiceOrderTitleSeen };
export type DisplacedDocumentTitle = {
  title: string; winnerTitle: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type DocumentTitleHistoryEntry = DisplacedDocumentTitle & { id: string; acceptedAt: string };
export type ServiceOrderTitleHistoryPage = {
  owner: string; orderId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export type DocumentTitleTarget = {
  action: 'serviceOrderTitleAction' | 'groupTitleAction';
  proof: 'serviceOrderTitle' | 'groupTitle';
  allowsEmpty: boolean;
};

const SERVICE_ORDER_TITLE: DocumentTitleTarget = { action: 'serviceOrderTitleAction', proof: 'serviceOrderTitle', allowsEmpty: false };
const GROUP_TITLE: DocumentTitleTarget = { action: 'groupTitleAction', proof: 'groupTitle', allowsEmpty: true };

export function documentTitleTarget(collection: string): DocumentTitleTarget | undefined {
  if (collection === 'serviceOrders') return SERVICE_ORDER_TITLE;
  if (collection === 'groups') return GROUP_TITLE;
}

export function isShortDocumentTitle(value: unknown, target: DocumentTitleTarget): value is string {
  return typeof value === 'string' && value.length <= 1024 && (target.allowsEmpty || value.trim().length > 0);
}

export type GroupTitleHistoryPage = {
  owner: string; groupId: string; generation: string; entries: DocumentTitleHistoryEntry[]; nextCursor: string | null;
};

export function documentTitleChange(changes: readonly FieldChange[]): FieldChange | undefined {
  return changes.find(change => change.path.length === 1 && change.path[0] === 'title');
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
  capture?: ServiceOrderTitleCapture): DocumentTitleAction | undefined {
  if (!capture || baseline.resource.collection !== 'serviceOrders' || baseline.metadata?.generation !== capture.seen.generation) return undefined;
  const after = value?.title;
  if (!isShortDocumentTitle(after, SERVICE_ORDER_TITLE) || after === capture.seen.title) return undefined;
  return { before: capture.seen.title, after, observedRevision: capture.seen.revision, time: capture.time };
}

export type GroupTitleDraft = { generation: string; action: DocumentTitleAction };

/** An autosaved title retains the displayed ancestor across keystrokes and unrelated edits. */
export function stageGroupTitle(checkpoint: SessionCheckpoint, value: DocumentData | null,
  shown: ShownCopy | undefined, stamp: ActionTime | undefined): GroupTitleDraft | undefined {
  if (checkpoint.confirmed.resource.collection !== 'groups') return undefined;
  const oldTitle = checkpoint.draft?.title, nextTitle = value?.title;
  if (oldTitle === nextTitle) return checkpoint.groupTitleDraft;
  const metadata = checkpoint.confirmed.metadata;
  const time = boundedActionTime(stamp);
  if (!metadata || metadata.deleted || !time || !isShortDocumentTitle(nextTitle, GROUP_TITLE)) return undefined;
  const visible = shown?.editGeneration === checkpoint.editGeneration
    && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
  const prior = checkpoint.groupTitleDraft?.generation === metadata.generation
    && checkpoint.groupTitleDraft.action.after === oldTitle ? checkpoint.groupTitleDraft.action : undefined;
  const tip = Object.values(checkpoint.pending).reduce<SessionCheckpoint['pending'][string] | undefined>((latest, item) =>
    !latest || item.generation > latest.generation ? item : latest, undefined);
  const pending = tip?.value?.title === oldTitle ? tip : undefined;
  const before = prior && !pending ? prior.before : pending ? oldTitle : visible.draft?.title ?? oldTitle;
  if (!isShortDocumentTitle(before, GROUP_TITLE) || before === nextTitle) return undefined;
  const observedRevision = prior?.observedRevision ?? pending?.groupTitleAction?.observedRevision ?? visible.confirmed.metadata!.revision;
  return { generation: metadata.generation, action: { before, after: nextTitle, observedRevision, time } };
}

function groupTitleDraftAction(checkpoint: SessionCheckpoint): DocumentTitleAction | undefined {
  const staged = checkpoint.groupTitleDraft;
  const metadata = checkpoint.confirmed.metadata;
  if (checkpoint.confirmed.resource.collection !== 'groups' || !staged || !metadata || metadata.deleted
    || staged.generation !== metadata.generation || staged.action.observedRevision > metadata.revision
    || staged.action.after !== checkpoint.draft?.title) return undefined;
  return staged.action;
}

export function uncapturedGroupTitle(checkpoint: SessionCheckpoint): DocumentTitleAction | undefined {
  const action = groupTitleDraftAction(checkpoint);
  return action && !Object.values(checkpoint.pending).some(request => equalValues(request.groupTitleAction ?? null, action)) ? action : undefined;
}

export function groupTitleAcknowledgementAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
  checkpoint: SessionCheckpoint): DocumentData | null {
  const action = groupTitleDraftAction(checkpoint);
  if (!action || !ancestor || action.before !== ancestor.title || accepted.metadata?.generation !== checkpoint.groupTitleDraft?.generation
    || !isShortDocumentTitle(accepted.value?.title, GROUP_TITLE)) return ancestor;
  return { ...ancestor, title: accepted.value.title };
}

export function titleCommandAncestor(working: ResourceSnapshot, action: DocumentTitleAction): ResourceSnapshot {
  if (!working.value || working.metadata?.deleted) return working;
  return { ...working, value: { ...working.value, title: action.before } };
}

export function withDocumentTitleAction(command: DataCommand, action?: DocumentTitleAction): DataCommand {
  const target = documentTitleTarget(command.resource.collection);
  if (!action || !target || command.kind !== 'update') return command;
  const change = documentTitleChange(command.changes);
  return change?.before.exists && change.before.value === action.before && change.after.exists && change.after.value === action.after
    ? { ...command, [target.action]: action }
    : command;
}
