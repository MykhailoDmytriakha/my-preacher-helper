import { apiClient } from '@/utils/apiClient';
import { accountChangedError, getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { clearDraftIfMatches, draftKey, findDraftCopies, saveDraft } from '@/utils/durableDraft';
import { planInboxPage } from '@/utils/planResultOrigin';
import { resolveOwnerUid } from '@/utils/queryKeys';

import type { PlanInboxItem, PlanResultMode } from '@/utils/planResultOrigin';

export type PlanInboxScope = { ownerId: string; sermonId: string; mode: PlanResultMode };

export async function planResultDigest(value: string): Promise<string | undefined> {
  try {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

async function requestInbox({ ownerId, sermonId, mode }: PlanInboxScope, options: {
  method?: 'GET' | 'POST' | 'DELETE'; cursor?: string; operationId?: string; signal?: AbortSignal; known?: string[]; statusOnly?: boolean;
}) {
  const { method = 'GET', cursor, operationId, signal, known, statusOnly } = options;
  const search = new URLSearchParams({ sermonId, mode, ...(cursor && { cursor }), ...(operationId && { operationId }), ...(statusOnly && { statusOnly: '1' }) });
  for (const id of known ?? []) search.append('known', id);
  const headers = await getAuthenticatedRequestHeaders(ownerId);
  if (resolveOwnerUid() !== ownerId) throw accountChangedError();
  const response = await apiClient(`/api/ai/plan-results?${search}`, {
    headers, method, cache: 'no-store', signal, category: 'detail',
  });
  if (resolveOwnerUid() !== ownerId) throw accountChangedError();
  if (!response.ok) throw Object.assign(new Error('Plan results unavailable'), { status: response.status });
  return response;
}

export async function listPlanResultInbox(scope: PlanInboxScope, signal: AbortSignal, known: string[]) {
  const items: PlanInboxItem[] = [];
  const closed: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await requestInbox(scope, { cursor, signal, known: cursor ? undefined : known.slice(0, 16) });
    const page = planInboxPage.parse(await response.json());
    if (page.items.some(item => item.value.sermonId !== scope.sermonId || item.value.mode !== scope.mode)
      || page.next && page.next === cursor) throw new Error('Plan result scope mismatch');
    items.push(...page.items);
    closed.push(...page.closed);
    cursor = page.next;
  } while (cursor);
  for (let offset = 16; offset < known.length; offset += 16) {
    const response = await requestInbox(scope, { signal, known: known.slice(offset, offset + 16), statusOnly: true });
    closed.push(...planInboxPage.parse(await response.json()).closed);
  }
  return { items, closed };
}

export async function checkPlanInboxResult(scope: PlanInboxScope, operationId: string) {
  await requestInbox(scope, { method: 'POST', operationId });
}

const closureAggregate = (mode: PlanResultMode) => 'plan-result-closure-' + mode;
const sendingClosures = new Map<string, Promise<void>>();

export function queuedPlanInboxClosures({ ownerId, sermonId, mode }: PlanInboxScope) {
  return findDraftCopies<string>(ownerId, sermonId, closureAggregate(mode))
    .flatMap(copy => typeof copy.value === 'string' ? [copy.value] : []);
}

export async function closePlanInboxResult(scope: PlanInboxScope, operationId: string) {
  const key = draftKey(scope.ownerId, scope.sermonId, closureAggregate(scope.mode), operationId);
  const existing = sendingClosures.get(key);
  if (existing) return existing;
  const sent = (async () => {
    try {
      await requestInbox(scope, { method: 'DELETE', operationId });
    } catch (error) {
      if ((error as { status?: number } | undefined)?.status !== 404) throw error;
    }
    clearDraftIfMatches(key, operationId);
  })();
  sendingClosures.set(key, sent);
  try {
    await sent;
  } finally {
    sendingClosures.delete(key);
  }
}

export async function recordPlanInboxClosure(scope: PlanInboxScope, operationId: string) {
  const key = draftKey(scope.ownerId, scope.sermonId, closureAggregate(scope.mode), operationId);
  const persisted = saveDraft(key, operationId);
  try {
    await closePlanInboxResult(scope, operationId);
  } catch (error) {
    if (!persisted) throw error;
    // The next opening or reconnection sends the remembered decision.
  }
}
