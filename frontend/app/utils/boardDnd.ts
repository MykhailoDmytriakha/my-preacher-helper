/**
 * The two rules that decide what a drag can hit, kept away from React so they can
 * be tested as plain functions.
 *
 * WHY THEY EXIST. Drop targets on this board overlap by construction: a card sits
 * inside a column, and the seam between cards sits inside the same column again —
 * partly over the cards themselves. A pointer is therefore "within" several
 * targets at once, and dnd-kit hands back every one of them. Without an explicit
 * order the winner is whichever the library happened to list first, which is how
 * a drag ends up meaning something the person did not aim at.
 *
 * The dnd-kit docs name this exact situation and, in newer versions, solve it
 * with `collisionPriority`; the version here has no such option, so the priority
 * is spelled out below.
 *
 * The second rule answers the owner's complaint that "everything lights up":
 * a target that cannot accept what is being dragged is not dimmed or ignored on
 * drop — it is switched OFF for the whole gesture, so it neither highlights nor
 * competes for the pointer.
 */

export type DragKind = 'point' | 'sub' | 'note';

export const DROP_PREFIX = {
  intoPoint: 'into-point:',
  gap: 'gap:',
  subGap: 'subgap:',
  noteGap: 'notegap:',
  section: 'section:',
  scratchPoint: 'scratch-point:',
  scratchSubPoint: 'scratch-subpoint:',
} as const;

export const SCRATCH_POOL_DROP_ID = 'scratch-note-pool';

/**
 * Smaller wins. A seam is a deliberate, precise aim; a card is a bigger and more
 * forgiving target; a column is the fallback that means "anywhere in here".
 */
export function dropTargetPriority(dropId: string): number {
  if (
    dropId.startsWith(DROP_PREFIX.gap) ||
    dropId.startsWith(DROP_PREFIX.subGap) ||
    dropId.startsWith(DROP_PREFIX.noteGap)
  ) {
    return 0;
  }
  if (
    dropId.startsWith(DROP_PREFIX.scratchPoint) ||
    dropId.startsWith(DROP_PREFIX.scratchSubPoint) ||
    dropId === SCRATCH_POOL_DROP_ID
  ) {
    return 1;
  }
  if (dropId.startsWith(DROP_PREFIX.intoPoint)) return 2;
  if (dropId.startsWith(DROP_PREFIX.section)) return 3;
  return 4;
}

/**
 * The collisions this drag is allowed to land on, most precise first.
 *
 * WHY THE FILTER LIVES HERE AND NOT ON THE DROP ZONES. The board used to switch
 * a zone OFF for the whole gesture when it could not accept what was in the air,
 * which sounds equivalent and is not: a zone was only enabled once a drag had
 * begun, and the library takes its measurements AT THE START of the drag — so it
 * measured a board on which every target was still off, then dragged over an
 * empty list and reported no target at all. Nothing could be dropped anywhere.
 *
 * Registration must therefore never depend on a drag being in progress. Targets
 * stay registered and measured at all times, and what a given drag may hit is
 * decided here, where it costs nothing.
 */
export function allowedCollisions<T extends { id: string | number }>(
  kind: DragKind | null,
  collisions: T[]
): T[] {
  const permitted = kind ? collisions.filter((c) => isDropTargetEnabled(kind, String(c.id))) : collisions;
  return orderCollisions(permitted);
}

/** Orders raw collisions so the most precise target the pointer is over wins. */
export function orderCollisions<T extends { id: string | number }>(collisions: T[]): T[] {
  return [...collisions].sort(
    (a, b) => dropTargetPriority(String(a.id)) - dropTargetPriority(String(b.id))
  );
}

/**
 * Can THIS kind of drag land on THIS target?
 *
 * A note belongs on a point, on a sub-point, or back in the pool — never in the
 * seam between two points, because a note has no place in the plan's order. A
 * point or a sub-point is the opposite: it belongs in the order, or inside
 * another point, and never on a note strip.
 */
export function isDropTargetEnabled(kind: DragKind, dropId: string): boolean {
  const isNoteTarget =
    dropId === SCRATCH_POOL_DROP_ID ||
    dropId.startsWith(DROP_PREFIX.scratchPoint) ||
    dropId.startsWith(DROP_PREFIX.scratchSubPoint);

  if (kind === 'note') {
    // A card is a valid target for a note too: dropping onto it files the note
    // under that point, which is what the strip inside it does. The seam BETWEEN
    // two notes is a note-only target as well — it is the one place that says
    // "this note comes before that one", which the owner could not express at all.
    return isNoteTarget || dropId.startsWith(DROP_PREFIX.intoPoint) || dropId.startsWith(DROP_PREFIX.noteGap);
  }

  // A point or a sub-point belongs in the plan's order, never among the notes.
  return !isNoteTarget && !dropId.startsWith(DROP_PREFIX.noteGap);
}
