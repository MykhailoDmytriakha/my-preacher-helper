import { SECTION_KEYS } from '@/utils/outlineDnd';

import { withoutUnsignedRowOrder } from './anchoredRowPlacement';
import { equalValues, object, readField } from './fieldValues';

import type { ConflictDetail, DocumentData, FieldValue, Json } from './types';
import type { SectionKey } from '@/utils/outlineDnd';

type Row = DocumentData & { id: string; text: string };
type TemplateOutline = DocumentData & Record<SectionKey, Row[]>;
type MergeResult = { value: FieldValue; conflicts: ConflictDetail[] };
type Merge = (base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[]) => MergeResult;

function templateOutline(value: unknown): TemplateOutline | undefined {
  if (!object(value)) return undefined;
  const ids = new Set<string>();
  const row = (entry: unknown): entry is Row => {
    if (!object(entry) || typeof entry.id !== 'string' || typeof entry.text !== 'string' || ids.has(entry.id)) return false;
    ids.add(entry.id);
    return true;
  };
  for (const section of SECTION_KEYS) {
    const points = value[section];
    if (!Array.isArray(points) || !points.every(point => row(point) && (point.subPoints === undefined
      || Array.isArray(point.subPoints) && point.subPoints.every(row)))) return undefined;
  }
  return value as TemplateOutline;
}

const children = (row: Row) => Array.isArray(row.subPoints) ? row.subPoints as Row[] : [];
const topology = (outline: TemplateOutline) => SECTION_KEYS.map(section => outline[section].map(row => [row.id, children(row).map(child => child.id)]));
const index = (outline: TemplateOutline) => new Map(SECTION_KEYS.flatMap(section => outline[section].map(row => [row.id, row] as const)));
const arrayField = (rows: Row[]): FieldValue => ({ exists: true, value: rows });

function pointParents(outline: TemplateOutline) {
  return new Map<string, string | null>([...index(outline).values()].flatMap(point => [
    [point.id, null] as const, ...children(point).map(row => [row.id, point.id] as const),
  ]));
}

function keepsPointHomes(before: TemplateOutline, after: TemplateOutline): boolean {
  const updated = index(after);
  const retained = new Set([...index(before).keys()].filter(id => updated.has(id)));
  if (!equalValues(positions(before, retained), positions(after, retained))) return false;
  const nextParents = pointParents(after);
  return [...pointParents(before)].every(([id, parent]) => !nextParents.has(id) || nextParents.get(id) === parent);
}

/** Align content by identity when one branch alone changed where a point lives. */
function changedParents(before: TemplateOutline, content: TemplateOutline, placed: TemplateOutline) {
  const opening = pointParents(before), authored = pointParents(content), destinations = pointParents(placed);
  const homes = new Map<string, string | null>();
  for (const [id, parent] of opening) {
    const home = destinations.get(id);
    if (authored.has(id) && home !== undefined && home !== parent
      && (home === null || !opening.has(home) || authored.has(home))) homes.set(id, home);
  }
  return homes;
}

function projectPointHomes(rows: Map<string, Row>, placed: Map<string, Row>, homes: Map<string, string | null>): boolean {
  if (!homes.size) return true;
  const arrivals = new Map<string, Row[]>(), promoted: Row[] = [];
  const arrive = (home: string, row: Row) => arrivals.set(home, [...arrivals.get(home) ?? [], row]);
  for (const row of rows.values()) {
    const original = children(row);
    const retained = original.filter(child => {
      const home = homes.get(child.id);
      if (home === undefined) return true;
      if (home === null) promoted.push(child);
      else arrive(home, child);
      return false;
    });
    const home = homes.get(row.id);
    if (typeof home === 'string') {
      // The point and its children each need their own proved destination in a two-level outline.
      if (retained.length) return false;
      const { subPoints: _children, ...point } = row;
      arrive(home, point);
      rows.delete(row.id);
    } else if (retained.length !== original.length) rows.set(row.id, { ...row, subPoints: retained });
  }
  for (const row of promoted) rows.set(row.id, row);
  for (const [id, moved] of arrivals) {
    const saved = placed.get(id)!;
    const row = rows.get(id);
    const existing = row ? children(row) : [];
    const present = new Map([...existing, ...moved].map(child => [child.id, child]));
    const savedOrder = children(saved).flatMap(child => present.get(child.id) ?? []);
    const savedIds = new Set(savedOrder.map(child => child.id));
    const subPoints = withoutUnsignedRowOrder(existing, [...savedOrder, ...existing.filter(child => !savedIds.has(child.id))]);
    rows.set(id, { ...(row ?? saved), subPoints });
  }
  return true;
}

