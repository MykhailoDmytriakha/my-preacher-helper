import { newClientId } from '@/utils/clientId';
import { clearCreationDraft, draftKey, findDraftDocIds, readDraft, type DurableDraft } from '@/utils/durableDraft';

import type { StudyNote } from '@/models/models';
import type { NoteDraftPayload } from '@/models/studyNoteDraft';

export interface NewNoteDraft extends DurableDraft<NoteDraftPayload> {
  docId: string;
}

const CREATION_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/** Precreate and actual document addresses stay distinct even for the same creation. */
export function newNoteDraftId(creationId: string): string {
  return `new~${creationId}`;
}

export function newNoteCreationId(docId: string): string | null {
  const id = docId.startsWith('new~') ? docId.slice(4) : '';
  return CREATION_ID.test(id) ? id : null;
}

/** Only a local precreate draft address, never an existing server document ID. */
export function validNewNoteDraftId(value: string | null): string | null {
  return value === 'new' || (value && newNoteCreationId(value)) ? value : null;
}

export function readNewNoteDraft(uid: string, docId: string): DurableDraft<NoteDraftPayload> | null {
  const stored = readDraft<NoteDraftPayload>(draftKey(uid, docId, 'note'));
  if (!stored || !isNotePayload(stored.value)) return null;
  if (docId !== 'new' && newNoteCreationId(docId) !== stored.creationTargetId) return null;
  if (stored.creationTargetId !== undefined && (typeof stored.creationTargetId !== 'string' || !CREATION_ID.test(stored.creationTargetId))) return null;
  return stored;
}

function isNotePayload(value: NoteDraftPayload): boolean {
  return Boolean(value && typeof value.title === 'string' && typeof value.content === 'string'
    && Array.isArray(value.tags) && Array.isArray(value.scriptureRefs)
    && (value.type === 'note' || value.type === 'question'));
}

/** A blank visit is not an unfinished note. Metadata-only work still counts. */
function hasNoteWork(value: NoteDraftPayload): boolean {
  return Boolean(value.title.trim() || value.content.trim() || value.tags.length || value.scriptureRefs.length
    || value.recordingSourceIds?.length || value.dictationSourceIds?.length);
}

export function findNewNoteDrafts(
  uid: string,
  representedIds: ReadonlySet<string>,
  confirmedCreationIds: ReadonlySet<string>,
): NewNoteDraft[] {
  return findDraftDocIds(uid, 'note').flatMap(docId => {
    const stored = readNewNoteDraft(uid, docId);
    if (!stored || !hasNoteWork(stored.value)) return [];
    const target = stored.creationTargetId;
    if (target && (representedIds.has(target) || confirmedCreationIds.has(target))) return [];
    return [{ ...stored, docId }];
  });
}

/** Canonical acceptance alone retires a precreate lineage; visible pending rows cannot. */
export function retireConfirmedNewNoteDrafts(uid: string, confirmedCreationIds: ReadonlySet<string>): void {
  if (!confirmedCreationIds.size) return;
  for (const docId of findDraftDocIds(uid, 'note')) {
    const target = readNewNoteDraft(uid, docId)?.creationTargetId;
    if (target && confirmedCreationIds.has(target)) clearCreationDraft(draftKey(uid, docId, 'note'), target);
  }
}

export function newNoteDraftHref(docId: string, uid: string): string {
  return `/studies/new?draft=${encodeURIComponent(docId)}&draftOwner=${encodeURIComponent(uid)}`;
}

/** Reopening a legacy targetless source reserves one identity for this opening. */
export function reserveNewNoteCreation(uid: string | undefined, docId: string): string {
  const stored = uid ? readNewNoteDraft(uid, docId) : null;
  return stored?.creationTargetId ?? newNoteCreationId(docId) ?? newClientId();
}

export function representedNewNoteId(routeId: string, creationId: string, notes: ReadonlyArray<Pick<StudyNote, 'id'>>): string | null {
  return routeId === 'new' && notes.some(note => note.id === creationId) ? creationId : null;
}

/** URL ownership is a navigation guard; server authorization remains authoritative. */
export function canResumeNewNoteDraft(uid: string | undefined, docId: string | null, linkOwner: string | null): boolean {
  if (!uid || !docId || (linkOwner !== null && linkOwner !== uid)) return false;
  return readNewNoteDraft(uid, docId) !== null;
}
