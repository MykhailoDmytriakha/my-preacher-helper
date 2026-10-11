import { debugLog } from '@/utils/debugMode';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
}

export class FetchTimeoutError extends Error {
  constructor(message: string = 'Request timed out') {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

/**
 * Body reads a caller awaits as a whole; a stream taken with `getReader()` is its owner's to bound.
 * `formData()` is left out, as `apiClient` leaves it out: its TypeError also means "not form data".
 */
const BODY_READS = ['json', 'text', 'arrayBuffer', 'blob'] as const;

/**
 * Resilient fetch with AbortSignal chaining and deterministic error classification.
 *
 * A body read as a whole gets the same deadline again, counted from the moment it starts: the headers
 * can come while the body never does, and a read that waits for ever holds the screen without an
 * error and without "no connection" (BUG-20261011-body-after-headers-no-deadline). A fresh window and
 * not what is left of the first one, so a body read late or right at the edge is not cut for being
 * late. The caller's own cancel reaches the body read too. A stream read through `getReader()` —
 * audio, long generations — keeps no deadline after the headers, as before: its length is the
 * caller's business.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = 5000, signal: externalSignal, ...fetchOptions } = options;

  if (externalSignal?.aborted) {
    throw externalSignal.reason;
  }

  const controller = new AbortController();
  let isInternalTimeout = false;

  /** Bound one stretch of the request — the wait for the headers, or one body read — and undo it. */
  const bound = (): (() => void) => {
    const timeoutId = setTimeout(() => {
      debugLog('fetchWithTimeout: aborting request due to timeout', { url, timeout });
      isInternalTimeout = true;
      controller.abort();
    }, timeout);
    const onExternalAbort = () => {
      debugLog('fetchWithTimeout: external signal aborted', { url });
      controller.abort();
    };
    externalSignal?.addEventListener('abort', onExternalAbort);
    if (externalSignal?.aborted) controller.abort();
    return () => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    };
  };

  /** An abort the request caused itself, named: our deadline, or the caller's own reason. */
  const classify = (error: unknown): unknown => {
    const err = error as Error & { name?: string };
    if (err?.name === 'AbortError') {
      // Deterministic classification: internal flag first
      if (isInternalTimeout) return new FetchTimeoutError(`Request to ${url} timed out after ${timeout}ms`);
      if (externalSignal?.aborted) return externalSignal.reason ?? error;
    }
    return error;
  };

  const release = bound();
  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    throw classify(error);
  } finally {
    release();
  }

  return boundBodyReads(response, bound, classify);
}

function boundBodyReads(response: Response, bound: () => () => void, classify: (error: unknown) => unknown): Response {
  // A response that cannot take own properties is returned as it is, as before.
  if (!Object.isExtensible(response)) return response;
  for (const method of BODY_READS) {
    const read = response[method]?.bind(response);
    if (!read || Object.getOwnPropertyDescriptor(response, method)?.configurable === false) continue;
    Object.defineProperty(response, method, {
      configurable: true,
      value: async () => {
        // A body already read or held by a stream reader: the platform refuses this read by itself,
        // and arming here would only abort the read or the stream that owns the body.
        if (response.bodyUsed || response.body?.locked) return read();
        const release = bound();
        try {
          return await read();
        } catch (error) {
          throw classify(error);
        } finally {
          release();
        }
      },
    });
  }
  return response;
}
