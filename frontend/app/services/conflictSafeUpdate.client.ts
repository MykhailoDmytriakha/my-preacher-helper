import {
  increment,
  runTransaction,
  updateDoc,
  type DocumentReference,
  type FieldValue,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';

/**
 * Refuse a save that would overwrite a NEWER version.
 *
 * WHY. Everything else built for freshness only makes staleness VISIBLE. Nothing
 * makes overwriting IMPOSSIBLE: a tab holding yesterday's copy still writes over
 * whatever the phone saved a minute ago, and the text is gone with no trace. That
 * is the owner's original bug, reproduced live (two tabs, one note, BUGS.md).
 *
 * HOW. Each editable aggregate carries a counter in `rev`. A save states which
 * revision it was built from; inside one transaction we compare, and either write
 * `patch` together with `rev.<aggregate> = n + 1`, or write NOTHING and throw a
 * typed conflict. Compare-and-set — no server code, no Security Rules change.
 *
 * WHY PER-AGGREGATE, NOT PER-DOCUMENT. One sermon document holds title, thoughts,
 * outline, scratch, preparation and structure. A single document counter would
 * make an AI insight write collide with a human editing the title — false
 * conflicts train people to click through the dialog, which is worse than none.
 *
 * WHY A COUNTER AND NOT `updatedAt`. `UserSettings` has no `updatedAt` at all,
 * `Sermon.updatedAt` is optional, structure writes deliberately leave it alone,
 * and every value comes from the DEVICE clock. A counter changes only when a
 * participating writer changes the data.
 *
 * MIGRATION-FREE. A missing counter reads as 0 and the first write sets 1.
 *
 * ⚠️ PRECONDITION — DO NOT USE THIS WITHOUT A DURABLE DRAFT. Refusing a write
 * turns "silently overwrote someone else" into "silently lost your own" unless
 * the rejected text is already stored somewhere that survives reload. That is
 * what `durableDraft.ts` is for, and it must land first (it did).
 */
export class StaleWriteError extends Error {
  readonly isStaleWrite = true;
  constructor(
    readonly aggregate: string,
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Refused a stale write to "${aggregate}": built from revision ${expectedRevision}, server is at ${actualRevision}`
    );
    this.name = 'StaleWriteError';
  }
}

export function isStaleWriteError(error: unknown): error is StaleWriteError {
  return Boolean((error as StaleWriteError | null)?.isStaleWrite);
}

/** Revision of one aggregate as stored; absent means "never written under this scheme". */
export function readRevision(data: Record<string, unknown> | undefined, aggregate: string): number {
  const rev = (data?.rev ?? {}) as Record<string, unknown>;
  const value = rev[aggregate];
  return typeof value === 'number' ? value : 0;
}

/**
 * Field patch that advances an aggregate's counter WITHOUT a transaction.
 *
 * EVERY writer of an aggregate must advance its counter, or the counter lies: a
 * writer that changes the data while leaving the number alone makes a later stale
 * save look up-to-date, and the guard then hands it permission to overwrite. That
 * is worse than having no guard, because the app now CONFIRMS the overwrite.
 *
 * `increment` is a server-side FieldValue, so this rides the ordinary `updateDoc`
 * path: it stays atomic under concurrency AND keeps working offline, where
 * transactions do not. Unguarded writers use this; guarded ones get the bump from
 * `conflictSafeUpdate` itself.
 */
export function revisionBump(aggregate: string): Record<string, FieldValue> {
  return { [`rev.${aggregate}`]: increment(1) };
}

export interface ConflictSafeUpdateOptions {
  /** Which independently edited part of the document this write touches. */
  aggregate: string;
  /**
   * The revision the caller's text was built from. `null` means the caller cannot
   * prove what it started from, so the write proceeds WITHOUT the guard — used by
   * paths not yet migrated, so behaviour there is exactly as before.
   */
  expectedRevision: number | null;
}

/**
 * The server could not be reached, so no comparison was possible.
 *
 * Firestore transactions FAIL while the client is offline — ordinary writes are
 * queued and replayed on reconnect, transactions are not
 * (https://firebase.google.com/docs/firestore/manage-data/enable-offline).
 * `unavailable` also covers a transient server outage while nominally online;
 * treating both the same way is correct, because in both cases we have no
 * server state to compare against.
 */
export function isUnreachableWriteError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'unavailable' || code === 'deadline-exceeded') return true;
  const message = (error as { message?: string } | null)?.message ?? '';
  return /client is offline/i.test(message);
}

/**
 * Apply `patch` only if `aggregate` is still at `expectedRevision`.
 *
 * Throws `StaleWriteError` and writes nothing when it is not. The transaction
 * callback may run more than once (the SDK reruns it), which is safe here: it
 * only ever compares and writes the caller's fixed patch — it does not rebuild
 * anything from data it read.
 *
 * OFFLINE — two different situations, deliberately handled differently.
 *
 * (a) The browser ALREADY KNOWS it is offline (`navigator.onLine === false`): a
 *     transaction is impossible, so we take the pre-guard path openly — see the
 *     comment at the check below.
 * (b) The server turns out to be unreachable MID-FLIGHT: the transaction rejects
 *     and that rejection is passed to the caller untouched. It is NOT converted
 *     into a write. An earlier version did exactly that — a queued unconditional
 *     last-write-wins patch that ALSO reported success — and adversarial review
 *     was right to kill it: the editor retired its durable draft for a write the
 *     server had never seen, and on reconnect that patch overwrote whatever the
 *     other device had stored. Both outcomes this mechanism exists to prevent.
 *
 * Callers can tell (b) apart from a conflict with `isUnreachableWriteError`, so the
 * UI can say "no connection" instead of showing a conflict choice. The real fix for
 * offline protection is a durable OUTBOX replaying the SAME compare-and-set on
 * reconnect — see BUGS.md; it is a build, not a fallback.
 */
export async function conflictSafeUpdate(
  ref: DocumentReference,
  // Firestore accepts nulls too (a field explicitly set to null), so the shape
  // must not be narrower than what callers already pass to `updateDoc`.
  patch: { [field: string]: FieldValue | Partial<unknown> | null | undefined },
  notFoundMessage: string,
  { aggregate, expectedRevision }: ConflictSafeUpdateOptions
): Promise<number> {
  // OFFLINE: take the PRE-GUARD path deliberately, not as a disguised CAS.
  // A transaction cannot run without the server, and failing outright would be a
  // functional regression for a PWA (before this mechanism an offline edit queued
  // and landed on reconnect). So we issue the ordinary write and AWAIT it — offline
  // that promise does not settle until reconnect, exactly as before, which is what
  // keeps it honest: the caller never sees a success it did not get, never marks
  // anything saved, and never retires its durable draft. The counter still advances
  // via `increment`. What we do NOT get is protection — impossible without a server;
  // on reconnect this is last-write-wins, the same risk the app always had here.
  // The real fix is a durable outbox replaying the same CAS (BUGS.md).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await updateDoc(ref, { ...patch, ...revisionBump(aggregate) });
    return (expectedRevision ?? 0) + 1;
  }

  let committedRevision = 0;

  await runTransaction(getClientDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(notFoundMessage);

    const current = readRevision(snap.data() as Record<string, unknown>, aggregate);

    if (expectedRevision !== null && current !== expectedRevision) {
      throw new StaleWriteError(aggregate, expectedRevision, current);
    }

    committedRevision = current + 1;
    tx.update(ref, { ...patch, [`rev.${aggregate}`]: committedRevision });
  });

  return committedRevision;
}
