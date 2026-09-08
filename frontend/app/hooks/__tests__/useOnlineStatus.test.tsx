import { act, renderHook } from '@testing-library/react';

import { getConnectivityStatus, subscribeToConnectivity } from '@/utils/connectivity';

import { useOnlineStatus } from '../useOnlineStatus';

/**
 * THIS HOOK IS A SUBSCRIPTION, NOT A SECOND OPINION.
 *
 * It used to recompute `navigator.onLine && getConnectivityStatus()` itself, in each of the
 * ~25 components that call it. That was the same formula written many times rather than one
 * detector shared by many readers, and it disagreed with itself twice in ways that reached
 * users: the device half never reached `apiClient` (which everything else reads directly),
 * and ANDing every notification with `navigator.onLine` meant a successful manual check
 * could not restore the app while that flag was stuck false — as it is for a PWA resumed
 * from the background on iPadOS.
 *
 * Both halves now live in `utils/connectivity`, which keeps them apart. What is left to pin
 * here is that this hook reports that store faithfully and lets go of it on unmount. What
 * the store itself believes is pinned against the real module in
 * `__tests__/utils/connectivity.test.ts`.
 */
jest.mock('@/utils/connectivity', () => ({
  getConnectivityStatus: jest.fn(),
  subscribeToConnectivity: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

const mockGetConnectivityStatus = getConnectivityStatus as jest.MockedFunction<typeof getConnectivityStatus>;
const mockSubscribe = subscribeToConnectivity as jest.MockedFunction<typeof subscribeToConnectivity>;

describe('useOnlineStatus', () => {
  let notifyStore: (() => void) | undefined;
  const unsubscribe = jest.fn();

  beforeEach(() => {
    notifyStore = undefined;
    unsubscribe.mockClear();

    mockGetConnectivityStatus.mockReturnValue(true);
    mockSubscribe.mockImplementation((listener) => {
      notifyStore = listener;
      return unsubscribe;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts from what the connectivity module already knows', () => {
    mockGetConnectivityStatus.mockReturnValue(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it('follows the module down', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      mockGetConnectivityStatus.mockReturnValue(false);
      notifyStore?.();
    });

    expect(result.current).toBe(false);
  });

  it('follows the module back up, without consulting the device flag again', () => {
    /**
     * The stuck-flag case: `navigator.onLine` can stay false over a working network, and
     * the old formula multiplied every answer by it — so a confirmed recovery could never
     * be applied and the manual retry button could not do the one job it exists for.
     */
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    mockGetConnectivityStatus.mockReturnValue(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => {
      mockGetConnectivityStatus.mockReturnValue(true);
      notifyStore?.();
    });

    expect(result.current).toBe(true);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('does not listen to window events itself — the module owns that', () => {
    /**
     * Two listeners for the same event, in two places, with an order that decided the
     * outcome: the hook's own handler ran first and could declare the app online before
     * the provider's probe had sent anything.
     */
    mockGetConnectivityStatus.mockReturnValue(false);
    const { result } = renderHook(() => useOnlineStatus());

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
