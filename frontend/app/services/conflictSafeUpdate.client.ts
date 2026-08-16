import { increment, runTransaction, updateDoc, type DocumentReference, type FieldValue } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { auth } from '@/services/firebaseAuth.service';
import { enqueueWrite, newIntentId } from '@/services/writeOutbox.client';
import { contentFingerprint } from '@/utils/contentFingerprint';

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
    readonly actualRevision: number,
    /**
     * WHAT THE SERVER ACTUALLY HELD, for exactly the fields that were compared.
     *
     * Without it a refusal is a dead end rather than a decision. The editor still vouches for
     * the value it opened with, so pressing Save again recreates the same conflict, for ever —
     * the person's only way out is to copy their text somewhere and reload. Reported here
     * because this transaction is the only thing that ever saw the server: the caller can then
     * adopt it as the new baseline (a second, deliberate press means "mine wins"), or show it
     * beside the person's own text.
     */
    readonly serverValues: Record<string, unknown> = {}
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

/**
 * THE OTHER DOOR: a write that is deliberately NOT guarded, but still honest.
 *
 * Some writes must never be refused. Deleting the text of a node that no longer exists is
 * cleanup — refusing it would leave debris and tell the person their deletion failed. A
 * refusal there costs something and protects nothing.
 *
 * It exists as a NAMED export rather than as a bare `updateDoc` at the call site so the
 * choice is visible and countable. "Unguarded" then reads as a decision someone made and
 * explained, instead of as a writer that never heard about the guard —
 * `__tests__/architecture/writesGoThroughTheInterface.test.ts` counts every remaining bare
 * write and refuses to let the number grow.
 *
 * The counter still advances: a writer that changes data while leaving the number alone
 * makes a later stale save look current, and the guard then CONFIRMS the overwrite. And
 * because this is an ordinary `updateDoc`, it keeps working offline, where transactions
 * do not run at all.
 */
export async function revisionedUpdate(
  ref: DocumentReference,
  patch: { [field: string]: FieldValue | Partial<unknown> | null | undefined },
  aggregate: string
): Promise<void> {
  await updateDoc(ref, { ...patch, ...revisionBump(aggregate) });
}

/** The write could not be attempted; it is queued and will replay through the guard. */
export class OfflineQueuedError extends Error {
  readonly isOfflineQueued = true;
  constructor(readonly aggregate: string) {
    super(`No connection: the "${aggregate}" change is queued and will be saved when back online`);
    this.name = 'OfflineQueuedError';
  }
}

export function isOfflineQueuedError(error: unknown): error is OfflineQueuedError {
  return Boolean((error as OfflineQueuedError | null)?.isOfflineQueued);
}

/**
 * Firestore codes that mean the write was REFUSED, not merely delayed.
 *
 * Repeating a refusal cannot change its answer, and the cost of trying is not
 * zero: the retry ladder runs for the better part of a minute, and for all that
 * time the screen still shows the entry as if it had been stored, while nothing
 * tells the person otherwise. Reproduced 2026-08-11 against an emulator whose
 * rules deny every write — an added prayer update sat "saved" on screen with no
 * message at all, and after a reload it was simply gone.
 *
 * The list is deliberately of REFUSALS rather than of transient faults: an
 * unknown code should keep being retried, because treating a passing network
 * glitch as final would throw away work that was about to succeed.
 */
const REFUSAL_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'not-found',
  'invalid-argument',
  'failed-precondition',
  'already-exists',
  'out-of-range',
  'unimplemented',
]);

