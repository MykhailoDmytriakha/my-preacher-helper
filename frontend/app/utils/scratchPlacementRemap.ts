/**
 * Notes follow the thing they were pinned to.
 *
 * A note is filed against a plan row by id: `{ pointId }` for a point, or
 * `{ pointId, subPointId }` for a sub-point. Moving a row does not change its id,
 * but it DOES change what kind of row it is — a point that becomes a sub-point is
 * still `pt-a`, yet a placement saying `{ pointId: 'pt-a' }` now names a point
 * that no longer exists. The board renders notes by looking up those ids, so the
 * note quietly disappears from the screen: the owner saw exactly that.
 *
 * These functions translate the placements that a structural move invalidates.
 * They are pure and return only what CHANGED, so the caller writes the minimum.
 */

export interface ScratchPlacement {
  pointId: string;
  subPointId?: string;
}

export type PlacementMap = Record<string, ScratchPlacement | undefined>;

export interface PlacementChange {
  noteId: string;
  placement: ScratchPlacement;
}

/**
 * A point became a sub-point of `newParentId` — and its own children came along.
 *
 * Notes pinned to the point itself now belong to it AS a sub-point. Notes pinned
 * to its former children move with them: those children are now siblings under
 * the same new parent, so their ids stay, only the point above them changes.
 */
export function remapAfterNest(
  placements: PlacementMap,
  nestedId: string,
  newParentId: string,
  formerChildIds: string[]
): PlacementChange[] {
  const changes: PlacementChange[] = [];
  const childSet = new Set(formerChildIds);

  Object.entries(placements).forEach(([noteId, placement]) => {
    if (!placement) return;

    // Pinned to the point that just got nested.
    if (!placement.subPointId && placement.pointId === nestedId) {
      changes.push({ noteId, placement: { pointId: newParentId, subPointId: nestedId } });
      return;
    }
    // Pinned to one of its children, which now hang off the new parent.
    if (placement.pointId === nestedId && placement.subPointId && childSet.has(placement.subPointId)) {
      changes.push({ noteId, placement: { pointId: newParentId, subPointId: placement.subPointId } });
    }
  });

  return changes;
}

/** A sub-point became a point of its own: its notes are now pinned to a point. */
export function remapAfterOutdent(
  placements: PlacementMap,
  promotedId: string,
  formerParentId: string
): PlacementChange[] {
  const changes: PlacementChange[] = [];

  Object.entries(placements).forEach(([noteId, placement]) => {
    if (!placement) return;
    if (placement.pointId === formerParentId && placement.subPointId === promotedId) {
      changes.push({ noteId, placement: { pointId: promotedId } });
    }
  });

  return changes;
}

/** A sub-point moved under a different point; its notes name the new parent. */
export function remapAfterSubPointReparent(
  placements: PlacementMap,
  subPointId: string,
  newParentId: string
): PlacementChange[] {
  const changes: PlacementChange[] = [];

  Object.entries(placements).forEach(([noteId, placement]) => {
    if (!placement) return;
    if (placement.subPointId === subPointId && placement.pointId !== newParentId) {
      changes.push({ noteId, placement: { pointId: newParentId, subPointId } });
    }
  });

  return changes;
}
