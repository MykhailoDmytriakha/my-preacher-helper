/** Observed transport failures, shared without importing the browser HTTP client. */
const connectionFailures = new WeakSet<object>();

/** Called only by a transport at the point where it observed a connection failure. */
export function markConnectionFailure(error: object): void {
  connectionFailures.add(error);
}

/**
 * DID THIS FAILURE COME FROM NOT REACHING THE SERVER — as opposed to the server answering "no"?
 *
 * Decided where the request was made, not guessed from a sentence: a service that turns a 403 into
 * `new Error('Failed to fetch share links')` is reporting an answer, and a TypeError from our own code
 * is not a network (Codex review 2026-10-11). Yes for an error `apiClient` marked as not reaching the
 * server, for a transport's `unavailable` / `deadline-exceeded`, for Firebase Auth failing to fetch a
 * token (`auth/network-request-failed`, before `apiClient` runs), and for the Firestore SDK saying the
 * client is offline.
 */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (connectionFailures.has(error)) return true;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const bare = typeof code === 'string' ? code.replace(/^firestore\//, '') : '';
  if (bare === 'unavailable' || bare === 'deadline-exceeded' || bare === 'auth/network-request-failed') return true;
  return typeof message === 'string' && /client is offline/i.test(message);
}
