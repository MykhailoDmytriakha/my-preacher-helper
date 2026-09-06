/**
 * The rules that decide what a drag can hit, kept away from React so they can be
 * tested as plain functions.
 *
 * TWO VOCABULARIES LIVE ON ONE BOARD.
 *
 * A point or a sub-point moves in the plan's ORDER: it lands beside another row
 * (a seam), inside a card (nesting) or in an empty column. Those targets overlap by
 * construction — a seam sits inside a card sits inside a column — so the raw list
 * of hits is ordered by precision before the first one is taken.
 *
 * A scratch note is filed into a CONTAINER: the pool, a point, a sub-point. The
 * whole card is the target, the whole row is the target, and WHERE inside the
 * container the note lands is read from the nearest note card under the pointer —
 * its upper half means "before", its lower half "after". No seams, no bands: the
 * owner's words were "the machine catches every pixel; human movements are rough".
 */

export type DragKind = 'point' | 'sub' | 'note';

export const DROP_PREFIX = {
  intoPoint: 'into-point:',
  gap: 'gap:',
  subGap: 'subgap:',
  section: 'section:',
} as const;

/* ---------------------------------------------------------------- note containers */

export const NOTE_POOL_ID = 'scratch-note-pool';
/** @deprecated kept for older imports; the pool container id. */
export const SCRATCH_POOL_DROP_ID = NOTE_POOL_ID;
export const NOTE_CONTAINER_PREFIX = {
  point: 'note-point:',
  sub: 'note-sub:',
} as const;

export type NoteContainer =
  | { kind: 'pool' }
  | { kind: 'point'; pointId: string }
  | { kind: 'sub'; subPointId: string };

export const notePointContainerId = (pointId: string) => `${NOTE_CONTAINER_PREFIX.point}${pointId}`;
export const noteSubContainerId = (subPointId: string) => `${NOTE_CONTAINER_PREFIX.sub}${subPointId}`;

export function parseNoteContainerId(id: string | number): NoteContainer | null {
  const raw = String(id);
  if (raw === NOTE_POOL_ID) return { kind: 'pool' };
  if (raw.startsWith(NOTE_CONTAINER_PREFIX.point)) return { kind: 'point', pointId: raw.slice(NOTE_CONTAINER_PREFIX.point.length) };
  if (raw.startsWith(NOTE_CONTAINER_PREFIX.sub)) return { kind: 'sub', subPointId: raw.slice(NOTE_CONTAINER_PREFIX.sub.length) };
  return null;
}

export const isNoteContainerId = (id: string | number): boolean => parseNoteContainerId(id) !== null;

/** A sub-point row sits inside its point card: when the pointer is in both, the row wins. */
export function noteContainerDepth(id: string | number): number {
  const parsed = parseNoteContainerId(id);
  if (!parsed) return -1;
  return parsed.kind === 'sub' ? 2 : parsed.kind === 'point' ? 1 : 0;
}

export function pickDeepestNoteContainer<T extends { id: string | number }>(collisions: T[]): T | null {
  let best: T | null = null;
  let bestDepth = -1;
  for (const collision of collisions) {
    const depth = noteContainerDepth(collision.id);
    if (depth > bestDepth) {
      best = collision;
      bestDepth = depth;
    }
  }
  return best;
}

/* ------------------------------------------------------- structural drags (points) */

/**
 * Smaller wins. A seam is a deliberate, precise aim; a card is a bigger and more
 * forgiving target; a column is the fallback that means "anywhere in here".
 */
export function dropTargetPriority(dropId: string): number {
  if (dropId.startsWith(DROP_PREFIX.gap) || dropId.startsWith(DROP_PREFIX.subGap)) return 0;
  if (dropId.startsWith(DROP_PREFIX.intoPoint)) return 1;
  if (dropId.startsWith(DROP_PREFIX.section)) return 2;
  return 3;
}

/**
 * The collisions a structural drag is allowed to land on, most precise first.
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
 * A note belongs in a container — the pool, a point, a sub-point — and nowhere
 * in the plan's order. A point or a sub-point is the opposite: it belongs in the
 * order or inside another point, never among the notes.
 */
export function isDropTargetEnabled(kind: DragKind, dropId: string): boolean {
  const isNoteContainer = isNoteContainerId(dropId);
  if (kind === 'note') return isNoteContainer;
  return !isNoteContainer;
}

/* ------------------------------------------------------------ where a note lands */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const rectContains = (rect: Rect, p: Point): boolean =>
  p.x >= rect.left && p.x <= rect.left + rect.width && p.y >= rect.top && p.y <= rect.top + rect.height;

