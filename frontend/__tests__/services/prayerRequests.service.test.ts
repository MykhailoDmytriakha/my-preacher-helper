const mockGetAllPrayerRequestsViaClient = jest.fn();
const mockGetPrayerRequestByIdViaClient = jest.fn();
const mockUpdatePrayerRequestViaClient = jest.fn();
const mockDeletePrayerRequestViaClient = jest.fn();
const mockAddPrayerUpdateViaClient = jest.fn();
const mockSetPrayerStatusViaClient = jest.fn();

jest.mock('@/utils/clientId', () => ({
  newClientId: jest.fn(() => 'stable-client-id'),
}));

jest.mock('@/services/prayerRequests.client', () => ({
  getAllPrayerRequestsViaClient: (...args: unknown[]) => mockGetAllPrayerRequestsViaClient(...args),
  getPrayerRequestByIdViaClient: (...args: unknown[]) => mockGetPrayerRequestByIdViaClient(...args),
  updatePrayerRequestViaClient: (...args: unknown[]) => mockUpdatePrayerRequestViaClient(...args),
  deletePrayerRequestViaClient: (...args: unknown[]) => mockDeletePrayerRequestViaClient(...args),
  addPrayerUpdateViaClient: (...args: unknown[]) => mockAddPrayerUpdateViaClient(...args),
  setPrayerStatusViaClient: (...args: unknown[]) => mockSetPrayerStatusViaClient(...args),
}));

import {
  addPrayerUpdate,
  createPrayerRequest,
  deletePrayerRequest,
  getAllPrayerRequests,
  getPrayerRequestById,
  setPrayerStatus,
  updatePrayerRequest,
} from '@/services/prayerRequests.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('prayerRequests.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE = '';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
  });

  it('routes dead operations through the client SDK', async () => {
    mockGetAllPrayerRequestsViaClient.mockResolvedValueOnce([{ id: 'p1', title: 'Prayer 1' }]);
    mockGetPrayerRequestByIdViaClient.mockResolvedValueOnce({ id: 'p1', title: 'Prayer 1' });
    mockUpdatePrayerRequestViaClient.mockResolvedValueOnce({ id: 'p1', title: 'Updated' });
    mockDeletePrayerRequestViaClient.mockResolvedValueOnce(undefined);
    mockAddPrayerUpdateViaClient.mockResolvedValueOnce({ id: 'p1', updates: [{ id: 'stable-client-id' }] });
    mockSetPrayerStatusViaClient.mockResolvedValueOnce({ id: 'p1', status: 'answered' });

    await expect(getAllPrayerRequests('user-1')).resolves.toHaveLength(1);
    await expect(getPrayerRequestById('p1')).resolves.toEqual({ id: 'p1', title: 'Prayer 1' });
    await expect(updatePrayerRequest('p1', { title: 'Updated' })).resolves.toEqual({ id: 'p1', title: 'Updated' });
    await expect(deletePrayerRequest('p1')).resolves.toBeUndefined();
    await expect(addPrayerUpdate('p1', 'Fresh update')).resolves.toEqual({
      id: 'p1',
      updates: [{ id: 'stable-client-id' }],
    });
    await expect(setPrayerStatus('p1', 'answered', 'Yes')).resolves.toEqual({ id: 'p1', status: 'answered' });

    expect(mockGetAllPrayerRequestsViaClient).toHaveBeenCalledWith('user-1');
    expect(mockGetPrayerRequestByIdViaClient).toHaveBeenCalledWith('p1');
    expect(mockUpdatePrayerRequestViaClient).toHaveBeenCalledWith('p1', { title: 'Updated' });
    expect(mockDeletePrayerRequestViaClient).toHaveBeenCalledWith('p1');
    expect(mockAddPrayerUpdateViaClient).toHaveBeenCalledWith('p1', {
      updateId: 'stable-client-id',
      text: 'Fresh update',
      createdAt: expect.any(String),
    });
    expect(mockSetPrayerStatusViaClient).toHaveBeenCalledWith('p1', {
      status: 'answered',
      answerText: 'Yes',
      updatedAt: expect.any(String),
      answeredAt: expect.any(String),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps createPrayerRequest on the server route', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'p1', title: 'Created prayer' }),
    });

    const created = await createPrayerRequest({ userId: 'user-1', title: 'Created prayer', tags: ['faith'] } as any);

    expect(created.id).toBe('p1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/prayer'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws when server create fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    await expect(createPrayerRequest({ userId: 'user-1', title: 'x' } as any)).rejects.toThrow(
      'Failed to create prayer request'
    );
  });
});
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));
