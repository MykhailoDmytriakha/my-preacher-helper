import type { OutlinePoint, SubPoint } from '@/models/models';

/**
 * The plan, laid out as one flat list per section — the shape a sortable list can
 * actually work with.
 *
 * WHY FLAT. A card and the card nested under it are two different lists to React,
 * and a drag cannot cross between two sibling sortable contexts. Every serious
 * tree implementation solves this the same way: flatten for the duration of the
 * interaction, let the single list handle order, and rebuild the hierarchy on
 * drop. dnd-kit's own tree example is built exactly like this.
 *
 * WHY DEPTH COMES FROM THE POINTER'S HORIZONTAL POSITION. "Drop onto the card to
 * nest" reads well in a demo and badly in the hand: the card is a big target that
 * overlaps the seam above it, so the same pixel can mean two different things.
 * Dragging sideways is unambiguous, it is what Notion and Workflowy trained
 * everyone on, and it lets the row show its future indent WHILE moving instead of
 * promising something at drop time.
 *
 * The plan is two levels deep, so depth is 0 or 1 and `MAX_DEPTH` says so once.
 */

export const MAX_DEPTH = 1;

export interface FlatRow {
  id: string;
  text: string;
  depth: number;
  parentId: string | null;
  note?: string;
  isReviewed?: boolean;
}

export function flattenPoints(points: OutlinePoint[]): FlatRow[] {
  const rows: FlatRow[] = [];
  points.forEach((point) => {
    rows.push({
      id: point.id,
      text: point.text,
      depth: 0,
      parentId: null,
      ...(point.note !== undefined ? { note: point.note } : {}),
      ...(point.isReviewed !== undefined ? { isReviewed: point.isReviewed } : {}),
    });
    [...(point.subPoints ?? [])]
      .sort((a, b) => a.position - b.position)
      .forEach((sub) => {
        rows.push({
          id: sub.id,
          text: sub.text,
          depth: 1,
          parentId: point.id,
          ...(sub.note !== undefined ? { note: sub.note } : {}),
        });
      });
  });
  return rows;
}

export function buildPoints(rows: FlatRow[]): OutlinePoint[] {
  const points: OutlinePoint[] = [];
  rows.forEach((row) => {
    if (row.depth === 0 || points.length === 0) {
      const point: OutlinePoint = { id: row.id, text: row.text };
      if (row.note !== undefined) point.note = row.note;
      if (row.isReviewed !== undefined) point.isReviewed = row.isReviewed;
      points.push(point);
      return;
    }
    const parent = points[points.length - 1];
    const sub: SubPoint = {
      id: row.id,
      text: row.text,
      position: parent.subPoints?.length ?? 0,
    };
    if (row.note !== undefined) sub.note = row.note;
    parent.subPoints = [...(parent.subPoints ?? []), sub];
  });
  return points;
}

/**
 * Where the row would land if the drag ended right now.
 *
 * Depth is the pointer's horizontal travel in indent steps, then clamped by the
 * neighbours it is landing between: it can go at most one level deeper than the
 * row above (you cannot nest under nothing) and no shallower than the row below
 * (or that row would be orphaned). Those two clamps are what make the gesture
 * feel guided rather than fussy.
 */
export function getProjection(
  rows: FlatRow[],
  activeId: string,
  overId: string,
  dragOffsetX: number,
  indentWidth: number
): { depth: number; parentId: string | null } | null {
  const overIndex = rows.findIndex((r) => r.id === overId);
  const activeIndex = rows.findIndex((r) => r.id === activeId);
  if (overIndex === -1 || activeIndex === -1) return null;

  const moved = arrayMoveRows(rows, activeIndex, overIndex);
  const previous = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const active = rows[activeIndex];

  const steps = Math.round(dragOffsetX / indentWidth);
  const projected = active.depth + steps;

  const maxDepth = previous ? Math.min(previous.depth + 1, MAX_DEPTH) : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(projected, maxDepth));

  /*
   * The clamped depth DECIDES the answer — it is not a hint that a later branch
   * may ignore. An earlier version returned a hard-coded 1 whenever depth was
   * non-zero, which meant removing the clamps changed nothing and the test that
   * claimed to guard them passed against broken code. Mutation testing is what
   * exposed it: break the clamp, everything still green.
   */
  if (depth <= 0 || !previous) return { depth: 0, parentId: null };
  return { depth, parentId: previous.depth === 0 ? previous.id : previous.parentId };
}

/** Local copy so the utilities stay free of the drag library. */
export function arrayMoveRows(rows: FlatRow[], from: number, to: number): FlatRow[] {
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (!moved) return rows;
  next.splice(to, 0, moved);
  return next;
}

/**
 * A point being dragged takes its sub-points with it — they are hidden from the
 * list while it moves, exactly as a collapsed branch would be, and re-attached on
 * drop. Without this they would sit in place while their parent flies away.
 */
export function withoutDescendantsOf(rows: FlatRow[], id: string): FlatRow[] {
  return rows.filter((row) => row.parentId !== id);
}

export function descendantsOf(rows: FlatRow[], id: string): FlatRow[] {
  return rows.filter((row) => row.parentId === id);
}
