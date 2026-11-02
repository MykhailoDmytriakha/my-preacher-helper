/** Background page warming respects server pauses; actual navigation keeps its normal network path. */
const MAX_SERVER_PAUSE_MS = 24 * 60 * 60 * 1000;
const MAX_REFUSAL_PAUSE_MS = 60_000;

function httpDate(value: string | null): number | undefined {
  if (!value) return undefined;
  // HTTP dates, including the two obsolete forms a recipient must still understand. In particular,
  // a malformed fractional delay such as "1.5" must not become a date through Date.parse.
  const shape = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/;
  if (!shape.test(value)) return undefined;
  const parsed = Date.parse(value.endsWith(' GMT') ? value : value + ' GMT');
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requestedPause(response: Response, now: number): number | undefined {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Math.min(MAX_SERVER_PAUSE_MS, seconds * 1000);
  }
  const target = httpDate(value);
  if (target === undefined) return undefined;
  const reference = httpDate(response.headers.get('Date')) ?? now;
  return Math.min(MAX_SERVER_PAUSE_MS, Math.max(0, target - reference));
}

/** Called only for a response that was not a usable page; network errors are not permanent refusals. */
export function nextOfflineWarmRetry(response: Response, previousRefusals: number, now = Date.now()): {
  refusal: boolean; retryAt: number;
} {
  const refusal = response.redirected || response.ok || [401, 403, 429].includes(response.status)
    || (response.status >= 300 && response.status < 400);
  const requested = requestedPause(response, now);
  const fallback = refusal ? Math.min(MAX_REFUSAL_PAUSE_MS, 1000 * 2 ** Math.min(6, Math.max(0, previousRefusals))) : 0;
  const pause = requested ?? fallback;
  return { refusal, retryAt: pause > 0 ? now + pause : 0 };
}
