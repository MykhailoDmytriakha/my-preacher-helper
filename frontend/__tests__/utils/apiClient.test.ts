import { apiClient, onConnectivityChange, probeConnectivity } from '@/utils/apiClient';
import { __resetConnectivityForTests } from '@/utils/connectivity';
import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';
import { subscribeToUsageClientEvents } from '@/services/usageCapClient';
import { UsageCapReachedError } from '@/services/usageLimits';

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

    /**
     * Connectivity is a module-level store shared by every test in this file, and its state
     * outlives a single case. Reset it outright rather than nudging it back with a fake
     * request: a leftover "reachable" from an earlier case made a later one see a
     * connectivity notification it never caused.
     */
    __resetConnectivityForTests();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls fetchWithTimeout with correct default timeout based on category', async () => {
    (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response('ok'));

    await apiClient('http://test.com', { category: 'ai' });
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 90000 }));

    await apiClient('http://test.com', { category: 'audio' });
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 90000 }));

    await apiClient('http://test.com', { category: 'metadata' });
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 5000 }));

    await apiClient('http://test.com', { category: 'detail' });
    expect(fetchWithTimeout).toHaveBeenCalledWith('http://test.com', expect.objectContaining({ timeout: 15000 }));
    
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

  it('publishes settlement and throws a typed global hard-cap error for AI responses', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToUsageClientEvents(listener);
    (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      code: 'USAGE_CAP_REACHED',
      resource: 'transcription',
      used: 3960,
      baseLimit: 3600,
      hardCap: 3960,
      resetsAt: '2026-08-01T00:00:00.000Z',
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }));

    await expect(apiClient('http://test.com/api/thoughts', { category: 'ai' }))
      .rejects.toBeInstanceOf(UsageCapReachedError);

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      'cap-reached',
      'request-settled',
    ]);
    unsubscribe();
  });

  describe('probeConnectivity', () => {
    /**
     * THREE OUTCOMES, NOT TWO. A boolean forced two different situations into one answer
     * and contradicted itself on screen: a 503 during a deploy made the probe report
     * failure, the toast said "still no connection", and moments later the offline icon
     * disappeared anyway — because the reply had in fact travelled. "The network carried
     * it" and "the server is usable" are different facts.
     */
    it('reports a healthy server when the check answers ok', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response('ok', { status: 200 }));
      process.env.NEXT_PUBLIC_API_BASE = 'http://test.com';

      expect(await probeConnectivity()).toBe('healthy');
    });

    it('separates a reachable-but-unhealthy server from an unreachable one', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response('', { status: 503 }));
      process.env.NEXT_PUBLIC_API_BASE = 'http://test.com';

      expect(await probeConnectivity()).toBe('unhealthy');
    });

    it('reports unreachable when nothing comes back', async () => {
      (fetchWithTimeout as jest.Mock).mockRejectedValue(new Error('Failed'));

      expect(await probeConnectivity()).toBe('unreachable');
    });
  });
});
