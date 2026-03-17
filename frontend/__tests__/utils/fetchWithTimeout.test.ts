import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('resolves successfully before timeout', async () => {
    const mockResponse = new Response('ok');
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const promise = fetchWithTimeout('http://test.com', { timeout: 1000 });
    
    // Fast-forward slightly, but not past timeout
    jest.advanceTimersByTime(500);
    
    const result = await promise;
    expect(result).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith('http://test.com', expect.any(Object));
  });

  it('throws FetchTimeoutError when timeout is reached', async () => {
    jest.useRealTimers();
    // Mock fetch to reject when signal is aborted
    (global.fetch as jest.Mock).mockImplementation((url, { signal }) => {
      return new Promise((_, reject) => {
        if (signal?.aborted) {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          return reject(err);
        }
        signal?.addEventListener('abort', () => {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = fetchWithTimeout('http://test.com', { timeout: 10 });

    await expect(promise).rejects.toThrow(FetchTimeoutError);
    jest.useFakeTimers();
  });

  it('respects external abort signal before fetch', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Manual abort'));

    await expect(
      fetchWithTimeout('http://test.com', { signal: controller.signal })
    ).rejects.toThrow('Manual abort');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('respects external abort signal during fetch', async () => {
    const controller = new AbortController();
    
    // Mock fetch to throw AbortError when its signal is aborted
    (global.fetch as jest.Mock).mockImplementation((url, { signal }) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = fetchWithTimeout('http://test.com', { signal: controller.signal });

    // Trigger external abort
    controller.abort(new Error('User cancelled'));

    await expect(promise).rejects.toThrow('User cancelled');
  });

  it('throws regular fetch errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network failure'));

    await expect(fetchWithTimeout('http://test.com')).rejects.toThrow('Network failure');
  });
});
