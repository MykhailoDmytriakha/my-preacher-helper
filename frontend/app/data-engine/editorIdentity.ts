import { HARD_QUESTION_GROUP_CREATE } from './hardQuestionGroupCreation';

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

const leasedAtomicPrefixes = { 'analysis-reshape': 'reshape-lease-v1:', 'council-carry': 'carry-lease-v1:',
  [HARD_QUESTION_GROUP_CREATE]: 'question-group-lease-v1:' } as const;
export type LeasedAtomicAction = keyof typeof leasedAtomicPrefixes;
export const LEASED_ATOMIC_EDITOR_PREFIXES = Object.values(leasedAtomicPrefixes).map(prefix => JSON.stringify([prefix]).slice(0, -2));

export function leasedAtomicEditorId(kind: LeasedAtomicAction, leaseId: string, participantId: string): string {
  return JSON.stringify([leasedAtomicPrefixes[kind] + leaseId, kind, participantId]);
}

/** These three-part identities belong to one native batch in a new client. */
export function readLeasedAtomicAction(editorId: string): { kind: LeasedAtomicAction; leaseId: string } | null {
  if (!LEASED_ATOMIC_EDITOR_PREFIXES.some(prefix => editorId.startsWith(prefix))) return null;
  try {
    const parts: unknown = JSON.parse(editorId);
    if (!Array.isArray(parts) || parts.length !== 3 || (parts[1] !== 'analysis-reshape' && parts[1] !== 'council-carry' && parts[1] !== HARD_QUESTION_GROUP_CREATE)
      || typeof parts[2] !== 'string' || !parts[2] || typeof parts[0] !== 'string'
      || JSON.stringify(parts) !== editorId) return null;
    const kind: LeasedAtomicAction = parts[1];
    const prefix = leasedAtomicPrefixes[kind];
    if (!parts[0].startsWith(prefix)) return null;
    const leaseId = parts[0].slice(prefix.length);
    return /^[a-z0-9-]{1,80}$/i.test(leaseId) ? { kind, leaseId } : null;
  } catch {
    return null;
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
const protectedSermonRecoveries = {
  'sermon-header': { choice: 'sermon-header-choice-recovery', fork: ':sermon-header-recovery' },
  'sermon-church': { choice: 'sermon-church-choice-recovery', fork: ':sermon-church-recovery' },
  'sermon-preparation-check': { choice: 'sermon-preparation-check-choice-recovery', fork: ':sermon-preparation-check-recovery' },
  'sermon-scratch-text': { choice: 'sermon-scratch-text-choice-recovery', fork: ':sermon-scratch-text-recovery' },
  'sermon-scratch-removal': { choice: 'sermon-scratch-removal-choice-recovery', fork: ':sermon-scratch-removal-recovery' },
  'sermon-placed-sketch': { choice: 'sermon-placed-sketch-choice-recovery', fork: ':sermon-placed-sketch-recovery' },
  'sermon-amended-sketch': { choice: 'sermon-amended-sketch-choice-recovery', fork: ':sermon-amended-sketch-recovery' },
  'sermon-thought-lock': { choice: 'sermon-thought-lock-choice-recovery', fork: ':sermon-thought-lock-recovery' },
  'sermon-thought-removal': { choice: 'sermon-thought-removal-choice-recovery', fork: ':sermon-thought-removal-recovery' },
  'sermon-thought-placement': { choice: 'sermon-thought-placement-choice-recovery', fork: ':sermon-thought-placement-recovery' },
} as const;
type ProtectedSermonRecoveryKind = keyof typeof protectedSermonRecoveries;
const protectedKinds = Object.keys(protectedSermonRecoveries) as ProtectedSermonRecoveryKind[];
const choicePrefix = (choice: string) => JSON.stringify([choice]).slice(0, -1) + ',';
export const SERMON_NOTE_CHOICE_RECOVERY_PREFIX = choicePrefix(SERMON_NOTE_CHOICE_RECOVERY);
export const MANUAL_CHOICE_RECOVERY_PREFIX = choicePrefix(MANUAL_CHOICE_RECOVERY);

export function manualChoiceRecoveryIdentity(chosenId: string, laterId: string, kind?: 'sermon-note' | ProtectedSermonRecoveryKind): string {
  const name = kind === 'sermon-note' ? SERMON_NOTE_CHOICE_RECOVERY
    : kind ? protectedSermonRecoveries[kind].choice : MANUAL_CHOICE_RECOVERY;
  return JSON.stringify([name, chosenId, laterId]);
}

export function protectedSermonRecoveryKind(editorId: string): ProtectedSermonRecoveryKind | undefined {
  return protectedKinds.find(kind => {
    const protection = protectedSermonRecoveries[kind];
    return editorId.endsWith(protection.fork) || editorId.startsWith(choicePrefix(protection.choice));
  });
}

export function isSermonChoiceRecoveryIdentity(editorId: string, kind: ProtectedSermonRecoveryKind): boolean {
  return editorId.startsWith(choicePrefix(protectedSermonRecoveries[kind].choice)) && isManualChoiceRecoveryIdentity(editorId);
}

export function protectSermonRecoveryEditor(editorId: string, kind: ProtectedSermonRecoveryKind): string {
  const suffix = protectedSermonRecoveries[kind].fork;
  return editorId.endsWith(suffix) ? editorId : editorId + suffix;
}

export function isManualChoiceRecoveryIdentity(editorId: string): boolean {
  const kind = protectedSermonRecoveryKind(editorId);
  if (kind && editorId.endsWith(protectedSermonRecoveries[kind].fork)) return true;
  try {
    const parts: unknown = JSON.parse(editorId);
    return Array.isArray(parts) && parts.length === 3
      && (parts[0] === MANUAL_CHOICE_RECOVERY || parts[0] === SERMON_NOTE_CHOICE_RECOVERY
        || (kind !== undefined && parts[0] === protectedSermonRecoveries[kind].choice))
      && parts.slice(1).every(part => typeof part === 'string' && part.length > 0);
  } catch {
    return false;
  }
}

const RECOVERY_SUFFIX = ':recovery:';

export function recoveryEditorIdentity(editorId: string, suffix: string): string {
  const kind = protectedSermonRecoveryKind(editorId);
  const root = kind ? openingEditorId(editorId) : editorId;
  const fork = `${root}${RECOVERY_SUFFIX}${suffix}`;
  return kind ? protectSermonRecoveryEditor(fork, kind) : fork;
}

function openingEditorId(editorId: string): string {
  const protection = protectedSermonRecoveryKind(editorId);
  const suffix = protection ? protectedSermonRecoveries[protection].fork : undefined;
  const base = suffix && editorId.endsWith(suffix) ? editorId.slice(0, -suffix.length) : editorId;
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
