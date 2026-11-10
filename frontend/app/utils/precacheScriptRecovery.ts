import { withinDeadline } from './withinDeadline';

import type { SerwistPlugin } from 'serwist';

const RETRY_DEADLINE_MS = 8_000;
const SCRIPT_MEDIA_TYPES = new Set(['application/javascript', 'text/javascript', 'application/x-javascript']);

function isSuccessfulScript(response: Response): boolean {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return response.status === 200 && SCRIPT_MEDIA_TYPES.has(mediaType);
}

async function completeBody(response: Response): Promise<Response> {
  const reader = response.clone().body?.getReader();
  if (!reader) return response;
  try {
    // Drain the clone without keeping a second full byte array. The original remains unread.
    while (!(await reader.read()).done) { /* wait for the end of this network response */ }
    return response;
  } finally {
    reader.releaseLock();
  }
}

/** Serwist calls this for network responses, so an ordinary precache hit never reads a body twice. */
export function createPrecacheScriptRecovery(origin: string): SerwistPlugin {
  return {
    async fetchDidSucceed({ event, request, response }) {
      const url = new URL(request.url);
      if (event.type !== 'fetch' || request.method !== 'GET' || url.origin !== origin
        || !url.pathname.startsWith('/_next/static/chunks/') || !url.pathname.endsWith('.js')
        || !isSuccessfulScript(response)) return response;
      try {
        return await completeBody(response);
      } catch (error) {
        if (request.signal.aborted) throw error;
      }

      // Only a failed body reaches this point. Retain the request's credentials and integrity.
      const controller = new AbortController();
      const cancel = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', cancel, { once: true });
      try {
        return await withinDeadline(async () => {
          const retried = await fetch(new Request(request, { cache: 'reload', signal: controller.signal }));
          return isSuccessfulScript(retried) ? completeBody(retried) : retried;
        }, performance.now() + RETRY_DEADLINE_MS, () => {
          const timeout = new Error('Timed out reading the application script retry');
          controller.abort(timeout);
          return timeout;
        });
      } finally {
        request.signal.removeEventListener('abort', cancel);
      }
    },
  };
}
