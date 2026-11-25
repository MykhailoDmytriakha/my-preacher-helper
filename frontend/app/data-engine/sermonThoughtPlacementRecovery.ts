import { patchSermonThought } from '@/utils/sermonThoughtEdits';
import { normalizeStructure } from '@/utils/thoughtOrdering';

import { isActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { existingRowField, existingRowFields } from './rowFieldAction';
import { sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { isThoughtLocation, thoughtOutlineDestinations, THOUGHT_PLACEMENT_POLICY, type ThoughtLocation } from './thoughtPlacementAction';

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

export function thoughtPlacementBoardOrder(value: DocumentData): string[] {
  const sermon = value as unknown as Pick<Sermon, 'structure' | 'thoughtsBySection'>;
  return Object.values(normalizeStructure(sermon.structure ?? sermon.thoughtsBySection)).flat();
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

export function recoveredThoughtPlacement(checkpoint: SessionCheckpoint, targetSnapshot: ResourceSnapshot) {
  const addresses = checkpoint.unreadableRowProofs ?? [];
  const { confirmed, draft } = checkpoint;
  const generation = confirmed.metadata?.generation;
  if (!generation || !addresses.length || checkpoint.unreadableScalarProof?.length || checkpoint.unreadableExegeticalProofs?.length
    || confirmed.resource.collection !== 'sermons' || targetSnapshot.resource.collection !== confirmed.resource.collection
    || targetSnapshot.resource.id !== confirmed.resource.id || targetSnapshot.metadata?.generation !== generation
    || targetSnapshot.metadata.deleted || !confirmed.value || !draft || !targetSnapshot.value
    || addresses.some(address => address.field !== 'thoughtPlacementDrafts' || address.generation !== generation)
    || new Set(addresses.map(address => address.rowId)).size !== addresses.length) return;
  const saved = targetSnapshot.value;
  const moves = [];
  for (const { rowId: id, birth: createdAt } of addresses) {
    const location = readLocation(draft, id);
    if (!location || existingRowField(draft.thoughts, id, birth) !== createdAt) return;
    moves.push({ id, birth: createdAt, location });
  }
  if (!equalValues(draft, projectThoughtMoves(confirmed.value, moves))) return;
  const locations = moves.map(({ id, birth: createdAt, location: mine }) => ({
    id, mine, stored: existingRowField(saved.thoughts, id, birth) === createdAt ? readLocation(saved, id) : undefined,
  }));
  const changed = moves.filter((move, index) => !equalValues(move.location, locations[index].stored));
  const projected = locations.every(location => location.stored) ? projectThoughtMoves(saved, changed) : undefined;
  const proposed = projected && placementOrderFits(draft, projected, moves) ? projected : undefined;
  return { locations, proposed, rowIds: changed.map(move => move.id), samePlace: Boolean(proposed && !changed.length) };
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
