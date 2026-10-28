import { isValidRecoveryPatch } from '@/data-engine/react.client';
import { readDraftAddress } from '@/utils/draftAddress';
import { draftKey, findDraftCopies, readDraft, type DurableDraftCopy } from '@/utils/durableDraft';

import type { ScriptureReference } from '@/models/models';

export type CommentDraftTarget = { kind: 'new'; reference: ScriptureReference | null } | { kind: 'edit'; id: string };
export type CommentDraft = { text: string; reference: ScriptureReference | null; title?: string };
export const COMMENT_DRAFT_AGGREGATE = 'comment';

/** Preserve an adopted historical payload's absent empty title for exact retirement. */
export function commentDraftValue(text: string, reference: ScriptureReference | null, title: string, restoredWithoutTitle: boolean): CommentDraft {
  return { text, reference, ...(restoredWithoutTitle && title === '' ? {} : { title }) };
}

export type RestoredCommentPlace = { openingId: string; reference: ScriptureReference };

/** A restored Bible door keeps its actual reference identity until that opening changes. */
export function commentDraftReference(target: CommentDraftTarget, restored: RestoredCommentPlace | null): ScriptureReference | null {
  if (target.kind === 'edit') return null;
  return restored && restored.openingId === target.reference?.id ? restored.reference : target.reference;
}

/** A logical door is stable across reloads; each mounted writer has its own physical address. */
export function commentDraftDocument(target: CommentDraftTarget, choosesPlace: boolean): string {
  if (target.kind === 'edit') return target.id;
  const reference = target.reference;
  if (choosesPlace || !reference?.chapter) return 'new';
  return `new:${reference.bible ?? ''}:${reference.book}:${reference.chapter}:${reference.fromVerse ?? ''}`;
}

function validDraft(value: unknown, documentId: string): value is CommentDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as CommentDraft;
  if (typeof draft.text !== 'string' || (draft.title !== undefined && typeof draft.title !== 'string')) return false;
  if (draft.reference === null) return !documentId.startsWith('new:');
  if (!isValidRecoveryPatch('studyNotes', { scriptureRefs: [{ ...draft.reference }] })) return false;
  return documentId === 'new' || (documentId.startsWith('new:')
    && commentDraftDocument({ kind: 'new', reference: draft.reference }, false) === documentId);
}

/** Read old comment keys narrowly; never reinterpret the shared legacy address grammar. */
export function findCommentDraftCopies(uid: string, documentId: string, aggregate: string): DurableDraftCopy<CommentDraft>[] {
  if (aggregate !== COMMENT_DRAFT_AGGREGATE) return [];
  const copies = findDraftCopies<unknown>(uid, documentId, aggregate)
    .flatMap(copy => validDraft(copy.value, documentId) ? [{ ...copy, value: copy.value }] : []);
  if (documentId.startsWith('new:')) {
    const key = draftKey(uid, documentId, aggregate);
    const legacy = readDraft<unknown>(key);
    // Older Bible doors put colons in a v1 document ID. Its exact physical key,
    // owner and retained reference together establish this one historical source.
    if (readDraftAddress(key)?.owner === uid && legacy && validDraft(legacy.value, documentId)) {
      copies.push({ ...legacy, value: legacy.value, key, sourceRecord: legacy });
    }
  }
  const time = (value: number) => Number.isFinite(value) ? value : 0;
  return [...new Map(copies.map(copy => [copy.key, copy])).values()]
    .sort((left, right) => time(right.savedAt) - time(left.savedAt) || left.key.localeCompare(right.key));
}
