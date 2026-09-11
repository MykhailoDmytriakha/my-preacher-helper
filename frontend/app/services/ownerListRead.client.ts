'use client';

import { apiClient } from '@/utils/apiClient';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { newClientId } from '@/utils/clientId';
import { resolveOwnerUid } from '@/utils/queryKeys';
import { readWithDeadline } from '@/utils/readWithDeadline';

const OWNER_LIST_EVENT = 'owner-list-read';

/**
 * Long enough that a healthy device is never cut off — it answers in tens of milliseconds — and
 * short enough that a silent one does not hold a person in front of an empty screen.
 */
const SDK_DEADLINE_MS = 2500;

/**
 * Codes that mean "no answer", as opposed to an answer of refusal. A refused read is a real
 * answer: asking a second road the same question would only bring the same refusal later.
 */
const SILENT_CODES = ['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'cancelled'];

/** After this, neither road has answered and the caller is told so rather than left waiting. */
const SECOND_ROAD_DEADLINE_MS = 9000;

/** Said in three places, and it must be the same sentence in all three. */
const ACCOUNT_CHANGED = 'Account changed';

/**
 * READING A LIST SO THAT NO DEVICE CAN LEAVE IT WAITING FOR EVER.
 *
 * The browser's own Firestore is first, and on nearly every device it is the only road used. But
 * on the owner's iPad that road is silent — measured 2026-09-06, zero server snapshots from the
 * SDK while the app's HTTPS road answered in 205 ms, same device, same minute — and `getDocs` in
 * that state neither resolves nor throws. A list with one road and no deadline therefore waits
 * for ever, which is what the pastor saw: a heading over a skeleton.
 *
 * Written once and used by every owner list, because the same rule copied into five services is
 * four copies waiting to differ. Each caller keeps its own shaping of the documents — that part
 * really is different per collection — and hands it in as `hydrate`.
 *
 * Offline is a different thing and is left alone: there the SDK answers from the local replica,
 * and the server is unreachable anyway.
 */
export async function readOwnerList<T>(
  collection: string,
  owner: string,
  viaSdk: Promise<T[]>,
  hydrate: (documents: Record<string, unknown>[]) => T[]
): Promise<T[]> {
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  try {
    return await readWithDeadline(viaSdk, online ? SDK_DEADLINE_MS : 8000);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!online || !SILENT_CODES.includes(code ?? '')) throw error;
    /*
     * WHOSE LIST WAS ASKED FOR IS DECIDED BY WHO ASKED, not by who is signed in now. A sign-in
     * that happens inside the 2.5 seconds would otherwise have the second road fetch the NEW
     * account's documents and hand them back to a request made for the old one — straight into
     * a cache still keyed by the old owner.
     */
    if (resolveOwnerUid() !== owner) {
      throw Object.assign(new Error(ACCOUNT_CHANGED), { code: 'unauthenticated' });
    }
    /*
     * THE FIRST ROAD IS NOT ABANDONED, ONLY OVERTAKEN.
     *
     * The deadline says "do not keep him waiting", not "that answer is worthless": a merely slow
     * connection would otherwise have its own answer thrown away at 2.501 seconds and be handed
     * a failure if the second road happened to be down. Both keep running, the first to answer
     * wins, and only both of them failing is a failure.
     */
    /*
     * A LAST BOUND ON THE WHOLE THING. The silent road can stay silent for ever; if the second
     * road then fails, waiting on the pair would be the very defect this helper exists to end.
     */
    return readWithDeadline(
      firstToAnswer(viaSdk, readOwnerListFromServer(collection, owner, hydrate)),
      SECOND_ROAD_DEADLINE_MS
    );
  }
}

/** The same list, asked of the app's own server over ordinary HTTPS. */
export async function readOwnerListFromServer<T>(
  collection: string,
  owner: string,
  hydrate: (documents: Record<string, unknown>[]) => T[]
): Promise<T[]> {
  const startedAt = Date.now();
  recordDiagnostic(OWNER_LIST_EVENT, { source: 'http', collection, result: 'started' });
  try {
    return await readWithDeadline(
      (async () => {
        const headers = await getAuthenticatedRequestHeaders();
        if (!headers.Authorization) {
          throw Object.assign(new Error('Authentication required'), { code: 'unauthenticated' });
        }
        // Acquiring a token takes a moment, and a sign-in inside that moment would send the new
        // account's credential for a question asked about the old one.
        if (resolveOwnerUid() !== owner) {
          throw Object.assign(new Error(ACCOUNT_CHANGED), { code: 'unauthenticated' });
        }
        const response = await apiClient(
          `/api/owner-list?collection=${encodeURIComponent(collection)}&read=${newClientId()}`,
          { headers, cache: 'no-store', category: 'crud', timeout: 8000 }
        );
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
        if (!Array.isArray(value)) throw new Error('Invalid list response');
        // The account may have changed while this was in the air; answering the new owner with
        // the old owner's documents would be worse than answering nothing.
        if (resolveOwnerUid() !== owner) {
          throw Object.assign(new Error(ACCOUNT_CHANGED), { code: 'unauthenticated' });
        }
        recordDiagnostic(OWNER_LIST_EVENT, {
          source: 'http',
          collection,
          result: 'answered',
          elapsedMs: Date.now() - startedAt,
        });
        return hydrate(value as Record<string, unknown>[]);
      })(),
      8000
    );
  } catch (error) {
    recordDiagnostic(OWNER_LIST_EVENT, {
      source: 'http',
      collection,
      result: 'failed',
      code: diagnosticErrorCode(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/** Whichever answers first; rejects only when neither can, with the failure that came first. */
function firstToAnswer<T>(one: Promise<T>, other: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let failures = 0;
    let firstFailure: unknown;
    const watch = (candidate: Promise<T>) =>
      candidate.then(resolve, (error: unknown) => {
        failures += 1;
        if (failures === 1) firstFailure = error;
        if (failures === 2) reject(firstFailure);
      });
    watch(one);
    watch(other);
  });
}
