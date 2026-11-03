import { randomUUID } from 'node:crypto';

import { advanceResourceSnapshot } from './protocol';
import { validateResourceDocument } from './resourceSchemas';

import type { DataCommand, ResourceSnapshot } from './types';

export type ShareCapabilityCommand = Extract<DataCommand, { relation: 'share-link-create' | 'share-link-revoke' }>;

interface CapabilityPorts {
  /** The existing relation reader owns owner checks, generation admission and the scope bound. */
  readLiveNote(note: { id: string; generation: string | null }): Promise<void>;
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
    return [advanceResourceSnapshot(primary, null, command.operationId, [])];
  }

  if (primary.value || primary.metadata) ports.refuse('resource-already-exists');
  await ports.readLiveNote(command.note);
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
