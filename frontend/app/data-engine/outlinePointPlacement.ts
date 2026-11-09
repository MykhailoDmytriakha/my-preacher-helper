import { outlinePointGap, outlinePointOrder, projectOutlinePoint } from '@/utils/outlineDnd';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import { equalValues, object } from './fieldValues';
import { isValidIdentifier, validOutlinePointGap } from './protocol';

import type { ActionTime } from './actionClock';
import type { SessionCheckpoint } from './session';
import type { DocumentData, OutlinePointPlacementCapture, ResourceSnapshot } from './types';
import type { Sermon, SermonOutline } from '@/models/models';
import type { OutlinePointGap } from '@/utils/outlineDnd';

const asOutline = (value: unknown) => object(value) ? value as unknown as SermonOutline : undefined;

export function readOutlinePointPlacementComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, conflicts, remoteCandidate } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || conflicts.length !== 1) return undefined;
  const { path, mine } = conflicts[0];
  const pointId = path[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  if (path.length !== 3 || path[0] !== 'outline' || path[2] !== 'position' || !isValidIdentifier(pointId)
    || !validOutlinePointGap(mine.value, pointId)) return undefined;
  const outline = asOutline(remoteCandidate?.value?.outline);
  const shown = outline ?? asOutline(confirmed.value?.outline);
  if (!shown) return undefined;
  const saved = outline && outlinePointGap(outline, pointId);
  return { pointId, mine: mine.value, saved, outline: shown,
    available: Boolean(saved && outline && projectOutlinePoint(outline, pointId, mine.value)) };
}

export function retryOutlinePointPlacement(accepted: ResourceSnapshot, pointId: string, destination: OutlinePointGap,
  expectedOpening: OutlinePointGap | undefined, time: ActionTime | null) {
  const before = asOutline(accepted.value?.outline);
  const opening = before && outlinePointGap(before, pointId);
  const next = before && projectOutlinePoint(before, pointId, destination);
  const actualDestination = next && outlinePointGap(next, pointId);
  if (!before || !next || !opening || !actualDestination || !equalValues(opening, expectedOpening)) return undefined;
  const move: OutlinePointPlacementCapture = {
    generation: accepted.metadata?.generation ?? null, before: outlinePointOrder(before), after: outlinePointOrder(next),
    placement: { pointId, opening, destination: actualDestination, observedRevision: accepted.metadata?.revision ?? 0, time },
  };
  return { move, draft: replaceSermonOutline(accepted.value as unknown as Sermon, next) as unknown as DocumentData };
}

/** Keep the queued gesture in the draft while an earlier, independent Save settles. */
export function alignPendingOutlinePointPlacements(accepted: DocumentData | null, draft: DocumentData | null,
  moves: readonly OutlinePointPlacementCapture[]): DocumentData | null {
  const shown = asOutline(draft?.outline);
  if (!accepted || !shown || !moves.length) return accepted;
  const latest = new Map(moves.map(move => [move.placement.pointId, move]));
  let projected = accepted as unknown as Sermon;
  for (const move of moves) {
    const { pointId, destination } = move.placement;
    if (latest.get(pointId) !== move || projectOutlinePoint(shown, pointId, destination) !== shown) continue;
    const outline = projected.outline && projectOutlinePoint(projected.outline, pointId, destination);
    if (outline && outline !== projected.outline) projected = replaceSermonOutline(projected, outline);
  }
  return projected as unknown as DocumentData;
}
