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
  /** The council is not on the server: deleted, or created offline and not replayed yet. */
  | { kind: 'gone' }
  | { kind: 'refused'; error: unknown };

const deviceOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * `knownToServer` is the difference between "deleted" and "not there yet", and only the caller
 * can tell them apart: it has seen whether the server ever answered about this council.
 */
export async function saveCouncil(
  council: Council,
  options: { keepalive?: boolean; knownToServer?: boolean } = {}
): Promise<CouncilSaveResult> {
  if (!deviceOnline()) {
    // NOT awaited: offline the SDK promise settles only when the server acknowledges, which may
    // be hours away. The local replica has the write the moment the call returns, and holding
    // the queue for an acknowledgement that cannot come blocks every later change behind it.
    void setCouncilViaSdk(council).catch((error) => console.error('council offline write failed', error));
    return { kind: 'queued' };
  }
  try {
    const { conflict, current } = await replaceCouncilOnServer(council, council.rev ?? null, options);
    return conflict ? { kind: 'conflict', current } : { kind: 'saved', council: current };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'deadline-exceeded') return { kind: 'unknown' };
    /*
     * NOT FOUND MEANS ONE OF TWO OPPOSITE THINGS, and the answer depends on whether the server
     * ever knew this council. Never knew it — it was written on this device while offline, and
     * creating it now is the same write finally arriving. Knew it and does not have it — it was
     * deleted, here or on another device, and re-creating it would raise a document its owner
     * threw away. That resurrection is what a blanket "create on 404" used to do.
     */
    if (code === 'not-found') {
      if (options.knownToServer) return { kind: 'gone' };
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
    void setCouncilViaSdk(council).catch((error) => console.error('council offline create failed', error));
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
    void deleteCouncilViaSdk(id).catch((error) => console.error('council offline delete failed', error));
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
