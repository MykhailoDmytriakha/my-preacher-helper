import { SECTION_KEYS } from '@/utils/outlineDnd';

import { equalValues, object, own } from './fieldValues';

import type { CommandResult, DataCommand, DocumentData, FieldChange, FieldValue, Json } from './types';

export const SERMON_TEXT_ROOTS = ['planText', 'outline', 'scratch'] as const;
export type SermonTextRoot = typeof SERMON_TEXT_ROOTS[number];
export type SermonTextOpenings = Record<string, number | null>;
type SermonTextLeaf = { key: string; path: string[]; value: FieldValue };
type SermonTextChange = FieldChange & { key: string };
export type CommittedSermonText = { operationId: string; changes: Pick<SermonTextChange, 'key' | 'path' | 'after'>[] };

export const isSermonTextRoot = (field: string): field is SermonTextRoot =>
  field === 'planText' || field === 'outline' || field === 'scratch';
export const sermonTextKey = (root: SermonTextRoot, id: string, birth?: string) => JSON.stringify([root, id, birth]);
export const isPlanCellPath = (path: readonly string[]) => path.length === 2 && path[0] === 'planText';
const text = (value: Json | undefined): FieldValue => typeof value === 'string' ? { exists: true, value } : { exists: false };

function rows(value: Json | undefined): DocumentData[] {
  return Array.isArray(value) ? value.filter(object) : [];
}

function* outlineNotes(value: Json | undefined) {
  if (!object(value)) return;
  for (const section of SECTION_KEYS) {
    for (const point of rows(value[section])) {
      if (typeof point.id !== 'string') continue;
      const path = ['outline', section, 'id:' + point.id];
      yield { id: point.id, path: [...path, 'note'], note: point.note };
      for (const child of rows(point.subPoints)) {
        if (typeof child.id === 'string') {
          yield { id: child.id, path: [...path, 'subPoints', 'id:' + child.id, 'note'], note: child.note };
        }
      }
    }
  }
}

/** Identity follows outline moves. Ambiguous legacy IDs do not identify an editable leaf. */
export function sermonTextLeaves(root: SermonTextRoot, value: Json | undefined): Map<string, SermonTextLeaf> {
  const leaves = new Map<string, SermonTextLeaf>();
  const seen = new Set<string>();
  const add = (key: string, path: string[], value: FieldValue) => {
    if (seen.has(key)) leaves.delete(key);
    else { seen.add(key); leaves.set(key, { key, path, value }); }
  };
  if (root === 'planText') {
    if (object(value)) {
      for (const [id, words] of Object.entries(value)) {
        if (typeof words === 'string') add(sermonTextKey(root, id), [root, id], text(words));
      }
    }
  } else if (root === 'outline') {
    for (const { id, path, note } of outlineNotes(value)) add(sermonTextKey(root, id), path, text(note));
  } else {
    for (const row of rows(value)) {
      if (typeof row.id !== 'string' || typeof row.createdAt !== 'string' || typeof row.text !== 'string') continue;
      add(sermonTextKey('scratch', row.id, row.createdAt), ['scratch', 'id:' + row.id, 'text'], text(row.text));
    }
  }
  return leaves;
}

export function changedSermonText(root: SermonTextRoot, opening: Map<string, SermonTextLeaf>, next: Map<string, SermonTextLeaf>,
  trackRemoval = false): SermonTextChange[] {
  const changes: SermonTextChange[] = [];
  const keys = root === 'planText' ? new Set([...opening.keys(), ...next.keys()]) : opening.keys();
  for (const key of keys) {
    const before = opening.get(key), after = next.get(key);
    if (root !== 'planText' && (!before || (!after && !trackRemoval))) continue;
    const beforeText = before?.value ?? text(undefined), afterText = after?.value ?? text(undefined);
    if (!equalValues(beforeText, afterText)) changes.push({ key, path: (after ?? before)!.path, before: beforeText, after: afterText });
  }
  return changes;
}

export function sermonTextChanges(changes: readonly FieldChange[]) {
  return changes.flatMap(change => {
    const root = change.path[0];
    return isSermonTextRoot(root)
      ? changedSermonText(root, sermonTextLeaves(root, change.before.value), sermonTextLeaves(root, change.after.value))
      : [];
  });
}

export function selectSermonTextOpenings(changes: readonly FieldChange[], openings: SermonTextOpenings | undefined) {
  if (!openings || !Object.keys(openings).length) return;
  const selected = sermonTextChanges(changes).filter(({ key }) => own(openings, key));
  if (selected.length) return Object.fromEntries(selected.map(({ key }) => [key, openings[key]]));
}

/** The immediate successor can adopt an ACK for a specific leaf this request demonstrably wrote. */
export function committedSermonText(command: DataCommand | null, result: Extract<CommandResult, { kind: 'acknowledged' }>): CommittedSermonText | undefined {
  const committed = result.committed;
  if (!command || command.kind !== 'update' || command.resource.collection !== 'sermons'
    || !committed || committed.generation !== command.generation || committed.operationId !== command.operationId
    || !result.snapshot.value) return;
  const value = result.snapshot.value;
  const live = new Map(SERMON_TEXT_ROOTS.filter(root => command.changes.some(change => change.path[0] === root))
    .map(root => [root, sermonTextLeaves(root, value[root])]));
  const changes = sermonTextChanges(command.changes).flatMap(({ key, path, after }) => {
    const observed = command.sermonTextOpenings && own(command.sermonTextOpenings, key)
      ? command.sermonTextOpenings[key] : command.sermonTextObservedRevision;
    // If the ACK skipped a revision, the command may only have agreed with words already saved elsewhere.
    if (observed !== committed.revision - 1) return [];
    const root = path[0];
    if (!isSermonTextRoot(root) || !equalValues(live.get(root)?.get(key)?.value ?? text(undefined), after)) return [];
    return [{ key, path, after }];
  });
  if (changes.length) return { operationId: committed.operationId, changes };
}
