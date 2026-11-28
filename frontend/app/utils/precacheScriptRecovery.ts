import { withinDeadline } from './withinDeadline';

import type { SerwistPlugin } from 'serwist';

const SCRIPT_DEADLINE_MS = 8_000;
const TRANSIENT_SCRIPT_STATUSES = new Set([502, 503, 504]);
const SCRIPT_MEDIA_TYPES = new Set(['application/javascript', 'text/javascript', 'application/x-javascript']);

function isSuccessfulScript(response: Response): boolean {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return response.status === 200 && SCRIPT_MEDIA_TYPES.has(mediaType);
}

async function completeBody(response: Response, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) {
    void response.body?.cancel(signal.reason).catch(() => undefined);
    throw signal.reason;
  }
  const reader = response.clone().body?.getReader();
  if (!reader) return response;
  const abandon = () => {
    // A cloned body has two consumers. Neither will read this response after a timeout.
    void reader.cancel(signal.reason).catch(() => undefined);
    void response.body?.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', abandon, { once: true });
  try {
    // Drain the clone without keeping a second full byte array. The original remains unread.
    while (!(await reader.read()).done) { /* wait for the end of this network response */ }
    if (signal.aborted) throw signal.reason;
    return response;
  } finally {
    signal.removeEventListener('abort', abandon);
    reader.releaseLock();
  }
}

async function readBeforeDeadline(request: Request, message: string,
  read: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) cancel();
  else request.signal.addEventListener('abort', cancel, { once: true });
  try {
    return await withinDeadline(() => read(controller.signal), performance.now() + SCRIPT_DEADLINE_MS, () => {
      const timeout = new Error(message);
      controller.abort(timeout);
      return timeout;
    });
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
          return await readBeforeDeadline(request, 'Timed out reading the application script', signal => completeBody(response, signal));
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
      return readBeforeDeadline(request, 'Timed out reading the application script retry', async signal => {
        const retried = await fetch(new Request(request, { cache: 'reload', signal }));
        return isSuccessfulScript(retried) ? completeBody(retried, signal) : retried;
      });
    },
  };
}
