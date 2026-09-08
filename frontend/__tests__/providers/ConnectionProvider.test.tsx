import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { ConnectionProvider, useConnection } from '@/providers/ConnectionProvider';
import { probeConnectivity } from '@/utils/apiClient';
import {
  __resetConnectivityForTests,
  reportServerReachable,
  reportServerUnreachable,
} from '@/utils/connectivity';

/**
 * WHAT THIS PROVIDER IS FOR, NOW THAT IT HOLDS NO OPINION.
 *
 * It used to keep its own copy of "are we online", starting at `true` and learning otherwise
 * only from the browser `offline` event — which fires on a transition, so an app launched
 * with the Wi-Fi already off never heard it and showed no offline icon all session.
 *
 * Two later attempts to repair that from here made things worse and were removed: one had
 * the provider fire its own health probe on the `online` event, where a single timeout
 * could disable every server-first read with nothing left running to re-enable them; the
 * other let a manual check publish "online" directly, which could overwrite a disconnection
 * that landed while the probe was in flight. Connectivity lives in `utils/connectivity`,
 * where the device signal and the server signal are kept apart, and this is a republisher.
 *
 * Only `probeConnectivity` is mocked — it does HTTP. The connectivity store is the real
 * one, so a change that detaches the provider from it fails here rather than passing
 * against a hand-written stand-in.
 */
jest.mock('@/utils/apiClient', () => ({
  probeConnectivity: jest.fn(async () => 'healthy'),
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
    expect(result.current.isMagicAvailable).toBe(true);
  });

  it('republishes the connectivity store rather than holding its own answer', () => {
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });
    expect(result.current.isOnline).toBe(false);
    expect(result.current.isMagicAvailable).toBe(false);

    // A recovery settles for a few seconds before it counts, so a shaky link cannot flash.
    jest.useFakeTimers();
    act(() => { reportServerReachable(); });
    act(() => { jest.advanceTimersByTime(3000); });
    expect(result.current.isOnline).toBe(true);
    jest.useRealTimers();
  });

  it('reports offline when the app opens with the network already gone', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

    const { result } = renderConnection();

    expect(result.current.isOnline).toBe(false);
  });

  it('stays offline when the check reaches nothing', async () => {
    (probeConnectivity as jest.Mock).mockResolvedValueOnce('unreachable');
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
    /**
     * A reply of any status means the network carried it, and that is the one piece of
     * evidence allowed to overrule a device flag that is stuck — the state a person is in
     * when they press this button on an iPad resumed from the background.
     */
    (probeConnectivity as jest.Mock).mockResolvedValueOnce('healthy');
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });
    expect(result.current.isOnline).toBe(false);

    let answer;
    await act(async () => {
      answer = await result.current.checkConnection();
    });

    expect(answer).toBe('healthy');
    expect(result.current.isOnline).toBe(true);
  });

  it('also comes back when the server replied with an error — the network still carried it', async () => {
    (probeConnectivity as jest.Mock).mockResolvedValueOnce('unhealthy');
    const { result } = renderConnection();

    act(() => { reportServerUnreachable(); });

    let answer;
    await act(async () => {
      answer = await result.current.checkConnection();
    });

    expect(answer).toBe('unhealthy');
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
