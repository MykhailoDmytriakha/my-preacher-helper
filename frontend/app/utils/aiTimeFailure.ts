import { FetchTimeoutError } from '@/utils/fetchWithTimeout';

/**
 * DID AN AI CALL RUN OUT OF TIME? (.howto/raise-route-time-limit.md)
 *
 * An AI route has 60 seconds. A 504 means some hop stopped waiting — Vercel killing the function at
 * that ceiling, a gateway, or the route's own deadline (compose answers its 45 s deadline with a
 * 504) — a 408 is the edge, and past the client's own 90 seconds `apiClient` gives up with a
 * `FetchTimeoutError`. Each says only that no answer arrived in the time allowed: not that the work
 * stopped (the server may still finish and save it), and nothing certain about the input. So a
 * screen that answers it invites a retry, only suggests a shorter text, and never shows the status
 * line ("HTTP 504", "Gateway Timeout"), which is a sentence for developers.
 *
 * A client that throws on a non-OK response attaches the status (`withStatus`) so this can be asked
 * after the fact, wherever the error is shown.
 */
export function ranOutOfTime(error: unknown, status?: number): boolean {
  if (error instanceof FetchTimeoutError) return true;
  const code = status ?? (typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined);
  return code === 408 || code === 504;
}

/**
 * Did a server-side AI call stop at its owner's own deadline — the chain's (`ChainDeadlineError`,
 * "AI call timed out") or the SDK's per-request timer (`APIConnectionTimeoutError`)? The route then
 * answers a 504 with a code, which `ranOutOfTime` reads on the screen. Not "timeout" alone: a
 * "timeout must be positive" refusal is a bad request, not a late answer.
 */
export function stoppedAtDeadline(error: { name?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.name === 'APIConnectionTimeoutError' || /\btimed out\b/i.test(error.message ?? '')));
}

/** The error a client throws for a non-OK response, carrying the status `ranOutOfTime` reads. */
export function withStatus(error: Error, status: number): Error & { status: number } {
  return Object.assign(error, { status });
}
