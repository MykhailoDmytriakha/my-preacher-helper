'use client';

import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { resolveOwnerUid } from '@/utils/queryKeys';

import type { ServiceOrder } from '@/models/models';

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
