/**
 * @jest-environment node
 */
import { Response as PlatformResponse } from 'undici';

import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';

/*
 * THE DEADLINE AND THE CANCEL REACH EVERY WAY A BODY IS READ (BUG-20261011-stream-and-clone-reads-unbounded).
 *
 * A whole-body read got the request's deadline and the caller's cancel; a stream read piece by piece
 * (the audio export) and a copy of the answer (`clone()`, read by the usage check) did not, and a
 * server that sent its headers and fell silent held them for ever. Real streams here (node), because
 * locking, tee and abort are exactly what the bound has to respect — and the platform's Response
 * (undici), since the test setup replaces the global one with a polyfill that cannot hold a stream.
 */
describe('fetchWithTimeout: streams and copies', () => {
  const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  const encoder = new TextEncoder();
  let push: (text: string) => void, close: () => void;

  /** A body that delivers only what the test pushes, and fails when the request is aborted. */
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
      init.signal?.addEventListener('abort', () => controller.error(abortError()));
      push = text => controller.enqueue(encoder.encode(text));
      close = () => controller.close();
      return Promise.resolve(new PlatformResponse(stream) as unknown as Response);
    }) as unknown as typeof fetch;
  });
  afterEach(() => { jest.useRealTimers(); });

  const settles = (read: Promise<unknown>) => {
    const seen: { state: 'pending' | 'resolved' | 'rejected'; error?: unknown } = { state: 'pending' };
    read.then(() => { seen.state = 'resolved'; }, error => { seen.state = 'rejected'; seen.error = error; });
    return seen;
  };

  it('gives up on a stream that stops between pieces, at the request\'s deadline', async () => {
    const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
    const reader = response.body!.getReader();
    push('first');
    expect((await reader.read()).done).toBe(false);

    const seen = settles(reader.read());
    await jest.advanceTimersByTimeAsync(1000);
    expect(seen.state).toBe('rejected');
    expect(seen.error).toBeInstanceOf(FetchTimeoutError);
  });

  it('keeps reading a stream whose pieces keep coming, however long the whole takes', async () => {
    const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
    const reader = response.body!.getReader();
    for (let piece = 0; piece < 5; piece += 1) {
      const seen = settles(reader.read());
      await jest.advanceTimersByTimeAsync(800);
      push(`piece ${piece}`);
      await jest.advanceTimersByTimeAsync(0);
      expect(seen.state).toBe('resolved');
    }
    close();
    expect((await reader.read()).done).toBe(true);
  });

  it('lets the caller cancel a stream read', async () => {
    const controller = new AbortController();
    const response = await fetchWithTimeout('http://test.com', { timeout: 60_000, signal: controller.signal });
    const seen = settles(response.body!.getReader().read());
    controller.abort(new Error('User cancelled'));
    await jest.advanceTimersByTimeAsync(0);
    expect(seen.state).toBe('rejected');
    expect((seen.error as Error).message).toBe('User cancelled');
  });

  it('gives up on a copy whose body stops coming, at the deadline', async () => {
    const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
    const seen = settles(response.clone().json());
    await jest.advanceTimersByTimeAsync(1000);
    expect(seen.state).toBe('rejected');
    expect(seen.error).toBeInstanceOf(FetchTimeoutError);
  });

  it('lets the caller cancel the read of a copy', async () => {
    const controller = new AbortController();
    const response = await fetchWithTimeout('http://test.com', { timeout: 60_000, signal: controller.signal });
    const seen = settles(response.clone().text());
    controller.abort(new Error('User cancelled'));
    await jest.advanceTimersByTimeAsync(0);
    expect(seen.state).toBe('rejected');
    expect((seen.error as Error).message).toBe('User cancelled');
  });

  // Codex (refute-stream-reads): cloning hands the original a new body (tee) — it stays bounded too.
  it('keeps the deadline on the original\'s stream after a copy was made', async () => {
    const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
    response.clone();
    const seen = settles(response.body!.getReader().read());
    await jest.advanceTimersByTimeAsync(1000);
    expect(seen.state).toBe('rejected');
    expect(seen.error).toBeInstanceOf(FetchTimeoutError);
  });

  it('reads a copy and the original that both arrive in time', async () => {
    const response = await fetchWithTimeout('http://test.com', { timeout: 1000 });
    const copy = response.clone();
    push('{"a":1}'); close();
    await expect(copy.json()).resolves.toEqual({ a: 1 });
    await expect(response.json()).resolves.toEqual({ a: 1 });
  });
});
