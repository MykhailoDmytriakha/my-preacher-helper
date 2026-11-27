import { patchSermonThought } from '@/utils/sermonThoughtEdits';
import { applyScopedThoughtPlacement, normalizeStructure, removeThoughtIdFromStructure } from '@/utils/thoughtOrdering';

import { isActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { projectManualSelection } from './manualScope';
import { mergeDocumentFields } from './protocol';
import { existingRowField, existingRowFields } from './rowFieldAction';
import { sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { isThoughtLocation, isThoughtPlacementPart, thoughtOutlineDestinations, thoughtPlacementConflictId, THOUGHT_PLACEMENT_POLICY, type ThoughtLocation } from './thoughtPlacementAction';
import { awaitsRowReturnVersion } from './unreadableDraftProof';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';
import type { Sermon } from '@/models/models';

const { birth } = THOUGHT_PLACEMENT_POLICY;
const target = THOUGHT_PLACEMENT_POLICY.target('outlineLocation');
type PlacementAction = NonNullable<CommitRequest['thoughtPlacementActions']>[number];
export type CapturedThoughtMove = { id: string; birth: string; location: ThoughtLocation; action?: PlacementAction };

function requireThoughtRows(value: unknown): boolean {
  return Array.isArray(value) && value.every(row => object(row) && typeof row.id === 'string'
    && Array.isArray(row.tags) && row.tags.every(tag => typeof tag === 'string'));
}

function readLocation(value: DocumentData, id: string) {
  return existingRowField(value.thoughts, id, target);
}

/** Use the same projection as the thought card, so both aliases follow the requested thought. */
export function projectRecoveredThoughtPlacement(value: DocumentData, id: string, createdAt: string, location: ThoughtLocation): DocumentData | undefined {
  if (!requireThoughtRows(value.thoughts) || existingRowField(value.thoughts, id, birth) !== createdAt) return;
  const destination = location.subPointId ?? location.outlinePointId;
  if (destination && !equalValues(thoughtOutlineDestinations(value.outline).get(destination)?.location, location)) return;
  return patchSermonThought(value as unknown as Sermon, id, location) as unknown as DocumentData;
}

export function capturedThoughtMove(before: DocumentData, after: DocumentData, request: CommitRequest) {
  const oldLocations = existingRowFields(before.thoughts, target);
  const changes = [...existingRowFields(after.thoughts, target)].filter(([id, location]) => !equalValues(oldLocations.get(id), location));
  if (changes.length !== 1 || (request.thoughtPlacementActions && request.thoughtPlacementActions.length !== 1)) return;
  const [id, location] = changes[0];
  if (!location) return;
  const createdAt = existingRowField(before.thoughts, id, birth);
  const proposed = createdAt && projectRecoveredThoughtPlacement(before, id, createdAt, location);
  if (!proposed) return;
  const action = request.thoughtPlacementActions?.[0];
  if (action && action.rowId !== id) return;
  const proof = action && action.rowCreatedAt === createdAt && equalValues(action.before, oldLocations.get(id))
    && equalValues(action.after, location) && (action.time === null || isActionTime(action.time)) ? action : undefined;
  return { move: { id, birth: createdAt, location, action: proof } satisfies CapturedThoughtMove, proposed };
}

function projectThoughtMoves(value: DocumentData, moves: readonly Pick<CapturedThoughtMove, 'id' | 'birth' | 'location'>[]) {
  let projected = value;
  for (const move of moves) {
    const next = projectRecoveredThoughtPlacement(projected, move.id, move.birth, move.location);
    if (!next) return;
    projected = next;
  }
  return projected;
}

function readThoughtMoves(draft: DocumentData, rows: readonly { rowId: string; birth: string }[]) {
  const moves = [];
  for (const { rowId: id, birth: createdAt } of rows) {
    const location = readLocation(draft, id);
    if (!location || existingRowField(draft.thoughts, id, birth) !== createdAt) return;
    moves.push({ id, birth: createdAt, location });
  }
  return moves;
}

export function matchesThoughtPlacementDraft(opening: DocumentData, draft: DocumentData, rows: readonly { rowId: string; birth: string }[]): boolean {
  const moves = readThoughtMoves(draft, rows);
  return Boolean(moves && equalValues(draft, projectThoughtMoves(opening, moves)));
}

export function thoughtPlacementRecoveryCopy(source: SessionCheckpoint, orderedMoves: readonly CapturedThoughtMove[]) {
  const { confirmed } = source;
  const { value: opening, metadata } = confirmed;
  if (!opening || !metadata || !orderedMoves.length) return;
  const draft = projectThoughtMoves(opening, orderedMoves);
  if (!draft) return;
  const moves = new Map<string, CapturedThoughtMove>();
  for (const move of orderedMoves) {
    moves.delete(move.id);
    moves.set(move.id, move);
  }
  const continuation: SessionCheckpoint = {
    confirmed, draft, editGeneration: source.editGeneration, dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
  };
  const proofs: NonNullable<SessionCheckpoint['thoughtPlacementDrafts']> = {};
  for (const [id, move] of moves) {
    const original = readLocation(opening, id);
    if (!original || equalValues(original, move.location)) return;
    if (moves.size === 1) {
      // A single recovered choice must reproduce the final move directly from its opening.
      const direct = projectRecoveredThoughtPlacement(opening, id, move.birth, move.location);
      if (!direct || !equalValues(sermonThoughtFrame(direct), sermonThoughtFrame(draft))) return;
    }
    const action = move.action;
    if (action?.observedRevision === metadata.revision && !action.predecessorOperationId && equalValues(action.before, original)) {
      proofs[id] = { generation: metadata.generation, action };
    }
  }
  if (Object.keys(proofs).length === moves.size) continuation.thoughtPlacementDrafts = proofs;
  else {
    // A single grouped choice keeps the witnessed order even when only some original
    // action stamps survived. Its final moves must reproduce the exact saved draft.
    if (!equalValues(draft, projectThoughtMoves(opening, [...moves.values()]))) return;
    continuation.unreadableRowProofs = [...moves.values()].map(move => ({
      field: 'thoughtPlacementDrafts', rowId: move.id, birth: move.birth, generation: metadata.generation,
    }));
  }
  return { key: 'thought-placement', recoveryKind: 'sermon-thought-placement' as const, continuation };
}

/** Keep a captured move out of delivery if the freshly read thought or destination is gone. */
export function reviewUnavailableThoughtPlacements(checkpoint: SessionCheckpoint, saved: ResourceSnapshot): SessionCheckpoint {
  const moves = Object.values(checkpoint.thoughtPlacementDrafts ?? {});
  if (!moves.length || moves.every(({ generation, action }) => generation === saved.metadata?.generation && !saved.metadata.deleted
    && saved.value && isThoughtLocation(action.after)
    && projectRecoveredThoughtPlacement(saved.value, action.rowId, action.rowCreatedAt, action.after))) return checkpoint;
  return { ...checkpoint, thoughtPlacementDrafts: undefined,
    unreadableRowProofs: moves.map(({ generation, action }) => ({
      field: 'thoughtPlacementDrafts', rowId: action.rowId, birth: action.rowCreatedAt, generation,
    })) };
}

function placementBoard(value: DocumentData) {
  const sermon = value as unknown as Pick<Sermon, 'structure' | 'thoughtsBySection'>;
  return normalizeStructure(sermon.structure ?? sermon.thoughtsBySection);
}

export function thoughtPlacementBoardOrder(value: DocumentData): string[] {
  return Object.values(placementBoard(value)).flat();
}

function selectThoughtPlacementRows(value: DocumentData, source: DocumentData, rowIds: readonly string[]): DocumentData {
  const rows = projectManualSelection(value, source, rowIds.map(id => ['thoughts', { id }]));
  const without = rowIds.reduce((board, id) => removeThoughtIdFromStructure(board, id), placementBoard(value));
  const structure = { ...applyScopedThoughtPlacement(without, placementBoard(source), rowIds) };
  return { ...rows, structure, thoughtsBySection: structure };
}

/** Keep the original row for review when an ACK carries its deletion or replacement. */
export function retainReplacedThoughtPlacementReturns(checkpoint: SessionCheckpoint, accepted: ResourceSnapshot,
  draft: DocumentData | null): DocumentData | null {
  const original = checkpoint.draft, saved = accepted.value;
  if (!draft || !original || !saved || accepted.resource.collection !== 'sermons') return draft;
  const rows = (checkpoint.unreadableRowProofs ?? []).filter(address => address.field === 'thoughtPlacementDrafts'
    && address.returnedToOpening && address.generation === accepted.metadata?.generation
    && existingRowField(original.thoughts, address.rowId, birth) === address.birth
    && existingRowField(saved.thoughts, address.rowId, birth) !== address.birth);
  return rows.length ? selectThoughtPlacementRows(draft, original, rows.map(row => row.rowId)) : draft;
}

function restoreKnownThoughtPositions(draft: DocumentData, opening: DocumentData, moves: readonly CapturedThoughtMove[]) {
  const lostIds = moves.filter(move => existingRowField(opening.thoughts, move.id, birth) !== move.birth).map(move => move.id);
  const lost = new Set(lostIds);
  const currentPlaces = readThoughtMoves(opening, moves.filter(move => !lost.has(move.id))
    .map(move => ({ rowId: move.id, birth: move.birth })));
  if (!currentPlaces) return;
  const knownRows = lost.size ? selectThoughtPlacementRows(draft, opening, lostIds) : draft;
  return projectThoughtMoves(knownRows, currentPlaces);
}

function placementOrderFits(draft: DocumentData, projected: DocumentData, moves: readonly CapturedThoughtMove[]): boolean {
  if (moves.length < 2) return true;
  const wanted = thoughtPlacementBoardOrder(draft), actual = thoughtPlacementBoardOrder(projected);
  const byPoint = new Map<string | null, Set<string>>();
  for (const { id, location } of moves) {
    const rows = byPoint.get(location.outlinePointId) ?? new Set<string>();
    rows.add(id);
    byPoint.set(location.outlinePointId, rows);
  }
  return [...byPoint.values()].every(rows => {
    if (rows.size < 2) return true;
    const order = wanted.filter(id => rows.has(id));
    return order.length === rows.size && equalValues(order, actual.filter(id => rows.has(id)));
  });
}

function affectsThoughtPlacement(path: readonly string[], id: string): boolean {
  return path.length === 0 || path[0] === 'structure' || path[0] === 'thoughtsBySection'
    || (path[0] === 'thoughts' && path.length === 1)
    || (path[0] === 'thoughts' && path[1] === 'id:' + id && path.length === 2)
    || thoughtPlacementConflictId(path) === id || isThoughtPlacementPart(path, id);
}

export function recoveredThoughtPlacement(checkpoint: SessionCheckpoint, targetSnapshot: ResourceSnapshot) {
  const addresses = checkpoint.unreadableRowProofs ?? [];
  const { confirmed, draft } = checkpoint;
  const generation = confirmed.metadata?.generation;
  if (!generation || !addresses.length || checkpoint.unreadableScalarProof?.length || checkpoint.unreadableExegeticalProofs?.length
    || confirmed.resource.collection !== 'sermons' || targetSnapshot.resource.collection !== confirmed.resource.collection
    || targetSnapshot.resource.id !== confirmed.resource.id || targetSnapshot.metadata?.generation !== generation
    || targetSnapshot.metadata.deleted || !confirmed.value || !draft || !targetSnapshot.value
    || addresses.some(address => address.field !== 'thoughtPlacementDrafts' || address.generation !== generation
      || awaitsRowReturnVersion(address, targetSnapshot))
    || new Set(addresses.map(address => address.rowId)).size !== addresses.length) return;
  const saved = targetSnapshot.value;
  const moves = readThoughtMoves(draft, addresses);
  if (!moves) return;
  const shownMoves = projectThoughtMoves(confirmed.value, moves);
  const returned = addresses.some(address => address.returnedToOpening);
  if (!returned && !equalValues(draft, shownMoves)) return;
  // The saved choice can still retain other local fields when the destination or original row is gone.
  const neutral = shownMoves ? draft : restoreKnownThoughtPositions(draft, confirmed.value, moves);
  if (!neutral) return;
  const merged = mergeDocumentFields(shownMoves ?? confirmed.value, neutral, saved);
  if (!merged.value.exists || !object(merged.value.value)) return;
  const storedDraft = merged.value.value;
  // An acknowledgement adopts the saved text as the opening, while already disputed
  // sibling fields still need their own answer against that exact saved version.
  const conflicts = [...merged.conflicts];
  if (returned && equalValues(checkpoint.remoteCandidate, targetSnapshot)) {
    for (const conflict of checkpoint.conflicts) {
      if (!moves.some(({ id }) => affectsThoughtPlacement(conflict.path, id))
        && !conflicts.some(({ path }) => equalValues(path, conflict.path))) conflicts.push(conflict);
    }
  }
  const locations = moves.map(({ id, birth: createdAt, location: mine }) => ({
    id, mine, stored: existingRowField(saved.thoughts, id, birth) === createdAt ? readLocation(saved, id) : undefined,
  }));
  const changed = moves.filter((move, index) => !equalValues(move.location, locations[index].stored));
  const projected = shownMoves && locations.every(location => location.stored) ? projectThoughtMoves(storedDraft, changed) : undefined;
  const proposed = projected && placementOrderFits(draft, projected, moves) ? projected : undefined;
  return { locations, proposed, storedDraft, conflicts,
    rowIds: changed.map(move => move.id), samePlace: Boolean(proposed && !changed.length) };
}

export function openingKeepingReviewedThoughtPlacements(checkpoint: SessionCheckpoint, shown: DocumentData): DocumentData | undefined {
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  if (!confirmed.value || !remoteCandidate?.value || !conflicts.length
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation) return;
  const opening = confirmed.value, saved = remoteCandidate.value;
  const moves = Object.values(checkpoint.thoughtPlacementDrafts ?? {}).flatMap(({ generation, action }) => {
    const { rowId, rowCreatedAt, after } = action;
    const location = readLocation(opening, rowId);
    if (generation !== confirmed.metadata?.generation || !location || !equalValues(readLocation(shown, rowId), after)
      || [opening, saved, shown].some(value => existingRowField(value.thoughts, rowId, birth) !== rowCreatedAt)
      || conflicts.some(({ path }) => affectsThoughtPlacement(path, rowId))) return [];
    return [{ id: rowId, birth: rowCreatedAt, location }];
  });
  const projected = moves.length ? projectThoughtMoves(shown, moves) : undefined;
  return projected && placementOrderFits(opening, projected, moves) ? projected : undefined;
}

export function unresolvedThoughtPlacement(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.confirmed.resource.collection === 'sermons' && checkpoint.unreadableRowProofs?.some(address => address.field === 'thoughtPlacementDrafts') === true;
}

export function sermonThoughtPlacementDraft(checkpoint: SessionCheckpoint) {
  const ids = new Set(Object.keys(checkpoint.thoughtPlacementDrafts ?? {}));
  for (const address of checkpoint.unreadableRowProofs ?? []) if (address.field === 'thoughtPlacementDrafts') ids.add(address.rowId);
  if (!ids.size || !Array.isArray(checkpoint.draft?.thoughts)) return;
  const preview = checkpoint.draft.thoughts.flatMap(row =>
    object(row) && typeof row.id === 'string' && ids.has(row.id) && typeof row.text === 'string' ? [row.text] : []);
  if (preview.length) return preview.join('\n').slice(0, 500);
}
