import { SECTION_KEYS } from '@/utils/outlineDnd';
import { outlineTitleConflictTarget, sermonNoteConflictTarget } from '@/utils/sermonNoteText';

import { withoutUnsignedRowOrder } from './anchoredRowPlacement';
import { equalValues, object, readField } from './fieldValues';
import { childIdentityIssues, outlineIdentityRows } from './legacyChildIdentity';

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

function untouchedRemovedChildren(before: TemplateOutline, content: TemplateOutline, placed: TemplateOutline): Set<string> {
  const live = pointParents(placed);
  const authored = new Map([...index(content).values()].flatMap(children).map(row => [row.id, row]));
  return new Set([...index(before).values()].flatMap(children)
    .filter(row => !live.has(row.id) && equalValues(row, authored.get(row.id))).map(row => row.id));
}

function projectPointHomes(rows: Map<string, Row>, placed: Map<string, Row>, homes: Map<string, string | null>,
  untouchedRemovals?: ReadonlySet<string>): boolean {
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
      // A demoted point cannot hold children. A proved removal of an untouched
      // child needs no new home, but never discard a child with authored changes.
      if (retained.some(child => !untouchedRemovals?.has(child.id))) return false;
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

const outlineLayout = (outline: TemplateOutline) => SECTION_KEYS.map(section => outline[section].map(row => [
  row.id, children(row).map(child => [child.id, child.position]),
]));
const rowWords = (outline: TemplateOutline) => SECTION_KEYS.flatMap(section => outline[section].flatMap(row =>
  [row.text, row.note, ...children(row).flatMap(child => [child.text, child.note])]));

function outlineTextEdit(before: TemplateOutline, after: TemplateOutline): boolean {
  return equalValues(outlineLayout(before), outlineLayout(after)) && !equalValues(rowWords(before), rowWords(after));
}

/** Edits without a new placement follow point identities into their saved sections. */
export function mergeOutlineContent(base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[], merge: Merge): MergeResult | null {
  const before = templateOutline(base.value), local = templateOutline(mine.value), stored = templateOutline(theirs.value);
  if (!before || !local || !stored) return null;
  const openingTopology = topology(before);
  // A sermon text edit may bundle other authored fields. Only the branch
  // whose whole placement is unchanged can carry those fields across a move.
  const contentOnly = path[0] === 'outline' ? outlineTextEdit : keepsPointHomes;
  const storedPlaces = contentOnly(before, local) && !equalValues(openingTopology, topology(stored));
  const localPlaces = !storedPlaces && contentOnly(before, stored) && !equalValues(openingTopology, topology(local));
  if (!storedPlaces && !localPlaces) return null;
  const placement = storedPlaces ? stored : local;
  const content = storedPlaces ? local : stored;
  const live = index(placement);
  const homes = changedParents(before, content, placement);
  const untouchedRemovals = path[0] === 'outline' && homes.size ? untouchedRemovedChildren(before, content, placement) : undefined;
  const review = { value: mine, conflicts: [{ path, base, mine, theirs }] };
  const project = (outline: TemplateOutline) => {
    const rows = index(outline);
    if (!projectPointHomes(rows, live, homes, untouchedRemovals)) return undefined;
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

/** Parent lists cannot independently accept the same identity at two new places. */
export function duplicatesMergedOutlineIdentity(merged: FieldValue, ...inputs: FieldValue[]): boolean {
  return childIdentityIssues(outlineIdentityRows(merged.value)).length > 0
    && inputs.every(input => templateOutline(input.value) !== undefined);
}

/** A text comparison cannot authorize choosing between competing point locations. */
export function hasAmbiguousOutlineTextMerge(merged: MergeResult): boolean {
  if (merged.conflicts.length !== 1) return false;
  const { path } = merged.conflicts[0];
  return Boolean(sermonNoteConflictTarget(path) || outlineTitleConflictTarget(path))
    && childIdentityIssues(outlineIdentityRows(merged.value.value)).length > 0;
}

/** A text choice already projected onto the saved layout needs no second outline reconstruction. */
export function usesSavedTemplateLayout(opening: unknown, proposed: unknown, current: unknown, merged: unknown): boolean {
  const before = templateOutline(opening), local = templateOutline(proposed);
  const saved = templateOutline(current), candidate = templateOutline(merged);
  if (!before || !local || !saved || !candidate) return false;
  return equalValues(outlineLayout(before), outlineLayout(local)) && equalValues(outlineLayout(saved), outlineLayout(candidate));
}

/** Keep the exact positions chosen by an outline merge when answering an outline text question. */
export function usesMergedSermonTextLayout(opening: unknown, proposed: unknown, current: unknown, merged: unknown): boolean {
  const before = templateOutline(opening), local = templateOutline(proposed);
  const saved = templateOutline(current), candidate = templateOutline(merged);
  if (!before || !local || !saved || !candidate) return false;
  const selected = outlineLayout(candidate);
  return (outlineTextEdit(before, local) && equalValues(outlineLayout(saved), selected))
    || (outlineTextEdit(before, saved) && equalValues(outlineLayout(local), selected));
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