/**
 * Distance from the pointer to a card, with the axis the list does NOT flow on
 * weighted heavily: in the grid a card in the pointer's own row beats one in the
 * row above even when both gaps are 12px (stretched grid rows make that a tie),
 * and in a list the card level with the pointer wins over a nearer corner.
 */
const CROSS_AXIS_WEIGHT = 8;
const distanceToRect = (rect: Rect, p: Point, isGrid: boolean): number => {
  const dx = Math.max(rect.left - p.x, 0, p.x - (rect.left + rect.width));
  const dy = Math.max(rect.top - p.y, 0, p.y - (rect.top + rect.height));
  return isGrid ? Math.hypot(dx, dy * CROSS_AXIS_WEIGHT) : Math.hypot(dx * CROSS_AXIS_WEIGHT, dy);
};

export interface NoteSlotPosition {
  /** Where the note lands among the container's notes, counted WITHOUT the note in the air. */
  index: number;
  /** The neighbour the decision was read from; null in an empty container. */
  anchorIndex: number | null;
  side: 'before' | 'after';
}

/**
 * The NEAREST card decides, not only the one under the pointer: the gaps between
 * cards, the space above the first and below the last all belong to their closest
 * neighbour, and its half — top/bottom in a list, left/right in the pool grid —
 * says before or after. `cards` are the container's notes as displayed, without
 * the note in the air.
 */
export function resolveNoteSlot(pointer: Point, cards: Rect[], isGrid: boolean): NoteSlotPosition {
  if (cards.length === 0) return { index: 0, anchorIndex: null, side: 'after' };
  let best = 0;
  let bestDistance = Infinity;
  cards.forEach((rect, i) => {
    const d = distanceToRect(rect, pointer, isGrid);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  const rect = cards[best];
  const before = isGrid ? pointer.x < rect.left + rect.width / 2 : pointer.y < rect.top + rect.height / 2;
  return { index: before ? best : best + 1, anchorIndex: best, side: before ? 'before' : 'after' };
}

export interface NoteSlot {
  containerId: string;
  index: number;
}

export interface NoteContainerMeasure {
  /** The container's note cards as displayed, without the note in the air. */
  cards: Rect[];
  /**
   * The open slot inside this container, if one is drawn — or, before the first
   * slot exists, the lifted card's own place while it is still on screen.
   */
  slot: Rect | null;
  /** Which index the slot stands for, counted among `cards`. */
  slotIndex: number | null;
  isGrid: boolean;
}

/**
 * One drop target for a note in the air: the deepest container under the pointer
 * and the slot inside it. Resting on the open slot itself means "yes, here" — the
 * slot holds, which is what keeps neighbours from jittering after they slid apart.
 * Without pointer coordinates (keyboard) the centre of the dragged rect stands in.
 */
export function resolveNoteCollision<T extends { id: string | number }>(input: {
  pointer: Point | null;
  fallbackPoint: Point | null;
  hits: T[];
  previous: NoteSlot | null;
  measure: (containerId: string) => NoteContainerMeasure | null;
}): NoteSlot | null {
  const deepest = pickDeepestNoteContainer(input.hits.filter((hit) => isNoteContainerId(hit.id)));
  if (!deepest) return null;
  const containerId = String(deepest.id);
  const point = input.pointer ?? input.fallbackPoint;
  const measured = input.measure(containerId);
  if (!point || !measured) return { containerId, index: 0 };
  if (measured.slot && rectContains(measured.slot, point)) {
    if (input.previous?.containerId === containerId) return input.previous;
    // Lift-off: the finger is on the card's own place, and that place is the answer —
    // not the nearest neighbour, which would open a slot somewhere else.
    if (measured.slotIndex !== null) return { containerId, index: measured.slotIndex };
  }
  return { containerId, index: resolveNoteSlot(point, measured.cards, measured.isGrid).index };
}

/* --------------------------------------------------------------- slot geometry */

/**
 * A tall card opens a COMPACT slot in another container: a full-height hole for an
 * eight-line note shoved every destination a screen away each time the pointer
 * crossed a card on the way. Inside its own list the slot is the card's full
 * height — neighbours make exactly the room the card takes.
 */
export const NOTE_COMPACT_SLOT_HEIGHT = 120;

export const noteSlotHeight = (cardHeight: number, sameContainer: boolean): number =>
  sameContainer ? cardHeight : Math.min(cardHeight, NOTE_COMPACT_SLOT_HEIGHT);
