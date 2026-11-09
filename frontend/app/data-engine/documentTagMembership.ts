import { readField } from './fieldValues';

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

export const documentTagCollection = (collection: string) => collection === 'studyNotes';
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
