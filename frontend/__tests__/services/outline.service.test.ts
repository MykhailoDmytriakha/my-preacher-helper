import { generateSermonPointsForSection } from '@/services/outline.service';
import { apiClient } from '@/utils/apiClient';
import { __resetConnectivityForTests, getConnectivityStatus, reportServerReachable } from '@/utils/connectivity';

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

  describe('the phone flag says offline (BUG-20261011-raw-phone-flag-in-read-paths)', () => {
    beforeEach(() => {
      __resetConnectivityForTests();
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    });
    afterEach(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      __resetConnectivityForTests();
    });

    it('does not call the server while nothing has reached it', async () => {
      await expect(generateSermonPointsForSection('sermon-1', 'main')).resolves.toEqual([]);
      expect(apiClient).not.toHaveBeenCalled();
    });

    it('generates once a request has reached the server, though the flag is stuck', async () => {
      getConnectivityStatus();
      reportServerReachable();
      const outlinePoints = [{ id: 'p1', text: 'Point' }];
      (apiClient as jest.MockedFunction<typeof apiClient>).mockResolvedValue({
        ok: true,
        json: async () => ({ outlinePoints }),
      } as Response);
      await expect(generateSermonPointsForSection('sermon-1', 'main')).resolves.toEqual(outlinePoints);
    });
  });

  it('routes outline generation through the shared AI api client', async () => {
    const outlinePoints = [{ id: 'p1', text: 'Point' }];
    (apiClient as jest.MockedFunction<typeof apiClient>).mockResolvedValue({
      ok: true,
      json: async () => ({ outlinePoints }),
    } as Response);

    await expect(generateSermonPointsForSection('sermon-1', 'main')).resolves.toEqual(outlinePoints);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/sermons/sermon-1/generate-outline-points',
      expect.objectContaining({ category: 'ai', method: 'POST' })
    );
  });
});
