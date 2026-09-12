'use client';

import { deleteCouncilViaSdk, setCouncilViaSdk } from '@/services/councils.client';
import { createCouncilOnServer, deleteCouncilOnServer, replaceCouncilOnServer } from '@/services/councilsTransport.client';

import type { Council } from '@/models/models';

/**
 * WHICH ROAD A COUNCIL WRITE TAKES, decided once.
 *
 * ONLINE — the app's server over HTTPS, with a compare-and-set on the revision. Not the SDK:
 * on the owner's iPad the SDK reports the device online and then holds the write for ever
 * (`BUG-20260911-service-orders-write-lock`), and a timeout there is never replayed by the
 * other road, because the server may have applied it.
 *
 * OFFLINE — the SDK, whose local replica queues the write and replays it when the network is
 * back. There the server is unreachable anyway, and the replica is what offline is for.
 */
export type CouncilSaveResult =
  | { kind: 'saved'; council: Council }
  | { kind: 'queued' }
  | { kind: 'conflict'; current: Council }
  | { kind: 'unknown' }
  | { kind: 'refused'; error: unknown };

const deviceOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export async function saveCouncil(council: Council, options: { keepalive?: boolean } = {}): Promise<CouncilSaveResult> {
  if (!deviceOnline()) {
    await setCouncilViaSdk(council);
    return { kind: 'queued' };
  }
  try {
    const { conflict, current } = await replaceCouncilOnServer(council, council.rev ?? null, options);
    return conflict ? { kind: 'conflict', current } : { kind: 'saved', council: current };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'deadline-exceeded') return { kind: 'unknown' };
    // The document is not on the server yet (created while offline, replay still pending):
    // creating it over the road that answers is the same write, not a different one.
    if (code === 'not-found') {
      try {
        return { kind: 'saved', council: await createCouncilOnServer(council) };
      } catch (createError) {
        return { kind: 'refused', error: createError };
      }
    }
    return { kind: 'refused', error };
  }
}

export async function createCouncil(council: Council): Promise<CouncilSaveResult> {
  if (!deviceOnline()) {
    await setCouncilViaSdk(council);
    return { kind: 'queued' };
  }
  try {
    return { kind: 'saved', council: await createCouncilOnServer(council) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === 'deadline-exceeded' ? { kind: 'unknown' } : { kind: 'refused', error };
  }
}

export async function deleteCouncil(id: string): Promise<CouncilSaveResult> {
  if (!deviceOnline()) {
    await deleteCouncilViaSdk(id);
    return { kind: 'queued' };
  }
  try {
    await deleteCouncilOnServer(id);
    return { kind: 'saved', council: { id } as Council };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'not-found') return { kind: 'saved', council: { id } as Council };
    return code === 'deadline-exceeded' ? { kind: 'unknown' } : { kind: 'refused', error };
  }
}
