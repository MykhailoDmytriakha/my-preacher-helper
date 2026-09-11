import type { QueryClient } from '@tanstack/react-query';

/** How many writes have begun or ended, and how many are under way right now. */
export type WriteFence = { epoch: number; inFlight: number };

const IDLE: WriteFence = { epoch: 0, inFlight: 0 };

/**
 * WHERE THE ORDERS-OF-SERVICE WRITE FENCE LIVES.
 *
 * A read that overlapped a write may have been answered from before the commit, so it must not
 * publish. Deciding that needs one count shared by every screen holding the list — the editor and
 * the breadcrumb each mount the hook, and a count kept inside one of them is no fence at all.
 *
 * Beside the cache, NOT IN IT. Keeping it as query data made it shared, and also made it
 * durable: the app persists successful queries to storage, so a write interrupted by a closed
 * tab left `inFlight: 1` behind — and after the reload nothing could ever bring that count back
 * down. Every later read saw a write under way, kept the cache and asked again, for ever. State
 * that describes THIS RUN must not outlive it.
 *
 * Keyed by the QueryClient so it shares exactly what the cache shares and dies with it, and by
 * the owner inside that, so one person's writes never fence another person's reads.
 */
const fences = new WeakMap<QueryClient, Map<string, WriteFence>>();

const bucket = (client: QueryClient): Map<string, WriteFence> => {
  const existing = fences.get(client);
  if (existing) return existing;
  const created = new Map<string, WriteFence>();
  fences.set(client, created);
  return created;
};

export function readWriteFence(client: QueryClient, owner: string): WriteFence {
  return bucket(client).get(owner) ?? IDLE;
}

/**
 * Moves the fence: `+1` as a write begins, `-1` as it ends. The epoch moves BOTH times, because
 * a read is suspect either way — it may have started before a write and ended after its commit,
 * or started while one was already under way.
 */
export function moveWriteFence(client: QueryClient, owner: string, by: number): void {
  const current = readWriteFence(client, owner);
  bucket(client).set(owner, { epoch: current.epoch + 1, inFlight: current.inFlight + by });
}

/** True when a read that saw `before` and then `after` may be carrying pre-commit data. */
export function readOverlappedAWrite(before: WriteFence, after: WriteFence): boolean {
  return before.inFlight > 0 || after.epoch !== before.epoch;
}
