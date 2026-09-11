import { createServiceOrderOnServer, deleteServiceOrderOnServer, readServiceOrderOnServer, setServiceOrderRanksOnServer, updateServiceOrderMetaOnServer, updateServiceOrderStepsOnServer } from '@/services/serviceOrderEditing.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
const mockRequest = jest.fn();
const mockHeaders = jest.fn();
let mockOwner = 'owner';
jest.mock('@/utils/apiClient', () => ({ apiClient: (...args: unknown[]) => mockRequest(...args) }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: () => mockHeaders() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => mockOwner }));
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value });
const order = { id: 'o1', userId: 'owner', title: 'Visit', steps: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], rev: { steps: 1 } };
beforeEach(() => { jest.clearAllMocks(); mockOwner = 'owner'; mockHeaders.mockResolvedValue({ Authorization: 'Bearer token' }); });
it('recomputes deletion against new data instead of overwriting its text', async () => {
  const newer = { ...order, steps: [{ id: 'a', title: 'A' }, { id: 'b', title: 'New words' }], rev: { steps: 2 } };
  mockRequest.mockResolvedValueOnce(response(order)).mockResolvedValueOnce(response(newer, 409)).mockResolvedValueOnce(response({ ...newer, steps: [newer.steps[1]], rev: { steps: 3 } }));
  expect(await updateServiceOrderStepsOnServer('o1', steps => steps.filter(step => step.id !== 'a'))).toEqual([newer.steps[1]]);
  expect(JSON.parse(mockRequest.mock.calls[2][1].body)).toMatchObject({ expectedRevision: 2, steps: [newer.steps[1]] });
});
it('does not write a no-op', async () => {
  mockRequest.mockResolvedValue(response(order));
  expect(await updateServiceOrderStepsOnServer('o1', () => null)).toBeNull();
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('does not retry an indeterminate write failure', async () => {
  mockRequest.mockResolvedValueOnce(response(order)).mockRejectedValueOnce(new Error('Network error'));
  await expect(updateServiceOrderStepsOnServer('o1', () => [])).rejects.toMatchObject({ code: 'unavailable' });
  expect(mockRequest).toHaveBeenCalledTimes(2);
});
it('preserves actionable title conflicts', async () => {
  mockRequest.mockResolvedValue(response({ ...order, rev: { meta: 4 } }, 409));
  await expect(updateServiceOrderMetaOnServer('o1', { title: 'New' }, 2, { title: 'Old' })).rejects.toBeInstanceOf(StaleWriteError);
});
it('maps absence and sends placement through authenticated HTTP', async () => {
  mockRequest.mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({ saved: true }));
  expect(await readServiceOrderOnServer('missing')).toBeNull();
  await setServiceOrderRanksOnServer([{ id: 'o1', rank: 40 }]);
  expect(mockRequest.mock.calls[1][0]).toBe('/api/service-orders/placement');
});
it('refuses account switching during token acquisition before writing', async () => {
  mockHeaders.mockImplementation(async () => { mockOwner = 'other'; return { Authorization: 'Bearer other' }; });
  await expect(setServiceOrderRanksOnServer([{ id: 'o1', rank: 40 }])).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockRequest).not.toHaveBeenCalled();
});
it('bounds silent token acquisition and never sends the expired write', async () => {
  jest.useFakeTimers();
  let headers!: (value: unknown) => void;
  mockHeaders.mockImplementation(() => new Promise(resolve => { headers = resolve; }));
  const request = setServiceOrderRanksOnServer([{ id: 'o1', rank: 40 }]);
  const rejection = expect(request).rejects.toMatchObject({ code: 'deadline-exceeded' });
  await jest.advanceTimersByTimeAsync(10000);
  await rejection;
  headers({ Authorization: 'Bearer token' });
  await Promise.resolve();
  expect(mockRequest).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('creates and deletes through the same bounded HTTP transport', async () => {
  mockRequest.mockResolvedValueOnce(response(order, 201)).mockResolvedValueOnce(response({ saved: true }));
  await createServiceOrderOnServer({ userId: 'owner', title: 'Visit', steps: [], rank: 1, createdAt: 'now', updatedAt: 'now' });
  expect(mockRequest.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(mockRequest.mock.calls[0][1].body)).not.toHaveProperty('userId');
  await deleteServiceOrderOnServer('o1');
  expect(mockRequest.mock.calls[1][1].method).toBe('DELETE');
});
