import {
  runTransaction,
  getDoc,
  updateDoc,
  type DocumentReference,
  type FieldValue,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';

/** Firestore's update payload shape: any field may hold a value or a FieldValue sentinel. */
export type DocPatch = { [key: string]: FieldValue | Partial<unknown> | undefined };

export interface AtomicUpdateOptions {
  /**
   * Retry a TRANSIENT transaction failure (`unavailable` / `deadline-exceeded`) as
   * a queued write, so a captive portal does not silently drop the edit.
   *
   * ⚠️ Set this ONLY for mutations that are safe to apply twice even if the first
   * attempt actually committed: removals, and insert-if-absent. A transient error
   * does NOT mean "did not commit", so replaying a replace/merge that carries a
   * caller-built stale item can overwrite a newer edit that landed in between.
   * Left off, a transient failure surfaces to the caller instead.
   */
  retryTransientAsQueuedWrite?: boolean;
}

/**
 * Concurrency-safe read-modify-write for a single own document.
 *
 * WHY THIS EXISTS. The naive pattern — `getDoc` → rebuild an embedded array →
 * `updateDoc` the WHOLE array — silently destroys a concurrent edit: another
 * device can write between our read and our write, and our stale full-array
 * write wipes it (Firestore resolves same-doc writes last-write-wins). That is
 * the observed two-device overwrite bug.
 *
 * ONLINE: `runTransaction` re-reads and RE-RUNS `buildPatch` when the document
 * changed mid-flight, so the patch is always computed from fresh data. This IS
 * compare-and-set — no hand-rolled `revision` field, no Security Rules change.
 *
 * OFFLINE: transactions require the server and reject offline, so we keep the
 * legacy read-then-write path unchanged — the native Firestore queue replays it
 * on reconnect (still last-write-wins offline; a durable outbox is the separate,
 * larger track tracked in FIRESTORE_SYNC_RESEARCH.md).
 *
 * `buildPatch` MUST be pure w.r.t. the document: it can run more than once.
 * Deriving a return value inside it is fine — the committed run is the last one,
 * so a closure variable ends up holding the value that actually landed.
 *
 * Returning `null` from `buildPatch` means "nothing to write" (no-op, no write).
 */
export async function atomicUpdate<T>(
  ref: DocumentReference,
  buildPatch: (current: T) => DocPatch | null,
  notFoundMessage: string,
  options?: AtomicUpdateOptions
): Promise<void> {
  // Only a KNOWN-offline browser skips the transaction. Deliberately NOT keyed on
  // page visibility: `hidden` also means "background tab / locked screen", so
  // routing those through the non-transactional path would silently reopen the
  // lost-update race for anyone who just switches tabs while a debounced save is
  // pending. Durability for a killed page needs a durable intent (outbox), not a
  // weaker write — see FIRESTORE_SYNC_RESEARCH.md.
  if (isBrowserOffline()) return queuedUpdate(ref, buildPatch, notFoundMessage);

  try {
    await runTransaction(getClientDb(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(notFoundMessage);
      const patch = buildPatch(snap.data() as T);
      if (patch) tx.update(ref, patch);
    });
  } catch (error) {
    // BEST-EFFORT DURABILITY FALLBACK — OPT-IN, and deliberately so.
    // A transient error is INDETERMINATE: `deadline-exceeded` can arrive AFTER the
    // commit succeeded. Replaying then is only safe if re-applying the mutation
    // cannot destroy a NEWER edit that landed in between. That holds for removals
    // and insert-if-absent (recomputed against fresh data), and does NOT hold for
    // replace/merge mutators carrying a caller-built stale item — replaying those
    // would resurrect old field values over a later successful edit, a corruption
    // path HEAD did not have. So callers must opt in per operation.
    // `navigator.onLine` lies: captive portals and flaky links report online, so
    // the transaction path can be chosen while the server is unreachable. A
    // transaction needs the server and NEVER enters Firestore's durable mutation
    // queue, so simply rejecting would LOSE the user's edit — worse than the
    // pre-transaction behaviour, where updateDoc was queued locally and replayed
    // on reconnect. So on a transient failure we retry as a queued write.
    // ⚠️ CAVEAT: queuedUpdate re-reads first, and `getDoc` can itself reject when
    // the server is unreachable AND the doc is not in the local cache — then
    // nothing is queued and the edit is still lost. Closing that hole needs an
    // operation intent persisted BEFORE the attempt (outbox), tracked as open in
    // FIRESTORE_SYNC_RESEARCH.md. This fallback also keeps the last-write-wins
    // risk. Application errors, permission-denied and genuine `aborted`
    // contention are NOT swallowed — they must surface.
    if (!options?.retryTransientAsQueuedWrite) throw error;
    if (!isTransportFailure(error)) throw error;
    return queuedUpdate(ref, buildPatch, notFoundMessage);
  }
}

/** Legacy read-then-write. Enters the native offline queue, so it is durable. */
async function queuedUpdate<T>(
  ref: DocumentReference,
  buildPatch: (current: T) => DocPatch | null,
  notFoundMessage: string
): Promise<void> {
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(notFoundMessage);
  const patch = buildPatch(snap.data() as T);
  if (patch) await updateDoc(ref, patch);
}

/**
 * Transient / indeterminate outcomes, where retrying as a queued write is better
 * than dropping the user's edit. NOT a claim that the commit did not happen:
 * `deadline-exceeded` in particular can be returned AFTER a successful write, so
 * the retry must be idempotent — which is why only ADDS (insert-if-absent) and
 * REMOVALS (filter recomputed on fresh data) opt in; replace/merge mutators never
 * do, because replaying them would reapply a stale payload. `internal` is deliberately EXCLUDED — it signals a broken
 * invariant in the backend/SDK and must surface instead of degrading silently.
 * Application errors, `permission-denied` and genuine `aborted` contention also
 * propagate untouched.
 */
function isTransportFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'unavailable' || code === 'deadline-exceeded';
}

/** Same offline probe the other client services use (outline/scratch/userSettings). */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}
