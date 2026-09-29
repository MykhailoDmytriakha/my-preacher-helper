import type { ResourceRef } from './types';

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
