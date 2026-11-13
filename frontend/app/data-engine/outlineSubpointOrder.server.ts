import { createHash } from 'node:crypto';

import { outlineSubpointGap, projectOutlineSubpoint, SECTION_KEYS } from '@/utils/outlineDnd';

import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { outlinePlacementField } from './outlinePlacementResource';
import { MAX_OUTLINE_SUBPOINT_MOVES, OUTLINE_SUBPOINT_REVIEW } from './outlineSubpointMove';
import { isValidIdentifier, mergeFields, validOutlineSubpointMove } from './protocol';
import { templateOutline } from './templateOutlineMerge';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, FieldValue, Json, OutlineSubpointMove, ResourceSnapshot } from './types';
import type { SermonOutline } from '@/models/models';
import type { OutlineSubpointGap } from '@/utils/outlineDnd';

type Displaced = {
  subpoint: true;
  pointId: string;
  earlier: OutlineSubpointGap;
  kept: OutlineSubpointGap;
  actionTime: ActionTime;
  winnerActionTime: ActionTime;
};
type Proof = { move: OutlineSubpointMove; revision: number; operationId: string | null };
type Tracking = { head: string; floor: number; proofs: Proof[] };
const MAX_PROOFS = MAX_OUTLINE_SUBPOINT_MOVES;
const asOutline = (value: unknown) => templateOutline(value) as unknown as SermonOutline | undefined;
const fieldValue = (outline: SermonOutline): FieldValue => ({ exists: true, value: outline as unknown as Json });

