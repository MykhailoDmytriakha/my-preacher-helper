import { generateSermonPointsForSection } from '@/services/outline.service';
import { apiClient } from '@/utils/apiClient';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer token' }),
}));
jest.mock('@/services/sermons.client', () => ({
  getSermonOutlineViaClient: jest.fn(),
  updateSermonOutlineViaClient: jest.fn(),
}));

describe('outline service AI transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('routes outline generation through the shared AI api client', async () => {
    const outlinePoints = [{ id: 'p1', text: 'Point' }];
    (apiClient as jest.MockedFunction<typeof apiClient>).mockResolvedValue({
      ok: true,
      json: async () => ({ outlinePoints }),
    } as Response);

    await expect(generateSermonPointsForSection('sermon-1', 'main')).resolves.toEqual(outlinePoints);
    expect(apiClient).toHaveBeenCalledWith(
      expect.stringContaining('/api/sermons/sermon-1/generate-outline-points'),
      expect.objectContaining({ category: 'ai', method: 'POST' })
    );
  });
});
