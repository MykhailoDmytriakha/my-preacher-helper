import { randomUUID } from 'node:crypto';

import { advanceResourceSnapshot, isValidIdentifier } from './protocol';
import { validateResourceDocument } from './resourceSchemas';

import type { DataCommand, ResourceSnapshot } from './types';

export type ShareCapabilityCommand = Extract<DataCommand, { relation: 'share-link-create' | 'share-link-revoke' }>;

interface CapabilityPorts {
  /** The existing relation reader owns owner checks, generation admission and the scope bound. */
  readLiveNote(noteId: string): Promise<ResourceSnapshot>;
  readRevokedLinkNote(noteId: string): Promise<ResourceSnapshot | undefined>;
  listLinks(noteId: string): Promise<ResourceSnapshot[]>;
  refuse(code: string): never;
}

/** Server-owned capability effects use the ordinary command transaction and its permanent receipt. */
export async function planShareCapability(command: ShareCapabilityCommand, primary: ResourceSnapshot, ports: CapabilityPorts): Promise<ResourceSnapshot[]> {
  if (command.relation === 'share-link-revoke') {
    // Counting can add the first protocol marker to a legacy capability. An unversioned
    // observation still names this permanent exact ID; typed creation never reuses any prior ID.
    if (command.generation !== null && (primary.metadata?.generation ?? null) !== command.generation) ports.refuse('generation-mismatch');
    // A tombstone also pins an absent legacy ID. No later create may reuse that capability address.
    const retired = advanceResourceSnapshot(primary, null, command.operationId, []);
    const noteId = primary.value?.noteId;
    if (!isValidIdentifier(noteId) || typeof noteId !== 'string') return [retired];
    const note = await ports.readRevokedLinkNote(noteId);
    if (!note?.value || note.metadata?.deleted) return [retired];
    const { metadata } = advanceResourceSnapshot(note, note.value, command.operationId, []);
    return [retired, { ...note, metadata: { ...metadata!, shareRevocation: command.operationId } }];
  }

  if (primary.value || primary.metadata) ports.refuse('resource-already-exists');
  const note = await ports.readLiveNote(command.note.id);
  // A command captured before this protocol has no access observation. Only a new,
  // explicit creation may reopen access. Receipt replays never reach this branch.
  if (command.note.shareRevocation !== (note.metadata?.shareRevocation ?? null)) ports.refuse('share-link-review-required');
  if (command.note.generation !== (note.metadata?.generation ?? null)) ports.refuse('generation-mismatch');
  const active = (await ports.listLinks(command.note.id)).filter(link => link.value && !link.metadata?.deleted);
  if (active.length > 1) ports.refuse('ambiguous-share-links');
  if (active.length) {
    const existing = active[0];
    validateResourceDocument('studyNoteShareLinks', existing.value!, { kind: 'update',
      changedFields: ['ownerId', 'noteId', 'token', 'createdAt', 'viewCount', 'authorLanguage'], previous: existing.value });
    // The alias records this new action without publishing another capability. Its secondary
    // proof lets a receipt replay return today's tombstone after the real link is revoked.
    return [advanceResourceSnapshot(primary, null, command.operationId, []),
      advanceResourceSnapshot(existing, existing.value, command.operationId, [])];
  }

  const value = { ownerId: command.owner, noteId: command.note.id, token: randomUUID(),
    createdAt: new Date().toISOString(), viewCount: 0, authorLanguage: command.authorLanguage };
  validateResourceDocument('studyNoteShareLinks', value, { kind: 'create' });
  return [advanceResourceSnapshot(primary, value, command.operationId, [])];
}
