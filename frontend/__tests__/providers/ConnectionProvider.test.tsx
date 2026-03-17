import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { ConnectionProvider, useConnection } from '@/providers/ConnectionProvider';
import { probeConnectivity } from '@/utils/apiClient';

jest.mock('@/utils/apiClient', () => {
  let cb: ((status: boolean) => void) | null = null;
  return {
    onConnectivityChange: jest.fn((callback) => {
      cb = callback;
      return jest.fn(); // unsubscribe function
    }),
    probeConnectivity: jest.fn(),
    // Expose internal trigger for testing
    __triggerConnectivityChange: (status: boolean) => {
      if (cb) cb(status);
    },
  };
});

describe('ConnectionProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Simulate initial online state in browser
    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  it('provides initial online state', () => {
    const { result } = renderHook(() => useConnection(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isMagicAvailable).toBe(true);
  });

  it('updates state when apiClient observer triggers', () => {
    const { result } = renderHook(() => useConnection(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });

    act(() => {
      const { __triggerConnectivityChange } = require('@/utils/apiClient');
      __triggerConnectivityChange(false);
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.isMagicAvailable).toBe(false);
  });

  it('updates state on browser offline event', () => {
    const { result } = renderHook(() => useConnection(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('does not immediately force online on browser online event', () => {
    const { result } = renderHook(() => useConnection(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });

    // Go offline first
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);

    // Browser says online, but we wait for actual fetch to confirm
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    // State should STILL be false because apiClient is the source of truth for online
    expect(result.current.isOnline).toBe(false);
  });

  it('allows manual checkConnection probe', async () => {
    (probeConnectivity as jest.Mock).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useConnection(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });

    let probeResult;
    await act(async () => {
      probeResult = await result.current.checkConnection();
    });

    expect(probeConnectivity).toHaveBeenCalled();
    expect(probeResult).toBe(true);
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
