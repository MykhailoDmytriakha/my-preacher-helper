import { marksDocumentId } from '@/utils/bibleMarksIdentity';
import { isBibleId } from '@/utils/bibles';

import type { DocumentData, ResourceSnapshot } from './types';

const object = (value: unknown): value is DocumentData => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const failure = (message: string, code: string): never => { throw Object.assign(new Error(message), { code }); };

/** An unseen fixed-ID book is a logical empty marks book, not an absent authored entity. */
export function isFirstBookMarksDraft(confirmed: ResourceSnapshot, draft: DocumentData | null): draft is DocumentData {
  return confirmed.resource.collection === 'bibleMarks' && confirmed.value === null && confirmed.metadata === null
    && draft !== null && typeof draft.userId === 'string' && isBibleId(draft.bible) && typeof draft.book === 'string'
    && object(draft.verses) && confirmed.resource.id === marksDocumentId(draft.userId, draft.bible, draft.book);
}

/**
 * First-book intent owns only the locally drawn layers. Remote-only verses and book metadata
 * stay remote-owned. Empty shared verse objects let the existing merger compare the two layers
 * separately; encoded strings/legacy arrays stay opaque and are never normalized here.
 */
export function firstBookMarksIntent(confirmed: ResourceSnapshot, draft: DocumentData | null, target: ResourceSnapshot): {
  baseline: DocumentData; value: DocumentData;
} | null {
  if (!isFirstBookMarksDraft(confirmed, draft)) return null;
  if (target.resource.collection !== confirmed.resource.collection || target.resource.id !== confirmed.resource.id) {
    return failure('The marks target identity changed', 'resource-mismatch');
  }
  if (target.metadata?.deleted) return failure('Deleted marks require a new copy', 'use-new-copy');
  if (!target.value) return null;
  if (target.value.userId !== draft.userId) return failure('The marks book belongs to another owner', 'permission-denied');
  if (target.value.bible !== draft.bible || target.value.book !== draft.book || !object(target.value.verses)) {
    return failure('The marks target is a different book', 'invalid-document');
  }
  const verses = draft.verses as DocumentData;
  const shared = Object.fromEntries(Object.keys(verses).filter(key => Object.prototype.hasOwnProperty.call(target.value!.verses, key)).map(key => [key, {}]));
  return {
    baseline: { ...copy(target.value), verses: shared },
    value: { ...copy(target.value), verses: copy(verses), ...(draft.updatedAt === undefined ? {} : { updatedAt: copy(draft.updatedAt) }) },
  };
}
