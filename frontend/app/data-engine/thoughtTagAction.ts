import { isStructureTag } from '@/utils/structureTags';

import { boundedActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { matchesRowDetailBirth } from './rowDetailAction';
import { knownRowDetailPredecessor } from './rowDetailCapture';
import { boundedRowId, existingRowField, isRowChange, matchesRowAction, replaceExistingRowField } from './rowFieldAction';
import { encodeTagMembershipAction, isTagMembershipName, MAX_TAG_MEMBERSHIP_PROOFS } from './tagMembershipOrder';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

export type ThoughtTagAction = RowDetailObservation<boolean> & { tag: string };
export const THOUGHT_TAG_HISTORY = '_thoughtTagHistory';

export type ThoughtTagHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; fields: RowDetailHistoryEntry<string, boolean>[] }[];
};

export const ordinaryThoughtTag = (tag: unknown): tag is string =>
  isTagMembershipName(tag) && !isStructureTag(tag);

export const THOUGHT_TAG_BIRTH: RowFieldTarget<string> = {
  field: 'thoughts', leaf: 'date', accepts: (date): date is string => typeof date === 'string' && date.length <= 128,
};

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}

export function thoughtTagTarget(tag: string): RowFieldTarget<boolean> {
  return {
    field: 'thoughts', leaf: ['tags', 'string:' + tag],
    accepts: (value): value is boolean => typeof value === 'boolean',
    projection: {
      read: row => strings(row.tags)?.includes(tag),
      write: (row, present) => {
        const tags = strings(row.tags);
        if (!tags || tags.includes(tag) === present) return row;
        return { ...row, tags: present ? [...tags, tag] : tags.filter(item => item !== tag) };
      },
    },
  };
}

export function thoughtTags(rows: unknown, id: string): string[] | undefined {
  if (!Array.isArray(rows)) return undefined;
  const matches = rows.filter(row => object(row) && row.id === id);
  return matches.length === 1 && object(matches[0]) ? strings(matches[0].tags) : undefined;
}

export function thoughtTagIdentity(path: readonly string[]): { rowId: string; tag: string } | undefined {
  if (path.length !== 4 || path[0] !== 'thoughts' || !path[1].startsWith('id:') || path[2] !== 'tags' || !path[3].startsWith('string:')) return undefined;
  const rowId = path[1].slice(3), tag = path[3].slice(7);
  return boundedRowId(rowId) && ordinaryThoughtTag(tag) ? { rowId, tag } : undefined;
}

export function restoreThoughtTag(data: DocumentData, rowId: string, date: string, tag: string, shown: boolean, present: boolean): DocumentData {
  const target = thoughtTagTarget(tag);
  if (!ordinaryThoughtTag(tag) || existingRowField(data.thoughts, rowId, THOUGHT_TAG_BIRTH) !== date
    || existingRowField(data.thoughts, rowId, target) !== shown) {
    throw Object.assign(new Error('The shown tag state changed'), { code: 'decision-changed' });
  }
  return { ...data, thoughts: replaceExistingRowField(data.thoughts, rowId, present, target)! };
}

export function readThoughtTagChoice(conflict: ConflictDetail, base: DocumentData, draft: DocumentData, stored: DocumentData) {
  const identity = thoughtTagIdentity(conflict.path);
  if (!identity) return undefined;
  const { rowId, tag } = identity;
  const date = existingRowField(base.thoughts, rowId, THOUGHT_TAG_BIRTH);
  if (date === undefined || existingRowField(draft.thoughts, rowId, THOUGHT_TAG_BIRTH) !== date
    || existingRowField(stored.thoughts, rowId, THOUGHT_TAG_BIRTH) !== date) return undefined;
  const target = thoughtTagTarget(tag);
  const mine = existingRowField(draft.thoughts, rowId, target);
  const saved = existingRowField(stored.thoughts, rowId, target);
  if (mine === undefined || saved === undefined || mine === saved) return undefined;
  const row = Array.isArray(draft.thoughts) ? draft.thoughts.find(item => object(item) && item.id === rowId) : undefined;
  return object(row) && typeof row.text === 'string' ? { rowId, date, tag, mine, stored: saved, text: row.text } : undefined;
}

