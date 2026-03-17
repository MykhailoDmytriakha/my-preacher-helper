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
 * Resilient fetch with AbortSignal chaining and deterministic error classification.
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

  const timeoutId = setTimeout(() => {
    debugLog('fetchWithTimeout: aborting request due to timeout', { url, timeout });
    isInternalTimeout = true;
    controller.abort();
  }, timeout);

  const onExternalAbort = () => {
    debugLog('fetchWithTimeout: external signal aborted', { url });
    controller.abort();
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    if (err.name === 'AbortError') {
      // Deterministic classification: internal flag first
      if (isInternalTimeout) {
        throw new FetchTimeoutError(`Request to ${url} timed out after ${timeout}ms`);
      }
      if (externalSignal?.aborted) {
        throw externalSignal.reason || error;
      }
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
