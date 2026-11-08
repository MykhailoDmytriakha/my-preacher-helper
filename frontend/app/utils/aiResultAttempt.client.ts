import { v4 as uuid } from 'uuid';

import { isUsageCapReachedError } from '@/services/usageLimits';

import { AI_RESULT_CONFLICT, AI_RESULT_OPERATION_HEADER, AI_RESULT_RECOVERY_ONLY_HEADER, AI_RESULT_UNAVAILABLE } from './aiResultOperation';
import { accountChangedError } from './authenticatedRequest';
import { serializeContent } from './contentFingerprint';
import { resolveOwnerUid } from './queryKeys';

const inMemory = new Map<string, string>();
const STORAGE_PREFIX = 'mhp:ai-result-attempt:';
const TERMINAL_REFUSAL_STATUSES = new Set([400, 409, 413, 422, 429]);

function readLocal(key: string | undefined): string | null {
  if (!key) return null;
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string | undefined, value: string | null): void {
  if (!key) return;
  try {
    if (value === null) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
  } catch {
    // The current tab can still retry when storage is unavailable.
  }
}

async function storedAttemptKey(scope: string): Promise<string | undefined> {
  try {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
    return STORAGE_PREFIX + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export function aiResultErrorCode(payload: unknown): string | undefined {
  const code = (payload as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isDefiniteRefusal(status: number, payload: unknown): boolean {
  const code = aiResultErrorCode(payload);
  if (code === AI_RESULT_UNAVAILABLE || code === AI_RESULT_CONFLICT) return true;
  if ((payload as { operationEnded?: unknown } | null)?.operationEnded === true) return true;
  // A generic server error or cut-off body cannot tell whether the attempt settled.
  return TERMINAL_REFUSAL_STATUSES.has(status) && typeof (payload as { error?: unknown } | null)?.error === 'string';
}

async function findAttempt(ownerId: string | undefined, path: string, body: string) {
  const scope = ownerId ? serializeContent([ownerId, path, JSON.parse(body)]) : undefined;
  const key = scope && await storedAttemptKey(scope);
  const cacheKey = key ?? scope;
  return { key, cacheKey, previousId: cacheKey && (readLocal(key) ?? inMemory.get(cacheKey)) };
}

export async function hasAiResultAttempt(ownerId: string | undefined, path: string, body: string): Promise<boolean> {
  return Boolean((await findAttempt(ownerId, path, body)).previousId);
}

export async function beginAiResultAttempt(
  ownerId: string | undefined, path: string, body: string, { recoverOnly = false } = {},
) {
  const { key, cacheKey, previousId } = await findAttempt(ownerId, path, body);
  if (recoverOnly && !previousId) {
    throw Object.assign(new Error('No earlier AI result is available'), { code: AI_RESULT_UNAVAILABLE });
  }
  const id = previousId || uuid();
  if (cacheKey) inMemory.set(cacheKey, id);
  writeLocal(key, id);

  function acknowledge() {
    if (cacheKey && inMemory.get(cacheKey) === id) inMemory.delete(cacheKey);
    if (readLocal(key) === id) writeLocal(key, null);
  }

  function assertOwner() {
    if (resolveOwnerUid() !== ownerId) throw accountChangedError();
  }

  return {
    assertOwner,
    async request<T>(send: () => Promise<T>): Promise<T> {
      assertOwner();
      try {
        return await send();
      } catch (error) {
        if (isUsageCapReachedError(error)) acknowledge();
        throw error;
      }
    },
    headers: {
      [AI_RESULT_OPERATION_HEADER]: id,
      ...(recoverOnly ? { [AI_RESULT_RECOVERY_ONLY_HEADER]: '1' } : {}),
    },
    acknowledge,
    refused(status: number, payload: unknown) {
      if (isDefiniteRefusal(status, payload)) acknowledge();
    },
  };
}
