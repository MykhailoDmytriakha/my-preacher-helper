const mockApiClient = jest.fn();
const mockGetSermonsViaClient = jest.fn();
const mockGetSermonByIdViaClient = jest.fn();
const mockUpdateSermonViaClient = jest.fn();
const mockUpdateSermonPreparationViaClient = jest.fn();

jest.mock('@/utils/apiClient', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}));

jest.mock('@/services/sermons.client', () => ({
  getSermonsViaClient: (...args: unknown[]) => mockGetSermonsViaClient(...args),
  getSermonByIdViaClient: (...args: unknown[]) => mockGetSermonByIdViaClient(...args),
  updateSermonViaClient: (...args: unknown[]) => mockUpdateSermonViaClient(...args),
  updateSermonPreparationViaClient: (...args: unknown[]) => mockUpdateSermonPreparationViaClient(...args),
}));

import {
  createSermon,
  deleteSermon,
  getSermonById,
  getSermons,
  updateSermon,
  updateSermonPreparation,
} from '@/services/sermon.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

describe('sermon.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes reads and own-doc updates through the client SDK', async () => {
    const sermons = [{ id: 's1', userId: 'u1', title: 'Sermon' }];
    const sermon = { id: 's1', userId: 'u1', title: 'Updated' };
    const preparation = { targetAudience: 'Youth' };

    mockGetSermonsViaClient.mockResolvedValueOnce(sermons);
    mockGetSermonByIdViaClient.mockResolvedValueOnce(sermon);
    mockUpdateSermonViaClient.mockResolvedValueOnce(sermon);
    mockUpdateSermonPreparationViaClient.mockResolvedValueOnce(preparation);

    await expect(getSermons('u1')).resolves.toBe(sermons);
    await expect(getSermonById('s1')).resolves.toBe(sermon);
    await expect(updateSermon(sermon as any)).resolves.toBe(sermon);
    await expect(updateSermonPreparation('s1', preparation as any)).resolves.toBe(preparation);

    expect(mockGetSermonsViaClient).toHaveBeenCalledWith('u1');
    expect(mockGetSermonByIdViaClient).toHaveBeenCalledWith('s1');
    expect(mockUpdateSermonViaClient).toHaveBeenCalledWith(sermon);
    expect(mockUpdateSermonPreparationViaClient).toHaveBeenCalledWith('s1', preparation);
    expect(mockApiClient).not.toHaveBeenCalled();
  });

  it('keeps createSermon on the server route', async () => {
    const sermon = { title: 'Test', verse: 'John 3:16', date: '2024-01-01', userId: 'u1', thoughts: [] };
    mockApiClient.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sermon: { ...sermon, id: 'new-id' } }),
    });

    const result = await createSermon(sermon);

    expect(mockApiClient).toHaveBeenCalledWith(`${API_BASE}/api/sermons`, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify(sermon),
      category: 'crud',
    }));
    expect(result.id).toBe('new-id');
  });

  it('keeps deleteSermon on the server cascade route', async () => {
    mockApiClient.mockResolvedValueOnce({ ok: true });

    await deleteSermon('s1');

    expect(mockApiClient).toHaveBeenCalledWith(`${API_BASE}/api/sermons/s1`, expect.objectContaining({
      method: 'DELETE',
      category: 'crud',
    }));
  });
});
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));
