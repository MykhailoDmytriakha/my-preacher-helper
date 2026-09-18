'use client';

import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { resolveOwnerUid } from '@/utils/queryKeys';

/**
 * ONE WAY TO TALK TO THE APP'S OWN SERVER ABOUT AN OWNER'S DOCUMENTS.
 *
 * Written once for the orders of service, when the browser's Firestore went silent on the
 * owner's iPad, and now shared by every section that writes over HTTPS: the councils use the
 * same function, not a copy with a different name. The rules it keeps are the ones that were
 * paid for live:
 *
 * - A WRITE USES ONE TRANSPORT. A timeout is indeterminate — the server may have applied it —
 *   and is never a reason to replay through the SDK. It comes back as `deadline-exceeded`.
 * - WHOSE REQUEST THIS IS IS FIXED WHEN IT STARTS. A sign-in that happens while the token is
 *   fetched, or while the answer is in the air, must not hand one account's request to another.
 * - A CAS 409 carries the server's current document. A typed migration refusal
 *   is terminal and must never be interpreted as that document.
 */

const HTTP_ERROR_CODES: Record<number, string> = {
  400: 'invalid-argument',
  401: 'unauthenticated',
  403: 'permission-denied',
  404: 'not-found',
};

/**
 * What an HTTP status means in the Firestore-shaped error codes the rest of the app reads.
 * Four places kept their own shorter table; anything not a known refusal is `unavailable`,
 * which the read paths treat as "try the other road" and the write paths as "queue it".
 */
export const codeForHttpStatus = (status: number): string => HTTP_ERROR_CODES[status] ?? 'unavailable';

const ACCOUNT_CHANGED = 'Account changed';

/**
 * THE ANSWER TO A REQUEST THAT OUTLIVED ITS ACCOUNT.
 *
 * A sign-in that lands while a token is fetched or an answer is in the air must not hand one
 * account's documents to another. Seven places built this refusal by hand; it is one value now,
 * so a caller can also recognise it (`isAccountChangedError`) instead of matching the message.
 */
export function accountChangedError(): Error {
  return Object.assign(new Error(ACCOUNT_CHANGED), { code: 'unauthenticated' });
}

export function isAccountChangedError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCOUNT_CHANGED;
}

export interface OwnerHttpMessages {
  /** When the response is not ok and carries no message of its own. */
  failed: string;
  /** When the request outlives its deadline. */
  timedOut: string;
  /** When the transport itself fails before any answer. */
  unavailable: string;
}

export interface OwnerHttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload?: unknown;
  /** Overall bound, abort included; the per-request `apiClient` timeout stays shorter. */
  deadlineMs?: number;
  /** Statuses handed back as an answer instead of thrown — 409 for a refused compare-and-set. */
  answerStatuses?: number[];
  messages: OwnerHttpMessages;
  /** Let the request outlive the page — for the last save on the way out. */
  keepalive?: boolean;
}

export async function requestOwnerJson<T>(
  url: string,
  { method, payload, deadlineMs = 10000, answerStatuses = [409], messages, keepalive }: OwnerHttpOptions
): Promise<{ status: number; value: T }> {
  const resolvedMethod = method ?? (payload === undefined ? 'GET' : 'PATCH');
  const owner = resolveOwnerUid();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  const operation = async () => {
    const headers = await getAuthenticatedRequestHeaders();
    if (controller.signal.aborted) throw Object.assign(new Error('Request expired'), { code: 'deadline-exceeded' });
    if (!headers.Authorization || resolveOwnerUid() !== owner) {
      throw Object.assign(new Error('Authentication required'), { code: 'unauthenticated' });
    }
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    /*
     * A keepalive request may carry at most 64 KiB, and a browser refuses the whole request when
     * it is larger — so asking for keepalive on a long document is how the last save is lost
     * rather than saved. Over the limit the request goes without the flag: the browser MAY still
     * finish it as the page closes, which is strictly better than a refusal.
     */
    const withinKeepaliveBudget = body === undefined || new Blob([body]).size < 60_000;
    const response = await apiClient(url, {
      method: resolvedMethod,
      headers: { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body }),
      cache: 'no-store',
      category: 'crud',
      timeout: 8000,
      signal: controller.signal,
      ...(keepalive && withinKeepaliveBudget ? { keepalive: true } : {}),
    });
    const value = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (resolveOwnerUid() !== owner) throw accountChangedError();
    // A migration refusal is terminal for this legacy write, never a CAS document.
    if (response.status === 409 && value?.code === 'data-engine-required') {
      throw Object.assign(new Error(value.error ?? messages.failed), { code: 'data-engine-required', status: 409 });
    }
    if (!response.ok && !answerStatuses.includes(response.status)) {
      throw Object.assign(new Error(value?.error ?? messages.failed), {
        code: codeForHttpStatus(response.status),
      });
    }
    return { status: response.status, value: value as T };
  };

  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error(messages.timedOut), { code: 'deadline-exceeded' }));
        }, deadlineMs);
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code) throw error;
    throw Object.assign(new Error(messages.unavailable), { code: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