function topology(outline: SermonOutline, skip: ReadonlySet<string> = new Set()) {
  // A parent's own board position is independent of the order of its children.
  return SECTION_KEYS.flatMap(section => outline[section].map(point =>
    [point.id, (point.subPoints ?? []).map(child => child.id).filter(id => !skip.has(id))] as const))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function digest(outline: SermonOutline) {
  return createHash('sha256').update(JSON.stringify(topology(outline))).digest('base64url');
}

function tracking(raw: unknown, outline: SermonOutline, revision: number): Tracking | undefined {
  const state = object(raw) ? raw.outlineSubpointPlacement : undefined;
  if (!object(state) || state.head !== digest(outline) || !Number.isSafeInteger(state.floor)
    || Number(state.floor) < 0 || Number(state.floor) > revision
    || !Array.isArray(state.proofs) || state.proofs.length > MAX_PROOFS
    || !state.proofs.every(proof => object(proof) && Number.isSafeInteger(proof.revision)
      && Number(proof.revision) >= Number(state.floor) && Number(proof.revision) <= revision
      && (proof.operationId === null || isValidIdentifier(proof.operationId)) && validOutlineSubpointMove(proof.move, true))) return;
  return state as unknown as Tracking;
}

function acceptedTime(time: ActionTime | null, serverMs: number): ActionTime | null {
  const measured = boundedActionTime(time);
  return measured && measured.earliestMs <= serverMs + 5 ? measured : null;
}

function verifiedMoves(opening: SermonOutline, proposed: SermonOutline, gestures: readonly OutlineSubpointMove[]) {
  // Replaying the authored gesture chain distinguishes an explicit return from
  // a sibling whose neighbors changed because another child moved.
  const latest = new Map<string, OutlineSubpointMove>();
  let witnessed = opening;
  for (const move of gestures) {
    if (!equalValues(move.opening, outlineSubpointGap(witnessed, move.subPointId))) return undefined;
    const next = projectOutlineSubpoint(witnessed, move.subPointId, move.destination);
    if (!next || !equalValues(move.destination, outlineSubpointGap(next, move.subPointId))) return undefined;
    witnessed = next;
    const first = latest.get(move.subPointId);
    latest.set(move.subPointId, first ? { ...move, opening: first.opening, observedRevision: first.observedRevision } : move);
  }
  const moves = [...latest.values()].flatMap(move => {
    const source = outlineSubpointGap(opening, move.subPointId);
    const destination = outlineSubpointGap(witnessed, move.subPointId);
    return source && destination && equalValues(destination, outlineSubpointGap(proposed, move.subPointId))
      ? [{ ...move, opening: source, destination }] : [];
  });
  return moves.length === latest.size ? moves : undefined;
}

function decidePlacements(moves: readonly OutlineSubpointMove[], live: SermonOutline, state: Tracking | undefined,
  revision: number, operationId: string, serverMs: number) {
  const proofs: Omit<Proof, 'revision'>[] = [];
  const displaced: Displaced[] = [];
  const destinations: OutlineSubpointMove[] = [];
  const disputed: string[] = [];
  const align: { subPointId: string; saved: OutlineSubpointGap }[] = [];
  for (const move of moves) {
    const { subPointId, observedRevision } = move;
    const saved = outlineSubpointGap(live, subPointId);
    if (!saved || observedRevision < (state?.floor ?? revision)) {
      disputed.push(subPointId);
      continue;
    }
    const time = acceptedTime(move.time, serverMs);
    const previous = state?.proofs.find(proof => proof.move.subPointId === subPointId);
    const follows = previous?.operationId && previous.operationId === move.predecessorOperationId;
    const competing = previous && previous.revision > observedRevision && !follows;
    if (competing) {
      const storedTime = acceptedTime(previous.move.time, serverMs);
      const order = time && storedTime ? compareActionTime(time, storedTime) : 0;
      const samePlace = equalValues(saved, move.destination);
      if (!equalValues(saved, previous.move.destination) || (!order && !samePlace)) {
        disputed.push(subPointId);
        continue;
      }
      if (!order || !time || !storedTime) {
        const possibleLatest = time && storedTime ? {
          earliestMs: Math.max(time.earliestMs, storedTime.earliestMs),
          latestMs: Math.max(time.latestMs, storedTime.latestMs),
        } : null;
        proofs.push({ move: { ...move, time: possibleLatest }, operationId: null });
        continue;
      }
      if (!samePlace) displaced.push({ subpoint: true, pointId: subPointId,
        earlier: order > 0 ? saved : move.destination, kept: order > 0 ? move.destination : saved,
        actionTime: order > 0 ? storedTime : time, winnerActionTime: order > 0 ? time : storedTime });
      if (order > 0) {
        proofs.push({ move: { ...move, time }, operationId });
        destinations.push(move);
      }
    } else {
      if (saved.parentId !== move.opening.parentId || (!equalValues(saved, move.opening) && !state)) {
        disputed.push(subPointId);
        continue;
      }
      proofs.push({ move: { ...move, time }, operationId });
      destinations.push(move);
    }
    align.push({ subPointId, saved });
  }
  return { proofs, displaced, destinations, disputed, align };
}

export function orderOutlineSubpoints(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const unchanged = { command, proofs: [] as Omit<Proof, 'revision'>[], displaced: [] as Displaced[], uncertain: [] as ConflictDetail[], settled: [] as ConflictDetail[] };
  const field = outlinePlacementField(command.resource.collection);
  const metadata = current.metadata;
  if (!field || !metadata || metadata.deleted || command.generation !== metadata.generation
    || command.kind !== 'update' || !command.outlineSubpointMoves?.length) return unchanged;
  const root = command.changes.find(change => change.path.length === 1 && change.path[0] === field);
  const opening = asOutline(root?.before.value), proposed = asOutline(root?.after.value), live = asOutline(current.value?.[field]);
  if (!root || !opening || !proposed || !live) return unchanged;
  const state = tracking(raw, live, metadata.revision);
  const comparison = (outlineSubpointIds: string[], orderedOutlineSubpoints?: ConflictDetail['orderedOutlineSubpoints']) => ({ ...unchanged, uncertain: [{
    path: [field], code: OUTLINE_SUBPOINT_REVIEW, outlineSubpointIds, ...(orderedOutlineSubpoints?.length && { orderedOutlineSubpoints }), base: fieldValue(opening), mine: fieldValue(proposed), theirs: fieldValue(live),
  }] });
  const moves = verifiedMoves(opening, proposed, command.outlineSubpointMoves);
  if (!moves || moves.some(move => move.observedRevision > metadata.revision)) return unchanged;
  if (equalValues(opening, live)) {
    const proofs = moves.map(move => ({ move: { ...move, time: acceptedTime(move.time, serverMs) }, operationId: command.operationId }));
    if (moves.every(move => move.observedRevision === metadata.revision)) return { ...unchanged, proofs };
  }
  let base = opening, mine = proposed;
  const { proofs, displaced, destinations, disputed, align } =
    decidePlacements(moves, live, state, metadata.revision, command.operationId, serverMs);
  for (const { subPointId, saved } of align) {
    const alignedBase = projectOutlineSubpoint(base, subPointId, saved);
    const alignedMine = projectOutlineSubpoint(mine, subPointId, saved);
    if (!alignedBase || !alignedMine) {
      disputed.push(subPointId);
      continue;
    }
    base = alignedBase;
    mine = alignedMine;
  }
  const orderedPositions = displaced.map(({ pointId }) => ({ id: pointId,
    side: destinations.some(move => move.subPointId === pointId) ? 'local' as const : 'remote' as const }));
  const resolvedComparison = (ids: string[]) => comparison([...new Set([...ids, ...orderedPositions.map(item => item.id)])], orderedPositions);
  if (disputed.length) return resolvedComparison(disputed);
  const merged = mergeFields(fieldValue(base), fieldValue(mine), fieldValue(live), [field]);
  let result = asOutline(merged.value.value);
  if (merged.conflicts.length || !result) {
    const competingIds = displaced.map(({ pointId }) => pointId);
    return competingIds.length ? resolvedComparison([]) : unchanged;
  }
  const winning = new Set(destinations.map(move => move.subPointId));
  for (const move of command.outlineSubpointMoves) {
    if (!winning.has(move.subPointId)) continue;
    const next = projectOutlineSubpoint(result, move.subPointId, move.destination);
    if (!next) return comparison([move.subPointId]);
    result = next;
  }
  for (const move of destinations) {
    // The intended anchors need not remain immediately adjacent after independent
    // insertions, but the child must be within the exact authored gap.
    if (projectOutlineSubpoint(result, move.subPointId, move.destination) !== result) return comparison([move.subPointId]);
  }
  const { outlineSubpointMoves: _moves, ...ordered } = command;
  return { ...unchanged, proofs, displaced, settled: orderedPositions.length ? resolvedComparison([]).uncertain : [],
    command: { ...ordered, changes: command.changes.map(change =>
    change === root ? { ...root, before: fieldValue(live), after: fieldValue(result) } : change) } };
}

export function metadataAfterOutlineSubpointOrder(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  proofs: readonly Omit<Proof, 'revision'>[] = []) {
  const { metadata, resource, value } = snapshot;
  const field = outlinePlacementField(resource.collection);
  const outline = field && asOutline(value?.[field]);
  if (!metadata || !field || !outline) return metadata;
  const before = asOutline(raw?.[field]);
  const prior = raw?._dataEngine;
  const sameGeneration = object(prior) && prior.generation === metadata.generation && prior.revision === metadata.revision - 1;
  const state = sameGeneration && before ? tracking(prior, before, metadata.revision - 1) : undefined;
  const accepted = proofs.filter(({ move }) => equalValues(outlineSubpointGap(outline, move.subPointId), move.destination));
  const moved = new Set(accepted.map(({ move }) => move.subPointId));
  const unsigned = !before || !equalValues(topology(before, moved), topology(outline, moved));
  const brokenHead = object(prior) && prior.outlineSubpointPlacement !== undefined && !state;
  let floor = unsigned || !sameGeneration || brokenHead ? metadata.revision : state?.floor ?? metadata.revision - 1;
  const retained = (state?.proofs ?? []).filter(proof => proof.revision >= floor && !moved.has(proof.move.subPointId));
  retained.push(...accepted.map(({ move, operationId }) => {
    const { predecessorOperationId: _predecessorOperationId, ...stamp } = move;
    return { move: stamp, operationId, revision: metadata.revision };
  }));
  if (retained.length > MAX_PROOFS) floor = Math.max(floor, retained.at(-MAX_PROOFS - 1)!.revision);
  return { ...metadata, outlineSubpointPlacement: { head: digest(outline), floor, proofs: retained.slice(-MAX_PROOFS) } };
}
