'use client';

import { apiClient } from '@/utils/apiClient';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { newClientId } from '@/utils/clientId';
import { resolveOwnerUid } from '@/utils/queryKeys';
import { readWithDeadline } from '@/utils/readWithDeadline';

import type { ServiceOrder } from '@/models/models';

const SERVICE_ORDERS_READ_EVENT = 'service-orders-read';

/**
 * THE SECOND WAY TO THE SAME DATABASE, for the device where the first one is silent.
 *
 * The browser's Firestore SDK is not the only road: the app's own server holds an admin key and
 * answers over ordinary HTTPS. On the owner's iPad that is the difference between nothing and
 * everything — measured on 2026-09-06 against the sermon page: zero server snapshots from the
 * SDK, 205 ms from this road, on the same device in the same minute.
 *
 * Owner-checked twice over: the server verifies the bearer token and filters by it, and the
 * answer is refused here if the signed-in account changed while the request was in the air.
 */
export async function readServiceOrdersFromServer(): Promise<ServiceOrder[]> {
  const owner = resolveOwnerUid();
  const startedAt = Date.now();
  recordDiagnostic(SERVICE_ORDERS_READ_EVENT, { source: 'http', result: 'started' });
  try {
    return await readWithDeadline(
      (async () => {
        const headers = await getAuthenticatedRequestHeaders();
        if (!headers.Authorization) {
          throw Object.assign(new Error('Authentication required'), { code: 'unauthenticated' });
        }
        const response = await apiClient(`/api/service-orders?read=${newClientId()}`, {
          headers,
          cache: 'no-store',
          category: 'crud',
          timeout: 8000,
        });
        if (!response.ok) {
          throw Object.assign(new Error('Server read failed'), {
            code:
              response.status === 403
                ? 'permission-denied'
                : response.status === 401
                  ? 'unauthenticated'
                  : 'unavailable',
          });
        }
        const value: unknown = await response.json();
        if (!Array.isArray(value)) throw new Error('Invalid service orders response');
        // The account may have changed while this was in the air; answering the new owner with
        // the old owner's rites would be worse than answering nothing.
        if (resolveOwnerUid() !== owner) {
          throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
        }
        recordDiagnostic(SERVICE_ORDERS_READ_EVENT, {
          source: 'http',
          result: 'answered',
          elapsedMs: Date.now() - startedAt,
        });
        return value as ServiceOrder[];
      })(),
      8000
    );
  } catch (error) {
    recordDiagnostic(SERVICE_ORDERS_READ_EVENT, {
      source: 'http',
      result: 'failed',
      code: diagnosticErrorCode(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/**
 * THE STANDARD SET, CREATED BY THE SERVER.
 *
 * The words are the pastor's own language and live in the app's locale files, so the ten rites
 * are built here and the server only stores them — refusing anything that is not his, and
 * creating only the rites he does not already have. Two devices pressing the button in the same
 * second therefore end with ten rites, not twenty: the server decides by the rite's own key.
 */
export async function seedServiceOrdersOnServer(
  drafts: Omit<ServiceOrder, 'id'>[]
): Promise<ServiceOrder[]> {
  const owner = resolveOwnerUid();
  const headers = await getAuthenticatedRequestHeaders();
  if (!headers.Authorization) {
    throw Object.assign(new Error('Authentication required'), { code: 'unauthenticated' });
  }
  /*
   * Checked BEFORE the request, not only after it. Acquiring a token takes a moment, and a
   * sign-in that happened inside that moment would otherwise have ten rites written into the
   * new account before anyone noticed — and writing is not something an after-the-fact check
   * can take back.
   */
  if (resolveOwnerUid() !== owner) {
    throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
  }
  const response = await apiClient('/api/service-orders', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orders: drafts }),
    cache: 'no-store',
    category: 'detail',
    timeout: 15000,
  });
  if (!response.ok) {
    throw Object.assign(new Error('Server seed failed'), {
      code:
        response.status === 403
          ? 'permission-denied'
          : response.status === 401
            ? 'unauthenticated'
            : 'unavailable',
    });
  }
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error('Invalid service orders response');
  if (resolveOwnerUid() !== owner) {
    throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
  }
  return value as ServiceOrder[];
}
