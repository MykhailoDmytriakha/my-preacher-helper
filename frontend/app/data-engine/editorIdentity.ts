import type { ResourceRef } from './types';

/** Reserved for transient document actions that have no answering screen. */
export const ACTION_SLOT = 'action';

/**
 * AN EDITOR'S IDENTITY — which tab opened it, for which document, under which slot, with a fresh
 * suffix per opening. Built and read here only, so what kind of editor left a checkpoint is never
 * guessed from a string shape somewhere else.
 */
export function editorIdentity(tabId: string, resource: ResourceRef, slot: string, suffix: string): string {
  return JSON.stringify([tabId, resource.collection, resource.id, slot, suffix]);
}

/** The slot an editor identity was opened under; null for a recovery fork or any other shape. */
export function editorSlot(editorId: string): string | null {
  try {
    const parts: unknown = JSON.parse(editorId);
    return Array.isArray(parts) && typeof parts[3] === 'string' ? parts[3] : null;
  } catch {
    return null;
  }
}

/** A cross-tab continuation needs two ordinary, fully resource-bound editor identities. */
export function areDifferentTabEditors(sourceId: string, recipientId: string, resource: ResourceRef): boolean {
  const matches = (id: string): boolean => {
    try {
      const parts: unknown = JSON.parse(id);
      return Array.isArray(parts) && parts.length === 5
        && parts.every(part => typeof part === 'string' && part.length > 0)
        && parts[1] === resource.collection && parts[2] === resource.id && parts[3] !== ACTION_SLOT;
    } catch { return false; }
  };
  return sourceId !== recipientId && matches(sourceId) && matches(recipientId)
    && (JSON.parse(sourceId) as string[])[0] !== (JSON.parse(recipientId) as string[])[0];
}
