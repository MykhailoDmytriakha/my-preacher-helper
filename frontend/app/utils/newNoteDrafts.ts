import { discoverLegacyRecovery, isValidRecoveryPatch, type LegacyRecoverySource } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { compareDraftCopies, findDraftCopies, findDraftDocIds, type DurableDraftCopy } from '@/utils/durableDraft';

import type { DocumentData } from '@/data-engine/types';
import type { StudyNote } from '@/models/models';
import type { NoteDraftPayload } from '@/models/studyNoteDraft';

export interface NewNoteDraft extends DurableDraftCopy<NoteDraftPayload> {
  docId: string;
  /** A known created destination is readable, never a fresh create. */
  created?: boolean;
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

/** All independent openings of this precreate source, including its old shared copy. */
export function readNewNoteDraftCopies(uid: string, docId: string): NewNoteDraft[] {
  return readNewNoteSources(uid, docId).flatMap(stored => isNotePayload(stored.value)
    ? [{ ...stored, value: stored.value, docId }] : []);
}

function validPrecreateLineage(docId: string, target: unknown): boolean {
  if (!validNewNoteDraftId(docId)) return false;
  if (docId !== 'new' && newNoteCreationId(docId) !== target) return false;
  return target === undefined || (typeof target === 'string' && CREATION_ID.test(target));
}

/** Ownership can permit reading an invalid source, never applying its payload. */
function readNewNoteSources(uid: string, docId: string): DurableDraftCopy<unknown>[] {
  return findDraftCopies<unknown>(uid, docId, 'note').filter(copy => validPrecreateLineage(docId, copy.creationTargetId));
}

/** A selected copy supplies creation identity; list order is only presentation. */
export function readNewNoteDraft(uid: string, docId: string, selectedKey?: string | null): NewNoteDraft | null {
  const copies = readNewNoteDraftCopies(uid, docId);
  return (selectedKey ? copies.find(copy => copy.key === selectedKey) : copies[0]) ?? null;
}

function isNotePayload(value: unknown): value is NoteDraftPayload {
  if (!value || typeof value !== 'object') return false;
  const note = value as NoteDraftPayload;
  if (typeof note.title !== 'string' || typeof note.content !== 'string'
    || !Array.isArray(note.tags) || !Array.isArray(note.scriptureRefs)
    || (note.type !== 'note' && note.type !== 'question')) return false;
  // Reuse the canonical field rules without treating partial backup text as a
  // complete document or applying server storage limits to its authored body.
  const fields = ['tags', 'scriptureRefs', 'dictationSourceIds', 'recordingSourceIds']
    .filter(field => Object.prototype.hasOwnProperty.call(note, field));
  const metadata = Object.fromEntries(fields.map(field => [field, (note as unknown as Record<string, unknown>)[field]])) as DocumentData;
  return isValidRecoveryPatch('studyNotes', metadata);
}

/** A blank visit is not an unfinished note. Metadata-only work still counts. */
function hasNoteWork(value: NoteDraftPayload): boolean {
  return Boolean(value.title.trim() || value.content.trim() || value.tags.length || value.scriptureRefs.length
    || value.recordingSourceIds?.length || value.dictationSourceIds?.length);
}

export function findNewNoteDrafts(uid: string, representedIds: ReadonlySet<string>, confirmedCreationIds: ReadonlySet<string>): NewNoteDraft[] {
  return findDraftDocIds(uid, 'note').flatMap(docId => readNewNoteDraftCopies(uid, docId).flatMap(stored => {
    if (!hasNoteWork(stored.value)) return [];
    const target = stored.creationTargetId;
    if (target && representedIds.has(target)) return [];
    return [{ ...stored, created: Boolean(target && confirmedCreationIds.has(target)) }];
  }));
}

/** A created note also owns unfinished precreate copies; existence never retires unknown words. */
export function findNoteDraftCopies(uid: string, docId: string, aggregate: string): DurableDraftCopy<NoteDraftPayload>[] {
  if (aggregate !== 'note') return [];
  if (validNewNoteDraftId(docId)) return readNewNoteDraftCopies(uid, docId);
  const current = findDraftCopies<NoteDraftPayload>(uid, docId, aggregate).filter(copy => isNotePayload(copy.value));
  const sources = [newNoteDraftId(docId), 'new'].flatMap(source => readNewNoteDraftCopies(uid, source))
    .filter(copy => copy.creationTargetId === docId);
  return [...new Map([...current, ...sources].map(copy => [copy.key, copy])).values()].sort(compareDraftCopies);
}

/** Exact original bytes stay available even when a payload cannot enter an editor. */
export function findUnreadableNoteDraftCopies(uid: string, docId?: string): LegacyRecoverySource[] {
  return discoverLegacyRecovery(uid).filter(source => {
    if (source.kind !== 'draft' || source.aggregate !== 'note') return false;
    const payload = source.payload as { value?: unknown; creationTargetId?: unknown };
    const invalid = !isNotePayload(payload.value)
      || (Boolean(validNewNoteDraftId(source.documentId)) && !validPrecreateLineage(source.documentId, payload.creationTargetId));
    if (!invalid) return false;
    if (!docId || source.documentId === docId) return true;
    return payload.creationTargetId === docId && (source.documentId === newNoteDraftId(docId) || source.documentId === 'new');
  });
}

export function newNoteDraftHref(docId: string, uid: string, selectedKey?: string, createdTargetId?: string): string {
  const destination = createdTargetId ? `/studies/${encodeURIComponent(createdTargetId)}`
    : `/studies/new?draft=${encodeURIComponent(docId)}&draftOwner=${encodeURIComponent(uid)}`;
  return selectedKey ? `${destination}${createdTargetId ? '?' : '&'}draftCopy=${encodeURIComponent(selectedKey)}` : destination;
}

/** Reopening a legacy targetless source reserves one identity for this opening. */
export function reserveNewNoteCreation(uid: string | undefined, docId: string, selectedKey?: string | null): string {
  const sources = uid ? readNewNoteSources(uid, docId) : [];
  const stored = selectedKey ? sources.find(copy => copy.key === selectedKey) : sources[0];
  return stored?.creationTargetId ?? newNoteCreationId(docId) ?? newClientId();
}

export function representedNewNoteId(routeId: string, creationId: string, notes: ReadonlyArray<Pick<StudyNote, 'id'>>, confirmedCreationIds?: ReadonlySet<string>): string | null {
  return routeId === 'new' && (notes.some(note => note.id === creationId) || confirmedCreationIds?.has(creationId)) ? creationId : null;
}

/** URL ownership is a navigation guard; server authorization remains authoritative. */
export function canResumeNewNoteDraft(uid: string | undefined, docId: string | null, linkOwner: string | null, selectedKey?: string | null): boolean {
  if (!uid || !docId || (linkOwner !== null && linkOwner !== uid)) return false;
  const sources = readNewNoteSources(uid, docId);
  return selectedKey ? sources.some(copy => copy.key === selectedKey) : sources.length > 0;
}
