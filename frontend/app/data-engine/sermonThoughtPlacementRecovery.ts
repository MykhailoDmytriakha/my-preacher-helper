import { patchSermonThought } from '@/utils/sermonThoughtEdits';

import { isActionTime } from './actionClock';
import { equalValues, object, readField, writeField } from './fieldValues';
import { existingRowField, existingRowFields } from './rowFieldAction';
import { isThoughtLocation, thoughtOutlineDestinations, THOUGHT_PLACEMENT_POLICY, type ThoughtLocation } from './thoughtPlacementAction';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';
import type { Sermon } from '@/models/models';

const fields = ['thoughts', 'structure', 'thoughtsBySection'] as const;
const frame = (value: DocumentData) => fields.map(field => readField(value, [field]));
const { birth } = THOUGHT_PLACEMENT_POLICY;
const target = THOUGHT_PLACEMENT_POLICY.target('outlineLocation');
type PlacementAction = NonNullable<CommitRequest['thoughtPlacementActions']>[number];
type Move = { id: string; birth: string; location: ThoughtLocation; action?: PlacementAction };

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

function actualMove(before: DocumentData, after: DocumentData, request: CommitRequest): Move | undefined {
  const oldLocations = existingRowFields(before.thoughts, target);
  const changes = [...existingRowFields(after.thoughts, target)].filter(([id, location]) => !equalValues(oldLocations.get(id), location));
  if (changes.length !== 1 || (request.thoughtPlacementActions && request.thoughtPlacementActions.length !== 1)) return;
  const [id, location] = changes[0];
  if (!location) return;
  const createdAt = existingRowField(before.thoughts, id, birth);
  const proposed = createdAt && projectRecoveredThoughtPlacement(before, id, createdAt, location);
  if (!proposed || !equalValues(frame(proposed), frame(after))) return;
  const action = request.thoughtPlacementActions?.[0];
  if (action && action.rowId !== id) return;
  const proof = action && action.rowCreatedAt === createdAt && equalValues(action.before, oldLocations.get(id))
    && equalValues(action.after, location) && (action.time === null || isActionTime(action.time)) ? action : undefined;
  return { id, birth: createdAt, location, action: proof };
}

export function recoverableThoughtPlacements(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const { value: opening, metadata } = confirmed;
  const first = chain[0]?.value, last = chain.at(-1)?.value, saved = projected.confirmed.value;
  if (!metadata || !opening || !draft || !first || !last || !saved || !equalValues(frame(opening), frame(first))
    || !equalValues(frame(last), frame(draft))) return;
  const moves = new Map<string, Move>();
  for (let index = 1; index < chain.length; index += 1) {
    const request = chain[index], before = chain[index - 1].value, after = request.value;
    if (!before || !after) return;
    if (equalValues(frame(before), frame(after)) && !request.thoughtPlacementActions?.length) continue;
    const move = actualMove(before, after, request);
    if (!move) return;
    moves.set(move.id, move);
  }
  if (!moves.size) return;

  const copyFrame = (document: DocumentData, frameSource: DocumentData) => fields.reduce(
    (result, field) => writeField(result, [field], readField(frameSource, [field])), document);
  const continuation: SessionCheckpoint = {
    confirmed, draft: copyFrame(opening, last), editGeneration: source.editGeneration,
    dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
  };
  const proofs: NonNullable<SessionCheckpoint['thoughtPlacementDrafts']> = {};
  for (const [id, move] of moves) {
    const original = readLocation(opening, id);
    const next = projectRecoveredThoughtPlacement(opening, id, move.birth, move.location);
    if (!next || !original || equalValues(original, move.location)
      || (moves.size === 1 && !equalValues(frame(next), frame(last)))) return;
    const action = move.action;
    if (action?.observedRevision === metadata.revision && !action.predecessorOperationId && equalValues(action.before, original)) {
      proofs[id] = { generation: metadata.generation, action };
    } else {
      // More than one Thought may depend on their combined relative order. Do not separate a partially witnessed order.
      if (moves.size !== 1) return;
      continuation.unreadableRowProofs = [{ field: 'thoughtPlacementDrafts', rowId: id, birth: move.birth, generation: metadata.generation }];
    }
  }
  if (Object.keys(proofs).length) continuation.thoughtPlacementDrafts = proofs;
  return { continuation, restoreStored: (document: DocumentData) => copyFrame(document, saved) };
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

export function recoveredThoughtPlacement(checkpoint: SessionCheckpoint, targetSnapshot: ResourceSnapshot) {
  const [address, other] = checkpoint.unreadableRowProofs ?? [];
  if (other || address?.field !== 'thoughtPlacementDrafts' || checkpoint.unreadableScalarProof?.length
    || checkpoint.unreadableExegeticalProofs?.length || checkpoint.confirmed.resource.collection !== 'sermons'
    || checkpoint.confirmed.metadata?.generation !== address.generation || targetSnapshot.metadata?.generation !== address.generation
    || targetSnapshot.metadata.deleted || !checkpoint.confirmed.value || !checkpoint.draft || !targetSnapshot.value) return;
  const { rowId, birth: createdAt } = address;
  const mine = readLocation(checkpoint.draft, rowId);
  if (!mine || !equalValues(checkpoint.draft, projectRecoveredThoughtPlacement(checkpoint.confirmed.value, rowId, createdAt, mine))) return;
  const sameThought = existingRowField(targetSnapshot.value.thoughts, rowId, birth) === createdAt;
  const stored = sameThought ? readLocation(targetSnapshot.value, rowId) : undefined;
  const proposed = stored && projectRecoveredThoughtPlacement(targetSnapshot.value, rowId, createdAt, mine);
  return { rowId, mine, stored, proposed, samePlace: equalValues(mine, stored) };
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
