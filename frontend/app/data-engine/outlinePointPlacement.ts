import { hasOutlinePointOrder, outlinePointGap, outlinePointOrder, projectOutlinePoint } from '@/utils/outlineDnd';

import { equalValues, object } from './fieldValues';
import { outlinePlacementField, replaceResourceOutline } from './outlinePlacementResource';
import { isValidIdentifier, validOutlinePointGap } from './protocol';

import type { ActionTime } from './actionClock';
import type { SessionCheckpoint } from './session';
import type { DocumentData, OutlinePointPlacementCapture, ResourceSnapshot } from './types';
import type { SermonOutline } from '@/models/models';
import type { OutlinePointGap } from '@/utils/outlineDnd';

const asOutline = (value: unknown) => object(value) ? value as unknown as SermonOutline : undefined;

export function readOutlinePointPlacementComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, conflicts, remoteCandidate } = checkpoint;
  const field = outlinePlacementField(confirmed.resource.collection);
  if (!field || conflicts.length !== 1) return undefined;
  const { path, mine } = conflicts[0];
  const pointId = path[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  if (path.length !== 3 || path[0] !== field || path[2] !== 'position' || !isValidIdentifier(pointId)
    || !validOutlinePointGap(mine.value, pointId)) return undefined;
  const outline = asOutline(remoteCandidate?.value?.[field]);
  const shown = outline ?? asOutline(confirmed.value?.[field]);
  if (!shown) return undefined;
  const saved = outline && outlinePointGap(outline, pointId);
  return { pointId, mine: mine.value, saved, outline: shown,
    available: Boolean(saved && outline && projectOutlinePoint(outline, pointId, mine.value)) };
}

export function captureOutlinePointPlacement(before: SermonOutline, after: SermonOutline, pointId: string,
  generation: string | null, observedRevision: number, time: ActionTime | null): OutlinePointPlacementCapture | undefined {
  const opening = outlinePointGap(before, pointId), destination = outlinePointGap(after, pointId);
  if (!opening || !destination) return undefined;
  return { generation, before: outlinePointOrder(before), after: outlinePointOrder(after),
    placement: { pointId, opening, destination, observedRevision, time } };
}

/** The queue may attach a predecessor after the editor has captured this gesture. */
export function sameOutlinePointGesture(a: OutlinePointPlacementCapture, b: OutlinePointPlacementCapture): boolean {
  return equalValues({ ...a, placement: { ...a.placement, predecessorOperationId: null } },
    { ...b, placement: { ...b.placement, predecessorOperationId: null } });
}

export function projectResourceOutlinePoint(collection: string, value: DocumentData | null, move: OutlinePointPlacementCapture,
  exactOpening = false): DocumentData | null {
  const field = outlinePlacementField(collection);
  const outline = field && asOutline(value?.[field]);
  if (!value || !outline || (exactOpening && !hasOutlinePointOrder(outline, move.before))) return null;
  const { pointId, destination } = move.placement;
  const next = projectOutlinePoint(outline, pointId, destination);
  return next && (!exactOpening || hasOutlinePointOrder(next, move.after)) ? replaceResourceOutline(collection, value, next) : null;
}

export function retryOutlinePointPlacement(accepted: ResourceSnapshot, pointId: string, destination: OutlinePointGap,
  expectedOpening: OutlinePointGap | undefined, time: ActionTime | null) {
  const { collection } = accepted.resource;
  const field = outlinePlacementField(collection);
  const before = field && asOutline(accepted.value?.[field]);
  const opening = before && outlinePointGap(before, pointId);
  const next = before && projectOutlinePoint(before, pointId, destination);
  if (!before || !next || !opening || !accepted.value || !equalValues(opening, expectedOpening)) return undefined;
  const move = captureOutlinePointPlacement(before, next, pointId, accepted.metadata?.generation ?? null,
    accepted.metadata?.revision ?? 0, time);
  return move && { move, draft: replaceResourceOutline(collection, accepted.value, next) };
}

/** Keep the queued gesture in the draft while an earlier, independent Save settles. */
export function alignPendingOutlinePointPlacements(collection: string, accepted: DocumentData | null, draft: DocumentData | null,
  moves: readonly OutlinePointPlacementCapture[]): DocumentData | null {
  const field = outlinePlacementField(collection);
  const shown = field && asOutline(draft?.[field]);
  if (!accepted || !shown || !moves.length) return accepted;
  const latest = new Map(moves.map(move => [move.placement.pointId, move]));
  let projected = accepted;
  for (const move of moves) {
    const { pointId, destination } = move.placement;
    if (latest.get(pointId) !== move || projectOutlinePoint(shown, pointId, destination) !== shown) continue;
    const next = projectResourceOutlinePoint(collection, projected, move);
    if (field && next && next[field] !== projected[field]) projected = next;
  }
  return projected;
}
