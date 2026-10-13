const mockApiClient = jest.fn();
const mockGetSermonsViaClient = jest.fn();

jest.mock('@/utils/apiClient', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}));

jest.mock('@/services/sermons.client', () => ({
  getSermonsViaClient: (...args: unknown[]) => mockGetSermonsViaClient(...args),
}));

import { getSermons } from '@/services/sermon.service';

describe('sermon.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes the sermon list read through the client SDK', async () => {
    const sermons = [{ id: 's1', userId: 'u1', title: 'Sermon' }];
    mockGetSermonsViaClient.mockResolvedValueOnce(sermons);

    await expect(getSermons('u1')).resolves.toBe(sermons);

    expect(mockGetSermonsViaClient).toHaveBeenCalledWith('u1');
    expect(mockApiClient).not.toHaveBeenCalled();
  });
});
