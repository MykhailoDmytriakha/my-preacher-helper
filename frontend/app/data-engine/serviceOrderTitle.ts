import { boundedActionTime } from './actionClock';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from './types';

export type ServiceOrderTitleAction = { before: string; after: string; observedRevision: number; time: ActionTime };
export type ServiceOrderTitleSeen = { title: string; generation: string; revision: number; requestId?: string };
export type ServiceOrderTitleCapture = { time: ActionTime; seen: ServiceOrderTitleSeen };
export type DisplacedServiceOrderTitle = {
  title: string; winnerTitle: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type ServiceOrderTitleHistoryEntry = DisplacedServiceOrderTitle & { id: string; acceptedAt: string };
export type ServiceOrderTitleHistoryPage = {
  owner: string; orderId: string; generation: string; entries: ServiceOrderTitleHistoryEntry[]; nextCursor: string | null;
};

export function isShortServiceOrderTitle(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value.trim().length > 0;
}

export function serviceOrderTitleChange(changes: readonly FieldChange[]): FieldChange | undefined {
  return changes.find(change => change.path.length === 1 && change.path[0] === 'title');
}

/** Only a displayed title from the exact pending tip can continue a submitted local edit. */
export function submittedServiceOrderTitle(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  needsAttention: boolean): ServiceOrderTitleSeen | undefined {
  const shown = checkpoint?.draft?.title;
  if (checkpoint?.confirmed.resource.collection !== 'serviceOrders' || needsAttention || !isShortServiceOrderTitle(shown)) return undefined;
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
    && (!seen.requestId || knownPredecessor || confirmed.value?.title === seen.title) && isShortServiceOrderTitle(seen.title) && isShortServiceOrderTitle(title) && time) {
    return { seen: { ...seen }, time };
  }
  // Without the shown ancestor, the normal writer may only use the title it actually sees.
  if (seen.generation !== confirmed.metadata?.generation || draft?.title !== seen.title) throw Object.assign(new Error('The service order title changed'), { code: 'stale-write' });
  return undefined;
}

export function captureServiceOrderTitle(baseline: ResourceSnapshot, value: DocumentData | null,
  capture?: ServiceOrderTitleCapture): ServiceOrderTitleAction | undefined {
  if (!capture || baseline.resource.collection !== 'serviceOrders' || baseline.metadata?.generation !== capture.seen.generation) return undefined;
  const after = value?.title;
  if (!isShortServiceOrderTitle(after) || after === capture.seen.title) return undefined;
  return { before: capture.seen.title, after, observedRevision: capture.seen.revision, time: capture.time };
}

export function titleCommandAncestor(working: ResourceSnapshot, action: ServiceOrderTitleAction): ResourceSnapshot {
  if (!working.value || working.metadata?.deleted) return working;
  return { ...working, value: { ...working.value, title: action.before } };
}

export function withServiceOrderTitleAction(command: DataCommand, action?: ServiceOrderTitleAction): DataCommand {
  if (!action || command.resource.collection !== 'serviceOrders' || command.kind !== 'update') return command;
  const change = serviceOrderTitleChange(command.changes);
  return change?.before.exists && change.before.value === action.before && change.after.exists && change.after.value === action.after
    ? { ...command, serviceOrderTitleAction: action }
    : command;
}
