import type { DeliveryState, JournalEntry } from './types';

/*
 * A DELIVERY WHOSE ANSWER DID NOT COME BACK (the owner, 2026-10-17). On a weak signal a write's
 * request runs out of time (`services/ownerHttpTransport.client.ts`, 8–10 s) and the journal marks it
 * `unknown`: the server may or may not have it. It is sent again — the same operation, so it can never
 * land twice (README, invariant 2) — and nobody has to ask for that: the engine retries it on its own,
 * after a growing pause, for as long as it stays unanswered (`engine.ts`, redelivery).
 *
 * While those retries run, the change is still on its way, and nothing is said: "while there is a
 * connection, no banner; retry, and only when the retries are spent, the banner". A mark made on a weak
 * signal showed "The result of sending is unknown" five seconds after it and took it back five seconds
 * later. Without a connection no delivery is tried, and the app's own line says it ("Working offline").
 */

/** Pauses before an unanswered delivery is sent again: growing, then every half minute. */
export const REDELIVERY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

/** Attempts that may stay unanswered before it is said: the first send and three retries. */
export const UNANSWERED_SAID_AFTER_ATTEMPTS = 4;

/** The pause before sending again a delivery tried `attempts` times. */
export function redeliveryDelay(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), REDELIVERY_DELAYS_MS.length) - 1;
  return REDELIVERY_DELAYS_MS[index];
}

/** What a delivery shows: an unanswered one is still on its way until its retries are spent. */
export function shownDeliveryState(entry: JournalEntry): DeliveryState {
  return entry.state === 'unknown' && entry.attempts < UNANSWERED_SAID_AFTER_ATTEMPTS ? 'sending' : entry.state;
}
