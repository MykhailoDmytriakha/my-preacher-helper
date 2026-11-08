import { isValidRecoveryPatch } from '@/data-engine/react.client';

import type { DocumentData } from '@/data-engine/types';

type RecordValue = Record<string, unknown>;

function isPlainObject(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function conflictParts(value: unknown): { payload: RecordValue; validRevision: boolean } | null {
  if (!isPlainObject(value) || !isPlainObject(value.payload)) return null;
  const revision = value.actualRevision;
  return {
    payload: value.payload,
    validRevision: typeof revision === 'number' && Number.isFinite(revision) && Number.isInteger(revision) && revision >= 0,
  };
}

/** Shared envelope check for a caller without resource-specific fields. */
export function validConflictEnvelope(value: unknown): boolean {
  return Boolean(conflictParts(value)?.validRevision);
}

function validResourceUpdate(collection: string, updates: RecordValue): boolean {
  return isValidRecoveryPatch(collection, updates as DocumentData);
}

function validOutline(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return validResourceUpdate('sermons', { outline: value });
}

function validOptionalOutline(payload: RecordValue, field: string): boolean {
  const value = payload[field];
  return value === undefined || value === null || validOutline(value);
}

function identityMatches(value: unknown, documentId: string): boolean {
  return typeof value === 'string' && value.length > 0 && value === documentId;
}

export function validPrayerCoreConflict(value: unknown, documentId: string): boolean {
  const conflict = conflictParts(value);
  if (!conflict?.validRevision) return false;
  const { payload } = conflict;
  return identityMatches(payload.id, documentId)
    && isPlainObject(payload.updates)
    && (payload.cleared === undefined || (Array.isArray(payload.cleared)
      && payload.cleared.every(field => field === 'description' || field === 'tags')))
    && validResourceUpdate('prayerRequests', payload.updates);
}

export function validPrayerStatusConflict(value: unknown, documentId: string): boolean {
  const conflict = conflictParts(value);
  if (!conflict?.validRevision) return false;
  const { payload } = conflict;
  if (!identityMatches(payload.id, documentId)) return false;
  const patch: RecordValue = { status: payload.status };
  if (payload.answerText !== undefined) patch.answerText = payload.answerText;
  return validResourceUpdate('prayerRequests', patch);
}

export function validOutlineConflict(value: unknown, _documentId: string): boolean {
  const conflict = conflictParts(value);
  if (!conflict?.validRevision) return false;
  const { payload } = conflict;
  if (!validOutline(payload.outline)) return false;
  if (!(payload.serverOutline === null || validOutline(payload.serverOutline))) return false;
  if (!validOptionalOutline(payload, 'baseOutline')) return false;
  if (payload.resolution !== undefined && payload.resolution !== 'local') return false;
  if (payload.reviewWhole !== undefined && typeof payload.reviewWhole !== 'boolean') return false;
  return true;
}

export function validTemplateConflict(value: unknown, documentId: string): boolean {
  const conflict = conflictParts(value);
  if (!conflict?.validRevision) return false;
  const { payload } = conflict;
  return identityMatches(payload.templateId, documentId)
    && typeof payload.label === 'string'
    && isPlainObject(payload.updates)
    && validResourceUpdate('planTemplates', payload.updates);
}