export function changedThoughtTagTarget(data: DocumentData, request: CommitRequest): boolean {
  return request.thoughtTagActions?.some(action => existingRowField(data.thoughts, action.rowId, THOUGHT_TAG_BIRTH) !== action.rowCreatedAt) ?? false;
}

function membershipPolicy(tag: string): RowDetailPolicy<string, boolean> {
  return { collection: 'sermons', fields: [tag], birth: THOUGHT_TAG_BIRTH, target: thoughtTagTarget,
    proofs: 'thoughtTagProofs', actions: 'thoughtTagActions', history: THOUGHT_TAG_HISTORY };
}

export function captureThoughtTagActions(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  rowId: string | undefined, captured: ActionTime | null | undefined, records: readonly CommitRequest[]): ThoughtTagAction[] | undefined {
  if (baseline.resource.collection !== 'sermons' || !baseline.metadata || baseline.metadata.deleted || !boundedRowId(rowId)) return undefined;
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return undefined;
  const opening = (predecessor ? predecessor.value : baseline.value)?.thoughts;
  const rowCreatedAt = existingRowField(opening, rowId, THOUGHT_TAG_BIRTH);
  const previous = thoughtTags(opening, rowId), next = thoughtTags(draft?.thoughts, rowId);
  if (rowCreatedAt === undefined || existingRowField(draft?.thoughts, rowId, THOUGHT_TAG_BIRTH) !== rowCreatedAt || !previous || !next) return undefined;
  const before = new Set(previous), after = new Set(next);
  const changed = [...new Set([...previous, ...next])].filter(tag => ordinaryThoughtTag(tag) && before.has(tag) !== after.has(tag));
  if (!changed.length || changed.length > MAX_TAG_MEMBERSHIP_PROOFS) return undefined;
  const requests = new Map(records.map(request => [request.id, request]));
  return changed.map(tag => {
    const present = before.has(tag);
    const predecessorOperationId = knownRowDetailPredecessor(predecessor, requests, baseline, membershipPolicy(tag),
      request => request.thoughtTagActions?.find(action => action.rowId === rowId && action.tag === tag), tag, rowId, rowCreatedAt, present, undefined);
    return { tag, rowId, rowCreatedAt, before: present, after: after.has(tag), time, observedRevision: baseline.metadata!.revision,
      ...(predecessorOperationId && { predecessorOperationId }) };
  });
}

export function matchesThoughtTag(changes: FieldChange[], action: ThoughtTagAction): boolean {
  return matchesRowDetailBirth(changes, action, THOUGHT_TAG_BIRTH) && matchesRowAction(changes, action, thoughtTagTarget(action.tag));
}

export function thoughtTagCommandActions(changes: FieldChange[], actions: readonly ThoughtTagAction[] | undefined) {
  const change = changes.find(item => isRowChange(item, THOUGHT_TAG_BIRTH));
  if (!change || !actions?.length) return [];
  return actions.flatMap(action => {
    if (!matchesThoughtTag(changes, action)) return [];
    const wire = encodeTagMembershipAction(action, thoughtTags((action.after ? change.after : change.before).value, action.rowId));
    return wire ? [wire] : [];
  });
}

export function pendingThoughtTagRebases(record: CommitRequest) {
  if (record.sequence !== 0 || !record.thoughtTagActions?.length || !record.working.value
    || record.working.metadata?.generation !== record.baseline.metadata?.generation) return [];
  const working = record.working.value.thoughts, intended = record.intended?.thoughts;
  return record.thoughtTagActions.flatMap(action => {
    const target = thoughtTagTarget(action.tag);
    return existingRowField(working, action.rowId, THOUGHT_TAG_BIRTH) === action.rowCreatedAt
      && existingRowField(intended, action.rowId, THOUGHT_TAG_BIRTH) === action.rowCreatedAt
      && equalValues(existingRowField(intended, action.rowId, target), action.after) ? [{ action, target }] : [];
  });
}
