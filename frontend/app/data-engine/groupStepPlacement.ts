import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { anchoredPlacementPredecessor, captureAnchoredRowPlacement } from './anchoredRowPlacement';
import { autosaveAcknowledgementAncestor, carryAutosaveFieldDrafts } from './documentFieldAction';
import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { carryRowFieldDrafts, rowFieldAckAncestor } from './rowFieldAutosave';
import { placementSteps } from './serviceOrderStepPlacement';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, GroupFlowStepPlacementCapture, ResourceSnapshot, ServiceOrderStepGap } from './types';

type GroupStep = DocumentData & { id: string; templateId: string; order: number };

export function groupPlacementSteps(value: unknown): GroupStep[] | undefined {
  const steps = placementSteps(value);
  if (!steps?.every((step): step is GroupStep => typeof step.templateId === 'string' && step.templateId.length > 0
    && typeof step.order === 'number' && Number.isFinite(step.order))) return undefined;
  return [...steps].sort((first, second) => first.order - second.order);
}

export function groupStepWitness(value: unknown) {
  return groupPlacementSteps(value)?.map(({ id, templateId }) => ({ id, templateId }));
}

export function projectGroupStep(rows: GroupStep[], id: string, destination: ServiceOrderStepGap): GroupStep[] | undefined {
  return projectServiceOrderStep(rows, id, destination)?.map((row, index) =>
    row.order === index + 1 ? row : { ...row, order: index + 1 });
}

export function captureGroupStepPlacement(before: unknown, after: unknown, stepId: string, generation: string | null,
  observedRevision: number, time: GroupFlowStepPlacementCapture['placement']['time']): GroupFlowStepPlacementCapture | undefined {
  return captureAnchoredRowPlacement(groupStepWitness(before), groupStepWitness(after), stepId, generation, observedRevision, time);
}

export function projectCapturedGroupStep(value: unknown, move: GroupFlowStepPlacementCapture): GroupStep[] | undefined {
  const steps = groupPlacementSteps(value);
  if (!steps || !equalValues(groupStepWitness(steps), move.before)) return undefined;
  return projectGroupStep(steps, move.placement.stepId, move.placement.destination);
}

/** Project the chosen move onto current rows without adopting any captured row data. */
export function projectGroupStepOnDocument(value: DocumentData | null, move: GroupFlowStepPlacementCapture): DocumentData | null {
  const steps = groupPlacementSteps(value?.flow);
  if (!value || !steps) return value;
  const { stepId, destination } = move.placement;
  const ids = [stepId, destination.previous, destination.next].filter(id => id !== null);
  const sameRows = ids.every(id => {
    const shown = move.before.find(step => step.id === id);
    return shown && steps.some(step => step.id === id && step.templateId === shown.templateId);
  });
  const flow = sameRows && projectGroupStep(steps, stepId, destination);
  return flow ? { ...value, flow } : value;
}

export function groupPlacementMergeFrame(value: DocumentData | null, moves: readonly GroupFlowStepPlacementCapture[]) {
  const positioned = moves.reduce((next, move) => projectGroupStepOnDocument(next, move), value);
  const rows = groupPlacementSteps(positioned?.flow);
  return positioned && rows ? { ...positioned, flow: rows.map(({ order: _order, ...row }) => row) } : positioned;
}

export function restoreGroupPlacementOrder(value: DocumentData | null): DocumentData | null {
  const rows = placementSteps(value?.flow);
  return value && rows ? { ...value, flow: rows.map((row, index) => ({ ...row, order: index + 1 })) } : value;
}

/** Slot numbers are derived from order; they are not edits to neighboring rows. */
export function mergeGroupFlowRebase(base: DocumentData | null, draft: DocumentData | null, stored: DocumentData | null) {
  const before = groupPlacementSteps(base?.flow), mine = groupPlacementSteps(draft?.flow), saved = groupPlacementSteps(stored?.flow);
  const opening = before?.map(row => row.id);
  if (!before || !mine || !saved || (equalValues(opening, mine.map(row => row.id)) && equalValues(opening, saved.map(row => row.id)))) {
    return mergeDocumentFields(base, draft, stored);
  }
  const result = mergeDocumentFields(groupPlacementMergeFrame(base, []), groupPlacementMergeFrame(draft, []), groupPlacementMergeFrame(stored, []));
  if (!result.value.exists) return result;
  const value = restoreGroupPlacementOrder(result.value.value as DocumentData);
  return { ...result, value: { exists: true, value } };
}

export function mergeEditsAfterAnchoredPlacement(source: SessionCheckpoint, base: DocumentData, draft: DocumentData,
  target: SessionCheckpoint) {
  const ancestor = autosaveAcknowledgementAncestor(base, target.confirmed, source);
  const merge = target.confirmed.resource.collection === 'groups' ? mergeGroupFlowRebase : mergeDocumentFields;
  return merge(rowFieldAckAncestor(ancestor, target.confirmed, source), draft, target.draft);
}

export function carryAnchoredDraftChronology(source: SessionCheckpoint, target: SessionCheckpoint,
  reviewed: readonly ConflictDetail[] = []): void {
  const keep = (path: readonly string[]) => !reviewed.some(conflict =>
    conflict.path.slice(0, path.length).every((part, index) => part === path[index]));
  carryAutosaveFieldDrafts(source, target, keep);
  carryRowFieldDrafts(source, target, keep);
}

export function retryGroupStepPlacement(snapshot: ResourceSnapshot, move: GroupFlowStepPlacementCapture,
  reviewed: ServiceOrderStepGap, time: GroupFlowStepPlacementCapture['placement']['time']) {
  const opening = groupStepWitness(snapshot.value?.flow);
  if (!snapshot.value || !opening || !equalValues(stepGap(opening, move.placement.stepId), reviewed)) return undefined;
  const draft = projectGroupStepOnDocument(snapshot.value, move);
  if (!draft || draft === snapshot.value) return undefined;
  const capture = captureGroupStepPlacement(snapshot.value.flow, draft.flow, move.placement.stepId,
    snapshot.metadata?.generation ?? null, snapshot.metadata?.revision ?? 0, time);
  return { capture, draft };
}

/** Rewind only requests from the same local save chain and the exact order visible at the gesture. */
export function groupStepPlacementPredecessor(records: readonly CommitRequest[], predecessor: CommitRequest | undefined,
  move: GroupFlowStepPlacementCapture): CommitRequest | undefined {
  return anchoredPlacementPredecessor(records, predecessor, move, 'groups', record => groupStepWitness(record.value?.flow),
    record => record.groupFlowStepPlacement);
}
