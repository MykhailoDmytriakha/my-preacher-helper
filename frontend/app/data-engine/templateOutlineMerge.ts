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

function keepsPointHomes(before: TemplateOutline, after: TemplateOutline): boolean {
  const updated = index(after);
  const retained = new Set([...index(before).keys()].filter(id => updated.has(id)));
  if (!equalValues(positions(before, retained), positions(after, retained))) return false;
  const parents = (outline: TemplateOutline) => new Map(SECTION_KEYS.flatMap(section => outline[section].flatMap(point => [
    [point.id, null] as const,
    ...children(point).map(row => [row.id, point.id] as const),
  ])));
  const nextParents = parents(after);
  return [...parents(before)].every(([id, parent]) => !nextParents.has(id) || nextParents.get(id) === parent);
}

/** A child still edited under its old parent belongs to the saved parent on both merge inputs. */
function childRehomes(before: TemplateOutline, local: TemplateOutline, stored: Map<string, Row>) {
  const opening = index(before), authored = index(local);
  const savedParents = new Map<string, string | null>([...stored.values()].flatMap(row => [
    [row.id, null] as const, ...children(row).map(child => [child.id, row.id] as const),
  ]));
  const homes = new Map<string, string | null>();
  for (const row of opening.values()) {
    const edited = authored.get(row.id);
    if (!edited) continue;
    for (const child of children(edited)) {
      const home = savedParents.get(child.id);
      if (home !== undefined && home !== row.id && children(row).some(original => original.id === child.id)
        && (home === null || !opening.has(home) || authored.has(home))) homes.set(child.id, home);
    }
  }
  return homes;
}

function projectChildren(rows: Map<string, Row>, stored: Map<string, Row>, homes: Map<string, string | null>): void {
  if (!homes.size) return;
  const arrivals = new Map<string, Row[]>(), promoted: Row[] = [];
  for (const row of rows.values()) {
    const original = children(row);
    const retained = original.filter(child => {
      const home = homes.get(child.id);
      if (home === undefined) return true;
      if (home === null) promoted.push(child);
      else arrivals.set(home, [...arrivals.get(home) ?? [], child]);
      return false;
    });
    if (retained.length !== original.length) rows.set(row.id, { ...row, subPoints: retained });
  }
  for (const row of promoted) rows.set(row.id, row);
  for (const [id, moved] of arrivals) {
    const saved = stored.get(id)!;
    const row = rows.get(id);
    const existing = row ? children(row) : [];
    const present = new Map([...existing, ...moved].map(child => [child.id, child]));
    const savedOrder = children(saved).flatMap(child => present.get(child.id) ?? []);
    const savedIds = new Set(savedOrder.map(child => child.id));
    const subPoints = withoutUnsignedRowOrder(existing, [...savedOrder, ...existing.filter(child => !savedIds.has(child.id))]);
    rows.set(id, { ...(row ?? saved), subPoints });
  }
}

/** Edits without a new placement follow point identities into their saved sections. */
export function mergeTemplateOutlineContent(base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[], merge: Merge): MergeResult | null {
  const before = templateOutline(base.value), local = templateOutline(mine.value), stored = templateOutline(theirs.value);
  if (!before || !local || !stored || !keepsPointHomes(before, local) || equalValues(topology(before), topology(stored))) return null;
  const live = index(stored);
  const homes = childRehomes(before, local, live);
  const project = (outline: TemplateOutline) => {
    const rows = index(outline);
    projectChildren(rows, live, homes);
    return (section: SectionKey) => {
      const here = new Set(stored[section].map(row => row.id));
      const placed = stored[section].flatMap(point => rows.get(point.id) ?? []);
      // Keep deleted rows in the ancestor so a separate text edit still conflicts.
      const original = outline[section].filter(row => !live.has(row.id) || here.has(row.id)).map(row => rows.get(row.id)!);
      const present = new Set(original.map(row => row.id));
      return withoutUnsignedRowOrder(placed, [...original, ...placed.filter(row => !present.has(row.id))]);
    };
  };
  const opening = project(before), authored = project(local);
  const value: DocumentData = {}, conflicts: ConflictDetail[] = [];
  for (const section of SECTION_KEYS) {
    const result = merge(arrayField(opening(section)), arrayField(authored(section)), arrayField(stored[section]), [...path, section]);
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
  return templateOutline(value) ? { value: { exists: true, value }, conflicts } : { value: mine, conflicts: [{ path, base, mine, theirs }] };
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
