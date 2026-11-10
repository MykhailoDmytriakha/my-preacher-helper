import { createHash } from 'node:crypto';


import { boundedActionTime } from './actionClock';
import { object } from './fieldValues';
import { groupPlacementSteps, projectGroupStep } from './groupStepPlacement';
import { isValidIdentifier, validServiceOrderStepGap } from './protocol';
import { retainedStepOrderChanged } from './serviceOrderStepPlacement';
import { planStepPlacement } from './stepPlacement.server';

import type { PlacementStep, StepPlacementProof, StepPlacementTarget, StepPlacementWrite } from './stepPlacement.server';
import type { DataCommand, GroupFlowStepPlacement, ResourceSnapshot } from './types';

export const GROUP_STEP_PLACEMENT_HISTORY = '_groupStepPlacementHistory';
export const GROUP_STEP_PLACEMENT_REVIEW = 'group-step-placement-needs-review';
const proofKey = 'groupFlowStepPlacement';
const limit = 64;
type GroupStep = NonNullable<ReturnType<typeof groupPlacementSteps>>[number];
type Birth = { id: string; revision: number };
type Tracking = { floor: number; head: string; guardLegacy: boolean; moves: StepPlacementProof[]; births: Birth[] };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const headFor = (rows: GroupStep[]) => digest(rows.map(({ id, templateId }) => [id, templateId]));
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
const validRevision = (value: unknown, revision: number): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0 && value <= revision;

function readTracking(raw: unknown, rows: GroupStep[], revision: number): Tracking | undefined {
  const value = object(raw) && raw[proofKey];
  if (!object(value) || value.head !== headFor(rows) || !validRevision(value.floor, revision)
    || !Array.isArray(value.moves) || value.moves.length > limit
    || !Array.isArray(value.births) || value.births.length > limit) return undefined;
  const moves = value.moves.flatMap((move): StepPlacementProof[] => {
    if (!object(move) || !isValidIdentifier(move.stepId) || !validRevision(move.revision, revision)
      || (move.operationId !== null && !isValidIdentifier(move.operationId))
      || !validServiceOrderStepGap(move.destination, move.stepId)
      || (move.queueDigest !== undefined && !isDigest(move.queueDigest))) return [];
    const time = move.time === null ? null : boundedActionTime(move.time);
    return time === undefined ? [] : [{ stepId: move.stepId, revision: move.revision, operationId: move.operationId,
      destination: move.destination, time, ...(move.queueDigest && { queueDigest: move.queueDigest }) }];
  });
  const births = value.births.flatMap((birth): Birth[] =>
    object(birth) && isValidIdentifier(birth.id) && validRevision(birth.revision, revision)
      ? [{ id: birth.id, revision: birth.revision }] : []);
  if (moves.length !== value.moves.length || new Set(moves.map(move => move.stepId)).size !== moves.length
    || births.length !== value.births.length || new Set(births.map(birth => birth.id)).size !== births.length) return undefined;
  return { floor: value.floor, head: value.head, guardLegacy: value.guardLegacy === true || moves.length > 0, moves, births };
}

function lineage(raw: unknown, current: ResourceSnapshot, rows: GroupStep[], opening: PlacementStep[], move: GroupFlowStepPlacement) {
  const revision = current.metadata?.revision ?? 0;
  const tracked = readTracking(raw, rows, revision);
  const previous = tracked?.moves.find(item => item.stepId === move.stepId);
  const queueDigest = digest(move.queueId);
  const follows = previous && previous.operationId === move.predecessorOperationId && previous.queueDigest === queueDigest;
  const continuity = follows ? Math.max(move.observedRevision, previous.revision) : move.observedRevision;
  const ids = [move.stepId, move.destination.previous, move.destination.next].filter((id): id is string => id !== null);
  const available = ids.every(id => {
    const before = opening.find(row => row.id === id);
    const currentRow = rows.find(row => row.id === id);
    const born = tracked?.births.find(item => item.id === id)?.revision ?? 0;
    return before && currentRow && before.templateId === currentRow.templateId && born <= continuity;
  });
  return { available, trusted: continuity >= (tracked?.floor ?? revision), previous, queueDigest };
}

