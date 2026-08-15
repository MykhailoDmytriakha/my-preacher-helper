import type { OutlinePoint, SermonOutline, SubPoint } from '@/models/models';

/**
 * The four moves a plan can make — as pure functions, so the rules are testable
 * without a drag library and stay identical whether the move came from a pointer,
 * a keyboard or a button.
 *
 * THE PLAN IS TWO LEVELS DEEP: points, and sub-points under them. That is the
 * whole model, and these functions are what keeps a drag from inventing a third
 * one. When a point that HAS sub-points is nested into another point, its
 * children travel with it and land beside it — the alternative (refusing the
 * move, or dropping the children) either blocks a natural gesture or destroys
 * text, and the interface says so during the drag rather than surprising anyone.
 *
 * Every function returns a NEW outline and leaves the input untouched; a move
 * that cannot be made returns the outline unchanged rather than a half-applied one.
 */

export type SectionKey = 'introduction' | 'main' | 'conclusion';

export const SECTION_KEYS: SectionKey[] = ['introduction', 'main', 'conclusion'];

const listOf = (outline: SermonOutline, section: SectionKey): OutlinePoint[] =>
  outline[section] ?? [];

const withList = (
  outline: SermonOutline,
  section: SectionKey,
  next: OutlinePoint[]
): SermonOutline => ({ ...outline, [section]: next });

/** Sub-points carry a fractional `position`; after any reorder it is renumbered. */
const renumber = (subPoints: SubPoint[]): SubPoint[] =>
  subPoints.map((sp, index) => ({ ...sp, position: index }));

export const findPointSection = (
  outline: SermonOutline,
  pointId: string
): SectionKey | null => {
  for (const section of SECTION_KEYS) {
    if (listOf(outline, section).some((p) => p.id === pointId)) return section;
  }
  return null;
};

export const findSubPointParent = (
  outline: SermonOutline,
  subPointId: string
): { section: SectionKey; point: OutlinePoint; index: number } | null => {
  for (const section of SECTION_KEYS) {
    for (const point of listOf(outline, section)) {
      const index = point.subPoints?.findIndex((sp) => sp.id === subPointId) ?? -1;
      if (index >= 0) return { section, point, index };
    }
  }
  return null;
};

/** Reorder within a section, or move to another one. */
export function movePoint(
  outline: SermonOutline,
  pointId: string,
  toSection: SectionKey,
  toIndex: number
): SermonOutline {
  const fromSection = findPointSection(outline, pointId);
  if (!fromSection) return outline;

  const fromList = [...listOf(outline, fromSection)];
  const currentIndex = fromList.findIndex((p) => p.id === pointId);
  const [moved] = fromList.splice(currentIndex, 1);
  if (!moved) return outline;

  if (fromSection === toSection) {
    // The index was measured against the list WITH the point still in it, so an
    // insert further down has to account for the gap the removal just left.
    const target = Math.max(0, Math.min(toIndex > currentIndex ? toIndex - 1 : toIndex, fromList.length));
    fromList.splice(target, 0, moved);
    return withList(outline, fromSection, fromList);
  }

  const toList = [...listOf(outline, toSection)];
  toList.splice(Math.max(0, Math.min(toIndex, toList.length)), 0, moved);
  return withList(withList(outline, fromSection, fromList), toSection, toList);
}

/**
 * A point becomes a sub-point of another point. Its own sub-points follow it and
 * land right after it under the new parent — see the note at the top of the file.
 */
export function nestPointUnderPoint(
  outline: SermonOutline,
  pointId: string,
  targetPointId: string
): SermonOutline {
  if (pointId === targetPointId) return outline;
  const fromSection = findPointSection(outline, pointId);
  const targetSection = findPointSection(outline, targetPointId);
  if (!fromSection || !targetSection) return outline;

  const fromList = [...listOf(outline, fromSection)];
  const movedIndex = fromList.findIndex((p) => p.id === pointId);
  const [moved] = fromList.splice(movedIndex, 1);
  if (!moved) return outline;

  let next = withList(outline, fromSection, fromList);
  const targetList = [...listOf(next, targetSection)];
  const targetIndex = targetList.findIndex((p) => p.id === targetPointId);
  if (targetIndex < 0) return outline;

  const target = targetList[targetIndex];
  const arrivals: SubPoint[] = [
    { id: moved.id, text: moved.text, position: 0, ...(moved.note ? { note: moved.note } : {}) },
    ...(moved.subPoints ?? []),
  ];
  targetList[targetIndex] = {
    ...target,
    subPoints: renumber([...(target.subPoints ?? []), ...arrivals]),
  };
  next = withList(next, targetSection, targetList);
  return next;
}

