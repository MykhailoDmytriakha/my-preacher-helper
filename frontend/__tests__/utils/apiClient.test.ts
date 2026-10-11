import { apiClient, isConnectionFailure, onConnectivityChange } from '@/utils/apiClient';
import { __resetConnectivityForTests, getConnectivityStatus } from '@/utils/connectivity';
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

  it('restores the connection at once when a request gets any answer, a 503 included', async () => {
    // Owner's rule 2: the request reached our server. The old construction held recovery for 3 s.
    const mockObserver = jest.fn();
    const unsubscribe = onConnectivityChange(mockObserver);

    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new FetchTimeoutError('timeout'));
    await expect(apiClient('http://test.com')).rejects.toThrow(FetchTimeoutError);
    expect(mockObserver).toHaveBeenLastCalledWith(false);

    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('', { status: 503 }));
    await apiClient('http://test.com');
    expect(mockObserver).toHaveBeenLastCalledWith(true);
    expect(getConnectivityStatus()).toBe(true);

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

  it.each(['ai', 'audio'] as const)('keeps ordinary reads online when %s times out', async (category) => {
    const unsubscribe = onConnectivityChange(jest.fn());
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('ok'));
    await apiClient('/api/sermons', { category: 'metadata' });
    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new FetchTimeoutError('timeout'));
    await expect(apiClient('/api/generate', { category })).rejects.toThrow(FetchTimeoutError);
    expect(getConnectivityStatus()).toBe(true);
    unsubscribe();
  });

  it.each(['ai', 'audio'] as const)('still reports a real network failure for %s', async (category) => {
    const unsubscribe = onConnectivityChange(jest.fn());
    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiClient('/api/generate', { category })).rejects.toThrow('Failed to fetch');
    expect(getConnectivityStatus()).toBe(false);
    unsubscribe();
  });

  it('ignores an older failure after a newer request starts recovery', async () => {
    const unsubscribe = onConnectivityChange(jest.fn());
    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));
    await expect(apiClient('/api/initial')).rejects.toThrow('Failed to fetch');
    let rejectOld!: (error: Error) => void;
    (fetchWithTimeout as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const oldRequest = apiClient('/api/old');
    const oldFailure = expect(oldRequest).rejects.toThrow('Failed to fetch');
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('ok'));
    await apiClient('/api/new');
    rejectOld(new Error('Failed to fetch'));
    await oldFailure;
    jest.advanceTimersByTime(3000);
    expect(getConnectivityStatus()).toBe(true);
    unsubscribe();
  });

  /*
   * The headers came, the body did not (BUG-20261011-body-read-failure-drops-saved-copy): a network
   * that drops mid-answer fails while the body is read, after `apiClient` returned. That is "did not
   * arrive" as much as a failed fetch — the saved copy of the query must survive it — while bad JSON
   * and reading a body twice are faults of their own and must not pass for a network.
   */
  describe('reading the answer', () => {
    const answerThatBreaks = (failure: Error) => {
      const response = new Response('{}');
      Object.defineProperty(response, 'json', { configurable: true, value: () => Promise.reject(failure) });
      return response;
    };

    it('marks a body cut off mid-answer as not having arrived, and says the connection is gone', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(answerThatBreaks(new TypeError('network error')));
      const response = await apiClient('http://test.com/api/share-links');
      expect(getConnectivityStatus()).toBe(true);

      const failure = await response.json().catch((error: unknown) => error);

      expect(isConnectionFailure(failure)).toBe(true);
      expect(getConnectivityStatus()).toBe(false);
    });

    it('does not take bad JSON for a network', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(answerThatBreaks(new SyntaxError('Unexpected token')));
      const response = await apiClient('http://test.com/api/share-links');

      const failure = await response.json().catch((error: unknown) => error);

      expect(isConnectionFailure(failure)).toBe(false);
      expect(getConnectivityStatus()).toBe(true);
    });

    it('does not take a body read twice for a network', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(new Response('{"ok":true}'));
      const response = await apiClient('http://test.com/api/share-links');
      await response.json();

      const failure = await response.json().catch((error: unknown) => error);

      expect(isConnectionFailure(failure)).toBe(false);
      expect(getConnectivityStatus()).toBe(true);
    });

    it('lets a newer answer win over an older body cut off later', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(answerThatBreaks(new TypeError('network error')));
      const older = await apiClient('http://test.com/api/share-links');
      (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('ok'));
      await apiClient('http://test.com/api/health');

      const failure = await older.json().catch((error: unknown) => error);

      expect(isConnectionFailure(failure)).toBe(true);
      expect(getConnectivityStatus()).toBe(true);
    });

    it('does not take a body already held by a stream reader for a network', async () => {
      // As a browser does after `body.getReader()`: unused, but locked, and a read is refused.
      const held = answerThatBreaks(new TypeError('Body is unusable'));
      Object.defineProperty(held, 'body', { value: { locked: true } });
      (fetchWithTimeout as jest.Mock).mockResolvedValue(held);
      const response = await apiClient('http://test.com/api/share-links');

      const failure = await response.json().catch((error: unknown) => error);

      expect(isConnectionFailure(failure)).toBe(false);
      expect(getConnectivityStatus()).toBe(true);
    });

    it('returns a response it cannot mark as it is, without failing the request', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue(Object.freeze(new Response('{"ok":true}')));

      const response = await apiClient('http://test.com/api/share-links');

      expect(await response.json()).toEqual({ ok: true });
      expect(getConnectivityStatus()).toBe(true);
    });
  });
});
