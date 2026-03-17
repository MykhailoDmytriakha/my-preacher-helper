import { apiClient, onConnectivityChange, probeConnectivity } from '@/utils/apiClient';
import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';

// Mock fetchWithTimeout
jest.mock('@/utils/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
  FetchTimeoutError: class FetchTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'FetchTimeoutError';
    }
  }
}));

describe('apiClient', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    
    // Reset internal state to online
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('ok'));
    try {
      await apiClient('http://test.com/reset');
      jest.advanceTimersByTime(3500); // trigger any hysteresis
    } catch { }
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls fetchWithTimeout with correct default timeout based on category', async () => {
    (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response('ok'));

    await apiClient('http://test.com', { category: 'ai' });
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 90000 }));

    await apiClient('http://test.com', { category: 'metadata' });
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 5000 }));
    
    // Default is crud
    await apiClient('http://test.com');
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 8000 }));
  });

  it('drops connectivity immediately on timeout', async () => {
    const mockObserver = jest.fn();
    const unsubscribe = onConnectivityChange(mockObserver);

    (fetchWithTimeout as jest.Mock).mockRejectedValue(new FetchTimeoutError('timeout'));

    await expect(apiClient('http://test.com')).rejects.toThrow(FetchTimeoutError);

    expect(mockObserver).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('drops connectivity on Failed to fetch', async () => {
    const mockObserver = jest.fn();
    const unsubscribe = onConnectivityChange(mockObserver);

    (fetchWithTimeout as jest.Mock).mockRejectedValue(new Error('Failed to fetch'));

    await expect(apiClient('http://test.com')).rejects.toThrow('Failed to fetch');

    expect(mockObserver).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('debounces connectivity recovery (hysteresis)', async () => {
    const mockObserver = jest.fn();
    const unsubscribe = onConnectivityChange(mockObserver);

    // Drop it first
    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new FetchTimeoutError('timeout'));
    await expect(apiClient('http://test.com')).rejects.toThrow(FetchTimeoutError);
    expect(mockObserver).toHaveBeenCalledWith(false);

    // Now succeed
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('ok'));
    await apiClient('http://test.com');

    // Observer shouldn't be called immediately for true
    expect(mockObserver).not.toHaveBeenCalledWith(true);

    // Fast forward time
    jest.advanceTimersByTime(3000);

    // Now it should be called
    expect(mockObserver).toHaveBeenCalledWith(true);

    unsubscribe();
  });

  it('returns response even if status is 401', async () => {
    const mockResponse = new Response('Unauthorized', { status: 401 });
    (fetchWithTimeout as jest.Mock).mockResolvedValue(mockResponse);

    const result = await apiClient('http://test.com');
    expect(result.status).toBe(401);
  });

  describe('probeConnectivity', () => {
    it('returns true on success', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response('ok', { status: 200 }));
      process.env.NEXT_PUBLIC_API_BASE = 'http://test.com';

      const result = await probeConnectivity();
      expect(result).toBe(true);
    });

    it('returns false on fetch throw', async () => {
      (fetchWithTimeout as jest.Mock).mockRejectedValue(new Error('Failed'));
      
      const result = await probeConnectivity();
      expect(result).toBe(false);
    });
  });
});
