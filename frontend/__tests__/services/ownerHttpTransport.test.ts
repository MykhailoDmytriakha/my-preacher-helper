import { createCouncilOnServer, deleteCouncilOnServer, replaceCouncilOnServer } from '@/services/councilsTransport.client';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';

import type { Council } from '@/models/models';

const mockRequest = jest.fn();
jest.mock('@/utils/apiClient', () => ({ apiClient: (...args: unknown[]) => mockRequest(...args) }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: async () => ({ Authorization: 'Bearer owner' }) }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'owner' }));
const council: Council = { id: 'c', userId: 'owner', title: 'Council', status: 'preparing', topics: [], createdAt: 'T', updatedAt: 'T', rev: 1 };
const response = (value: unknown, status: number) => ({ ok: status < 400, status, json: async () => value });
const messages = { failed: 'Failed', timedOut: 'Timed out', unavailable: 'Unavailable' };
beforeEach(() => jest.clearAllMocks());
it('preserves true council CAS409 and every other explicitly allowed response', async () => {
  mockRequest.mockResolvedValue(response(council, 409));
  expect(await replaceCouncilOnServer(council, 0)).toEqual({ conflict: true, current: council });
  mockRequest.mockResolvedValue(response({ reason: 'review' }, 422));
  expect(await requestOwnerJson('/api/custom', { messages, answerStatuses: [422] })).toEqual({ status: 422, value: { reason: 'review' } });
});
it.each(['create', 'replace', 'delete'])('throws council migration refusal before %s can read it as a document', async action => {
  mockRequest.mockResolvedValue(response({ code: 'data-engine-required', error: 'Migration required' }, 409));
  const operation = action === 'create' ? createCouncilOnServer(council) : action === 'replace' ? replaceCouncilOnServer(council, 1) : deleteCouncilOnServer('c');
  await expect(operation).rejects.toMatchObject({ code: 'data-engine-required', status: 409 });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('does not turn an unknown network result into a retry or a CAS answer', async () => {
  mockRequest.mockRejectedValue(new Error('Network failed'));
  await expect(replaceCouncilOnServer(council, 1)).rejects.toMatchObject({ code: 'unavailable' });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
