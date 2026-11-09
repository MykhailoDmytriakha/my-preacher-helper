import { createHash } from 'node:crypto';

import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object, readField } from './fieldValues';
import { isValidIdentifier, validServiceOrderStepGap } from './protocol';
import { placementSteps, retainedStepOrderChanged } from './serviceOrderStepPlacement';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, DocumentData, LabeledServiceOrderPlacement, ResourceSnapshot, ServiceOrderPlacementComparison, ServiceOrderStepGap } from './types';

export const SERVICE_ORDER_STEP_PLACEMENT_HISTORY = '_stepPlacementHistory';
type Update = Extract<DataCommand, { kind: 'update' }>;
type Proof = { stepId: string; revision: number; operationId: string; destination: ServiceOrderStepGap; time: ActionTime | null };
type Proofs = { legacyRevision: number; legacyStepOrder?: string; unprovenRevision: number; moves: Proof[] };
type Displaced = {
  stepId: string; stepTitle?: string; earlier: LabeledServiceOrderPlacement; kept: LabeledServiceOrderPlacement;
  actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type ServiceOrderStepPlacementWrite = { proof?: Omit<Proof, 'revision'>; displaced?: Displaced };
type Plan = { steps: DocumentData[]; write: ServiceOrderStepPlacementWrite } | { conflict: ConflictDetail; comparison: ServiceOrderPlacementComparison };

function placementProofs(raw: unknown, current: ResourceSnapshot): Proofs | undefined {
  const state = object(raw) && raw.serviceOrderStepPlacement;
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

function previewTitle(title: DocumentData[string] | undefined): string | undefined {
  if (typeof title !== 'string') return undefined;
  return title.length > 160 ? title.slice(0, 160) + '…' : title;
}

function labelGap(gap: ServiceOrderStepGap, current: ResourceSnapshot, steps: DocumentData[]): LabeledServiceOrderPlacement {
  const label = (id: string | null) => {
    if (id === null) return null;
    const title = previewTitle(steps.find(step => step.id === id)?.title);
    return { id, generation: current.metadata?.generation ?? null, ...(title !== undefined && { title }) };
  };
  return { previous: label(gap.previous), next: label(gap.next) };
}

export function planServiceOrderStepPlacement(command: Update, current: ResourceSnapshot, raw: unknown, serverMs: number | undefined): Plan {
  const move = command.serviceOrderStepPlacement!;
  const change = command.changes.find(item => item.path[0] === 'steps')!;
  const stored = readField(current.value!, ['steps']);
  const steps = placementSteps(stored.value), opening = placementSteps(change.before.value);
  const saved = steps && stepGap(steps, move.stepId);
  const stepTitle = previewTitle(steps?.find(step => step.id === move.stepId)?.title);
  const step = { id: move.stepId, ...(stepTitle !== undefined && { title: stepTitle }) };
  const mine = labelGap(move.destination, current, steps ?? []);
  const field = (gap: ServiceOrderStepGap | undefined) => gap ? { exists: true, value: gap } : { exists: false };
  const unavailable = { conflict: { path: ['steps', 'id:' + move.stepId, 'position'],
    base: field(move.opening), mine: field(move.destination), theirs: field(saved) },
    comparison: { step, mine, saved: saved ? labelGap(saved, current, steps ?? []) : null, available: false } };
  if (!steps || !opening || !saved || move.observedRevision > (current.metadata?.revision ?? 0)) return unavailable;
  const review = () => ({ ...unavailable, comparison: { ...unavailable.comparison,
    available: Boolean(projectServiceOrderStep(steps, move.stepId, move.destination)) } });
  const state = placementProofs(raw, current);
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
    const projected = projectServiceOrderStep(steps, move.stepId, move.destination);
    return projected ? { steps: projected, write: { proof } } : unavailable;
  }
  const samePlace = equalValues(previous.destination, move.destination);
  const order = time && previous.time ? compareActionTime(time, previous.time) : 0;
  if (!samePlace && !order) return review();
  let displaced: Displaced | undefined;
  if (!samePlace && time && previous.time) {
    displaced = { stepId: move.stepId, ...(stepTitle !== undefined && { stepTitle }),
      earlier: labelGap(order > 0 ? previous.destination : move.destination, current, steps),
      kept: labelGap(order > 0 ? move.destination : previous.destination, current, steps),
      actionTime: order > 0 ? previous.time : time, winnerActionTime: order > 0 ? time : previous.time };
  }
  const projected = order < 0 ? steps : projectServiceOrderStep(steps, move.stepId, move.destination);
  if (!projected) return unavailable;
  return { steps: projected, write: { ...(order >= 0 && { proof }), ...(displaced && { displaced }) } };
}

export function metadataAfterServiceOrderStepPlacement(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  write?: ServiceOrderStepPlacementWrite) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || resource.collection !== 'serviceOrders' || !value) return metadata;
  const steps = placementSteps(value.steps);
  if (!steps) return metadata;
  const before = placementSteps(raw?.steps);
  const previous = placementProofs(raw?._dataEngine, snapshot);
  const live = new Set(steps.map(step => step.id));
  const moves = (previous?.moves ?? []).filter(proof => live.has(proof.stepId) && proof.stepId !== write?.proof?.stepId);
  if (write?.proof) moves.push({ ...write.proof, revision: metadata.revision });
  // Unstamped rearrangements from an older client cannot prove which step moved.
  const unproven = !write && raw?.steps !== undefined
    && (before ? retainedStepOrderChanged(before, steps) : !equalValues(raw.steps, steps));
  const storedMetadata = raw?._dataEngine;
  const storedRevision = object(storedMetadata) && typeof storedMetadata.revision === 'number'
    && Number.isSafeInteger(storedMetadata.revision) && storedMetadata.revision > 0 ? storedMetadata.revision : 0;
  const legacyStepOrder = previous ? previous.legacyStepOrder : storedRevision && before ? orderedStepDigest(before) : undefined;
  return { ...metadata, serviceOrderStepPlacement: { legacyRevision: previous?.legacyRevision ?? storedRevision,
    ...(legacyStepOrder && { legacyStepOrder }), unprovenRevision: unproven ? metadata.revision : previous?.unprovenRevision ?? 0, moves } };
}
