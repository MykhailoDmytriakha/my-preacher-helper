import { boundedActionTime } from './actionClock';
import { changedExegeticalPoint, exegeticalPlan, exegeticalPlanChange, exegeticalPointVersion, projectExegeticalPoint, readExegeticalPointChoice } from './exegeticalPointAction';
import { equalValues, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { boundedRowId } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { ExegeticalPointStamp, ExegeticalPointVersion } from './exegeticalPointAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { DocumentData, FieldChange, ResourceSnapshot } from './types';

export type ExegeticalPointEdit = { kind: 'exegetical-point'; nodeId: string; intent: 'title' | 'remove' };
export type ExegeticalPointEditStamp = { field: 'exegetical-point'; nodeId: string; intent: ExegeticalPointEdit['intent']; time: ActionTime | null };
type Draft = ExegeticalPointStamp & { generation: string; title: string | null; ancestors: string[] };
const LIMIT = 32;

function matchesResult(plan: NonNullable<ReturnType<typeof exegeticalPlan>>, action: Draft) {
  const point = exegeticalPointVersion(plan, action.nodeId);
  return action.kind === 'remove' ? !point : point?.point.title === action.title && equalValues(point.ancestors, action.ancestors);
}

export function stageExegeticalPoint(checkpoint: SessionCheckpoint, next: DocumentData | null, shown: ShownCopy | undefined,
  stamp: ExegeticalPointEditStamp | undefined): Draft[] | undefined {
  const { metadata, resource } = checkpoint.confirmed;
  if (resource.collection !== 'sermons' || !metadata || metadata.deleted || (!stamp && !checkpoint.exegeticalPointDrafts)) return undefined;
  const plan = exegeticalPlan(next?.preparation);
  if (!plan) return undefined;
  const previous = checkpoint.exegeticalPointDrafts?.filter(action => action.generation === metadata.generation && matchesResult(plan, action)) ?? [];
  if (!stamp || !boundedRowId(stamp.nodeId)) return previous.length ? previous : undefined;
  const opening = exegeticalPlan(checkpoint.draft?.preparation);
  const time = stamp.time === null ? null : boundedActionTime(stamp.time);
  if (!opening || time === undefined || changedExegeticalPoint(opening, plan, stamp.nodeId) !== stamp.intent) return previous.length ? previous : undefined;
  const basis = shown?.confirmed.metadata?.generation === metadata.generation && shown.editGeneration === checkpoint.editGeneration
    ? shown.confirmed.metadata : metadata;
  const point = exegeticalPointVersion(opening, stamp.nodeId)!;
  const title = exegeticalPointVersion(plan, stamp.nodeId)?.point.title;
  const action = { nodeId: stamp.nodeId, kind: stamp.intent, observedRevision: basis.revision, time, generation: metadata.generation,
    title: typeof title === 'string' ? title : null, ancestors: point.ancestors };
  return [action, ...previous.filter(item => item.nodeId !== stamp.nodeId)].slice(0, LIMIT);
}

function capturedPointPredecessor(baseline: ResourceSnapshot, nodeId: string, opening: NonNullable<ReturnType<typeof exegeticalPlan>>,
  predecessor: CommitRequest | undefined, requests: ReadonlyMap<string, CommitRequest>) {
  const shown = exegeticalPointVersion(opening, nodeId);
  const visited = new Set<string>();
  for (let request = predecessor; request && !visited.has(request.id); request = requests.get(request.predecessor ?? '')) {
    const tree = exegeticalPlan(request.value?.preparation);
    const point = tree && exegeticalPointVersion(tree, nodeId);
    if (!point || !shown || !equalValues([point.point, point.ancestors], [shown.point, shown.ancestors])
      || request.owner !== predecessor?.owner || !equalValues(request.baseline.resource, baseline.resource)
      || request.baseline.metadata?.generation !== baseline.metadata?.generation
      || ['cancelled', 'refused', 'conflict'].includes(request.state)) return undefined;
    if (request.exegeticalPlanActions?.some(action => action.nodeId === nodeId && action.kind === 'title')) {
      return request.command?.operationId ?? request.id;
    }
    visited.add(request.id);
  }
  return undefined;
}

export function captureExegeticalPointActions(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[]): ExegeticalPointStamp[] | undefined {
  if (!checkpoint.exegeticalPointDrafts?.length || !baseline.metadata || baseline.metadata.deleted) return undefined;
  const opening = exegeticalPlan((predecessor ? predecessor.value : baseline.value)?.preparation), next = exegeticalPlan(checkpoint.draft?.preparation);
  if (!opening || !next) return undefined;
  const requests = new Map(records.map(record => [record.id, record]));
  const actions = checkpoint.exegeticalPointDrafts.flatMap((action): ExegeticalPointStamp[] => {
    if (action.generation !== baseline.metadata?.generation || action.observedRevision > baseline.metadata.revision
      || !matchesResult(next, action) || changedExegeticalPoint(opening, next, action.nodeId) !== action.kind) return [];
    const predecessorOperationId = action.kind === 'remove' ? capturedPointPredecessor(baseline, action.nodeId, opening, predecessor, requests) : undefined;
    return [{ nodeId: action.nodeId, kind: action.kind, observedRevision: action.observedRevision, time: action.time,
      ...(predecessorOperationId && { predecessorOperationId }) }];
  });
  return actions.length ? actions : undefined;
}

export function matchingExegeticalPointActions(changes: readonly FieldChange[], actions: ExegeticalPointStamp[] | undefined) {
  if (!actions?.length) return undefined;
  const plan = exegeticalPlanChange(changes);
  const matching = plan && actions.filter(action => changedExegeticalPoint(plan.opening, plan.local, action.nodeId) === action.kind);
  return matching?.length ? matching : undefined;
}

export type ExegeticalQueueBasis = { nodeId: string; version: ExegeticalPointVersion };

export function restoreExegeticalQueueBasis(snapshot: ResourceSnapshot, basis: ExegeticalQueueBasis): ResourceSnapshot {
  const data = snapshot.value;
  const plan = exegeticalPlan(data?.preparation);
  const projected = plan && projectExegeticalPoint(data?.preparation, plan, basis.nodeId, basis.version.ancestors, basis.version);
  return data && projected ? { ...snapshot, value: writeField(data, ['preparation'], projected) } : snapshot;
}

/** Merge the other changes, then put the chosen branch back at its surviving anchors. */
export function mergeExegeticalPointChoice(ancestor: DocumentData | null, local: DocumentData | null, stored: DocumentData | null,
  ids: readonly string[]) {
  if (!ids.length || !ancestor || !local || !stored) return undefined;
  const opening = exegeticalPlan(ancestor.preparation), mine = exegeticalPlan(local.preparation), live = exegeticalPlan(stored.preparation);
  if (!opening || !mine || !live) return undefined;
  const contested = ids.flatMap(id => {
    const choice = readExegeticalPointChoice(opening, mine, live, id);
    return choice ? [{ id, ...choice }] : [];
  });
  if (contested.length !== 1) return undefined;
  const [{ id, before, mine: intended, saved }] = contested;
  const neutralOpening = projectExegeticalPoint(ancestor.preparation, opening, id, before.ancestors, saved);
  const neutralLocal = projectExegeticalPoint(local.preparation, mine, id, before.ancestors, saved);
  if (!neutralOpening || !neutralLocal) return undefined;
  const merged = mergeDocumentFields(writeField(ancestor, ['preparation'], neutralOpening), writeField(local, ['preparation'], neutralLocal), stored);
  const combined = merged.value.value as DocumentData | undefined;
  const combinedPlan = exegeticalPlan(combined?.preparation);
  if (!combined || !combinedPlan) return undefined;
  const projected = projectExegeticalPoint(combined.preparation, combinedPlan, id, before.ancestors, intended);
  const working = projectExegeticalPoint(stored.preparation, live, id, before.ancestors, before);
  if (!projected || !working) return undefined;
  const basis: ExegeticalQueueBasis = { nodeId: id, version: before };
  return { basis, rebased: { ...merged, value: { exists: true, value: writeField(combined, ['preparation'], projected) } } };
}

/** Hold the authored point over a preceding ACK; the server still owns the time comparison. */
export function rebaseQueuedExegeticalPoint(ancestor: DocumentData | null, local: DocumentData | null, stored: DocumentData | null,
  actions: readonly ExegeticalPointStamp[] | undefined) {
  if (!actions?.length) return undefined;
  const result = mergeExegeticalPointChoice(ancestor, local, stored, actions.map(action => action.nodeId));
  return result?.rebased.conflicts.length === 0 ? result : undefined;
}
