'use client';

import { apiClient } from '@/utils/apiClient';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { newClientId } from '@/utils/clientId';
import { resolveOwnerUid } from '@/utils/queryKeys';
import { readWithDeadline } from '@/utils/readWithDeadline';

import type { Sermon } from '@/models/models';

const SERMON_READ_EVENT = 'sermon-read';

/** An independent, owner-checked database read when the browser SDK cannot answer. */
export async function readSermonFromServer(id: string): Promise<Sermon | undefined> {
  const owner = resolveOwnerUid();
  const controller = new AbortController();
  const startedAt = Date.now();
  recordDiagnostic(SERMON_READ_EVENT, { source: 'http', result: 'started' });
  try {
    return await readWithDeadline((async () => {
      const headers = await getAuthenticatedRequestHeaders();
      if (controller.signal.aborted) throw new Error('Read cancelled');
      if (!headers.Authorization) throw Object.assign(new Error('Authentication required'), { code: 'unauthenticated' });
      const response = await apiClient(`/api/sermons/${encodeURIComponent(id)}?read=${newClientId()}`, {
        headers, cache: 'no-store', signal: controller.signal, category: 'detail', timeout: 8000,
      });
      if (resolveOwnerUid() !== owner) throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
      if (response.status === 404) return undefined;
      if (!response.ok) throw Object.assign(new Error('Server read failed'), {
        code: response.status === 403 ? 'permission-denied' : response.status === 401 ? 'unauthenticated' : 'unavailable',
      });
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id ||
          !('userId' in value) || value.userId !== owner) throw new Error('Invalid sermon response');
      if (resolveOwnerUid() !== owner) throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
      recordDiagnostic(SERMON_READ_EVENT, { source: 'http', result: 'answered', elapsedMs: Date.now() - startedAt });
      return value as Sermon;
    })(), 8000);
  } catch (error) {
    recordDiagnostic(SERMON_READ_EVENT, { source: 'http', result: 'failed', code: diagnosticErrorCode(error), elapsedMs: Date.now() - startedAt });
    throw error;
  } finally {
    controller.abort();
  }
}
