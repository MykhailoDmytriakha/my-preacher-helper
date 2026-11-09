import { equalValues, object, writeField } from './fieldValues';
import { indexTree, relativeOrderChanged } from './identityTreeMerge';
import { boundedRowId } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { DocumentData, FieldChange, FieldValue, Json } from './types';

const ROOT = 'preparation';
const PLAN = 'exegeticalPlan';
const CHILDREN = 'children';

export type ExegeticalPointStamp = {
  nodeId: string;
  kind: 'title' | 'remove';
  observedRevision: number;
  predecessorOperationId?: string;
  time: ActionTime | null;
};

type Tree = NonNullable<ReturnType<typeof indexTree>>;
type Plan = { points: Tree; nodes: Json[] };

export type ExegeticalPointVersion = { point: DocumentData; ancestors: string[]; siblings: string[] };
export type ExegeticalPointHistoryEntry = {
  id: string; nodeId: string; value: ExegeticalPointVersion | null; winner: ExegeticalPointVersion | null; origin?: 'comparison';
};
export type ExegeticalPointHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null; entries: ExegeticalPointHistoryEntry[];
};

export function exegeticalPointConflictId(path: readonly string[]) {
  const id = path[2]?.slice(3);
  return path.length === 3 && path[0] === ROOT && path[1] === PLAN && path[2].startsWith('id:') && boundedRowId(id)
    ? id : undefined;
}

export function exegeticalPlan(preparation: unknown): Plan | undefined {
  if (!object(preparation)) return undefined;
  const nodes = preparation[PLAN];
  if (!Array.isArray(nodes)) return undefined;
  const points = indexTree(nodes, CHILDREN);
  return points ? { points, nodes } : undefined;
}

export function exegeticalPlanChange(changes: readonly FieldChange[]) {
  const change = changes.find(item => item.path.length === 1 && item.path[0] === ROOT);
  if (!change || !object(change.before.value) || !object(change.after.value)
    || equalValues(change.before.value[PLAN], change.after.value[PLAN])) return undefined;
  const opening = exegeticalPlan(change.before.value), local = exegeticalPlan(change.after.value);
  return opening && local ? { change, opening, local } : undefined;
}

function ancestors(points: Tree, parent: string | null): string[] {
  const path: string[] = [];
  while (parent !== null) {
    path.unshift(parent);
    parent = points.entries.get(parent)!.parent;
  }
  return path;
}

export function exegeticalPointVersion(plan: Plan, id: string): ExegeticalPointVersion | null {
  const found = plan.points.entries.get(id);
  return found ? { point: found.full, ancestors: ancestors(plan.points, found.parent),
    siblings: plan.points.orders.get(found.parent) ?? [] } : null;
}

function compatibleScope(plan: Plan, path: string[]) {
  return path.every((id, index) => plan.points.entries.get(id)?.parent === (path[index - 1] ?? null));
}

export function changedExegeticalPoint(opening: Plan, next: Plan, id: string): 'title' | 'remove' | undefined {
  const shown = exegeticalPointVersion(opening, id);
  if (!shown || typeof shown.point.title !== 'string' || !compatibleScope(next, shown.ancestors)) return undefined;
  const current = exegeticalPointVersion(next, id);
  if (!current) {
    // A child moved out of the removed subtree belongs to a separate structural decision.
    const branch = indexTree([shown.point], CHILDREN)!;
    return [...branch.entries.keys()].every(child => !next.points.entries.has(child)) ? 'remove' : undefined;
  }
  const home = shown.ancestors.at(-1) ?? null;
  if (!equalValues(shown.ancestors, current.ancestors) || relativeOrderChanged(id, opening.points, next.points, home)) return undefined;
  const { title: oldTitle, ...previous } = shown.point;
  const { title, ...retained } = current.point;
  return typeof title === 'string' && title !== oldTitle && equalValues(previous, retained) ? 'title' : undefined;
}

export function readExegeticalPointChoice(opening: Plan, local: Plan, stored: Plan, id: string) {
  const before = exegeticalPointVersion(opening, id);
  if (!before) return undefined;
  const mine = exegeticalPointVersion(local, id), saved = exegeticalPointVersion(stored, id);
  const localChange = changedExegeticalPoint(opening, local, id), storedChange = changedExegeticalPoint(opening, stored, id);
  const returned = localChange === 'remove' && saved
    && equalValues([saved.point, saved.ancestors], [before.point, before.ancestors]);
  if (localChange && ((storedChange && localChange !== storedChange) || returned)) return { before, mine, saved };
}

