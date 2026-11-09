import { createHash } from 'node:crypto';

import { outlinePointGap, projectOutlinePoint, SECTION_KEYS } from '@/utils/outlineDnd';

import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { outlineMoveProof } from './outlineMoveProof.server';
import { isValidIdentifier, validOutlinePointGap } from './protocol';
import { proofRevision } from './rowFieldAction';
import { thoughtOutlineDestinations } from './thoughtPlacementAction';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, FieldValue, ResourceSnapshot } from './types';
import type { SermonOutline } from '@/models/models';
import type { OutlinePointGap } from '@/utils/outlineDnd';

export const OUTLINE_POINT_PLACEMENT_HISTORY = '_outlinePointPlacementHistory';
type Update = Extract<DataCommand, { kind: 'update' }>;
type Proof = {
  pointId: string;
  revision: number;
  operationId: string | null;
  destination: OutlinePointGap;
  time: ActionTime | null;
};
type Tracking = { floor: number; head: string; moves: Proof[] };
type Displaced = {
  pointId: string;
  earlier: OutlinePointGap;
  kept: OutlinePointGap;
  actionTime: ActionTime;
  winnerActionTime: ActionTime;
};
export type OutlinePointPlacementWrite = { proof?: Omit<Proof, 'revision'>; displaced?: Displaced };

function storedOutline(value: unknown): SermonOutline | undefined {
  if (!object(value)) return undefined;
  const lists = SECTION_KEYS.map(section => value[section] ?? []);
  const pointList = (list: unknown): list is { id: string }[] => Array.isArray(list)
    && list.every(point => object(point) && isValidIdentifier(point.id));
  if (!lists.every(pointList)) return undefined;
  const ids = lists.flat().map(point => point.id);
  if (new Set(ids).size !== ids.length) return undefined;
  return value as unknown as SermonOutline;
}

function placementDigest(outline: SermonOutline, retained?: ReadonlySet<string>): string {
  const sections = SECTION_KEYS.map(section => (outline[section] ?? [])
    .map(point => point.id).filter(id => !retained || retained.has(id)));
  return createHash('sha256').update(JSON.stringify(sections)).digest('base64url');
}

function readTracking(raw: unknown, outline: SermonOutline, revision: number): Tracking | undefined {
  const value = object(raw) ? raw.outlinePointPlacement : undefined;
  const head = placementDigest(outline);
  if (!object(value) || value.head !== head || !proofRevision(value.floor) || value.floor > revision
    || !Array.isArray(value.moves) || value.moves.length > 64) return undefined;
  const moves = value.moves.flatMap((proof): Proof[] => {
    if (!object(proof) || !proofRevision(proof.revision) || proof.revision > revision
      || !isValidIdentifier(proof.pointId) || (proof.operationId !== null && !isValidIdentifier(proof.operationId))
      || !validOutlinePointGap(proof.destination, proof.pointId)) return [];
    const time = proof.time === null ? null : boundedActionTime(proof.time);
    return time === undefined ? [] : [{ pointId: proof.pointId, revision: proof.revision,
      operationId: proof.operationId, destination: proof.destination, time }];
  });
  if (moves.length !== value.moves.length || new Set(moves.map(move => move.pointId)).size !== moves.length) return undefined;
  return { head, floor: value.floor, moves };
}

