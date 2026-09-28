'use client';

import { requestOwnerJson, accountChangedError } from '@/services/ownerHttpTransport.client';
import { resolveOwnerUid } from '@/utils/queryKeys';

import type { UserSettings } from '@/models/models';

/** Bounded bootstrap transport, usable before DataEngineWorkspace is mounted. */
export async function requestUserSettings(userId: string, mutation?: {
  operation: 'bootstrap' | 'language' | 'legacy' | 'heartbeat'; patch: Record<string, unknown>;
}): Promise<UserSettings | null> {
  if (resolveOwnerUid() !== userId) throw accountChangedError();
  const { value } = await requestOwnerJson<{ settings?: UserSettings | null }>('/api/me/settings', {
    method: mutation ? 'POST' : 'GET', payload: mutation, answerStatuses: [],
    messages: { failed: 'Settings request failed', timedOut: 'Settings request timed out', unavailable: 'Settings unavailable' },
  });
  if (resolveOwnerUid() !== userId) throw accountChangedError();
  return value.settings ?? null;
}
