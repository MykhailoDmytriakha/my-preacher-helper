import { newClientId } from '@/utils/clientId';
import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { boundedActionTime } from './actionClock';
import { equalValues, writeField } from './fieldValues';
import { homileticListPath, homileticLists, homileticTitleCommandChange, homileticTitlePolicy, readHomileticList } from './homileticPlan';
import { homileticMovesInList, matchesHomileticMoveSequence } from './homileticPlanMoves';
import { knownRowDetailPredecessor } from './rowDetailCapture';
import { boundedRowId, matchesRowAction } from './rowFieldAction';
import { retainedStepOrderChanged } from './serviceOrderStepPlacement';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { HomileticList, HomileticMoveActions, HomileticMoveGesture, HomileticPositionReviews, HomileticTitleActions } from './homileticPlan';
import type { DocumentData, FieldChange, ResourceSnapshot, ServiceOrderStepGap } from './types';

export function captureHomileticTitles(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captured: ActionTime | null | undefined, records: readonly CommitRequest[]): HomileticTitleActions | undefined {
  if (baseline.resource.collection !== 'sermons' || !baseline.metadata || baseline.metadata.deleted || captured === undefined) return;
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return;
  const opening = predecessor?.value ?? baseline.value;
  const actions: HomileticTitleActions = {};
  const byId = new Map(records.map(record => [record.id, record]));
  for (const list of homileticLists) {
    const before = readHomileticList(opening?.preparation, list), after = readHomileticList(draft?.preparation, list);
    if (!before || !after) continue;
    const original = new Map(before.map(row => [row.id, row.title]));
    const policy = homileticTitlePolicy(list);
    const rows = after.flatMap(row => {
      const earlier = original.get(row.id);
      if (!boundedRowId(row.id) || typeof earlier !== 'string' || typeof row.title !== 'string' || earlier.trim() === row.title.trim()) return [];
      const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, policy,
        record => record.homileticTitleActions?.[list]?.find(action => action.rowId === row.id), 'title', row.id, row.id, earlier,
        undefined, value => readHomileticList(value?.preparation, list));
      return [{ rowId: row.id, rowCreatedAt: row.id, before: earlier, after: row.title, time,
        observedRevision: baseline.metadata!.revision, ...(predecessorOperationId && { predecessorOperationId }) }];
    });
    if (rows.length) actions[list] = rows;
  }
  return Object.keys(actions).length ? actions : undefined;
}

export function matchingHomileticTitles(changes: FieldChange[], captured: HomileticTitleActions | undefined): HomileticTitleActions | undefined {
  if (!captured) return;
  const result: HomileticTitleActions = {};
  for (const list of homileticLists) {
    const change = homileticTitleCommandChange(changes, list);
    const target = homileticTitlePolicy(list).target('title');
    const rows = change && captured[list]?.filter(action => matchesRowAction([change], action, target));
    if (rows?.length) result[list] = rows;
  }
  return Object.keys(result).length ? result : undefined;
}

export function captureHomileticMoves(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  gestures: readonly HomileticMoveGesture[] | undefined, time: ActionTime | null | undefined, records: readonly CommitRequest[]): HomileticMoveActions | undefined {
  const metadata = baseline.metadata;
  if (baseline.resource.collection !== 'sermons' || !metadata || metadata.deleted || !gestures?.length || time === undefined) return;
  const observed = time === null ? null : boundedActionTime(time);
  if (observed === undefined) return;
  const opening = predecessor?.value ?? baseline.value;
  const byId = new Map(records.map(record => [record.id, record]));
  const result: HomileticMoveActions = {};
  for (const list of homileticLists) {
    const before = readHomileticList(opening?.preparation, list), after = readHomileticList(draft?.preparation, list);
    if (!before || !after) continue;
    const moves = homileticMovesInList(gestures, list, before, after);
    if (!matchesHomileticMoveSequence(before, after, moves)) continue;
    const previous = moves.map(move => precedingMove(predecessor, byId, list, move.stepId, move.opening, baseline));
    const queueId = previous.find(Boolean)?.queueId ?? newClientId();
    result[list] = moves.map((move, index) => {
      const prior = previous[index];
      return { ...move, queueId, observedRevision: metadata.revision, time: observed,
        ...(prior?.queueId === queueId && { predecessorOperationId: prior.operationId }) };
    });
  }
  return Object.keys(result).length ? result : undefined;
}

