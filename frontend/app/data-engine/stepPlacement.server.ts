import { createHash } from 'node:crypto';

import { stepGap } from '@/utils/serviceOrderStepPlacement';

import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object, readField } from './fieldValues';
import { isValidIdentifier, validServiceOrderStepGap } from './protocol';
import { placementSteps, retainedStepOrderChanged } from './serviceOrderStepPlacement';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, DocumentData, LabeledServiceOrderPlacement, ResourceSnapshot, ServiceOrderPlacementComparison, ServiceOrderStepGap, ServiceOrderStepPlacement } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
type Proof = { stepId: string; revision: number; operationId: string; destination: ServiceOrderStepGap; time: ActionTime | null };
type Proofs = { legacyRevision: number; legacyStepOrder?: string; unprovenRevision: number; moves: Proof[] };
type Displaced = {
  stepId: string; stepTitle?: string; earlier: LabeledServiceOrderPlacement; kept: LabeledServiceOrderPlacement;
  actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type StepPlacementWrite = { proof?: Omit<Proof, 'revision'>; displaced?: Displaced };
type Plan = { steps: DocumentData[]; write: StepPlacementWrite } | { conflict: ConflictDetail; comparison: ServiceOrderPlacementComparison };

type Step = NonNullable<ReturnType<typeof placementSteps>>[number];
export type StepPlacementTarget = {
  collection: string;
  field: string;
  proofKey: string;
  read: (value: unknown) => Step[] | undefined;
  project: (rows: Step[], id: string, destination: ServiceOrderStepGap) => Step[] | undefined;
  title: (value: DocumentData, step: Step) => unknown;
};

function placementProofs(raw: unknown, current: ResourceSnapshot, proofKey: string): Proofs | undefined {
  const state = object(raw) && raw[proofKey];
  if (!object(state) || !current.metadata || !Array.isArray(state.moves)) return undefined;
  const revision = current.metadata.revision;
  if (typeof state.unprovenRevision !== 'number' || !Number.isSafeInteger(state.unprovenRevision)
    || state.unprovenRevision < 0 || state.unprovenRevision > revision) return undefined;
  const moves = state.moves.flatMap((item): Proof[] => {
    if (!object(item) || !isValidIdentifier(item.stepId) || !isValidIdentifier(item.operationId)
      || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision > revision
      || !validServiceOrderStepGap(item.destination, item.stepId)) return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    return time === undefined ? [] : [{ stepId: item.stepId, revision: item.revision, operationId: item.operationId, destination: item.destination, time }];
  });
  const legacyRevision = typeof state.legacyRevision === 'number' && Number.isSafeInteger(state.legacyRevision)
    && state.legacyRevision >= 0 && state.legacyRevision <= revision ? state.legacyRevision : 0;
  const legacyStepOrder = typeof state.legacyStepOrder === 'string' && /^[a-f0-9]{64}$/.test(state.legacyStepOrder)
    ? state.legacyStepOrder : undefined;
  return { legacyRevision, legacyStepOrder, unprovenRevision: state.unprovenRevision, moves };
}

function orderedStepDigest(steps: readonly { id: string }[]): string {
  return createHash('sha256').update(JSON.stringify(steps.map(step => step.id))).digest('hex');
}

function previewTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined;
  return title.length > 160 ? title.slice(0, 160) + '…' : title;
}

function labelGap(gap: ServiceOrderStepGap, current: ResourceSnapshot, titleFor: (id: string) => string | undefined): LabeledServiceOrderPlacement {
  const label = (id: string | null) => {
    if (id === null) return null;
    const title = titleFor(id);
    return { id, generation: current.metadata?.generation ?? null, ...(title !== undefined && { title }) };
  };
  return { previous: label(gap.previous), next: label(gap.next) };
}