/** Edits without a new placement follow point identities into their saved sections. */
export function mergeTemplateOutlineContent(base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[], merge: Merge): MergeResult | null {
  const before = templateOutline(base.value), local = templateOutline(mine.value), stored = templateOutline(theirs.value);
  if (!before || !local || !stored) return null;
  const openingTopology = topology(before);
  const storedPlaces = keepsPointHomes(before, local) && !equalValues(openingTopology, topology(stored));
  const localPlaces = !storedPlaces && keepsPointHomes(before, stored) && !equalValues(openingTopology, topology(local));
  if (!storedPlaces && !localPlaces) return null;
  const placement = storedPlaces ? stored : local;
  const content = storedPlaces ? local : stored;
  const live = index(placement);
  const homes = changedParents(before, content, placement);
  const review = { value: mine, conflicts: [{ path, base, mine, theirs }] };
  const project = (outline: TemplateOutline) => {
    const rows = index(outline);
    if (!projectPointHomes(rows, live, homes)) return undefined;
    return (section: SectionKey) => {
      const here = new Set(placement[section].map(row => row.id));
      const placed = placement[section].flatMap(point => rows.get(point.id) ?? []);
      // Keep deleted rows in the ancestor so a separate text edit still conflicts.
      const original = outline[section].filter(row => !live.has(row.id) || here.has(row.id)).flatMap(row => rows.get(row.id) ?? []);
      const present = new Set(original.map(row => row.id));
      return withoutUnsignedRowOrder(placed, [...original, ...placed.filter(row => !present.has(row.id))]);
    };
  };
  const opening = project(before), projected = project(content);
  if (!opening || !projected) return review;
  const value: DocumentData = {}, conflicts: ConflictDetail[] = [];
  for (const section of SECTION_KEYS) {
    const localRows = storedPlaces ? projected(section) : local[section];
    const savedRows = storedPlaces ? stored[section] : projected(section);
    const result = merge(arrayField(opening(section)), arrayField(localRows), arrayField(savedRows), [...path, section]);
    value[section] = result.value.value as Json;
    conflicts.push(...result.conflicts);
  }
  for (const field of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(stored)])) {
    if (SECTION_KEYS.some(section => section === field)) continue;
    const result = merge(readField(before, [field]), readField(local, [field]), readField(stored, [field]), [...path, field]);
    if (result.value.exists) value[field] = result.value.value as Json;
    conflicts.push(...result.conflicts);
  }
  // A competing nesting change can put a child under two parents in the section merges.
  return templateOutline(value) ? { value: { exists: true, value }, conflicts } : review;
}

/** A text choice already projected onto the saved layout needs no second outline reconstruction. */
export function usesSavedTemplateLayout(opening: unknown, proposed: unknown, current: unknown, merged: unknown): boolean {
  const before = templateOutline(opening), local = templateOutline(proposed);
  const saved = templateOutline(current), candidate = templateOutline(merged);
  if (!before || !local || !saved || !candidate) return false;
  const layout = (outline: TemplateOutline) => SECTION_KEYS.map(section => outline[section].map(row => [
    row.id, children(row).map(child => [child.id, child.position]),
  ]));
  return equalValues(layout(before), layout(local)) && equalValues(layout(saved), layout(candidate));
}

function positions(outline: TemplateOutline, retained: ReadonlySet<string>) {
  return SECTION_KEYS.map(section => outline[section].map(row => row.id).filter(id => retained.has(id)));
}

/** Ignore adds, removals and words when asking whether surviving points were rearranged. */
export function unsignedTemplatePlacementNeedsReview(opening: unknown, proposed: unknown, current: unknown, tracked: boolean): boolean {
  const before = templateOutline(opening), after = templateOutline(proposed), stored = templateOutline(current);
  if (!before || !after || !stored) return false;
  const mine = index(after), live = index(stored);
  const retained = new Set([...index(before).keys()].filter(id => mine.has(id)));
  if (equalValues(positions(before, retained), positions(after, retained))) return false;
  // An old cross-section transfer must not look like a new addition after its point was removed.
  if (SECTION_KEYS.some(section => after[section].some(row => retained.has(row.id) && !live.has(row.id)
    && !before[section].some(point => point.id === row.id)))) return true;
  const remaining = new Set([...retained].filter(id => live.has(id)));
  return tracked && !equalValues(positions(stored, remaining), positions(after, remaining));
}

/** Keep authored contents while restoring the opening homes and order of surviving points. */
export function withoutUnsignedTemplateOrder(opening: unknown, proposed: unknown): { before: TemplateOutline; after: TemplateOutline } | undefined {
  const before = templateOutline(opening), after = templateOutline(proposed);
  if (!before || !after) return undefined;
  const original = index(before), updated = index(after);
  const sectionRows = (section: SectionKey) => {
    const own = new Set(before[section].map(row => row.id));
    const sameHome = after[section].filter(row => own.has(row.id) || !original.has(row.id));
    const present = new Set(sameHome.map(row => row.id));
    const moved = before[section].flatMap(row => present.has(row.id) ? [] : updated.get(row.id) ?? []);
    return withoutUnsignedRowOrder(before[section], [...sameHome, ...moved]);
  };
  return { before, after: { ...after, introduction: sectionRows('introduction'), main: sectionRows('main'), conclusion: sectionRows('conclusion') } };
}
