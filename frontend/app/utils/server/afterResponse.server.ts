import { after } from 'next/server';

/**
 * Work the person must not wait for: it runs once the response is sent and keeps the function alive
 * for it. Without a request scope to defer to (a script, a test), it still runs, detached.
 */
export function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}
