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

  // BUG-20261011-body-after-headers-no-deadline: the headers came and the body stopped coming — the
  // deadline and the caller's cancel used to be dropped with the headers, so the read waited for ever.
  describe('after the headers', () => {
    let signal: AbortSignal | undefined;
    const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    /** A response whose body reads end only when the request is aborted. */
    const stalledBody = () => {
      const response = new Response('{}');
      for (const method of ['json', 'text'] as const) {
        Object.defineProperty(response, method, {
          configurable: true,
          value: () => new Promise((_, reject) => {
            if (signal?.aborted) reject(abortError());
            signal?.addEventListener('abort', () => reject(abortError()));
          }),
        });
      }
      return response;
    };
    const settles = (read: Promise<unknown>) => {
      const seen: { state: 'pending' | 'resolved' | 'rejected'; error?: unknown } = { state: 'pending' };
      read.then(() => { seen.state = 'resolved'; }, (error) => { seen.state = 'rejected'; seen.error = error; });
      return seen;
    };
    beforeEach(() => {
      signal = undefined;
      (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return Promise.resolve(stalledBody());
      });
    });

    it('gives up on a body that stops coming, within the request\'s own deadline', async () => {
      const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
      const seen = settles(response.json());
      await jest.advanceTimersByTimeAsync(1000);
      expect(seen.state).toBe('rejected');
      expect(seen.error).toBeInstanceOf(FetchTimeoutError);
    });

    it('lets the caller cancel while the body is read', async () => {
      const controller = new AbortController();
      const response = await fetchWithTimeout('http://test.com', { timeout: 60_000, signal: controller.signal });
      const seen = settles(response.text());
      controller.abort(new Error('User cancelled'));
      await jest.advanceTimersByTimeAsync(0);
      expect(seen.state).toBe('rejected');
      expect((seen.error as Error).message).toBe('User cancelled');
    });

    it('does not cut a stream the caller reads itself', async () => {
      await fetchWithTimeout('http://test.com', { timeout: 1000 });
      await jest.advanceTimersByTimeAsync(5000);
      expect(signal?.aborted).toBe(false);
    });

    it('does not cut a body read late, after the first deadline has passed', async () => {
      (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => {
        signal = init.signal ?? undefined;
        const response = new Response('{}');
        Object.defineProperty(response, 'json', {
          configurable: true,
          value: () => new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ late: true }), 100);
            signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); });
          }),
        });
        return Promise.resolve(response);
      });
      const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
      await jest.advanceTimersByTimeAsync(1500);
      const seen = settles(response.json());
      await jest.advanceTimersByTimeAsync(100);
      expect(seen.state).toBe('resolved');
    });

    it('keeps the deadline and the cancel with the first read when a second read overlaps it', async () => {
      (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => {
        signal = init.signal ?? undefined;
        const response = new Response('{}');
        let used = false;
        Object.defineProperty(response, 'bodyUsed', { configurable: true, get: () => used });
        Object.defineProperty(response, 'json', {
          configurable: true,
          value: () => { used = true; return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(abortError()))); },
        });
        Object.defineProperty(response, 'text', {
          configurable: true,
          value: () => (used ? Promise.reject(new TypeError('Body is unusable')) : Promise.resolve('')),
        });
        return Promise.resolve(response);
      });
      const controller = new AbortController();
      const response = await fetchWithTimeout('http://test.com', { timeout: 60_000, signal: controller.signal });
      const first = settles(response.json());
      await expect(response.text()).rejects.toThrow('Body is unusable');
      controller.abort(new Error('User cancelled'));
      await jest.advanceTimersByTimeAsync(0);
      expect(first.state).toBe('rejected');
      expect((first.error as Error).message).toBe('User cancelled');
    });

    it('does not abort a stream the caller holds when it also asks for the whole body', async () => {
      let streamAborted = false;
      (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => {
        signal = init.signal ?? undefined;
        signal?.addEventListener('abort', () => { streamAborted = true; });
        const response = new Response('{}');
        Object.defineProperty(response, 'body', { configurable: true, get: () => ({ locked: true }) });
        Object.defineProperty(response, 'text', { configurable: true, value: () => Promise.reject(new TypeError('Body is locked')) });
        return Promise.resolve(response);
      });
      const controller = new AbortController();
      const response = await fetchWithTimeout('http://test.com', { timeout: 60_000, signal: controller.signal });
      controller.abort(new Error('Stop waiting'));
      await expect(response.text()).rejects.toThrow('Body is locked');
      expect(streamAborted).toBe(false);
    });

    it('keeps a falsy reason the caller gave', async () => {
      const controller = new AbortController();
      const response = await fetchWithTimeout('http://test.com', { timeout: 60_000, signal: controller.signal });
      const seen = settles(response.json());
      controller.abort(0);
      await jest.advanceTimersByTimeAsync(0);
      expect(seen.error).toBe(0);
    });

    it('leaves nothing running once the body was read', async () => {
      (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return Promise.resolve(new Response('{"ok":true}'));
      });
      const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
      await expect(response.json()).resolves.toEqual({ ok: true });
      await jest.advanceTimersByTimeAsync(5000);
      expect(signal?.aborted).toBe(false);
    });
  });

  it('throws regular fetch errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network failure'));

    await expect(fetchWithTimeout('http://test.com')).rejects.toThrow('Network failure');
  });
});