const groupSteps: StepPlacementTarget<GroupStep> = {
  collection: 'groups', field: 'flow', proofKey, read: groupPlacementSteps, project: projectGroupStep,
  title: (value, step) => {
    if (typeof step.instanceTitle === 'string' && step.instanceTitle) return step.instanceTitle;
    const block = Array.isArray(value.templates) ? value.templates.find(row => object(row) && row.id === step.templateId) : undefined;
    return object(block) ? block.title : undefined;
  },
  lineage: (raw, current, rows, opening, move) => lineage(raw, current, rows, opening, move as GroupFlowStepPlacement),
};

export function planGroupStepPlacement(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot, raw: unknown,
  serverMs?: number) {
  return planStepPlacement(groupSteps, command.groupFlowStepPlacement!, command, current, raw, serverMs);
}

/**
 * An older tab cannot distinguish a fresh permutation from a delayed move after
 * a proven return. Keep its request recoverable, without applying that position.
 */
export function legacyGroupPlacementNeedsReview(command: DataCommand, current: ResourceSnapshot, raw: unknown): boolean {
  if (command.kind !== 'update' || command.resource.collection !== 'groups' || command.groupFlowStepPlacement
    || command.generation !== (current.metadata?.generation ?? null)) return false;
  const state = object(raw) && raw[proofKey];
  if (!object(state) || !(state.guardLegacy === true || (Array.isArray(state.moves) && state.moves.length > 0))) return false;
  const change = command.changes.find(item => item.path[0] === 'flow');
  const before = groupPlacementSteps(change?.before.value), after = groupPlacementSteps(change?.after.value);
  const stored = groupPlacementSteps(current.value?.flow);
  return Boolean(before && after && stored && retainedStepOrderChanged(before, after) && retainedStepOrderChanged(stored, after));
}

/** Stamp layout continuity on ordinary writes too, including unstamped permutations from older clients. */
export function metadataAfterGroupStepPlacement(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, write?: StepPlacementWrite) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || resource.collection !== 'groups' || !value) return metadata;
  const steps = groupPlacementSteps(value.flow);
  if (!steps) return metadata;
  const before = groupPlacementSteps(raw?.flow);
  const stored = raw?._dataEngine;
  const sameGeneration = object(stored) && stored.generation === metadata.generation
    && validRevision(stored.revision, metadata.revision) && stored.revision + 1 === metadata.revision;
  const previous = sameGeneration && before ? readTracking(stored, before, metadata.revision - 1) : undefined;
  const untracked = !sameGeneration || !before || (object(stored) && stored[proofKey] !== undefined && !previous);
  const unstamped = !write && before && retainedStepOrderChanged(before, steps);
  let floor = untracked || unstamped ? metadata.revision : previous?.floor ?? metadata.revision - 1;
  const live = new Map(steps.map(step => [step.id, step.templateId]));
  const opening = new Map(before?.map(step => [step.id, step.templateId]));
  const same = (id: string) => live.has(id) && opening.get(id) === live.get(id);
  const moves = (previous?.moves ?? []).filter(proof => proof.revision >= floor
    && same(proof.stepId) && proof.stepId !== write?.proof?.stepId);
  const births = (previous?.births ?? []).filter(birth => birth.revision >= floor && same(birth.id));
  if (write?.proof) moves.push({ ...write.proof, revision: metadata.revision });
  if (!untracked) for (const step of steps) if (!same(step.id)) births.push({ id: step.id, revision: metadata.revision });
  floor = Math.max(floor, moves.at(-limit - 1)?.revision ?? 0, births.at(-limit - 1)?.revision ?? 0);
  const storedTracking = object(stored) && stored[proofKey];
  const guardLegacy = Boolean(write || previous?.guardLegacy || (sameGeneration && object(storedTracking) && storedTracking.guardLegacy === true));
  return { ...metadata, [proofKey]: { head: headFor(steps), floor, guardLegacy,
    moves: moves.filter(move => move.revision >= floor).slice(-limit), births: births.filter(birth => birth.revision >= floor).slice(-limit) } };
}