function precedingMove(predecessor: CommitRequest | undefined, requests: ReadonlyMap<string, CommitRequest>, list: HomileticList,
  rowId: string, gap: ServiceOrderStepGap, baseline: ResourceSnapshot): { operationId: string; queueId: string } | undefined {
  const visited = new Set<string>();
  for (let request = predecessor; request && !visited.has(request.id); request = requests.get(request.predecessor ?? '')) {
    const rows = readHomileticList(request.value?.preparation, list);
    if (request.owner !== predecessor?.owner || !equalValues(request.baseline.resource, baseline.resource)
      || request.baseline.metadata?.generation !== baseline.metadata?.generation || ['cancelled', 'refused', 'conflict'].includes(request.state)
      || !rows || !equalValues(stepGap(rows, rowId), gap)) break;
    const action = request.homileticMoveActions?.[list]?.filter(move => move.stepId === rowId).at(-1);
    if (action) return equalValues(action.destination, gap) ? { operationId: request.id, queueId: action.queueId } : undefined;
    visited.add(request.id);
  }
}

export function matchingHomileticMoves(changes: FieldChange[], captured: HomileticMoveActions | undefined): HomileticMoveActions | undefined {
  if (!captured) return;
  const result: HomileticMoveActions = {};
  for (const list of homileticLists) {
    const change = homileticTitleCommandChange(changes, list), actions = captured[list];
    if (change && actions && matchesHomileticMoveSequence(change.before.value, change.after.value, actions)) result[list] = actions;
  }
  return Object.keys(result).length ? result : undefined;
}

/** A preceding ACK can already look like this Save. Retain the actual opening of its authored rows. */
export function restoreHomileticOpenings(source: ResourceSnapshot, record: CommitRequest): ResourceSnapshot {
  if (record.sequence !== 0 || !source.value || source.metadata?.generation !== record.baseline.metadata?.generation) return source;
  let value = source.value;
  for (const list of homileticLists) {
    const titleActions = record.homileticTitleActions?.[list], moves = record.homileticMoveActions?.[list];
    if (!titleActions?.length && !moves?.length) continue;
    const live = readHomileticList(value.preparation, list), intended = readHomileticList(record.intended?.preparation, list);
    if (!live || !intended) continue;
    const proposedTitles = new Map(intended.map(row => [row.id, row.title]));
    let rows = moves?.length ? restoreMoveOpening(live, intended, moves) : live;
    for (const action of titleActions ?? []) if (proposedTitles.get(action.rowId) === action.after) {
      rows = rows.map(row => row.id === action.rowId ? { ...row, title: action.before } : row);
    }
    if (rows !== live) value = writeField(value, homileticListPath(list), { exists: true, value: rows });
  }
  return value === source.value ? source : { ...source, value };
}

function restoreMoveOpening<Row extends { id: string }>(live: Row[], intended: Row[], moves: NonNullable<HomileticMoveActions[HomileticList]>): Row[] {
  const current = new Map(live.map(row => [row.id, row]));
  let opening = intended.filter(row => current.has(row.id));
  for (const move of [...moves].reverse()) {
    if (!equalValues(stepGap(opening, move.stepId), move.destination)) return live;
    const previous = projectServiceOrderStep(opening, move.stepId, move.opening);
    if (!previous || !equalValues(stepGap(previous, move.stepId), move.opening)) return live;
    opening = previous;
  }
  const known = new Set(opening.map(row => row.id));
  const ordered = opening.flatMap(row => current.get(row.id) ?? []);
  let index = 0;
  return live.map(row => known.has(row.id) ? ordered[index++] ?? row : row);
}

export function matchingHomileticPositionReviews(changes: FieldChange[], record: CommitRequest): HomileticPositionReviews | undefined {
  if (!record.homileticPositionReviews) return;
  const preparation = changes.find(change => change.path[0] === 'preparation');
  if (!preparation) return;
  const result: HomileticPositionReviews = {};
  const ids = (rows: { id: string }[]) => rows.map(row => row.id);
  for (const list of homileticLists) {
    const observedRevision = record.homileticPositionReviews[list];
    const before = readHomileticList(preparation.before.value, list), after = readHomileticList(preparation.after.value, list);
    const compared = readHomileticList(record.baseline.value?.preparation, list), chosen = readHomileticList(record.value?.preparation, list);
    if (observedRevision && before && after && compared && chosen && retainedStepOrderChanged(before, after)
      && equalValues(ids(before), ids(compared)) && equalValues(ids(after), ids(chosen))) result[list] = observedRevision;
  }
  return Object.keys(result).length ? result : undefined;
}
