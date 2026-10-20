import { NextResponse } from 'next/server';

import { withinDeadline } from '@/utils/withinDeadline';

/**
 * A ROUTE THE APP CALLS BY ITSELF ANSWERS BEFORE THE BROWSER GIVES UP
 * (BUG-20261019-quota-outage-burns-vercel-functions).
 *
 * The Firestore server SDK treats "Quota exceeded" (RESOURCE_EXHAUSTED) as passing: a read retries it for
 * minutes, a transaction waits a whole minute between attempts. A route that simply awaited it never
 * answered — Vercel killed it at 10 s and billed all 10 — while the browser stopped waiting at 8 s, took
 * that for a lost network, and on the next answer re-asked every list at once. On 2026-10-19 one open
 * screen held six functions every 7.6 s and spent most of the month's free function time in a day.
 *
 * So the routes the screen calls by itself (the engine's reads and commands, entitlement, settings, the
 * owner list, referral stats) wait for the store only a few seconds counted from the request's arrival,
 * and once the store failed that way — silent past the deadline, or "Quota exceeded" — this server
 * instance answers reads "unavailable" at once for PAUSE_MS without asking it again. A write is always
 * tried: refused untried, a language chosen on a screen with no journal would be lost (Codex review).
 * A 503 is an answer: the browser stays online and its own backoff spaces the next attempts.
 *
 * The work is not cancelled (`withinDeadline`): a late write may still land. A command is idempotent by
 * its operation id, so "unavailable" for a command means what a timeout always meant — deliver it again.
 */

/** Reads take well under a second; both deadlines stay under the browser's 5 s and 8 s, cold start included. */
const READ_DEADLINE_MS = 3_000;
const WRITE_DEADLINE_MS = 5_000;
/** How long an instance stops asking a store that failed that way; the daily quota returns at midnight Pacific. */
const PAUSE_MS = 30_000;
/** gRPC status RESOURCE_EXHAUSTED, as the Firestore server SDK reports it on its errors. */
const RESOURCE_EXHAUSTED = 8;

export class StoreUnavailableError extends Error {
  readonly code = 'unavailable';
  readonly status = 503;

  constructor(readonly retryAfterSeconds: number) {
    super('Store unavailable');
    this.name = 'StoreUnavailableError';
  }
}

let pausedUntil = 0;

const unavailable = () => new StoreUnavailableError(Math.max(1, Math.ceil((pausedUntil - Date.now()) / 1000)));

/**
 * `startedAt` is the `performance.now()` the route read when the request arrived: verifying the caller
 * and reading the body spend the same budget the browser is counting.
 */
export async function withStore<T>(
  work: () => Promise<T>,
  { write = false, startedAt = performance.now() }: { write?: boolean; startedAt?: number } = {}
): Promise<T> {
  if (!write && Date.now() < pausedUntil) throw unavailable();
  let asked = false;
  let silent: Error | undefined;
  const ask = () => { asked = true; return work(); };
  try {
    return await withinDeadline(ask, startedAt + (write ? WRITE_DEADLINE_MS : READ_DEADLINE_MS), () => (silent = new Error('Store silent')));
  } catch (error) {
    // Out of time before the store was even asked: nothing was learned about the store.
    if (error === silent && !asked) throw unavailable();
    if (error !== silent && (error as { code?: unknown } | null)?.code !== RESOURCE_EXHAUSTED) throw error;
    pausedUntil = Date.now() + PAUSE_MS;
    throw unavailable();
  }
}

/** `Retry-After` for a refusal this module made; nothing for any other failure. */
export function storeRetryHeaders(error: unknown): Record<string, string> {
  return error instanceof StoreUnavailableError ? { 'Retry-After': String(error.retryAfterSeconds) } : {};
}

/**
 * The answer of a route the PERSON calls — an AI step, an audio step, a public link — when the store
 * refused that way (BUG-20261019-routes-hang-when-store-refuses). Those routes waited for the store
 * without a bound: 30–40 s on 2026-10-19, and on Vercel until the wall (10 s, 60 s for AI) before a
 * generic error. Their first store touch goes through `withStore`; its refusal answers here, so the
 * browser hears "unavailable" within seconds and the app says it in one line (`utils/serverAvailability`).
 */
export function storeUnavailableResponse(error: StoreUnavailableError): NextResponse {
  return NextResponse.json({ code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store', ...storeRetryHeaders(error) } });
}

export function __resetStoreAvailabilityForTests(): void {
  pausedUntil = 0;
}