export function planOutlinePointPlacement(command: Update, current: ResourceSnapshot, raw: unknown, serverMs?: number):
  { outline: SermonOutline; write: OutlinePointPlacementWrite } | { conflict: ConflictDetail } {
  const move = command.outlinePointPlacement!;
  const outline = storedOutline(current.value?.outline);
  const saved = outline && outlinePointGap(outline, move.pointId);
  const field = (gap: OutlinePointGap | undefined): FieldValue => gap ? { exists: true, value: gap } : { exists: false };
  const comparison = { conflict: { path: ['outline', 'id:' + move.pointId, 'position'],
    base: field(move.opening), mine: field(move.destination), theirs: field(saved) } };
  const revision = current.metadata?.revision ?? 0;
  if (!outline || !saved || move.observedRevision > revision) return comparison;
  const state = readTracking(raw, outline, revision);
  const previous = state?.moves.find(proof => proof.pointId === move.pointId);
  const follows = previous !== undefined && previous.operationId === move.predecessorOperationId;
  const continuityRevision = follows && previous ? Math.max(move.observedRevision, previous.revision) : move.observedRevision;
  if (continuityRevision < (state?.floor ?? revision)) return comparison;
  if (continuityRevision < revision && object(raw) && raw.outlineMoveProof !== undefined) {
    const continuity = outlineMoveProof(raw, thoughtOutlineDestinations(outline), revision);
    if (!continuity({ outlinePointId: move.pointId, subPointId: null }, continuityRevision)) return comparison;
  }

  const measured = boundedActionTime(move.time);
  const time = measured && serverMs !== undefined && measured.earliestMs <= serverMs + 5 ? measured : null;
  const proof = { pointId: move.pointId, operationId: command.operationId, destination: move.destination, time };
  const competing = previous && previous.revision > move.observedRevision && !follows;
  const samePlace = equalValues(previous?.destination, move.destination);
  const order = competing && time && previous.time ? compareActionTime(time, previous.time) : 0;
  if (competing && !order) {
    if (!samePlace) return comparison;
    // Both actions chose the same position. Keep it while carrying the full range
    // of the later action, whose identity cannot be assigned to either receipt.
    const latest = time && previous.time ? {
      earliestMs: Math.max(time.earliestMs, previous.time.earliestMs),
      latestMs: Math.max(time.latestMs, previous.time.latestMs),
    } : null;
    return { outline, write: { proof: { ...proof, operationId: null, time: latest } } };
  }
  const keepPrevious = order < 0;
  const projected = keepPrevious ? outline : projectOutlinePoint(outline, move.pointId, move.destination);
  if (!projected) return comparison;
  const displaced = competing && !samePlace && time && previous.time ? {
    pointId: move.pointId,
    earlier: order > 0 ? previous.destination : move.destination,
    kept: order > 0 ? move.destination : previous.destination,
    actionTime: order > 0 ? previous.time : time,
    winnerActionTime: order > 0 ? time : previous.time,
  } : undefined;
  return { outline: projected, write: { ...(!keepPrevious && { proof }), ...(displaced && { displaced }) } };
}

/** Older clients can rearrange the outline without identifying which point moved. */
export function metadataAfterOutlinePointPlacement(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  write?: OutlinePointPlacementWrite) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || resource.collection !== 'sermons' || !value) return metadata;
  const outline = storedOutline(value.outline);
  if (!outline) return metadata;
  const stored = raw?._dataEngine;
  const before = storedOutline(raw?.outline);
  const sameGeneration = object(stored) && stored.generation === metadata.generation
    && proofRevision(stored.revision) && stored.revision + 1 === metadata.revision;
  const state = sameGeneration && before ? readTracking(stored, before, metadata.revision - 1) : undefined;
  const liveIds = new Set(SECTION_KEYS.flatMap(section => (outline[section] ?? []).map(point => point.id)));
  const openingIds = new Set(before && SECTION_KEYS.flatMap(section => (before[section] ?? []).map(point => point.id)));
  const retained = new Set([...liveIds].filter(id => openingIds.has(id)));
  const unstamped = !write && before && placementDigest(before, retained) !== placementDigest(outline, retained);
  const untracked = !sameGeneration || !before || (object(stored) && stored.outlinePointPlacement !== undefined && !state);
  let floor = unstamped || untracked ? metadata.revision : state?.floor ?? metadata.revision - 1;
  const moves = (state?.moves ?? []).filter(proof => proof.revision >= floor
    && liveIds.has(proof.pointId) && proof.pointId !== write?.proof?.pointId);
  if (write?.proof) moves.push({ ...write.proof, revision: metadata.revision });
  if (moves.length > 64) floor = Math.max(floor, moves.shift()!.revision);
  return { ...metadata, outlinePointPlacement: { floor, head: placementDigest(outline), moves } };
}
