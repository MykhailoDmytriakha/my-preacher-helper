import { withinDeadline } from './withinDeadline';

import type { SerwistPlugin } from 'serwist';

const SCRIPT_INACTIVITY_MS = 8_000;
const TRANSIENT_SCRIPT_STATUSES = new Set([502, 503, 504]);
const SCRIPT_MEDIA_TYPES = new Set(['application/javascript', 'text/javascript', 'application/x-javascript']);

function isSuccessfulScript(response: Response): boolean {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return response.status === 200 && SCRIPT_MEDIA_TYPES.has(mediaType);
}

async function completeBody(response: Response, signal: AbortSignal, message: string,
  abortOnStall?: (reason: Error) => void): Promise<Response> {
  if (signal.aborted) {
    void response.body?.cancel(signal.reason).catch(() => undefined);
    throw signal.reason;
  }
  const reader = response.clone().body?.getReader();
  if (!reader) return response;
  const abandon = (reason: unknown) => {
    // A cloned body has two consumers. Neither will read this response after a timeout.
    void reader.cancel(reason).catch(() => undefined);
    void response.body?.cancel(reason).catch(() => undefined);
  };
  const cancel = () => abandon(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  let deadline = performance.now() + SCRIPT_INACTIVITY_MS;
  let stalled: Error | undefined;
  try {
    for (;;) {
      const chunk = await withinDeadline(() => reader.read(), deadline, () => {
        stalled = new Error(message);
        (abortOnStall ?? abandon)(stalled);
        return stalled;
      });
      if (signal.aborted) throw signal.reason;
      // Cancelling the reader can resolve its waiting read before the timeout rejects.
      if (stalled) throw stalled;
      if (chunk.done) return response;
      // Drain the clone while the original remains unread. Only actual bytes extend the deadline.
      if (chunk.value.byteLength) deadline = performance.now() + SCRIPT_INACTIVITY_MS;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function retryScript(request: Request): Promise<Response> {
  const message = 'Timed out reading the application script retry';
  const controller = new AbortController();
  const cancel = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) cancel();
  else request.signal.addEventListener('abort', cancel, { once: true });
  try {
    const retried = await withinDeadline(
      () => fetch(new Request(request, { cache: 'reload', signal: controller.signal })),
      performance.now() + SCRIPT_INACTIVITY_MS,
      () => {
        const timeout = new Error(message);
        controller.abort(timeout);
        return timeout;
      },
    );
    return isSuccessfulScript(retried)
      ? await completeBody(retried, controller.signal, message, reason => controller.abort(reason))
      : retried;
  } finally {
    request.signal.removeEventListener('abort', cancel);
  }
}

/** Serwist calls this for network responses, so an ordinary precache hit never reads a body twice. */
export function createPrecacheScriptRecovery(origin: string): SerwistPlugin {
  return {
    async fetchDidSucceed({ event, request, response }) {
      const url = new URL(request.url);
      if (event.type !== 'fetch' || request.method !== 'GET' || url.origin !== origin
        || !url.pathname.startsWith('/_next/static/chunks/') || !url.pathname.endsWith('.js')) return response;
      if (isSuccessfulScript(response)) {
        try {
          return await completeBody(response, request.signal, 'Timed out reading the application script');
        } catch (error) {
          if (request.signal.aborted) throw error;
        }
      } else {
        if (request.signal.aborted || !TRANSIENT_SCRIPT_STATUSES.has(response.status)
          || response.headers.has('retry-after')) return response;
        void response.body?.cancel().catch(() => undefined);
      }

      // Keep one bounded retry for a broken body or temporary gateway response.
      // Retain the request's credentials and integrity.
      return retryScript(request);
    },
  };
}
