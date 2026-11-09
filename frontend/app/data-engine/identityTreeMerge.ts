import { mergeOutlineOrder } from '@/utils/outlineMergeParts';

import { equalValues, object } from './fieldValues';

import type { ConflictDetail, DocumentData, FieldValue, Json } from './types';

type MergeResult = { value: FieldValue; conflicts: ConflictDetail[] };
type MergeFields = (base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[]) => MergeResult;
interface Entry {
  full: DocumentData;
  fields: DocumentData;
  parent: string | null;
  listedChildren: boolean;
}
interface TreeIndex {
  entries: Map<string, Entry>;
  orders: Map<string | null, string[]>;
}
type ChosenEntry = Pick<Entry, 'fields' | 'parent' | 'listedChildren'>;

/** A node's identity spans the whole tree; attachment objects are not tree points. */
export function indexTree(nodes: Json[], children: string): TreeIndex | null {
  const tree: TreeIndex = { entries: new Map(), orders: new Map() };
  const pending: { nodes: Json[]; parent: string | null }[] = [{ nodes, parent: null }];
  while (pending.length) {
    const group = pending.pop()!;
    tree.orders.set(group.parent, []);
    for (const value of group.nodes) {
      if (!object(value) || typeof value.id !== 'string' || !value.id || tree.entries.has(value.id)
        || (value[children] !== undefined && !Array.isArray(value[children]))) return null;
      const { [children]: nested, ...fields } = value;
      tree.entries.set(value.id, { full: value, fields, parent: group.parent, listedChildren: Array.isArray(nested) });
      tree.orders.get(group.parent)!.push(value.id);
      if (Array.isArray(nested)) pending.push({ nodes: nested, parent: value.id });
    }
  }
  // Missing and explicitly empty child lists describe the same authored branch.
  // Children were indexed after their parents, so normalize from the leaves up.
  for (const [id, entry] of [...tree.entries].reverse()) {
    const nested = (tree.orders.get(id) ?? []).map(child => tree.entries.get(child)!.full);
    entry.full = { ...entry.fields, ...(nested.length ? { [children]: nested } : {}) };
  }
  return tree;
}

const fieldsOf = (entry: Entry | undefined): FieldValue => entry
  ? { exists: true, value: entry.fields } : { exists: false };

export function relativeOrderChanged(id: string, base: TreeIndex, side: TreeIndex, home: string | null): boolean {
  const before = base.orders.get(home) ?? [], after = side.orders.get(home) ?? [];
  const from = before.indexOf(id), to = after.indexOf(id);
  return from >= 0 && to >= 0 && before.some((other, at) => after.includes(other)
    && Math.sign(at - from) !== Math.sign(after.indexOf(other) - to));
}

/** Returns null when no cycle exists; inputs are individually acyclic. */
function parentCycle(chosen: Map<string, ChosenEntry>): string[] | null {
  const done = new Set<string>();
  for (const id of chosen.keys()) {
    if (done.has(id)) continue;
    const at = new Map<string, number>(), trail: string[] = [];
    let current: string | null = id;
    while (current !== null && chosen.has(current) && !done.has(current)) {
      if (at.has(current)) return trail.slice(at.get(current)!);
      at.set(current, trail.length);
      trail.push(current);
      current = chosen.get(current)!.parent;
    }
    trail.forEach(key => done.add(key));
  }
  return null;
}

/** A missing copy means deletion only when compared with the authored branch it saw. */
function choosePresence(id: string, start: Entry | undefined, here: Entry | undefined, there: Entry | undefined,
  base: TreeIndex, side: TreeIndex): { entry?: Entry; conflict: boolean } {
  const kept = here ?? there;
  if (!kept) return { conflict: false };
  if (!start) return { entry: kept, conflict: false };
  const changed = !equalValues(start.full, kept.full) || start.parent !== kept.parent
    || relativeOrderChanged(id, base, side, kept.parent);
  if (!changed) return { conflict: false };
  // Explicit local branch deletion is only the candidate; the complete remote
  // alternative remains in the whole-tree conflict until the person chooses.
  return { entry: here, conflict: true };
}

