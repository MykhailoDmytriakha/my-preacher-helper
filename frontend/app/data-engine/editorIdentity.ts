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
    if (!Array.isArray(parts) || typeof parts[3] !== 'string' || (parts.length === 4 && parts[1] === 'manual')) return null;
    return parts[3];
  } catch {
    return null;
  }
}

const MANUAL_CHOICE_RECOVERY = 'manual-choice-recovery';
export const MANUAL_CHOICE_RECOVERY_PREFIX = JSON.stringify([MANUAL_CHOICE_RECOVERY]).slice(0, -1) + ',';

export function manualChoiceRecoveryIdentity(chosenId: string, laterId: string): string {
  return JSON.stringify([MANUAL_CHOICE_RECOVERY, chosenId, laterId]);
}

export function isManualChoiceRecoveryIdentity(editorId: string): boolean {
  try {
    const parts: unknown = JSON.parse(editorId);
    return Array.isArray(parts) && parts.length === 3 && parts[0] === MANUAL_CHOICE_RECOVERY
      && parts.slice(1).every(part => typeof part === 'string' && part.length > 0);
  } catch {
    return false;
  }
}

const RECOVERY_SUFFIX = ':recovery:';

export function recoveryEditorIdentity(editorId: string, suffix: string): string {
  return `${editorId}${RECOVERY_SUFFIX}${suffix}`;
}

function openingEditorId(editorId: string): string {
  const split = editorId.lastIndexOf(RECOVERY_SUFFIX);
  return split > 0 && /^[a-z0-9-]+$/i.test(editorId.slice(split + RECOVERY_SUFFIX.length))
    ? editorId.slice(0, split) : editorId;
}

/** Manual Saves may belong to an explicitly recovered, still resource-bound parent. */
export function areDifferentTabManualParents(sourceId: string, recipientId: string, resource: ResourceRef): boolean {
  return areDifferentTabEditors(openingEditorId(sourceId), openingEditorId(recipientId), resource);
}

export function areSameTabManualParents(sourceId: string, recipientId: string, resource: ResourceRef): boolean {
  const tab = tabForEditor(openingEditorId(sourceId), resource);
  return tab !== null && tab === tabForEditor(openingEditorId(recipientId), resource);
}

export function manualScopeIdentity(parentEditorId: string, slot: string, suffix?: string): string {
  return JSON.stringify(suffix === undefined ? [parentEditorId, 'manual', slot] : [parentEditorId, 'manual', slot, suffix]);
}

export function readManualScopeIdentity(scopeId: string): { parentEditorId: string; slot: string } | null {
  try {
    const parts: unknown = JSON.parse(scopeId);
    if (!Array.isArray(parts) || (parts.length !== 3 && parts.length !== 4) || parts[1] !== 'manual'
      || !parts.every(part => typeof part === 'string' && part.length > 0)
      || scopeId !== manualScopeIdentity(parts[0], parts[2], parts[3])) return null;
    return { parentEditorId: parts[0], slot: parts[2] };
  } catch {
    return null;
  }
}

function tabForEditor(editorId: string, resource: ResourceRef): string | null {
  try {
    const parts: unknown = JSON.parse(editorId);
    return Array.isArray(parts) && parts.length === 5
      && parts.every(part => typeof part === 'string' && part.length > 0)
      && parts[1] === resource.collection && parts[2] === resource.id && parts[3] !== ACTION_SLOT
      ? parts[0] : null;
  } catch {
    return null;
  }
}

export function isDocumentEditor(editorId: string, resource: ResourceRef): boolean {
  return tabForEditor(openingEditorId(editorId), resource) !== null;
}

/** A cross-tab continuation needs two ordinary, fully resource-bound editor identities. */
export function areDifferentTabEditors(sourceId: string, recipientId: string, resource: ResourceRef): boolean {
  const source = tabForEditor(sourceId, resource), recipient = tabForEditor(recipientId, resource);
  return source !== null && recipient !== null && source !== recipient;
}
