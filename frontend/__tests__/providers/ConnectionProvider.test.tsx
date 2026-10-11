import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { ConnectionProvider, useConnection } from '@/providers/ConnectionProvider';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import {
  __resetConnectivityForTests,
  reportServerReachable,
  reportServerUnreachable,
} from '@/utils/connectivity';

/**
 * WHAT THIS PROVIDER IS FOR, NOW THAT IT HOLDS NO OPINION.
 *
 * The answer lives in `utils/connectivity` (yes: the last real request reached our server — owner's
 * rule 2); this provider republishes it, keeps the knocking running while it is "no", and offers
 * the "check again" button, which is one more knock whose outcome it reports.
 *
 * Only `fetchWithTimeout` is mocked — it does HTTP. The connectivity store is the real one, so a
 * change that detaches the provider from it fails here rather than passing against a stand-in.
 */
jest.mock('@/utils/fetchWithTimeout', () => ({
  ...jest.requireActual('@/utils/fetchWithTimeout'),
  fetchWithTimeout: jest.fn(),
}));

describe('ConnectionProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetConnectivityForTests();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(() => {
    __resetConnectivityForTests();
  });

  const renderConnection = () =>
    renderHook(() => useConnection(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });

  it('provides initial online state', () => {
    const { result } = renderConnection();

    expect(result.current.isOnline).toBe(true);
  });

  it('republishes the connectivity store rather than holding its own answer', () => {
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });
    expect(result.current.isOnline).toBe(false);

    act(() => { reportServerReachable(); });
    expect(result.current.isOnline).toBe(true);
  });

  it('reports offline when the app opens with the network already gone', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

    const { result } = renderConnection();

    expect(result.current.isOnline).toBe(false);
  });

  it('stays offline when the check reaches nothing', async () => {
    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });
    expect(result.current.isOnline).toBe(false);

    let answer;
    await act(async () => {
      answer = await result.current.checkConnection();
    });

    expect(answer).toBe('unreachable');
    expect(result.current.isOnline).toBe(false);
  });

  it('comes back at once when the check reaches the server', async () => {
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('ok'));
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });
    expect(result.current.isOnline).toBe(false);

    let answer;
    await act(async () => {
      answer = await result.current.checkConnection();
    });

    expect(answer).toBe('reached');
    expect(result.current.isOnline).toBe(true);
  });

  it('also comes back when the server replied with an error — the request reached it', async () => {
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce(new Response('', { status: 503 }));
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });

    let answer;
    await act(async () => {
      answer = await result.current.checkConnection();
    });

    expect(answer).toBe('reached-with-error');
    expect(result.current.isOnline).toBe(true);
  });

  it('believes an answer that arrives after the phone said "no network": the server has just answered', async () => {
    // Owner's rule 2: the last outcome decides, and a success is never set aside. An iPad can say
    // "offline" over a working network; the answer that came back is the truth about the connection.
    let resolveProbe!: (response: Response) => void;
    (fetchWithTimeout as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { resolveProbe = resolve; }));
    const { result } = renderConnection();
    let pending!: ReturnType<typeof result.current.checkConnection>;
    act(() => { pending = result.current.checkConnection(); });
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);
    await act(async () => {
      resolveProbe(new Response('ok'));
      expect(await pending).toBe('reached');
    });
    expect(result.current.isOnline).toBe(true);
  });

  it('throws error if useConnection is used outside provider', () => {
    // Suppress console.error for the expected throw
    const originalError = console.error;
    console.error = jest.fn();

    expect(() => renderHook(() => useConnection())).toThrow(
      'useConnection must be used within a ConnectionProvider'
    );

    console.error = originalError;
  });
});
