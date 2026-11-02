/** @jest-environment node */
import { nextOfflineWarmRetry } from '@/utils/offlineWarmRetry';

const now = Date.parse('Mon, 02 Nov 2026 10:00:00 GMT');
const response = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe('background offline page warm retry policy', () => {
  it('honors an explicit delay without treating a transient refusal as a missing page', () => {
    expect(nextOfflineWarmRetry(response(429, { 'Retry-After': '60' }), 0, now)).toEqual({ refusal: true, retryAt: now + 60_000 });
    expect(nextOfflineWarmRetry(response(503, { 'Retry-After': '30' }), 0, now)).toEqual({ refusal: false, retryAt: now + 30_000 });
  });

  it('interprets an HTTP date against the server date when the device clock differs', () => {
    const headers = { 'Date': 'Mon, 02 Nov 2026 09:00:00 GMT', 'Retry-After': 'Mon, 02 Nov 2026 09:01:00 GMT' };
    expect(nextOfflineWarmRetry(response(429, headers), 0, now).retryAt).toBe(now + 60_000);
    expect(nextOfflineWarmRetry(response(429, { 'Retry-After': 'Mon, 02 Nov 2026 10:01:00 GMT' }), 0, now).retryAt).toBe(now + 60_000);
  });

  it.each(['Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994'])('accepts the obsolete HTTP date form %s', value => {
    const server = 'Sun, 06 Nov 1994 08:49:00 GMT';
    expect(nextOfflineWarmRetry(response(429, { Date: server, 'Retry-After': value }), 0, now).retryAt).toBe(now + 37_000);
  });

  it.each(['1.5', '-1', 'nonsense', ''])('uses bounded backoff for the malformed delay %s', value => {
    expect(nextOfflineWarmRetry(response(403, { 'Retry-After': value }), 2, now)).toEqual({ refusal: true, retryAt: now + 4000 });
  });

  it('bounds permanent refusals and very long server pauses', () => {
    for (const status of [401, 403, 429, 302, 200]) {
      expect(nextOfflineWarmRetry(response(status), 0, now).retryAt).toBe(now + 1000);
      expect(nextOfflineWarmRetry(response(status), 100, now).retryAt).toBe(now + 60_000);
    }
    expect(nextOfflineWarmRetry(response(429, { 'Retry-After': '9999999999' }), 0, now).retryAt).toBe(now + 86_400_000);
  });

  it('does not delay a transient response or extend an explicit zero or past pause', () => {
    expect(nextOfflineWarmRetry(response(503), 0, now)).toEqual({ refusal: false, retryAt: 0 });
    expect(nextOfflineWarmRetry(response(429, { 'Retry-After': '0' }), 5, now).retryAt).toBe(0);
    expect(nextOfflineWarmRetry(response(429, { 'Retry-After': 'Mon, 02 Nov 2026 09:00:00 GMT' }), 5, now).retryAt).toBe(0);
  });
});
