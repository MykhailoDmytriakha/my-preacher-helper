import { createHash } from 'node:crypto';

import { boundedActionTime, compareActionTime } from './actionClock';
import { changedExegeticalPoint, exegeticalPlan, exegeticalPlanChange, exegeticalPointConflict, exegeticalPointVersion, projectExegeticalPoint } from './exegeticalPointAction';
import { commandFingerprint, object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { boundedRowId, proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { ExegeticalPointHistoryEntry, ExegeticalPointStamp, ExegeticalPointVersion } from './exegeticalPointAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
type Proof = ExegeticalPointStamp & { revision: number; operationId: string; opening: string; result: string };
type Change = NonNullable<ReturnType<typeof exegeticalPlanChange>>;
type Plan = NonNullable<ReturnType<typeof exegeticalPlan>>;
type IntendedProof = { action: ExegeticalPointStamp; opening: string; result: string };
const MAX_PROOFS = 32;

export const EXEGETICAL_POINT_HISTORY = '_exegeticalPointHistory';

type DisplacedPoint = {
  nodeId: string; value: ExegeticalPointVersion | null; winner: ExegeticalPointVersion | null;
  actionTime: ActionTime; winnerActionTime: ActionTime;
};

type PointOrder = {
  command: DataCommand; uncertain: ConflictDetail[]; candidates: IntendedProof[]; displaced?: DisplacedPoint; comparison?: Omit<ExegeticalPointHistoryEntry, 'id'>;
};

const digest = (value: unknown) => createHash('sha256').update(commandFingerprint(value)).digest('base64url');
function structure(version: ExegeticalPointVersion) {
  const { title: _title, ...branch } = version.point;
  return digest([version.ancestors, branch]);
}
const resultOf = (version: ExegeticalPointVersion | null) => digest(version && [version.ancestors, version.point]);

function proofs(raw: unknown, generation: string): Proof[] {
  const list = object(raw) && raw.generation === generation ? raw.exegeticalPointProofs : undefined;
  return Array.isArray(list) ? list.slice(0, MAX_PROOFS).flatMap(item => {
    if (!object(item) || !boundedRowId(item.nodeId) || (item.kind !== 'title' && item.kind !== 'remove')
      || !proofRevision(item.revision) || !proofRevision(item.observedRevision)
      || !isValidIdentifier(item.operationId) || typeof item.opening !== 'string' || typeof item.result !== 'string') return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    return time === undefined ? [] : [{ nodeId: item.nodeId, kind: item.kind, observedRevision: item.observedRevision,
      revision: item.revision, operationId: item.operationId, opening: item.opening, result: item.result, time }];
  }) : [];
}

function actions(command: Update, change: Change, revision: number, serverMs: number) {
  if (!Array.isArray(command.exegeticalPlanActions) || command.exegeticalPlanActions.length > MAX_PROOFS) return new Map<string, ExegeticalPointStamp>();
  const observed = new Map<string, ExegeticalPointStamp>();
  const duplicates = new Set<string>();
  for (const item of command.exegeticalPlanActions) {
    if (!object(item) || !boundedRowId(item.nodeId) || (item.kind !== 'title' && item.kind !== 'remove')
      || !proofRevision(item.observedRevision) || item.observedRevision > revision
      || changedExegeticalPoint(change.opening, change.local, item.nodeId) !== item.kind) continue;
    const time = item.time === null ? null : boundedActionTime(item.time);
    if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) continue;
    if (observed.has(item.nodeId)) duplicates.add(item.nodeId);
    observed.set(item.nodeId, { nodeId: item.nodeId, kind: item.kind, observedRevision: item.observedRevision, time,
      ...(isValidIdentifier(item.predecessorOperationId) && { predecessorOperationId: item.predecessorOperationId }) });
  }
  for (const id of duplicates) observed.delete(id);
  return observed;
}

function competingPoint(change: Change, stored: Plan, evidence: ReadonlyMap<string, ExegeticalPointStamp>, saved: readonly Proof[]) {
  const points = [...change.opening.points.entries.keys()].flatMap(nodeId => {
    if (change.local.points.entries.has(nodeId) === stored.points.entries.has(nodeId)) return [];
    const mine = changedExegeticalPoint(change.opening, change.local, nodeId);
    const theirs = changedExegeticalPoint(change.opening, stored, nodeId);
    if (mine && theirs && mine !== theirs) return [{ nodeId, mine, theirs }];
    const action = evidence.get(nodeId), proof = saved.find(item => item.nodeId === nodeId);
    const original = exegeticalPointVersion(change.opening, nodeId);
    const current = exegeticalPointVersion(stored, nodeId);
    if (mine === 'remove' && !theirs && action && proof?.kind === 'title' && proof.revision > action.observedRevision && original
      && proof.opening === structure(original) && proof.result === resultOf(current)
      && resultOf(original) === proof.result && action.predecessorOperationId !== proof.operationId) {
      return [{ nodeId, mine, theirs: 'title' as const }];
    }
    return [];
  });
  return points.length === 1 ? points[0] : undefined;
}

export function orderExegeticalPoints(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number): PointOrder {
  const base = { command, uncertain: [], candidates: [] } satisfies PointOrder;
  const metadata = current.metadata;
  if (command.kind !== 'update' || current.resource.collection !== 'sermons' || !metadata
    || metadata.deleted || command.generation !== metadata.generation) return base;
  const change = exegeticalPlanChange(command.changes);
  const stored = exegeticalPlan(current.value?.preparation);
  if (!change || !stored) return base;
  const evidence = actions(command, change, metadata.revision, serverMs);
  const candidates = [...evidence.values()].flatMap(action => {
    const opening = exegeticalPointVersion(change.opening, action.nodeId)!;
    return resultOf(exegeticalPointVersion(stored, action.nodeId)) === resultOf(opening)
      ? [{ action, opening: structure(opening), result: resultOf(exegeticalPointVersion(change.local, action.nodeId)) }] : [];
  });
  const saved = proofs(raw, metadata.generation);
  const point = competingPoint(change, stored, evidence, saved);
  if (!point) return { ...base, candidates };
  const { nodeId } = point;
  const opening = exegeticalPointVersion(change.opening, nodeId)!;
  const local = exegeticalPointVersion(change.local, nodeId), live = exegeticalPointVersion(stored, nodeId);
  const action = evidence.get(nodeId), previous = saved.find(item => item.nodeId === nodeId);
  const beforeHash = structure(opening);
  const ordered = action?.time && previous?.time && previous.kind === point.theirs && previous.revision > action.observedRevision
    && previous.opening === beforeHash && previous.result === resultOf(live)
    ? compareActionTime(action.time, previous.time) : 0;
  const winner = ordered > 0 ? local : live;
  const before = projectExegeticalPoint(change.change.before.value, change.opening, nodeId, opening.ancestors, live);
  const after = projectExegeticalPoint(change.change.after.value, change.local, nodeId, opening.ancestors, winner);
  if (!before || !after) return { ...base, candidates };
  const planned = { ...command, changes: command.changes.map(item => item === change.change ? { ...item, before, after } : item) };
  if (!ordered || !action?.time || !previous?.time) {
    return { command: planned, candidates, uncertain: [exegeticalPointConflict(nodeId, opening, local, live)],
      comparison: { nodeId, value: local ?? live, winner: null, origin: 'comparison' } };
  }
  if (ordered > 0 && !candidates.some(candidate => candidate.action.nodeId === nodeId)) candidates.push({ action, opening: beforeHash, result: resultOf(winner) });
  return { command: planned, candidates, uncertain: [], displaced: {
    nodeId, value: ordered > 0 ? live : local, winner,
    actionTime: ordered > 0 ? previous.time : action.time, winnerActionTime: ordered > 0 ? action.time : previous.time,
  } };
}

export function metadataAfterExegeticalPoints(snapshot: ResourceSnapshot, raw: unknown, order?: PointOrder) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || resource.collection !== 'sermons') return metadata;
  const previousProofs = proofs(raw, metadata.generation);
  if (!previousProofs.length && !order?.candidates.length) return metadata;
  const next = exegeticalPlan(value?.preparation);
  if (!next) return metadata;
  const accepted = order?.candidates.filter(candidate => candidate.result === resultOf(exegeticalPointVersion(next, candidate.action.nodeId))) ?? [];
  const changed = new Set(accepted.map(candidate => candidate.action.nodeId));
  const previous = previousProofs.filter(proof =>
    !changed.has(proof.nodeId) && proof.result === resultOf(exegeticalPointVersion(next, proof.nodeId)));
  const tracked = [...accepted.map(({ action, opening, result }) => ({ ...action, opening, result, revision: metadata.revision, operationId: metadata.operationId! })),
    ...previous].slice(0, MAX_PROOFS);
  return tracked.length ? { ...metadata, exegeticalPointProofs: tracked } : metadata;
}

export function retainedExegeticalPointHistory(snapshot: ResourceSnapshot, order?: PointOrder) {
  const entry = order?.displaced;
  const plan = entry && exegeticalPlan(snapshot.value?.preparation);
  return entry && plan && resultOf(entry.winner) === resultOf(exegeticalPointVersion(plan, entry.nodeId)) ? entry : undefined;
}