interface Choices {
  chosen: Map<string, ChosenEntry>;
  conflicts: ConflictDetail[];
  treeConflict: boolean;
}

function chooseEntries(b: TreeIndex, m: TreeIndex, t: TreeIndex, path: string[], merge: MergeFields): Choices {
  const chosen = new Map<string, ChosenEntry>(), conflicts: ConflictDetail[] = [];
  let treeConflict = false;
  for (const id of new Set([...b.entries.keys(), ...m.entries.keys(), ...t.entries.keys()])) {
    const start = b.entries.get(id), here = m.entries.get(id), there = t.entries.get(id);
    if (!here || !there) {
      const presence = choosePresence(id, start, here, there, b, here ? m : t);
      if (presence.conflict) treeConflict = true;
      if (presence.entry) {
        const { fields, parent, listedChildren } = presence.entry;
        chosen.set(id, { fields, parent, listedChildren });
      }
      continue;
    }
    const fields = merge(fieldsOf(start), fieldsOf(here), fieldsOf(there), [...path, `id:${id}`]);
    conflicts.push(...fields.conflicts);
    const home = merge(start ? { exists: true, value: start.parent } : { exists: false },
      { exists: true, value: here.parent }, { exists: true, value: there.parent }, [...path, `id:${id}`, '$parent']);
    if (home.conflicts.length) treeConflict = true;
    chosen.set(id, { fields: fields.value.value as DocumentData, parent: home.value.value as string | null,
      listedChildren: Boolean(start?.listedChildren || here.listedChildren || there.listedChildren) });
  }
  return { chosen, conflicts, treeConflict };
}

function isOrphaned(chosen: Map<string, ChosenEntry>, id: string): boolean {
  const seen = new Set<string>();
  let parent = chosen.get(id)!.parent;
  while (parent !== null) {
    if (seen.has(parent)) return false; // Parent cycles have their own conflict resolution.
    seen.add(parent);
    const entry = chosen.get(parent);
    if (!entry) return true;
    parent = entry.parent;
  }
  return false;
}

/** Retain the local structural alternative without replacing independently merged words. */
function restoreLocalPath(chosen: Map<string, ChosenEntry>, mine: TreeIndex, id: string): boolean {
  let current: string | null = id, changed = false;
  while (current !== null) {
    const local: Entry = mine.entries.get(current)!;
    const existing = chosen.get(current);
    if (existing) {
      if (existing.parent !== local.parent) { existing.parent = local.parent; changed = true; }
    } else {
      chosen.set(current, { fields: local.fields, parent: local.parent, listedChildren: local.listedChildren });
      changed = true;
    }
    current = local.parent;
  }
  return changed;
}

/** Deleting a destination must not consume another point that this device kept. */
function restoreOrphanedLocalPoints(chosen: Map<string, ChosenEntry>, mine: TreeIndex): boolean {
  let conflict = false;
  for (const id of [...chosen.keys()]) {
    if (mine.entries.has(id) && isOrphaned(chosen, id)) {
      restoreLocalPath(chosen, mine, id);
      conflict = true;
    }
  }
  return conflict;
}

/** Remaining orphans exist only in the remote branch that this device deleted. */
function removeOrphans(chosen: Map<string, ChosenEntry>): boolean {
  const removed = [...chosen.keys()].filter(id => isOrphaned(chosen, id));
  removed.forEach(id => chosen.delete(id));
  return removed.length > 0;
}

/** Combined home changes can cycle; retain the local paths needed for an acyclic structural alternative. */
function resolveParentCycles(chosen: Map<string, ChosenEntry>, mine: TreeIndex): { resolved: boolean; conflict: boolean } {
  let conflict = false;
  for (let pass = 0; pass <= chosen.size; pass += 1) {
    const cycle = parentCycle(chosen);
    if (!cycle) return { resolved: true, conflict };
    conflict = true;
    let progress = false;
    for (const id of cycle) {
      if (mine.entries.has(id) && restoreLocalPath(chosen, mine, id)) progress = true;
    }
    if (!progress) return { resolved: false, conflict };
  }
  return { resolved: false, conflict };
}