export function isWriteRefusedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && REFUSAL_CODES.has(code.replace(/^firestore\//, ''));
}

export interface ConflictSafeUpdateOptions {
  /** Which independently edited part of the document this write touches. */
  aggregate: string;
  /**
   * Where this write lives, so an offline attempt can be queued and replayed.
   * Omit it and an offline caller simply gets the transaction's own failure —
   * used by writers that have no durable identity to replay under.
   */
  outboxRoute?: { uid: string; collection: string; docId: string; savedAt: number };
  /**
   * The revision the caller's text was built from. `null` means the caller cannot
   * prove what it started from, so the write proceeds WITHOUT the guard — used by
   * paths not yet migrated, so behaviour there is exactly as before.
   */
  expectedRevision: number | null;
  /**
   * Fingerprint of the fields being written AS THE CALLER FOUND THEM, together
   * with the exact field list it covers.
   *
   * The list is not decoration: the caller can only vouch for fields whose OPENING
   * value it knows, while the patch may also carry fields the service derives on
   * its own. Hashing "everything in the patch" on this side and "everything the
   * editor knew" on the other guarantees a mismatch — a legitimate save refused
   * forever.
   *
   * The counter alone is only as honest as the writers that maintain it. An old
   * build still installed on someone's phone changes content and leaves the number
   * alone — the counter then LIES, and a stale save matching that number is handed
   * permission to overwrite. Enforcing the counter in Security Rules would close it
   * but also lock those old clients out, which is a rollout decision, not a code
   * change (see firestore.rules).
   *
   * Comparing the CONTENT closes the same hole from this side and needs nobody's
   * cooperation: if the stored values of these very fields differ from what the
   * caller started with, something changed them — counter or no counter — and the
   * write is refused. Omit it and only the counter is checked, exactly as before.
   */
  /**
   * The values of the written fields AS THE EDITOR OPENED THEM. The guard hashes
   * these itself — callers pass plain values, never a precomputed hash, so there
   * is one place where "what did we start from" is defined.
   *
   * Stored VERBATIM in the offline queue rather than as a hash: a replay may need
   * to check only SOME of these fields (the others having been rewritten by an
   * earlier intent from the same person), and a hash cannot be narrowed.
   */
  expectedBaseline?: Record<string, unknown> | null;
}

/** A fingerprint plus the fields it covers. Built by `baselineFingerprint`. */
export interface ExpectedContent {
  fields: string[];
  fingerprint: string;
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
 * OFFLINE — two situations, and NEITHER of them writes unconditionally.
 *
 * (a) The browser already knows it is offline and the caller gave an
 *     `outboxRoute`: the intent is queued and `OfflineQueuedError` is thrown, so
 *     the caller says "will save when you are back online" and KEEPS its draft.
 *     `replayOutbox` later puts that intent through this same function.
 * (b) The server turns out to be unreachable mid-flight (or the caller gave no
 *     route): the transaction's own rejection reaches the caller untouched.
 *
 * An earlier version "helpfully" converted both into an ordinary queued write
 * that ALSO reported success. Adversarial review was right to call it the worst
 * thing here: the editor retired its durable draft for a write the server had
 * never seen, and on reconnect that patch overwrote whatever the other device had
 * stored. Callers tell the two apart with `isOfflineQueuedError` and
 * `isUnreachableWriteError`, so the UI can say "no connection" rather than
 * showing a conflict choice for something that never reached a server.
 */
/**
 * Fingerprint the stored values of exactly the fields this write would replace.
 *
 * Only those: a write that touches the title must not be refused because someone
 * edited the verse — false conflicts teach people to click through the dialog,
 * and then the real one is skipped too.
 */
/**
 * Read a Firestore FIELD PATH, not an object key.
 *
 * A dot in an `updateDoc` field name means NESTING: `planText.<nodeId>` addresses one entry
 * inside the `planText` map, and that is exactly what lets such a write merge instead of
 * replacing the whole map — the property the plan's per-node saves are built on.
 *
 * The comparison has to speak the same language. `stored['planText.abc']` finds nothing, so
 * every leaf write would be judged against `null`: on a document that already holds text the
 * fingerprints could never match and the save would be refused forever, while on an empty one
 * the check would pass no matter what the other device had stored. Neither is a guard.
 *
 * A missing segment answers `undefined`, which the caller turns into `null` — the same value
 * an absent flat field yields, and the honest reading of "the server has nothing here".
 */
function readFieldPath(stored: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return stored[path];
  return path.split('.').reduce<unknown>(
    (value, segment) =>
      value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)[segment]
        : undefined,
    stored
  );
}

function fingerprintOfFields(stored: Record<string, unknown>, fields: string[]): string {
  return contentFingerprint(
    [...fields].sort().map((name) => [name, readFieldPath(stored, name) ?? null])
  );
}

/**
 * Fingerprint the fields this write replaces, taken FROM THE VALUES THE EDITOR
 * OPENED WITH — never from a fresh read.
 *
 * ⚠️ THIS DISTINCTION IS THE WHOLE PROTECTION. Every service used to compute the
 * fingerprint from a `getDoc` performed moments before the write. That compares
 * the server with ITSELF: the fingerprint always matched, content had the final
 * word over the counter, and a laptop saving text built from revision 4 quietly
 * replaced the paragraph the phone had stored as revision 5. Adversarial review
 * called it correctly — the protection was a no-op wherever it was computed that
 * way.
 *
 * Only fields whose OPENING value we actually know are fingerprinted. A field the
 * service adds by itself (`updatedAt`, a derived flag) is not something the caller
 * started from, and vouching for it would refuse legitimate saves.
 *
 * No baseline at all → NO fingerprint, and the counter alone decides. That errs
 * toward a false refusal, which costs a question; the other error costs text.
 */
export function baselineFingerprint(
  baseline: Record<string, unknown> | null | undefined,
  writtenFields: Record<string, unknown>
): ExpectedContent | undefined {
  if (!baseline) return undefined;
  const fields = Object.keys(writtenFields)
    .filter((name) => !name.startsWith('rev.') && name !== 'updatedAt')
    .filter((name) => name in baseline)
    .sort();
  if (fields.length === 0) return undefined;
  return {
    fields,
    fingerprint: contentFingerprint(fields.map((name) => [name, baseline[name] ?? null])),
  };
}

export async function conflictSafeUpdate(
  ref: DocumentReference,
  // Firestore accepts nulls too (a field explicitly set to null), so the shape
  // must not be narrower than what callers already pass to `updateDoc`.
  patch: { [field: string]: FieldValue | Partial<unknown> | null | undefined },
  notFoundMessage: string,
  { aggregate, expectedRevision, outboxRoute, expectedBaseline }: ConflictSafeUpdateOptions
): Promise<number> {
  // OFFLINE: queue the INTENT, never an unconditional write.
  //
  // A transaction cannot run without the server. Writing an ordinary patch instead
  // would land on reconnect as last-write-wins and could silently replace whatever
  // another device stored meanwhile — the exact bug this mechanism exists to
  // prevent, which is why adversarial review called that fallback a P0. So the
  // patch, its aggregate and the revision it was built from go into the durable
  // outbox, and `replayOutbox` puts each one through THIS SAME function on
  // reconnect. Refused there, it is kept as `conflicted` with its text intact.
  //
  // The caller is told plainly (`OfflineQueuedError`) so it can say "will save
  // when you are back online" and KEEP its draft — never "saved".
  const queueIntent = (): boolean => {
    if (!outboxRoute) return false;
    // The intent belongs to the person WHO IS SIGNED IN, never to the owner field
    // of a cached document. On a shared browser those differ: account B editing a
    // stale copy of account A's document would queue under A, vanish from B, and
    // then replay inside A's authorized session later. Queue nothing rather than
    // launder a write into someone else's account.
    const actorUid = auth.currentUser?.uid;
    if (!actorUid || actorUid !== outboxRoute.uid) return false;
    return enqueueWrite({
      // A FRESH id per intent: a shared one made the queue a single slot, so a
      // second offline edit of the same aggregate erased the first.
      id: newIntentId(),
      uid: actorUid,
      collection: outboxRoute!.collection,
      docId: outboxRoute!.docId,
      aggregate,
      patch: patch as Record<string, unknown>,
      baseRevision: expectedRevision ?? 0,
      // The content check must survive the queue. Without it a replayed offline
      // edit falls back to the counter alone — and the counter is exactly what an
      // old build fails to advance, which is the hole the fingerprint closes.
      // Verbatim, not hashed — see `expectedBaseline` on the options.
      expectedBaseline: expectedBaseline ?? undefined,
      status: 'pending',
      savedAt: outboxRoute!.savedAt,
    });
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false && outboxRoute) {
    // Only claim "queued" when it REALLY is. If storage refused the entry, fall
    // through to the transaction so the caller gets a visible failure instead of
    // a promise nobody can keep.
    if (queueIntent()) throw new OfflineQueuedError(aggregate);
  }

  let committedRevision = 0;

  try {
    await runTransaction(getClientDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw Object.assign(new Error(notFoundMessage), { code: 'not-found' });
    }

    const current = readRevision(snap.data() as Record<string, unknown>, aggregate);

    // Two questions, and the CONTENT gets the final word.
    //
    // The counter tracks the whole aggregate, so it moves when ANY of its fields
    // changes — including one this write does not touch. Judging by the counter
    // alone therefore refuses a title save because the phone toggled "preached",
    // and a person who meets that a few times learns to click through the dialog.
    // The counter is also only as honest as the writers that maintain it: an old
    // build changes text and leaves it alone.
    //
    // So: if the fields WE are about to replace are byte-for-byte what this caller
    // started from, the write is safe no matter what the counter says. If they are
    // not, it is refused no matter how reassuring the counter looks.
    const expectedContent = baselineFingerprint(expectedBaseline, patch as Record<string, unknown>);
    const fingerprintMatches =
      expectedContent !== undefined &&
      fingerprintOfFields(snap.data() as Record<string, unknown>, expectedContent.fields) ===
        expectedContent.fingerprint;

    if (expectedContent !== undefined) {
      if (!fingerprintMatches) {
        throw new StaleWriteError(
          aggregate,
          expectedRevision ?? current,
          current,
          Object.fromEntries(
            expectedContent.fields.map((name) => [
              name,
              readFieldPath(snap.data() as Record<string, unknown>, name) ?? null,
            ])
          )
        );
      }
    } else if (expectedRevision !== null && current !== expectedRevision) {
      // No content to compare — the counter is all we have.
      throw new StaleWriteError(aggregate, expectedRevision, current);
    }

      committedRevision = current + 1;
      tx.update(ref, { ...patch, [`rev.${aggregate}`]: committedRevision });
    });
  } catch (error) {
    // NOMINALLY ONLINE but unreachable — a captive portal, a dead hotel link. The
    // offline branch above never ran because the browser claimed a connection, so
    // without this the text would live only in the DOM until the tab closes.
    // A refusal is the mechanism working and must never be turned into a write.
    if (!isStaleWriteError(error) && isUnreachableWriteError(error) && queueIntent()) {
      throw new OfflineQueuedError(aggregate);
    }
    throw error;
  }

  return committedRevision;
}
