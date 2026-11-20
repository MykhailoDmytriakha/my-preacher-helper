import { SECTION_KEYS, type SectionKey } from '@/utils/outlineDnd';
import { sortSubPointsByPosition } from '@/utils/subPoints';

import type { OutlinePoint, ScratchNote, SermonOutline, SubPoint } from '@/models/models';

/**
 * WHERE A SCRATCH NOTE LIES — the one reader of a note's place.
 *
 * A scratch note is "what I will speak about": raw material for the plan. Sorting it never merges
 * its words into the plan; the note stays a piece of its own and only gains a place, the way a
 * thought does: a part of the sermon, then optionally a point of that part and one of its
 * sub-points. No place at all is the pool (копилка).
 *
 * The outline is the truth about where a point is. A point moved to another part on another screen
 * takes its notes with it, so a note on a point reads its part from the point, not from its own
 * `section`. A note whose point was removed keeps the part it was in and lies there without a point.
 */
export interface ScratchPlace {
  section: SectionKey | null;
  pointId: string | null;
  subPointId: string | null;
}

export const POOL_PLACE: ScratchPlace = { section: null, pointId: null, subPointId: null };

export interface PointScratch {
  point: OutlinePoint;
  notes: ScratchNote[];
  subPoints: { subPoint: SubPoint; notes: ScratchNote[] }[];
}

export interface SectionScratch {
  /** Notes in the part without a point, shown above the points. */
  loose: ScratchNote[];
  points: PointScratch[];
}

export interface SortedScratch {
  pool: ScratchNote[];
  sections: Record<SectionKey, SectionScratch>;
}

const EMPTY_OUTLINE: SermonOutline = { introduction: [], main: [], conclusion: [] };

interface OutlineIndex {
  pointSection: Map<string, SectionKey>;
  subPointParent: Map<string, string>;
}

function indexOutline(outline: SermonOutline | undefined): OutlineIndex {
  const pointSection = new Map<string, SectionKey>();
  const subPointParent = new Map<string, string>();
  for (const section of SECTION_KEYS) {
    for (const point of outline?.[section] ?? []) {
      pointSection.set(point.id, section);
      for (const subPoint of point.subPoints ?? []) subPointParent.set(subPoint.id, point.id);
    }
  }
  return { pointSection, subPointParent };
}

function resolve(note: ScratchNote, index: OutlineIndex): ScratchPlace {
  const subParent = note.subPointId ? index.subPointParent.get(note.subPointId) : undefined;
  if (note.subPointId && subParent) {
    return { section: index.pointSection.get(subParent) ?? null, pointId: subParent, subPointId: note.subPointId };
  }
  const pointSection = note.outlinePointId ? index.pointSection.get(note.outlinePointId) : undefined;
  if (note.outlinePointId && pointSection) return { section: pointSection, pointId: note.outlinePointId, subPointId: null };
  if (note.section) return { section: note.section, pointId: null, subPointId: null };
  return POOL_PLACE;
}

/** The place a note is shown at, read against the outline as it is now. */
export function scratchPlaceOf(note: ScratchNote, outline: SermonOutline | undefined): ScratchPlace {
  return resolve(note, indexOutline(outline));
}

export function sameScratchPlace(a: ScratchPlace, b: ScratchPlace): boolean {
  return a.section === b.section && a.pointId === b.pointId && a.subPointId === b.subPointId;
}

/** Every note in its place, in the sermon's note order; points and sub-points in outline order. */
export function sortScratch(notes: readonly ScratchNote[], outline: SermonOutline | undefined): SortedScratch {
  const index = indexOutline(outline);
  const placed = notes.map((note) => ({ note, place: resolve(note, index) }));
  const pool = placed.filter(({ place }) => !place.section).map(({ note }) => note);
  const sections = Object.fromEntries(SECTION_KEYS.map((section) => {
    const inSection = placed.filter(({ place }) => place.section === section);
    const points = (outline?.[section] ?? []).map((point) => ({
      point,
      notes: inSection.filter(({ place }) => place.pointId === point.id && !place.subPointId).map(({ note }) => note),
      subPoints: sortSubPointsByPosition(point.subPoints ?? []).map((subPoint) => ({
        subPoint,
        notes: inSection.filter(({ place }) => place.subPointId === subPoint.id).map(({ note }) => note),
      })),
    }));
    return [section, { loose: inSection.filter(({ place }) => !place.pointId).map(({ note }) => note), points }];
  })) as Record<SectionKey, SectionScratch>;
  return { pool, sections };
}

