import { act, renderHook } from '@testing-library/react';

import { getConnectivityStatus, onConnectivityChange } from '@/utils/apiClient';

import { useOnlineStatus } from '../useOnlineStatus';

jest.mock('@/utils/apiClient', () => ({
  getConnectivityStatus: jest.fn(),
  onConnectivityChange: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

const mockGetConnectivityStatus = getConnectivityStatus as jest.MockedFunction<typeof getConnectivityStatus>;
const mockOnConnectivityChange = onConnectivityChange as jest.MockedFunction<typeof onConnectivityChange>;

describe('useOnlineStatus', () => {
  let browserOnline = true;
  let apiObserver: ((isOnline: boolean) => void) | undefined;
  const unsubscribe = jest.fn();

  beforeEach(() => {
    browserOnline = true;
    apiObserver = undefined;
    unsubscribe.mockClear();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => browserOnline,
    });

    mockGetConnectivityStatus.mockReturnValue(true);
    mockOnConnectivityChange.mockImplementation((observer) => {
      apiObserver = observer;
      return unsubscribe;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('requires both browser and API connectivity for initial online status', () => {
    mockGetConnectivityStatus.mockReturnValue(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it('drops offline when API connectivity reports a failure', () => {
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(true);

    act(() => {
      apiObserver?.(false);
    });

    expect(result.current).toBe(false);
  });

  it('does not force online from a browser online event while API status is still offline', () => {
    browserOnline = false;
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);

    browserOnline = true;
    mockGetConnectivityStatus.mockReturnValue(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe(false);
  });

  it('unsubscribes from API connectivity changes on unmount', () => {
    const { unmount } = renderHook(() => useOnlineStatus());

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