export function exegeticalPointConflict(id: string, opening: ExegeticalPointVersion, local: ExegeticalPointVersion | null,
  stored: ExegeticalPointVersion | null) {
  const field = (version: ExegeticalPointVersion | null): FieldValue => version ? { exists: true, value: version.point } : { exists: false };
  return { path: [ROOT, PLAN, 'id:' + id], base: field(opening), mine: field(local), theirs: field(stored) };
}

function insertionIndex(current: readonly Json[], version: ExegeticalPointVersion, id: string) {
  const at = version.siblings.indexOf(id);
  const left = version.siblings.slice(0, at).reverse(), right = version.siblings.slice(at + 1);
  const positions = new Map(current.map((row, index) => [(row as DocumentData).id, index]));
  const previous = left.find(sibling => positions.has(sibling));
  const following = right.find(sibling => positions.has(sibling));
  const before = previous === undefined ? -1 : positions.get(previous)!;
  const after = following === undefined ? current.length : positions.get(following)!;
  return before >= after ? undefined : following === undefined && before >= 0 ? before + 1 : after;
}

/** Replace one compatible branch, retaining its surviving sibling anchors when it has to be put back. */
export function projectExegeticalPoint(preparation: unknown, plan: Plan, id: string, path: string[],
  version: ExegeticalPointVersion | null): FieldValue | undefined {
  if (!object(preparation) || !compatibleScope(plan, path) || (version && !equalValues(version.ancestors, path))) return undefined;
  const existing = exegeticalPointVersion(plan, id);
  if (existing && !equalValues(existing.ancestors, path)) return undefined;
  if (!existing && !version) return { exists: true, value: preparation };
  if (!existing && version) {
    const restored = indexTree([version.point], CHILDREN);
    if (!restored || [...restored.entries.keys()].some(child => plan.points.entries.has(child))) return undefined;
  }
  function rewrite(nodes: Json[], depth: number): Json[] | undefined {
    if (depth === path.length) {
      if (existing) return nodes.flatMap(node => (node as DocumentData).id !== id ? [node] : version ? [version.point] : []);
      const index = insertionIndex(nodes, version!, id);
      return index === undefined ? undefined : [...nodes.slice(0, index), version!.point, ...nodes.slice(index)];
    }
    const parent = nodes.findIndex(node => (node as DocumentData).id === path[depth]);
    const row = nodes[parent] as DocumentData;
    const children = rewrite((row[CHILDREN] as Json[] | undefined) ?? [], depth + 1);
    return children && nodes.map((node, index) => index === parent ? { ...row, [CHILDREN]: children } : node);
  }
  const nodes = rewrite(plan.nodes, 0);
  return nodes && { exists: true, value: writeField(preparation, [PLAN], { exists: true, value: nodes }) };
}

/** Restore the shown point's text, or put the historical branch back when the point is absent. */
export function restoreExegeticalPoint(current: DocumentData, shown: DocumentData | null, entry: ExegeticalPointHistoryEntry): DocumentData {
  const plan = exegeticalPlan(current.preparation), opening = exegeticalPlan(shown?.preparation);
  const changed = () => Object.assign(new Error('The point has changed'), { code: 'decision-changed' });
  if (!plan || !opening) throw changed();
  const live = exegeticalPointVersion(plan, entry.nodeId), visible = exegeticalPointVersion(opening, entry.nodeId);
  if (!equalValues(live && [live.point, live.ancestors], visible && [visible.point, visible.ancestors])) throw changed();
  const restored = entry.value;
  if (!restored && !live) return current;
  const path = (restored ?? entry.winner)?.ancestors;
  if (!path || (live && !equalValues(live.ancestors, path))) throw changed();
  if (!restored && !equalValues(live?.point, entry.winner?.point)) throw changed();
  const version = live && restored ? { ...live, point: { ...live.point, title: restored.point.title } } : restored;
  const result = projectExegeticalPoint(current.preparation, plan, entry.nodeId, path, version);
  if (!result) throw changed();
  return writeField(current, [ROOT], result);
}