function groupByParent(chosen: Map<string, ChosenEntry>): Map<string | null, string[]> | null {
  const groups = new Map<string | null, string[]>();
  for (const [id, entry] of chosen) {
    if (entry.parent !== null && !chosen.has(entry.parent)) return null;
    const siblings = groups.get(entry.parent) ?? [];
    siblings.push(id);
    groups.set(entry.parent, siblings);
  }
  return groups;
}

function orderSiblings(groups: Map<string | null, string[]>, b: TreeIndex, m: TreeIndex, t: TreeIndex,
  path: string[], merge: MergeFields): { orders: Map<string | null, string[]>; conflict: boolean } {
  const orders = new Map<string | null, string[]>();
  let conflict = false;
  for (const [home, ids] of groups) {
    const wanted = new Set(ids);
    const sequence = (side: TreeIndex) => (side.orders.get(home) ?? []).filter(id => wanted.has(id));
    const bs = sequence(b), ms = sequence(m), ts = sequence(t);
    const order = merge({ exists: true, value: bs }, { exists: true, value: ms }, { exists: true, value: ts },
      [...path, '$order', home ?? '$root']);
    if (order.conflicts.length) conflict = true;
    const merged = (order.value.value as string[]).filter(id => wanted.has(id));
    // If order conflicts, local order leads; remote-only points retain their anchors.
    orders.set(home, mergeOutlineOrder(null, merged, [...ts, ...ms, ...ids], wanted));
  }
  return { orders, conflict };
}

function rebuildTree(chosen: Map<string, ChosenEntry>, orders: Map<string | null, string[]>, children: string): Json[] | null {
  const built = new Map<string, DocumentData>();
  const pending = (orders.get(null) ?? []).map(id => ({ id, after: false }));
  while (pending.length) {
    const task = pending.pop()!, entry = chosen.get(task.id)!;
    if (!task.after) {
      pending.push({ id: task.id, after: true });
      for (const id of orders.get(task.id) ?? []) pending.push({ id, after: false });
    } else {
      const nested = (orders.get(task.id) ?? []).map(id => built.get(id)!);
      built.set(task.id, { ...entry.fields, ...(nested.length || entry.listedChildren ? { [children]: nested } : {}) });
    }
  }
  return built.size === chosen.size ? (orders.get(null) ?? []).map(id => built.get(id)!) : null;
}

/**
 * Merge identity, own fields, home and order separately, then rebuild one tree.
 * Independent moves and words compose. Opposed homes, order or deletion retain
 * a whole-tree conflict; its local candidate includes independently merged words.
 * Ambiguous old input (including duplicate IDs) keeps the caller's legacy behavior.
 */
export function mergeIdentityTree(base: Json[], mine: Json[], theirs: Json[], path: string[],
  children: string, merge: MergeFields): MergeResult | null {
  const b = indexTree(base, children), m = indexTree(mine, children), t = indexTree(theirs, children);
  if (!b || !m || !t) return null;
  const { chosen, conflicts, treeConflict } = chooseEntries(b, m, t, path, merge);
  const orphanConflict = restoreOrphanedLocalPoints(chosen, m);
  const cycles = resolveParentCycles(chosen, m);
  if (!cycles.resolved) return null;
  const deletionConflict = removeOrphans(chosen);
  const groups = groupByParent(chosen);
  if (!groups) return null;
  const { orders, conflict: orderConflict } = orderSiblings(groups, b, m, t, path, merge);
  const tree = rebuildTree(chosen, orders, children);
  if (!tree) return null;
  if (treeConflict || orphanConflict || deletionConflict || cycles.conflict || orderConflict) conflicts.push({ path,
    base: { exists: true, value: base }, mine: { exists: true, value: mine }, theirs: { exists: true, value: theirs } });
  return { value: { exists: true, value: tree }, conflicts };
}
