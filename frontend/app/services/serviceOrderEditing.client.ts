'use client';

import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { resolveOwnerUid } from '@/utils/queryKeys';

import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

const HTTP_ERROR_CODES: Record<number, string> = { 400: 'invalid-argument', 401: 'unauthenticated', 403: 'permission-denied', 404: 'not-found' };

/** A write uses one transport. A timeout is indeterminate, never a reason to replay via the SDK. */
async function requestOrder(path: string, payload?: unknown, method = payload === undefined ? 'GET' : 'PATCH'): Promise<{ status: number; value: ServiceOrder }> {
  const owner = resolveOwnerUid();
  let timer: ReturnType<typeof setTimeout>;
  const controller = new AbortController();
  const operation = async () => {
    const headers = await getAuthenticatedRequestHeaders();
    if (controller.signal.aborted) throw Object.assign(new Error('Request expired'), { code: 'deadline-exceeded' });
    if (!headers.Authorization || resolveOwnerUid() !== owner) {
      throw Object.assign(new Error('Authentication required'), { code: 'unauthenticated' });
    }
    const response = await apiClient(`/api/service-orders/${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      cache: 'no-store', category: 'crud', timeout: 8000, signal: controller.signal,
    });
    const value = await response.json();
    if (resolveOwnerUid() !== owner) throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
    if (!response.ok && response.status !== 409) {
      throw Object.assign(new Error(value.error ?? 'Service order request failed'), {
        code: HTTP_ERROR_CODES[response.status] ?? 'unavailable',
      });
    }
    return { status: response.status, value: value as ServiceOrder };
  };
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Service order request timed out'), { code: 'deadline-exceeded' })); }, 10000); }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code) throw error;
    throw Object.assign(new Error('Service order transport unavailable'), { code: 'unavailable' });
  } finally { clearTimeout(timer!); }
}

export async function readServiceOrderOnServer(id: string): Promise<ServiceOrder | null> {
  try { return (await requestOrder(encodeURIComponent(id))).value; }
  catch (error) {
    if ((error as { code?: string }).code === 'not-found') return null;
    throw error;
  }
}

export async function updateServiceOrderStepsOnServer(
  id: string,
  mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null
): Promise<ServiceOrderStep[] | null> {
  let current = await readServiceOrderOnServer(id);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!current) throw Object.assign(new Error('Service order not found'), { code: 'not-found' });
    const steps = mutate(current.steps ?? []);
    if (steps === null) return null;
    const result = await requestOrder(encodeURIComponent(id), { aggregate: 'steps', expectedRevision: current.rev?.steps ?? 0, steps });
    if (result.status !== 409) return result.value.steps;
    // Only a definite CAS refusal is retried, recomputing against the newer server data.
    current = result.value;
  }
  throw Object.assign(new Error('Service order changed repeatedly'), { code: 'aborted' });
}

export async function updateServiceOrderMetaOnServer(
  id: string,
  updates: Partial<Pick<ServiceOrder, 'title' | 'summary'>>,
  expectedRevision: number | null,
  expectedBaseline: Record<string, unknown> | null
): Promise<number | null> {
  const { status, value } = await requestOrder(encodeURIComponent(id), { aggregate: 'meta', updates, expectedRevision, expectedBaseline });
  if (status === 409) throw new StaleWriteError('meta', expectedRevision ?? 0, value.rev?.meta ?? 0, { title: value.title, summary: value.summary });
  return value.rev?.meta ?? null;
}

export async function setServiceOrderRanksOnServer(ranks: { id: string; rank: number }[]): Promise<void> {
  if (ranks.length === 0) return;
  await requestOrder('placement', { ranks });
}

export async function createServiceOrderOnServer(order: Omit<ServiceOrder, 'id'>): Promise<ServiceOrder> {
  const { title, summary, steps, rank } = order;
  return (await requestOrder('custom', { title, summary, steps, rank }, 'POST')).value;
}

export async function deleteServiceOrderOnServer(id: string): Promise<void> {
  await requestOrder(encodeURIComponent(id), undefined, 'DELETE');
}
