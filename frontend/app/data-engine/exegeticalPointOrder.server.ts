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
const MAX_EVICTED_POINTS = 256;

export const EXEGETICAL_POINT_HISTORY = '_exegeticalPointHistory';

type DisplacedPoint = {
  nodeId: string; value: ExegeticalPointVersion | null; winner: ExegeticalPointVersion | null;
  actionTime: ActionTime; winnerActionTime: ActionTime;
};

type PointOrder = {
  command: DataCommand; uncertain: ConflictDetail[]; candidates: IntendedProof[]; displaced?: DisplacedPoint; comparisons?: Omit<ExegeticalPointHistoryEntry, 'id'>[];
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

function evictedPointProofs(raw: unknown, generation: string, revision: number) {
  const state = object(raw) && raw.generation === generation ? raw.exegeticalPointEvictions : undefined;
  const entries = object(state) && Array.isArray(state.points) ? state.points.slice(0, MAX_EVICTED_POINTS) : [];
  const points = new Map<string, number>();
  for (const item of entries) {
    if (object(item) && boundedRowId(item.nodeId) && proofRevision(item.revision) && item.revision <= revision) {
      points.set(item.nodeId, Math.max(points.get(item.nodeId) ?? 0, item.revision));
    }
  }
  const older = object(state) && proofRevision(state.older) && state.older <= revision ? state.older : 0;
  return { points, older };
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

function competingPoints(change: Change, stored: Plan, evidence: ReadonlyMap<string, ExegeticalPointStamp>, saved: readonly Proof[],
  evicted: ReturnType<typeof evictedPointProofs>) {
  return [...change.opening.points.entries.keys()].flatMap(nodeId => {
    const mine = changedExegeticalPoint(change.opening, change.local, nodeId);
    if (!mine) return [];
    const theirs = changedExegeticalPoint(change.opening, stored, nodeId);
    if ((mine === 'title' && theirs === 'remove') || (mine === 'remove' && theirs === 'title')) {
      return [{ nodeId, theirs }];
    }
    const action = evidence.get(nodeId), proof = saved.find(item => item.nodeId === nodeId);
    if (!action) return [];
    const original = exegeticalPointVersion(change.opening, nodeId);
    const current = exegeticalPointVersion(stored, nodeId);
    const currentResult = resultOf(current);
    // A returned title and a never-changed title look alike after an older receipt was pruned.
    if (!proof && action.observedRevision < Math.max(evicted.points.get(nodeId) ?? 0, evicted.older) && original && current
      && currentResult === resultOf(original)) return [{ nodeId, theirs: 'title' as const }];
    if (proof?.kind === 'title' && proof.revision > action.observedRevision && original && current
      && proof.opening === structure(original) && proof.result === currentResult
      && action.predecessorOperationId !== proof.operationId
      && (theirs === 'title' ? resultOf(exegeticalPointVersion(change.local, nodeId)) !== proof.result
        : !theirs && resultOf(original) === proof.result)) return [{ nodeId, theirs: 'title' as const }];
    return [];
  });
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
  const evicted = evictedPointProofs(raw, metadata.generation, metadata.revision);
  const points = competingPoints(change, stored, evidence, saved, evicted);
  const [point] = points;
  if (!point) return { ...base, candidates };
  if (points.length > 1) {
    const versions = points.map(({ nodeId }) => ({ nodeId, opening: exegeticalPointVersion(change.opening, nodeId)!,
      mine: exegeticalPointVersion(change.local, nodeId), live: exegeticalPointVersion(stored, nodeId) }));
    const uncertain = versions.map(({ nodeId, opening, mine, live }) => exegeticalPointConflict(nodeId, opening, mine, live));
    const comparisons = versions.map(({ nodeId, mine, live }) => ({
      nodeId, value: mine ?? live, winner: null, origin: 'comparison' as const,
    }));
    return { ...base, candidates, uncertain, comparisons };
  }
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
      comparisons: [{ nodeId, value: local ?? live, winner: null, origin: 'comparison' }] };
  }
  if (ordered > 0 && !candidates.some(candidate => candidate.action.nodeId === nodeId)) candidates.push({ action, opening: beforeHash, result: resultOf(winner) });
  return { command: planned, candidates, uncertain: [], displaced: {
    nodeId, value: ordered > 0 ? live : local, winner,
    actionTime: ordered > 0 ? previous.time : action.time, winnerActionTime: ordered > 0 ? action.time : previous.time,
  } };
}

export function metadataAfterExegeticalPoints(snapshot: ResourceSnapshot, raw: unknown, order?: PointOrder) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || metadata.deleted || resource.collection !== 'sermons') return metadata;
  const previousProofs = proofs(raw, metadata.generation);
  const evicted = evictedPointProofs(raw, metadata.generation, metadata.revision);
  if (!previousProofs.length && !order?.candidates.length && !evicted.points.size && !evicted.older) return metadata;
  const next = exegeticalPlan(value?.preparation);
  const accepted = next ? order?.candidates.filter(candidate => candidate.result === resultOf(exegeticalPointVersion(next, candidate.action.nodeId))) ?? [] : [];
  const changed = new Set(accepted.map(candidate => candidate.action.nodeId));
  const previous = next ? previousProofs.filter(proof =>
    !changed.has(proof.nodeId) && proof.result === resultOf(exegeticalPointVersion(next, proof.nodeId))) : [];
  const recent = [...accepted.map(({ action, opening, result }) => ({ ...action, opening, result, revision: metadata.revision, operationId: metadata.operationId! })),
    ...previous];
  const tracked = recent.slice(0, MAX_PROOFS);
  for (const proof of recent.slice(MAX_PROOFS)) {
    evicted.points.set(proof.nodeId, Math.max(evicted.points.get(proof.nodeId) ?? 0, proof.revision));
  }
  // Keep earlier gaps even when a new receipt exists. An untracked structural edit can invalidate that receipt.
  const pointRevisions = [...evicted.points].map(([nodeId, revision]) => ({ nodeId, revision })).sort((a, b) => b.revision - a.revision);
  const evictions = { points: pointRevisions.slice(0, MAX_EVICTED_POINTS),
    older: pointRevisions.slice(MAX_EVICTED_POINTS).reduce((latest, point) => Math.max(latest, point.revision), evicted.older) };
  return { ...metadata, ...(tracked.length && { exegeticalPointProofs: tracked }),
    ...((evictions.points.length || evictions.older) && { exegeticalPointEvictions: evictions }) };
}

export function retainedExegeticalPointHistory(snapshot: ResourceSnapshot, order?: PointOrder) {
  const entry = order?.displaced;
  const plan = entry && exegeticalPlan(snapshot.value?.preparation);
  return entry && plan && resultOf(entry.winner) === resultOf(exegeticalPointVersion(plan, entry.nodeId)) ? entry : undefined;
}
