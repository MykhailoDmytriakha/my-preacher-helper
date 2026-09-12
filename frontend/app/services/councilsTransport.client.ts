'use client';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';

import type { Council } from '@/models/models';

const MESSAGES = {
  failed: 'Council request failed',
  timedOut: 'Council request timed out',
  unavailable: 'Council transport unavailable',
};

/** What the server decides is not sent: `id` travels in the URL, `userId` and `rev` are its own. */
function bodyOf(council: Council) {
  const { id: _id, userId: _userId, rev: _rev, ...body } = council;
  return body;
}

export async function createCouncilOnServer(council: Council): Promise<Council> {
  const { value } = await requestOwnerJson<Council>('/api/councils', {
    method: 'POST',
    payload: { id: council.id, council: bodyOf(council) },
    messages: MESSAGES,
  });
  return value;
}

/**
 * The whole council, built on the revision the client last saw. A 409 hands back the server's
 * current document instead of failing — the caller decides what to do with it.
 */
export async function replaceCouncilOnServer(
  council: Council,
  expectedRev: number | null,
  options: { keepalive?: boolean } = {}
): Promise<{ conflict: boolean; current: Council }> {
  const { status, value } = await requestOwnerJson<Council>(`/api/councils/${encodeURIComponent(council.id)}`, {
    method: 'PUT',
    payload: { council: bodyOf(council), expectedRev },
    messages: MESSAGES,
    keepalive: options.keepalive,
  });
  return { conflict: status === 409, current: value };
}

export async function deleteCouncilOnServer(id: string): Promise<void> {
  await requestOwnerJson<{ deleted: boolean }>(`/api/councils/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    messages: MESSAGES,
  });
}
