import { equalValues, readField, writeField } from './fieldValues';
import { mergeFields } from './protocol';

import type { TagMembershipAction } from './tagMembershipOrder';
import type { DocumentData, FieldChange, FieldValue } from './types';

export const DOCUMENT_TAG_HISTORY = '_tagMembershipHistory';
export const DOCUMENT_TAG_FIELD = 'tags';

export type DocumentTagHistoryEntry = {
  tag: string;
  value: boolean;
  winnerValue: boolean;
  actionTime: NonNullable<TagMembershipAction['time']>;
  winnerActionTime: NonNullable<TagMembershipAction['time']>;
};
export type DocumentTagHistoryPage = {
  owner: string;
  documentId: string;
  generation: string;
  entries: { id: string; tags: DocumentTagHistoryEntry[] }[];
  nextCursor: string | null;
};

export const documentTagCollection = (collection: string) => collection === 'studyNotes' || collection === 'prayerRequests';
export const supportedDocumentTag = (tag: unknown): tag is string =>
  typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 256;

export function tagList(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}

export function tagMembership(value: FieldValue, tag: string): boolean | undefined {
  return tagList(value.exists ? value.value : undefined)?.includes(tag);
}

export function tagField(data: DocumentData | null | undefined): FieldValue {
  return readField(data ?? {}, [DOCUMENT_TAG_FIELD]);
}

export function changeTagMembership(value: FieldValue, tag: string, present: boolean): FieldValue {
  const tags = tagList(value.exists ? value.value : undefined);
  if (!tags || tags.includes(tag) === present) return value;
  return { exists: true, value: present ? [...tags, tag] : tags.filter(item => item !== tag) };
}

export function documentTagChange(changes: readonly FieldChange[]) {
  return changes.find(change => change.path.length === 1 && change.path[0] === DOCUMENT_TAG_FIELD);
}

export function matchesDocumentTag(change: FieldChange, action: Pick<TagMembershipAction, 'tag' | 'before' | 'after'>): boolean {
  return action.before !== action.after && tagMembership(change.before, action.tag) === action.before
    && tagMembership(change.after, action.tag) === action.after;
}

export const documentTagConflictPath = (tag: string) => [DOCUMENT_TAG_FIELD, 'string:' + tag];
export function documentTagConflictName(path: readonly string[]): string | undefined {
  if (path.length !== 2 || path[0] !== DOCUMENT_TAG_FIELD || !path[1].startsWith('string:')) return undefined;
  const tag = path[1].slice(7);
  return supportedDocumentTag(tag) ? tag : undefined;
}

/** Prayer forms omit their empty tag list. Three-way membership merge still sees an empty list. */
export function mergeOptionalPrayerTags(collection: string, before: FieldValue, after: FieldValue, stored: FieldValue): FieldValue | undefined {
  if (collection !== 'prayerRequests' || (before.exists && after.exists && stored.exists)) return undefined;
  const lists = [before, after, stored].map(field => tagList(field.exists ? field.value : undefined));
  if (!lists.every((list): list is string[] => list !== undefined)) return undefined;
  const [basis, mine, theirs] = lists.map(value => ({ exists: true, value }));
  const merged = mergeFields(basis, mine, theirs, [DOCUMENT_TAG_FIELD]);
  if (merged.conflicts.length) return undefined;
  return Array.isArray(merged.value.value) && !merged.value.value.length && (!after.exists || !stored.exists)
    ? { exists: false } : merged.value;
}

export function rebaseOptionalPrayerTags(collection: string, base: DocumentData | null, draft: DocumentData | null, stored: DocumentData | null,
  merged: ReturnType<typeof mergeFields>): ReturnType<typeof mergeFields> {
  if (collection !== 'prayerRequests' || !base || !draft || !stored || !merged.value.exists || !merged.value.value) return merged;
  const before = tagField(base), after = tagField(draft);
  if (equalValues(before, after)) return merged;
  const tags = mergeOptionalPrayerTags(collection, before, after, tagField(stored));
  if (!tags) return merged;
  return { value: { exists: true, value: writeField(merged.value.value as DocumentData, [DOCUMENT_TAG_FIELD], tags) },
    conflicts: merged.conflicts.filter(({ path }) => path[0] !== DOCUMENT_TAG_FIELD) };
}