/**
 * A point becomes a sub-point of `targetPointId` AT A CHOSEN SLOT.
 *
 * This is the case the board was showing a line for and then doing nothing about:
 * dropping a point into the seam between two sub-points is a perfectly ordinary
 * intention — "put it under this point, right here" — and it has to land where
 * the line promised, not at the end.
 */
export function nestPointUnderPointAt(
  outline: SermonOutline,
  pointId: string,
  targetPointId: string,
  index: number
): SermonOutline {
  const nested = nestPointUnderPoint(outline, pointId, targetPointId);
  if (nested === outline) return outline;

  const section = findPointSection(nested, targetPointId);
  if (!section) return nested;

  return withList(
    nested,
    section,
    listOf(nested, section).map((point) => {
      if (point.id !== targetPointId) return point;
      const subPoints = [...(point.subPoints ?? [])];
      // `nestPointUnderPoint` appended the arrivals; move them to the requested slot.
      const arrivalsStart = subPoints.findIndex((sp) => sp.id === pointId);
      if (arrivalsStart < 0) return point;
      const arrivals = subPoints.splice(arrivalsStart);
      const at = Math.max(0, Math.min(index, subPoints.length));
      subPoints.splice(at, 0, ...arrivals);
      return { ...point, subPoints: renumber(subPoints) };
    })
  );
}

/** A sub-point leaves its parent and becomes a point of its own. */
export function outdentSubPoint(
  outline: SermonOutline,
  subPointId: string,
  toSection: SectionKey,
  toIndex: number
): SermonOutline {
  const found = findSubPointParent(outline, subPointId);
  if (!found) return outline;
  const { section, point, index } = found;

  const subPoints = [...(point.subPoints ?? [])];
  const [moved] = subPoints.splice(index, 1);
  if (!moved) return outline;

  const sourceList = listOf(outline, section).map((p) =>
    p.id === point.id ? { ...p, subPoints: renumber(subPoints) } : p
  );
  let next = withList(outline, section, sourceList);

  const promoted: OutlinePoint = {
    id: moved.id,
    text: moved.text,
    ...(moved.note ? { note: moved.note } : {}),
  };
  const targetList = [...listOf(next, toSection)];
  targetList.splice(Math.max(0, Math.min(toIndex, targetList.length)), 0, promoted);
  next = withList(next, toSection, targetList);
  return next;
}

/** A sub-point moves under a different point, or to another slot under the same one. */
export function moveSubPoint(
  outline: SermonOutline,
  subPointId: string,
  toPointId: string,
  toIndex: number
): SermonOutline {
  const found = findSubPointParent(outline, subPointId);
  const toSection = findPointSection(outline, toPointId);
  if (!found || !toSection) return outline;

  const moved = found.point.subPoints?.[found.index];
  if (!moved) return outline;

  const sameParent = found.point.id === toPointId;
  const detached = [...(found.point.subPoints ?? [])];
  detached.splice(found.index, 1);

  const withoutMoved = withList(
    outline,
    found.section,
    listOf(outline, found.section).map((p) =>
      p.id === found.point.id ? { ...p, subPoints: renumber(detached) } : p
    )
  );

  const insertAt = sameParent && toIndex > found.index ? toIndex - 1 : toIndex;
  return withList(
    withoutMoved,
    toSection,
    listOf(withoutMoved, toSection).map((p) => {
      if (p.id !== toPointId) return p;
      const list = [...(p.subPoints ?? [])];
      list.splice(Math.max(0, Math.min(insertAt, list.length)), 0, moved);
      return { ...p, subPoints: renumber(list) };
    })
  );
}
