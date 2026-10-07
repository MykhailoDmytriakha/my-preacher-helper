/**
 * WAIT FOR WORK ONLY UNTIL A DEADLINE (BUG-20261006-ai-call-outlives-the-wall).
 *
 * The deadline is a moment on the `performance.now()` clock, set once by whoever owns the wall — a
 * route when the request arrives, an AI chain when it starts. Work is started only while the deadline
 * lasts and waited for only until it runs out. The work itself is not cancelled — a read left running
 * is harmless — and its late outcome is still handled, never an unhandled rejection. `overdue` makes
 * the refusal the caller's own: an AI chain says "timed out", a route answers its 504.
 */
export async function withinDeadline<T>(start: () => Promise<T>, deadline: number, overdue: () => Error): Promise<T> {
  const left = deadline - performance.now();
  if (left <= 0) throw overdue();
  const work = start();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(overdue()), left); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A route's own wall ran out before its work could finish: answered as the 504 it is. */
export class RouteDeadlineError extends Error {
  constructor(stage: string) {
    super(`Route timed out ${stage}`);
    this.name = 'RouteDeadlineError';
  }
}
