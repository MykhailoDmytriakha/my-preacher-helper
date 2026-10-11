import { shouldPersistQuery } from '@/providers/QueryProvider';

/**
 * WHAT GOES INTO THE SAVED COPY (BUG-20261010-persisted-query-copy-dropped-after-failed-refetch).
 *
 * A query whose background refetch failed still holds what the person saw. Keeping only `success`
 * dropped it from the copy written right after the failure, and the next start without a network
 * showed nothing where the data had been.
 */
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  shouldPersistLegacyQuery: () => true,
}));

const query = (state: Record<string, unknown>) => ({ queryKey: ['share-links', 'u1'], state } as never);

it('keeps a query that has data even after its refetch could not reach the server', async () => {
  // Marked where the request was made: apiClient saw no answer come back.
  const { apiClient } = jest.requireActual('@/utils/apiClient');
  const realFetch = global.fetch;
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
  const failure = await apiClient('/api/studies/share-links').catch((error: unknown) => error);
  global.fetch = realFetch;
  expect(shouldPersistQuery(query({ status: 'error', data: [{ id: 'link-1' }], error: failure }))).toBe(true);
  expect(shouldPersistQuery(query({ status: 'error', data: [{ id: 'link-1' }], error: Object.assign(new Error('x'), { code: 'unavailable' }) }))).toBe(true);
});

it('keeps a query whose sign-in token could not be fetched for want of a network', () => {
  // Firebase Auth fails before `apiClient` runs (entitlement, referral stats) and says so by code.
  const tokenFailure = Object.assign(new Error('Firebase: Error (auth/network-request-failed).'), { code: 'auth/network-request-failed' });
  expect(shouldPersistQuery(query({ status: 'error', data: { tier: 'pro' }, error: tokenFailure }))).toBe(true);
});

it('does not take an answer for a lost connection because of its wording or its type', () => {
  // A service reporting a 403 in words that contain "Failed to fetch", and a TypeError from our own code.
  expect(shouldPersistQuery(query({ status: 'error', data: [{ id: 'link-1' }], error: new Error('Failed to fetch share links') }))).toBe(false);
  expect(shouldPersistQuery(query({ status: 'error', data: [{ id: 'link-1' }], error: new TypeError("Cannot read properties of undefined (reading 'id')") }))).toBe(false);
});

it('does not keep data the server has since answered "gone" or "not yours" about', () => {
  // A series deleted elsewhere must not come back from the saved copy on the next offline start.
  expect(shouldPersistQuery(query({ status: 'error', data: { id: 's1' }, error: new Error('Series not found') }))).toBe(false);
  expect(shouldPersistQuery(query({ status: 'error', data: { id: 's1' }, error: Object.assign(new Error('denied'), { code: 'permission-denied' }) }))).toBe(false);
});

it('keeps a successful query and skips one that never got data', () => {
  expect(shouldPersistQuery(query({ status: 'success', data: [] }))).toBe(true);
  expect(shouldPersistQuery(query({ status: 'error', data: undefined, error: new Error('x') }))).toBe(false);
  expect(shouldPersistQuery(query({ status: 'pending', data: undefined }))).toBe(false);
});