export function planStepPlacement(target: StepPlacementTarget, move: ServiceOrderStepPlacement, command: Update,
  current: ResourceSnapshot, raw: unknown, serverMs: number | undefined): Plan {
  const change = command.changes.find(item => item.path[0] === target.field)!;
  const stored = readField(current.value!, [target.field]);
  const steps = target.read(stored.value), opening = placementSteps(change.before.value);
  const saved = steps && stepGap(steps, move.stepId);
  const titleFor = (id: string) => {
    const row = steps?.find(step => step.id === id);
    return row ? previewTitle(target.title(current.value!, row)) : undefined;
  };
  const stepTitle = titleFor(move.stepId);
  const step = { id: move.stepId, ...(stepTitle !== undefined && { title: stepTitle }) };
  const mine = labelGap(move.destination, current, titleFor);
  const field = (gap: ServiceOrderStepGap | undefined) => gap ? { exists: true, value: gap } : { exists: false };
  const unavailable = { conflict: { path: [target.field, 'id:' + move.stepId, 'position'],
    base: field(move.opening), mine: field(move.destination), theirs: field(saved) },
    comparison: { step, mine, saved: saved ? labelGap(saved, current, titleFor) : null, available: false } };
  if (!steps || !opening || !saved || move.observedRevision > (current.metadata?.revision ?? 0)) return unavailable;
  const review = () => ({ ...unavailable, comparison: { ...unavailable.comparison,
    available: Boolean(target.project(steps, move.stepId, move.destination)) } });
  const state = placementProofs(raw, current, target.proofKey);
  const previous = state?.moves.find(proof => proof.stepId === move.stepId);
  const measured = boundedActionTime(move.time);
  const time = measured && serverMs !== undefined && measured.earliestMs <= serverMs + 5 ? measured : null;
  const proof = { stepId: move.stepId, operationId: command.operationId, destination: move.destination, time };
  const follows = previous && previous.operationId === move.predecessorOperationId;
  const unprovenRevision = state?.unprovenRevision ?? 0;
  if (unprovenRevision > move.observedRevision && !(follows && previous.revision > unprovenRevision)) return review();
  // An unrelated first write cannot certify a permutation made by a pre-upgrade client.
  const olderThanLegacy = state && move.observedRevision < state.legacyRevision && !(follows && previous.revision > state.legacyRevision);
  if ((!state || (olderThanLegacy && (!state.legacyStepOrder || orderedStepDigest(opening) !== state.legacyStepOrder)))
    && retainedStepOrderChanged(opening, steps)) return review();
  if (!previous || previous.revision <= move.observedRevision || follows) {
    const projected = target.project(steps, move.stepId, move.destination);
    return projected ? { steps: projected, write: { proof } } : unavailable;
  }
  const samePlace = equalValues(previous.destination, move.destination);
  const order = time && previous.time ? compareActionTime(time, previous.time) : 0;
  if (!samePlace && !order) return review();
  let displaced: Displaced | undefined;
  if (!samePlace && time && previous.time) {
    displaced = { stepId: move.stepId, ...(stepTitle !== undefined && { stepTitle }),
      earlier: labelGap(order > 0 ? previous.destination : move.destination, current, titleFor),
      kept: labelGap(order > 0 ? move.destination : previous.destination, current, titleFor),
      actionTime: order > 0 ? previous.time : time, winnerActionTime: order > 0 ? time : previous.time };
  }
  const projected = order < 0 ? steps : target.project(steps, move.stepId, move.destination);
  if (!projected) return unavailable;
  return { steps: projected, write: { ...(order >= 0 && { proof }), ...(displaced && { displaced }) } };
}

export function metadataAfterStepPlacement(target: StepPlacementTarget, snapshot: ResourceSnapshot,
  raw: Record<string, unknown> | undefined, write?: StepPlacementWrite) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || resource.collection !== target.collection || !value) return metadata;
  const steps = target.read(value[target.field]);
  if (!steps) return metadata;
  const rawRows = raw?.[target.field];
  const before = target.read(rawRows);
  const previous = placementProofs(raw?._dataEngine, snapshot, target.proofKey);
  const live = new Set(steps.map(step => step.id));
  const moves = (previous?.moves ?? []).filter(proof => live.has(proof.stepId) && proof.stepId !== write?.proof?.stepId);
  if (write?.proof) moves.push({ ...write.proof, revision: metadata.revision });
  // Unstamped rearrangements from an older client cannot prove which step moved.
  const unproven = !write && rawRows !== undefined
    && (before ? retainedStepOrderChanged(before, steps) : !equalValues(rawRows, steps));
  const storedMetadata = raw?._dataEngine;
  const storedRevision = object(storedMetadata) && typeof storedMetadata.revision === 'number'
    && Number.isSafeInteger(storedMetadata.revision) && storedMetadata.revision > 0 ? storedMetadata.revision : 0;
  const legacyStepOrder = previous ? previous.legacyStepOrder : storedRevision && before ? orderedStepDigest(before) : undefined;
  return { ...metadata, [target.proofKey]: { legacyRevision: previous?.legacyRevision ?? storedRevision,
    ...(legacyStepOrder && { legacyStepOrder }), unprovenRevision: unproven ? metadata.revision : previous?.unprovenRevision ?? 0, moves } };
}
