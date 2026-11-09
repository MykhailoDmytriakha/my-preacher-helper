import { createHash } from 'node:crypto';

import { documentTagChange, documentTagCollection, documentTagConflictPath, tagList } from './documentTagMembership';
import { object } from './fieldValues';
import { boundedRowId, isRowChange, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { readTagMembershipName } from './tagMembershipOrder';
import { ordinaryThoughtTag, THOUGHT_TAG_BIRTH, thoughtTagTarget, thoughtTags } from './thoughtTagAction';

import type { CommandResult, ConflictDetail, DataCommand } from './types';

type Conflict = Extract<CommandResult, { kind: 'conflict' }>;
type TagReference = [actionIndex: number, values: number];
export type IndexedTagConflict = Omit<Conflict, 'conflicts'> & {
  tagPathRefs: true;
  conflicts: (ConflictDetail | TagReference)[];
};

const PART_CHARACTERS = 250_000;
const MAX_PARTS = 12;

export type SplitTagConflict = Pick<Conflict, 'kind' | 'operationId'> & { tagReceiptParts: number; tagReceiptDigest: string };

export function isSplitTagConflict(result: object): result is SplitTagConflict {
  return 'tagReceiptParts' in result;
}

export function validTagReceiptPartCount(count: unknown): count is number {
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && count <= MAX_PARTS;
}

/** Each string stays below Firestore's byte limit, including UTF-8 encoding. */
export function splitTagConflictJson(json: string): string[] | undefined {
  const parts: string[] = [];
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + PART_CHARACTERS, json.length);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(json.slice(start, end));
    if (parts.length > MAX_PARTS) return undefined;
    start = end;
  }
  return parts;
}

export const tagReceiptDigest = (json: string) => createHash('sha256').update(json).digest('base64url');

export function readTagConflictParts(parts: readonly unknown[], manifest: SplitTagConflict): IndexedTagConflict | undefined {
  if (!parts.every(part => typeof part === 'string' && part.length <= PART_CHARACTERS)) return undefined;
  const json = parts.join('');
  if (tagReceiptDigest(json) !== manifest.tagReceiptDigest) return undefined;
  try {
    const result: unknown = JSON.parse(json);
    return object(result) && result.kind === 'conflict' && result.operationId === manifest.operationId && isIndexedTagConflict(result)
      ? result : undefined;
  } catch { return undefined; }
}

export function isIndexedTagConflict(result: object): result is IndexedTagConflict {
  return 'tagPathRefs' in result && result.tagPathRefs === true;
}

function tagActionPaths(command: DataCommand): (string[] | undefined)[] {
  if (command.kind !== 'update') return [];
  if (documentTagCollection(command.resource.collection) && Array.isArray(command.tagMembershipActions)) {
    const change = documentTagChange(command.changes);
    if (!change) return [];
    const before = tagList(change.before.value), after = tagList(change.after.value);
    return command.tagMembershipActions.map(action => {
      if (!object(action) || typeof action.after !== 'boolean') return undefined;
      const tag = readTagMembershipName(action, action.after ? after : before);
      return tag ? documentTagConflictPath(tag) : undefined;
    });
  }
  if (command.resource.collection !== 'sermons' || !Array.isArray(command.thoughtTagActions)) return [];
  const change = command.changes.find(item => isRowChange(item, THOUGHT_TAG_BIRTH));
  if (!change) return [];
  return command.thoughtTagActions.map(action => {
    if (!object(action) || !boundedRowId(action.rowId) || typeof action.after !== 'boolean') return undefined;
    const tags = thoughtTags((action.after ? change.after : change.before).value, action.rowId);
    const tag = readTagMembershipName(action, tags);
    return ordinaryThoughtTag(tag) ? rowConflictPath(action.rowId, thoughtTagTarget(tag)) : undefined;
  });
}

/** A retry supplies the immutable command whose hash the server already verified. */
export function compactTagConflict(result: Conflict, command: DataCommand): IndexedTagConflict | undefined {
  const paths = new Map(tagActionPaths(command).flatMap((path, index) => path ? [[JSON.stringify(path), index] as const] : []));
  if (!paths.size) return undefined;
  let compacted = false;
  const conflicts = result.conflicts.map((conflict): ConflictDetail | TagReference => {
    const index = paths.get(JSON.stringify(conflict.path));
    const values = [conflict.base, conflict.mine, conflict.theirs];
    if (index === undefined || conflict.code !== undefined || !values.every(field => field.exists && typeof field.value === 'boolean')) return conflict;
    compacted = true;
    return [index, values.reduce((bits, field) => bits * 2 + Number(field.value), 0)];
  });
  return compacted ? { ...result, tagPathRefs: true, conflicts } : undefined;
}

export function expandTagConflict(result: IndexedTagConflict, command: DataCommand): Conflict | undefined {
  if (result.kind !== 'conflict' || !Array.isArray(result.conflicts)) return undefined;
  const paths = tagActionPaths(command), conflicts: ConflictDetail[] = [];
  for (const entry of result.conflicts) {
    if (!Array.isArray(entry)) {
      if (!entry || !Array.isArray(entry.path)) return undefined;
      conflicts.push(entry);
      continue;
    }
    const [index, values] = entry;
    const path = Number.isSafeInteger(index) && index >= 0 ? paths[index] : undefined;
    if (entry.length !== 2 || !path || !Number.isSafeInteger(values) || values < 0 || values > 7) return undefined;
    conflicts.push({ path, base: rowConflictValue(Boolean(values & 4)), mine: rowConflictValue(Boolean(values & 2)), theirs: rowConflictValue(Boolean(values & 1)) });
  }
  return { kind: 'conflict', operationId: result.operationId, snapshot: result.snapshot, conflicts };
}
