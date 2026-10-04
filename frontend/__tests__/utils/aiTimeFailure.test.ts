import { ranOutOfTime, withStatus } from '@/utils/aiTimeFailure';
import { FetchTimeoutError } from '@/utils/fetchWithTimeout';

/**
 * DID AN AI CALL RUN OUT OF TIME? Vercel cuts a route at 60 s with a bare 504 (or 408 at the edge),
 * and the client stops waiting at 90 s with a FetchTimeoutError; any of them is "out of time".
 */
describe('ranOutOfTime', () => {
  it.each([
    ['a bare 504 from the function ceiling', withStatus(new Error('HTTP 504'), 504)],
    ['a 408 from the edge', withStatus(new Error('Request Timeout'), 408)],
    ['the client clock', new FetchTimeoutError('Request to /api/thoughts timed out after 90000ms')],
  ])('is true for %s', (_name, error) => {
    expect(ranOutOfTime(error)).toBe(true);
  });

  it('is false for other failures and for errors without a status', () => {
    expect(ranOutOfTime(withStatus(new Error('Server error'), 500))).toBe(false);
    expect(ranOutOfTime(new Error('Gateway Timeout'))).toBe(false);
    expect(ranOutOfTime('boom')).toBe(false);
    expect(ranOutOfTime(null)).toBe(false);
  });

  it('reads a status given beside the error', () => {
    expect(ranOutOfTime(new Error('x'), 504)).toBe(true);
  });
});
