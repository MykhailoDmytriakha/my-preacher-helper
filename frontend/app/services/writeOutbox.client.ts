'use client';

/**
 * Durable queue of WRITES THAT STILL HAVE TO PASS THE GUARD.
 *
 * WHY THIS EXISTS. Firestore transactions cannot run offline, and the two ways
 * out of that were both wrong. Failing the save loses the edit for a PWA that is
 * expected to work on a train. Falling back to an ordinary queued write means the
 * edit lands on reconnect as an unconditional last-write-wins patch — it can
 * silently replace whatever another device stored in the meantime, which is the
 * exact bug this whole mechanism exists to prevent. Adversarial review named that
 * fallback the single remaining P0.
 *
 * So an offline save is stored here as an INTENT: the patch, the aggregate, and
 * the revision the text was built from. On reconnect each entry is replayed
 * through the SAME compare-and-set. If the server moved on meanwhile the entry is
 * not written — it is marked `conflicted` and keeps its text, so the person can
 * still be offered the choice instead of discovering a silent overwrite.
 *
 * Storage is localStorage: synchronous, so an entry survives a tab closed
 * mid-write, which IndexedDB's async write does not guarantee.
 */
const PREFIX = 'outbox:v1:';

export type OutboxStatus = 'pending' | 'conflicted';

export interface OutboxEntry {
  /** Stable id so a replay is idempotent and can be removed exactly once. */
  id: string;
  uid: string;
  collection: string;
  docId: string;
  aggregate: string;
  /** Field patch exactly as the guarded write would have applied it. */
  patch: Record<string, unknown>;
  /** The revision the text was built from — replay states THIS, never a fresh one. */
  baseRevision: number;
  /**
   * The written fields AS THE AUTHOR FOUND THEM when the editor opened.
   *
   * Kept verbatim, not hashed: a replay sometimes has to check only PART of these
   * fields — the rest having been rewritten by an earlier intent from the same
   * person minutes before — and a hash cannot be narrowed to a subset. Storing the
   * values is what lets the replay keep protecting the untouched ones.
   */
  expectedBaseline?: Record<string, unknown>;
  /** Server revision seen at refusal; set only once the replay was turned away. */
  actualRevision?: number;
  /**
   * A SEMANTIC intent: replay it by re-running a merge, not by applying a patch.
   *
   * Ordered structures — the sermon plan above all — have no commutative operation:
   * "merge" there means recompute against what the server holds, and offline there is
   * nothing to recompute against. Queueing the computed value (what the native
   * Firestore queue does) replaces the other device's work at reconnect. Carrying the
   * OPERATION plus the plan the editor started from lets the replay redo the merge
   * with fresh data, which is the whole point.
   */
  merge?:
    | { kind: 'outline'; base: unknown }
    | { kind: 'structure'; base?: unknown }
    | { kind: 'applyScratch'; base: unknown }
    | { kind: 'scratch'; base: unknown };
  /**
   * The document itself is GONE — deleted from another device while this edit waited.
   *
   * Kept apart from an ordinary refusal because the available actions differ: there
   * is nothing to overwrite, so offering "keep mine" would be a button that can
   * never work (it would try to update a document that does not exist). The text is
   * still here and the person can take it out.
   */
  targetMissing?: boolean;
  status: OutboxStatus;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Access itself throws in some privacy modes.
    return null;
  }
}

const keyFor = (id: string) => `${PREFIX}${id}`;

/**
 * Queue an intent. Returns whether it is REALLY stored.
 *
 * The boolean matters: telling the caller "queued, it will save later" when the
 * storage refused it is a promise the app cannot keep — the person closes the tab
 * and the text is gone with no write and no record. The caller must be able to
 * fall back to a plain, visible failure.
 */
export function enqueueWrite(entry: OutboxEntry): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(keyFor(entry.id), JSON.stringify(entry));
    return true;
  } catch {
    console.error('writeOutbox: no room to queue', entry.id);
    return false;
  }
}

/**
 * A fresh id for every intent.
 *
 * Ids used to be derived from document + aggregate, which quietly made the queue
 * a one-slot register: a second offline edit of the same aggregate — the title in
 * one tab, the verse in another — overwrote the first before it ever reached a
 * server. Each intent now gets its own entry, and replay walks them oldest first.
 */
export function newIntentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listOutbox(uid?: string): OutboxEntry[] {
  const store = storage();
  if (!store) return [];
  const entries: OutboxEntry[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(store.getItem(key) as string) as OutboxEntry;
      if (!uid || parsed.uid === uid) entries.push(parsed);
    } catch {
      /* skip an unparsable entry rather than throwing away the whole queue */
    }
  }
  return entries.sort((a, b) => a.savedAt - b.savedAt);
}

export function removeFromOutbox(id: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(keyFor(id));
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Mark an entry the server turned away; its text stays for the person to resolve.
 *
 * Returns whether the transition was really stored. That matters near the storage
 * quota: the conflict record is slightly larger than the pending one, so the write
 * could fail while the caller assumed it had succeeded — the entry stayed `pending`,
 * was refused again on every heartbeat, and never once turned into a choice the
 * person could make. If the full record does not fit, we retry WITHOUT the opening
 * values (by far the largest field): the guard then falls back to the counter, which
 * is a weaker check but keeps the text and the question alive.
 */
export function markOutboxConflicted(
  id: string,
  actualRevision: number,
  targetMissing = false
): boolean {
  const store = storage();
  if (!store) return false;
  const raw = store.getItem(keyFor(id));
  if (!raw) return false;
  try {
    const entry = JSON.parse(raw) as OutboxEntry;
    const conflicted = { ...entry, status: 'conflicted' as const, actualRevision, targetMissing };
    if (enqueueWrite(conflicted)) return true;
    const { expectedBaseline: _dropped, ...compact } = conflicted;
    if (enqueueWrite(compact)) return true;
    console.error('writeOutbox: could not record the conflict for', id);
    return false;
  } catch {
    /* leave it as-is: a malformed entry is better than a deleted one */
    return false;
  }
}
