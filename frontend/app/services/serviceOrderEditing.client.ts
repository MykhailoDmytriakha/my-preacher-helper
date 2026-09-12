'use client';

import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';

import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

const SERVICE_ORDER_MESSAGES = {
  failed: 'Service order request failed',
  timedOut: 'Service order request timed out',
  unavailable: 'Service order transport unavailable',
};

/**
 * The shared owner transport with this section's words. Everything that made this road safe on
 * the iPad — one transport per write, a timeout that is never replayed, the owner fixed at the
 * start — lives in `ownerHttpTransport.client.ts` now, once, for every section that uses it.
 */
function requestOrder(path: string, payload?: unknown, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<{ status: number; value: ServiceOrder }> {
  return requestOwnerJson<ServiceOrder>(`/api/service-orders/${path}`, { method, payload, messages: SERVICE_ORDER_MESSAGES });
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
