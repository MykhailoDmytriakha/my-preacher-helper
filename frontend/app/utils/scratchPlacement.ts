import { SECTION_KEYS, type SectionKey } from '@/utils/outlineDnd';
import { readOutlineNoteText, withOutlineNoteText, type OutlineNoteTarget } from '@/utils/sermonNoteText';
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

export interface ScratchEditLocation {
  id: string;
  place: ScratchPlace;
  pointIndex: number;
  subPointIndex: number;
}

export interface PointScratch {
  id: string;
  point: OutlinePoint | null;
  notes: ScratchNote[];
  subPoints: { id: string; subPoint: SubPoint | null; notes: ScratchNote[] }[];
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

/* ------------------------------------------------------ the old one-line reminder */

/**
 * A point or a sub-point used to keep ONE reminder, `note`: a second reminder was glued onto the first.
 * The owner's decision (2026-11-19): a reminder and a scratch note filed there are one thing — pieces,
 * several to a node. Nothing rewrites the old field in bulk (an old app version on another device may
 * still write it, so it must be read anyway): every reader sees it as one more note of its node, the
 * first one, under a fixed id. Editing and clearing it keep its own guarded path; moving it on the board
 * turns it into an ordinary note (`useScratchDataDocument`).
 */
const OUTLINE_NOTE_ID = 'outline-note:';
export const outlineNoteSketchId = (target: OutlineNoteTarget) => `${OUTLINE_NOTE_ID}${target.kind}:${target.id}`;

/** The point or sub-point whose old reminder this note id stands for; null for an ordinary note. */
export function outlineNoteTargetOf(id: string): OutlineNoteTarget | null {
  if (!id.startsWith(OUTLINE_NOTE_ID)) return null;
  const rest = id.slice(OUTLINE_NOTE_ID.length);
  const colon = rest.indexOf(':');
  const kind = rest.slice(0, colon);
  const nodeId = rest.slice(colon + 1);
  return colon > 0 && nodeId && (kind === 'point' || kind === 'subpoint') ? { kind, id: nodeId } : null;
}

/** Each non-empty old reminder as a note of its point or sub-point, in outline order. */
export function outlineNoteSketches(outline: SermonOutline | undefined): ScratchNote[] {
  const sketches: ScratchNote[] = [];
  for (const section of SECTION_KEYS) {
    for (const point of outline?.[section] ?? []) {
      if (point.note?.trim()) {
        sketches.push({ id: outlineNoteSketchId({ kind: 'point', id: point.id }), text: point.note, createdAt: '', section, outlinePointId: point.id });
      }
      for (const subPoint of sortSubPointsByPosition(point.subPoints ?? [])) {
        if (!subPoint.note?.trim()) continue;
        sketches.push({ id: outlineNoteSketchId({ kind: 'subpoint', id: subPoint.id }), text: subPoint.note, createdAt: '', section,
          outlinePointId: point.id, subPointId: subPoint.id });
      }
    }
  }
  return sketches;
}

/** A short stable hash of words, the same on every device. */
function wordsHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/**
 * The id an old reminder gets when it becomes an ordinary note: made from its node and its words, so two
 * devices turning the same reminder into a note write the same row instead of two (one person, devices
 * one after another, but an offline device catches up later); different words make a different note.
 */
export const materializedNoteId = (target: OutlineNoteTarget, text: string) => `from-outline:${target.kind}:${target.id}:${wordsHash(text.trim())}`;

/**
 * When an old reminder was written is not known; its note gets one fixed time, the same on every device,
 * so two devices writing the same converted note write the same row (a different time would conflict).
 */
export const OLD_REMINDER_CREATED_AT = '1970-01-01T00:00:00.000Z';

/**
 * Turn old one-line reminders (`outline-note:` ids) into ordinary notes of the same node: the words move
 * into a note in front of the list (they were shown first) under `materializedNoteId`, and the node's
 * `note` is cleared. A reminder already gone or emptied is skipped; a note with that id already present
 * (another device did it first) is not added twice. Returns the ids the reminders now have.
 */
export function materializeOutlineNotes(outline: SermonOutline | undefined, notes: readonly ScratchNote[],
  sketchIds: readonly string[]): { outline: SermonOutline; notes: ScratchNote[]; ids: Map<string, string> } {
  let nextOutline = outlineOrEmpty(outline);
  const made: ScratchNote[] = [];
  const ids = new Map<string, string>();
  for (const sketchId of new Set(sketchIds)) {
    const target = outlineNoteTargetOf(sketchId);
    const text = target ? readOutlineNoteText(nextOutline, target)?.text : undefined;
    const place = target ? placeOfNode(nextOutline, target) : null;
    if (!target || !text?.trim() || !place) continue;
    const cleared = withOutlineNoteText(nextOutline, target, undefined);
    if (!cleared) continue;
    nextOutline = cleared;
    const id = materializedNoteId(target, text);
    ids.set(sketchId, id);
    if (!notes.some((note) => note.id === id) && !made.some((note) => note.id === id)) made.push(scratchNoteAt(place, { id, text, createdAt: OLD_REMINDER_CREATED_AT }));
  }
  return { outline: nextOutline, notes: [...made, ...notes], ids };
}

/**
 * Scratch notes follow their nodes through an outline change, the way thoughts do (`replaceSermonOutline`
 * calls this). Read against the outline as it was, each filed note keeps its node: a moved point takes its
 * notes to its new part, a re-parented sub-point to its new point, a point nested under another becomes that
 * point's sub-point and a promoted sub-point a point — the notes with them. A removed sub-point leaves its
 * notes on its point; a removed point leaves them in the part it stood in. A removed node's old one-line
 * reminder becomes a note at that same place, so no words are lost with the node.
 */
export function scratchAfterOutlineChange(notes: readonly ScratchNote[], before: SermonOutline | undefined,
  after: SermonOutline | undefined): ScratchNote[] {
  const was = indexOutline(before);
  const now = indexOutline(after);
  /** Where a node of the old outline is now, or where its notes go when it is gone. */
  const follow = (place: ScratchPlace): ScratchPlace => {
    if (!place.section || !place.pointId) return place;
    const nodeId = place.subPointId ?? place.pointId;
    const parent = now.subPointParent.get(nodeId);
    if (parent) return { section: now.pointSection.get(parent) ?? place.section, pointId: parent, subPointId: nodeId };
    const asPoint = now.pointSection.get(nodeId);
    if (asPoint) return { section: asPoint, pointId: nodeId, subPointId: null };
    // The node is gone: a sub-point's notes go to its point (wherever it is now), a point's stay in its part.
    if (place.subPointId) return follow({ section: place.section, pointId: place.pointId, subPointId: null });
    return { section: place.section, pointId: null, subPointId: null };
  };
  const moved = notes.map((note) => {
    const shown = resolve(note, was);
    if (!shown.pointId) return note;
    const next = follow(shown);
    // Compared with what is stored, not with how it reads: a dangling id to a removed node must go too.
    if ((note.section ?? null) === next.section && (note.outlinePointId ?? null) === next.pointId
      && (note.subPointId ?? null) === next.subPointId) return note;
    const { section: _section, outlinePointId: _point, subPointId: _sub, ...rest } = note;
    return scratchNoteAt(next, rest);
  });
  const kept: ScratchNote[] = [];
  for (const sketch of outlineNoteSketches(before)) {
    const target = outlineNoteTargetOf(sketch.id)!;
    if (now.pointSection.has(target.id) || now.subPointParent.has(target.id)) continue;
    const id = materializedNoteId(target, sketch.text);
    if (moved.some((note) => note.id === id) || kept.some((note) => note.id === id)) continue;
    kept.push(scratchNoteAt(follow(resolve(sketch, was)), { id, text: sketch.text, createdAt: OLD_REMINDER_CREATED_AT }));
  }
  // A node back with the same reminder (an undo in the structure editor) takes back its converted copy —
  // only while the copy still has those very words: a copy the person has since edited is theirs now.
  const back = new Map(outlineNoteSketches(after).map((sketch) => [materializedNoteId(outlineNoteTargetOf(sketch.id)!, sketch.text), sketch.text.trim()]));
  return [...kept, ...moved].filter((note) => back.get(note.id) !== note.text.trim());
}

/** Retain only a previous editor location; a missing outline node has no live data. */
function withPreviousNode<T extends { id: string }>(nodes: readonly T[], id?: string | null, index = 0) {
  const result = nodes.map<{ id: string; node: T | null }>(node => ({ id: node.id, node }));
  if (id && !result.some(entry => entry.id === id)) {
    result.splice(Math.max(index, 0), 0, { id, node: null });
  }
  return result;
}

/**
 * Every note in its place, in the sermon's note order; points and sub-points in outline order. The old
 * one-line reminders come first in their node (`outlineNoteSketches`) unless `withOutlineNotes` is false.
 * The scratch screen can retain the open editor's previous location until its text is saved or cancelled.
 */
export function sortScratch(
  notes: readonly ScratchNote[],
  outline: SermonOutline | undefined,
  withOutlineNotes = true,
  editPlace?: ScratchEditLocation,
): SortedScratch {
  const index = indexOutline(outline);
  const all = withOutlineNotes ? [...outlineNoteSketches(outline), ...notes] : notes;
  const previous = editPlace && all.some(note => note.id === editPlace.id) ? editPlace : undefined;
  const placed = all.map(note => ({
    note,
    place: previous && note.id === previous.id ? previous.place : resolve(note, index),
  }));
  const pool = placed.filter(({ place }) => !place.section).map(({ note }) => note);
  const sections = Object.fromEntries(SECTION_KEYS.map((section) => {
    const inSection = placed.filter(({ place }) => place.section === section);
    const editedHere = previous?.place.section === section ? previous : undefined;
    const points = withPreviousNode(outline?.[section] ?? [], editedHere?.place.pointId, editedHere?.pointIndex)
      .map(({ id, node: point }) => {
        const editedPoint = editedHere?.place.pointId === id ? editedHere : undefined;
        const subPoints = withPreviousNode(sortSubPointsByPosition(point?.subPoints ?? []), editedPoint?.place.subPointId, editedPoint?.subPointIndex);
        return {
          id,
          point,
          notes: inSection.filter(({ place }) => place.pointId === id && !place.subPointId).map(({ note }) => note),
          subPoints: subPoints.map(({ id: subId, node: subPoint }) => ({
            id: subId,
            subPoint,
            notes: inSection.filter(({ place }) => place.pointId === id && place.subPointId === subId).map(({ note }) => note),
          })),
        };
      });
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

/**
 * Each outline node's own notes — a point's (without its sub-points') and each sub-point's — for the screens
 * that only show where the notes were filed (the structure page, the structure editor).
 */
export function scratchByOutlineNode(notes: readonly ScratchNote[], outline: SermonOutline | undefined): Map<string, ScratchNote[]> {
  const byNode = new Map<string, ScratchNote[]>();
  // The old one-line reminders are drawn by each node from its own live value, not from this map.
  const sorted = sortScratch(notes, outline, false);
  SECTION_KEYS.forEach((section) => sorted.sections[section].points.forEach(({ id, notes: onPoint, subPoints }) => {
    if (onPoint.length) byNode.set(id, onPoint);
    subPoints.forEach(({ id: subId, notes: onSub }) => { if (onSub.length) byNode.set(subId, onSub); });
  }));
  return byNode;
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
/** Where a note added on a point or a sub-point is filed: the node's part, point and sub-point; null when it is gone. */
export function placeOfNode(outline: SermonOutline | undefined, target: OutlineNoteTarget): ScratchPlace | null {
  const index = indexOutline(outline);
  const pointId = target.kind === 'point' ? target.id : index.subPointParent.get(target.id);
  const section = pointId ? index.pointSection.get(pointId) : undefined;
  if (!pointId || !section) return null;
  return { section, pointId, subPointId: target.kind === 'subpoint' ? target.id : null };
}

/** A new note filed on a place; the place fields only, the way `placeScratchNotes` writes them. */
export function scratchNoteAt(place: ScratchPlace, note: Omit<ScratchNote, 'section' | 'outlinePointId' | 'subPointId'>): ScratchNote {
  return { ...note, ...(place.section ? { section: place.section } : {}), ...(place.section && place.pointId ? { outlinePointId: place.pointId } : {}),
    ...(place.section && place.pointId && place.subPointId ? { subPointId: place.subPointId } : {}) };
}

export function outlineWithoutPoint(outline: SermonOutline | undefined, pointId: string): SermonOutline {
  const current = outlineOrEmpty(outline);
  const keep = (point: OutlinePoint) => point.id !== pointId;
  return { introduction: current.introduction.filter(keep), main: current.main.filter(keep), conclusion: current.conclusion.filter(keep) };
}

/** The outline without one sub-point; its notes stay on the point (`scratchAfterOutlineChange`, run by `replaceSermonOutline`). */
export function outlineWithoutSubPoint(outline: SermonOutline | undefined, subPointId: string): SermonOutline {
  const current = outlineOrEmpty(outline);
  const drop = (point: OutlinePoint): OutlinePoint => point.subPoints?.some((sub) => sub.id === subPointId)
    ? { ...point, subPoints: point.subPoints.filter((sub) => sub.id !== subPointId) } : point;
  return { introduction: current.introduction.map(drop), main: current.main.map(drop), conclusion: current.conclusion.map(drop) };
}

