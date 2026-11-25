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

const RETIRABLE_TAB = 'retirable-v1:';
export const RETIRABLE_EDITOR_PREFIX = JSON.stringify([RETIRABLE_TAB]).slice(0, -2);

export function retirableEditorIdentity(tabId: string, resource: ResourceRef, slot: string, suffix: string): string {
  return editorIdentity(RETIRABLE_TAB + tabId, resource, slot, suffix);
}

/** Keep the five-part identity readable by older bundles. Recovery forks have their own IDs. */
export function isRetirableOrdinaryEditor(editorId: string): boolean {
  try {
    const parts: unknown = JSON.parse(openingEditorId(editorId));
    return Array.isArray(parts) && parts.length === 5
      && parts.every(part => typeof part === 'string' && part.length > 0)
      && parts[3] !== ACTION_SLOT && parts[0].startsWith(RETIRABLE_TAB);
  } catch {
    return false;
  }
}

/** The screen slot is the same for a fresh opening and its recovery forks. */
export function editorSlot(editorId: string): string | null {
  try {
    const parts: unknown = JSON.parse(openingEditorId(editorId));
    if (!Array.isArray(parts) || typeof parts[3] !== 'string' || (parts.length === 4 && parts[1] === 'manual')) return null;
    return parts[3];
  } catch {
    return null;
  }
}

const MANUAL_CHOICE_RECOVERY = 'manual-choice-recovery';
const SERMON_NOTE_CHOICE_RECOVERY = 'sermon-note-choice-recovery';
const SERMON_HEADER_CHOICE_RECOVERY = 'sermon-header-choice-recovery';
const SERMON_HEADER_RECOVERY_FORK = ':sermon-header-recovery';
const SERMON_HEADER_CHOICE_PREFIX = JSON.stringify([SERMON_HEADER_CHOICE_RECOVERY]).slice(0, -1) + ',';
export const SERMON_NOTE_CHOICE_RECOVERY_PREFIX = JSON.stringify([SERMON_NOTE_CHOICE_RECOVERY]).slice(0, -1) + ',';
export const MANUAL_CHOICE_RECOVERY_PREFIX = JSON.stringify([MANUAL_CHOICE_RECOVERY]).slice(0, -1) + ',';

export function manualChoiceRecoveryIdentity(chosenId: string, laterId: string, kind?: 'sermon-note' | 'sermon-header'): string {
  const name = kind === 'sermon-note' ? SERMON_NOTE_CHOICE_RECOVERY
    : kind === 'sermon-header' ? SERMON_HEADER_CHOICE_RECOVERY : MANUAL_CHOICE_RECOVERY;
  return JSON.stringify([name, chosenId, laterId]);
}

export function isSermonHeaderRecoveryEditor(editorId: string): boolean {
  return editorId.startsWith(SERMON_HEADER_CHOICE_PREFIX) || editorId.endsWith(SERMON_HEADER_RECOVERY_FORK);
}

export function sermonHeaderRecoveryEditorIdentity(editorId: string): string {
  return editorId.endsWith(SERMON_HEADER_RECOVERY_FORK) ? editorId : editorId + SERMON_HEADER_RECOVERY_FORK;
}

export function isManualChoiceRecoveryIdentity(editorId: string): boolean {
  if (editorId.endsWith(SERMON_HEADER_RECOVERY_FORK)) return true;
  try {
    const parts: unknown = JSON.parse(editorId);
    return Array.isArray(parts) && parts.length === 3 && (parts[0] === MANUAL_CHOICE_RECOVERY || parts[0] === SERMON_NOTE_CHOICE_RECOVERY || parts[0] === SERMON_HEADER_CHOICE_RECOVERY)
      && parts.slice(1).every(part => typeof part === 'string' && part.length > 0);
  } catch {
    return false;
  }
}

const RECOVERY_SUFFIX = ':recovery:';

export function recoveryEditorIdentity(editorId: string, suffix: string): string {
  const headerRecovery = isSermonHeaderRecoveryEditor(editorId);
  const root = headerRecovery ? openingEditorId(editorId) : editorId;
  const fork = `${root}${RECOVERY_SUFFIX}${suffix}`;
  return headerRecovery ? sermonHeaderRecoveryEditorIdentity(fork) : fork;
}

function openingEditorId(editorId: string): string {
  const base = editorId.endsWith(SERMON_HEADER_RECOVERY_FORK) ? editorId.slice(0, -SERMON_HEADER_RECOVERY_FORK.length) : editorId;
  const split = base.lastIndexOf(RECOVERY_SUFFIX);
  return split > 0 && /^[a-z0-9-]+$/i.test(base.slice(split + RECOVERY_SUFFIX.length)) ? base.slice(0, split) : base;
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

function tabForEditor(editorId: string, resource: ResourceRef, oneShot = false): string | null {
  try {
    const parts: unknown = JSON.parse(editorId);
    return Array.isArray(parts) && parts.length === 5
      && parts.every(part => typeof part === 'string' && part.length > 0)
      && parts[1] === resource.collection && parts[2] === resource.id && (parts[3] === ACTION_SLOT) === oneShot
      ? parts[0] : null;
  } catch {
    return null;
  }
}

export function isResourceActionEditor(editorId: string, resource: ResourceRef): boolean {
  return tabForEditor(openingEditorId(editorId), resource, true) !== null;
}

export function isDocumentEditor(editorId: string, resource: ResourceRef): boolean {
  return tabForEditor(openingEditorId(editorId), resource) !== null;
}

export function isDocumentEditorSlot(editorId: string, resource: ResourceRef, slot: string): boolean {
  const opening = openingEditorId(editorId);
  return tabForEditor(opening, resource) !== null && editorSlot(opening) === slot;
}

/** An editor and its manual forms or explicit recovery retain the same original opening. */
export function sharesEditorOpening(first: string, second: string): boolean {
  const root = (id: string) => openingEditorId(readManualScopeIdentity(id)?.parentEditorId ?? id);
  return root(first) === root(second);
}

/** A cross-tab continuation needs two ordinary, fully resource-bound editor identities. */
export function areDifferentTabEditors(sourceId: string, recipientId: string, resource: ResourceRef): boolean {
  const source = tabForEditor(sourceId, resource), recipient = tabForEditor(recipientId, resource);
  return source !== null && recipient !== null && source !== recipient;
}
