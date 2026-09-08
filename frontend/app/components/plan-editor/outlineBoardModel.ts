import { DROP_PREFIX, type DragKind } from '@/utils/boardDnd';
import { findPointSection, findSubPointParent, movePoint, moveSubPoint, nestPointUnderPoint, nestPointUnderPointAt, outdentSubPoint, type SectionKey } from '@/utils/outlineDnd';
import { remapAfterNest, remapAfterOutdent, remapAfterSubPointReparent, type PlacementMap } from '@/utils/scratchPlacementRemap';

import type { SermonOutline } from '@/models/models';

export type DragSubject = { kind: DragKind; id: string };
const DRAG_PREFIX = { point: 'point:', sub: 'sub:', note: 'note:' } as const;
export const dragIdFor = (kind: DragKind, id: string) => `${DRAG_PREFIX[kind]}${id}`;
export function parseDragId(raw: string): DragSubject | null {
  for (const kind of ['point', 'sub', 'note'] as const) {
    if (raw.startsWith(DRAG_PREFIX[kind])) return { kind, id: raw.slice(DRAG_PREFIX[kind].length) };
  }
  return null;
}
export const intoPointDropId = (id: string) => `${DROP_PREFIX.intoPoint}${id}`;
export const gapDropId = (section: SectionKey, index: number) => `${DROP_PREFIX.gap}${section}:${index}`;
export const subGapDropId = (id: string, index: number) => `${DROP_PREFIX.subGap}${id}:${index}`;
export const sectionDropId = (section: SectionKey) => `${DROP_PREFIX.section}${section}`;

const isSection = (value: string): value is SectionKey => value === 'introduction' || value === 'main' || value === 'conclusion';
type DropTarget = { kind: 'inside'; pointId: string; index?: number } | { kind: 'section'; section: SectionKey; index: number };

/** Decode the existing target vocabulary once, before choosing a canonical move. */
function parseTarget(raw: string, outline: SermonOutline): DropTarget | null {
  if (raw.startsWith(DROP_PREFIX.intoPoint)) return { kind: 'inside', pointId: raw.slice(DROP_PREFIX.intoPoint.length) };
  if (raw.startsWith(DROP_PREFIX.subGap)) {
    const rest = raw.slice(DROP_PREFIX.subGap.length);
    const colon = rest.lastIndexOf(':');
    return colon < 0 ? null : { kind: 'inside', pointId: rest.slice(0, colon), index: Number(rest.slice(colon + 1)) };
  }
  if (raw.startsWith(DROP_PREFIX.gap)) {
    const [section, index] = raw.slice(DROP_PREFIX.gap.length).split(':');
    return isSection(section) ? { kind: 'section', section, index: Number(index) } : null;
  }
  if (raw.startsWith(DROP_PREFIX.section)) {
    const section = raw.slice(DROP_PREFIX.section.length);
    return isSection(section) ? { kind: 'section', section, index: outline[section]?.length ?? 0 } : null;
  }
  return null;
}

function moveSubject(outline: SermonOutline, subject: DragSubject, target: DropTarget) {
  if (target.kind === 'section') {
    return subject.kind === 'point'
      ? movePoint(outline, subject.id, target.section, target.index)
      : outdentSubPoint(outline, subject.id, target.section, target.index);
  }
  if (subject.kind === 'sub') return moveSubPoint(outline, subject.id, target.pointId, target.index ?? Number.MAX_SAFE_INTEGER);
  return target.index === undefined
    ? nestPointUnderPoint(outline, subject.id, target.pointId)
    : nestPointUnderPointAt(outline, subject.id, target.pointId, target.index);
}

/**
 * Derive follow-up effects from the actual before/after relationship, not from the
 * target's spelling. A card and a subpoint gap must carry the same attached notes.
 * Persistence and callback delivery remain with the board's owner.
 */
export function resolveOutlineDrop(outline: SermonOutline, subject: DragSubject, targetId: string, placements: PlacementMap = {}) {
  if (subject.kind === 'note') return null;
  const target = parseTarget(targetId, outline);
  if (!target) return null;
  const next = moveSubject(outline, subject, target);
  if (next === outline || JSON.stringify(next) === JSON.stringify(outline)) return null;

  const beforePointSection = findPointSection(outline, subject.id);
  const afterPointSection = findPointSection(next, subject.id);
  const beforeSub = findSubPointParent(outline, subject.id);
  const afterSub = findSubPointParent(next, subject.id);
  const beforePoint = beforePointSection ? outline[beforePointSection]?.find(point => point.id === subject.id) : undefined;
  const placementChanges = subject.kind === 'point' && beforePoint && afterSub
    ? remapAfterNest(placements, subject.id, afterSub.point.id, beforePoint.subPoints?.map(point => point.id) ?? [])
    : subject.kind === 'sub' && beforeSub && afterSub
      ? remapAfterSubPointReparent(placements, subject.id, afterSub.point.id)
      : subject.kind === 'sub' && beforeSub && afterPointSection
        ? remapAfterOutdent(placements, subject.id, beforeSub.point.id)
        : [];
  const movedPointTo = afterPointSection && (subject.kind === 'sub' ? beforeSub !== null : beforePointSection !== afterPointSection)
    ? afterPointSection : null;
  const subPointMove = subject.kind === 'sub' && beforeSub && afterSub && beforeSub.point.id !== afterSub.point.id
    ? { sourcePointId: beforeSub.point.id, destinationPointId: afterSub.point.id, section: afterSub.section } : null;
  return { next, placementChanges, movedPointTo, subPointMove };
}