/**
 * Give notes a new place. A container shows the sermon's one note list filtered, in that order, so
 * the moved notes land right before `beforeId` when it is given (dropped onto that note) and at the
 * end of the list otherwise — last in their new container; every other container keeps its order.
 * A note is a piece of its own: only its place fields change, never its words.
 */
export function placeScratchNotes(notes: readonly ScratchNote[], ids: readonly string[], place: ScratchPlace, beforeId?: string): ScratchNote[] {
  const moving = new Set(ids);
  const moved = ids.flatMap((id) => {
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) return [];
    const next: ScratchNote = { ...note };
    delete next.section;
    delete next.outlinePointId;
    delete next.subPointId;
    if (place.section) next.section = place.section;
    if (place.section && place.pointId) next.outlinePointId = place.pointId;
    if (place.section && place.pointId && place.subPointId) next.subPointId = place.subPointId;
    return [next];
  });
  const rest = notes.filter((note) => !moving.has(note.id));
  const at = beforeId && !moving.has(beforeId) ? rest.findIndex((note) => note.id === beforeId) : -1;
  return at < 0 ? [...rest, ...moved] : [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

export function outlineOrEmpty(outline: SermonOutline | undefined): SermonOutline {
  return {
    introduction: outline?.introduction ?? EMPTY_OUTLINE.introduction,
    main: outline?.main ?? EMPTY_OUTLINE.main,
    conclusion: outline?.conclusion ?? EMPTY_OUTLINE.conclusion,
  };
}

/** A new point at the end of a part. */
export function outlineWithPoint(outline: SermonOutline | undefined, section: SectionKey, point: { id: string; text: string }): SermonOutline {
  const current = outlineOrEmpty(outline);
  return { ...current, [section]: [...current[section], { id: point.id, text: point.text }] };
}

/** A new sub-point at the end of a point. */
export function outlineWithSubPoint(outline: SermonOutline | undefined, pointId: string, subPoint: { id: string; text: string }): SermonOutline {
  const current = outlineOrEmpty(outline);
  const add = (point: OutlinePoint): OutlinePoint => {
    if (point.id !== pointId) return point;
    const existing = point.subPoints ?? [];
    const position = existing.reduce((max, entry) => Math.max(max, entry.position), 0) + 1;
    return { ...point, subPoints: [...existing, { id: subPoint.id, text: subPoint.text, position }] };
  };
  return { introduction: current.introduction.map(add), main: current.main.map(add), conclusion: current.conclusion.map(add) };
}

/** The outline without one point; its notes keep their part (see `scratchPlaceOf`). */
/** The part a point stands in right now, or undefined when the outline no longer has it. */
export function sectionOfPoint(outline: SermonOutline | undefined, pointId: string): SectionKey | undefined {
  const current = outlineOrEmpty(outline);
  return (['introduction', 'main', 'conclusion'] as const).find((section) => current[section].some((point) => point.id === pointId));
}

export function outlineWithoutPoint(outline: SermonOutline | undefined, pointId: string): SermonOutline {
  const current = outlineOrEmpty(outline);
  const keep = (point: OutlinePoint) => point.id !== pointId;
  return { introduction: current.introduction.filter(keep), main: current.main.filter(keep), conclusion: current.conclusion.filter(keep) };
}

/** The outline without one sub-point; its notes stay on the point (see `releaseScratchFromSubPoint`). */
export function outlineWithoutSubPoint(outline: SermonOutline | undefined, subPointId: string): SermonOutline {
  const current = outlineOrEmpty(outline);
  const drop = (point: OutlinePoint): OutlinePoint => point.subPoints?.some((sub) => sub.id === subPointId)
    ? { ...point, subPoints: point.subPoints.filter((sub) => sub.id !== subPointId) } : point;
  return { introduction: current.introduction.map(drop), main: current.main.map(drop), conclusion: current.conclusion.map(drop) };
}

/** Notes on a removed sub-point stay on its point. */
export function releaseScratchFromSubPoint(notes: readonly ScratchNote[], subPointId: string): ScratchNote[] {
  return notes.map((note) => {
    if (note.subPointId !== subPointId) return note;
    const next: ScratchNote = { ...note };
    delete next.subPointId;
    return next;
  });
}

/** Notes on a removed point lose the point but stay in its part. */
export function releaseScratchFromPoint(notes: readonly ScratchNote[], pointId: string, section: SectionKey | undefined): ScratchNote[] {
  return notes.map((note) => {
    if (note.outlinePointId !== pointId) return note;
    // The point's part as the outline has it now; a point already gone leaves each note its own part.
    const next: ScratchNote = section ? { ...note, section } : { ...note };
    delete next.outlinePointId;
    delete next.subPointId;
    return next;
  });
}
