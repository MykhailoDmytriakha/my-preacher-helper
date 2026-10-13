import { requestOwnerJson } from '@/services/ownerHttpTransport.client';

const mockRequest = jest.fn();
jest.mock('@/utils/apiClient', () => ({ apiClient: (...args: unknown[]) => mockRequest(...args) }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: async () => ({ Authorization: 'Bearer owner' }) }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'owner' }));
const document = { id: 'c', title: 'Document', rev: 1 };
const response = (value: unknown, status: number) => ({ ok: status < 400, status, json: async () => value });
const messages = { failed: 'Failed', timedOut: 'Timed out', unavailable: 'Unavailable' };
beforeEach(() => jest.clearAllMocks());
it('hands back a compare-and-set 409 and every other explicitly allowed response as an answer', async () => {
  mockRequest.mockResolvedValue(response(document, 409));
  expect(await requestOwnerJson('/api/custom', { method: 'PUT', payload: document, messages })).toEqual({ status: 409, value: document });
  mockRequest.mockResolvedValue(response({ reason: 'review' }, 422));
  expect(await requestOwnerJson('/api/custom', { messages, answerStatuses: [422] })).toEqual({ status: 422, value: { reason: 'review' } });
});
// The server refuses with 426 (legacyBoundary.server.ts LEGACY_REFUSAL_STATUS); a deployment still
// answering 409 must be understood too. The refusal is known by its code, whatever the status —
// matched by status, a 426 would degrade into a retryable "unavailable".
it.each([['POST', 426], ['PUT', 426], ['DELETE', 426], ['PUT', 409]] as const)('throws a migration refusal before %s can read it as a document (status %d)', async (method, status) => {
  mockRequest.mockResolvedValue(response({ code: 'data-engine-required', error: 'Migration required' }, status));
  await expect(requestOwnerJson('/api/custom', { method, payload: document, messages })).rejects.toMatchObject({ code: 'data-engine-required', status });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('does not turn an unknown network result into a retry or a CAS answer', async () => {
  mockRequest.mockRejectedValue(new Error('Network failed'));
  await expect(requestOwnerJson('/api/custom', { method: 'PUT', payload: document, messages })).rejects.toMatchObject({ code: 'unavailable' });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
