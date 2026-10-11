import { renderHook, act } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  __resetConnectivityForTests,
  reportServerReachable,
  reportServerUnreachable,
} from '@/utils/connectivity';

/**
 * THE HOOK AND THE REAL CONNECTIVITY MODULE, WIRED TOGETHER.
 *
 * Its sibling in `app/hooks/__tests__/useOnlineStatus.test.tsx` mocks the store to pin
 * the hook's own contract. This one deliberately does not: it checks that the two really
 * are connected, so a change that quietly detaches the hook from the module — the exact
 * shape of the original defect, where the header icon read one answer and the freshness
 * machinery read another — fails here.
 *
 * Note what it does NOT do: it never rewrites `navigator.onLine` and expects the hook to
 * notice. Connectivity is read from the module, and the module is moved by the device
 * event and by real answers. A test that set the flag directly would be describing a state
 * the app cannot be in.
 */
describe('useOnlineStatus with the real connectivity module', () => {
  const setNavigatorOnline = (value: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
  };

  beforeEach(() => {
    __resetConnectivityForTests();
    setNavigatorOnline(true);
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setNavigatorOnline(true);
  });

  it('goes offline when the device loses its network', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe(false);
  });

  it('does not come back because the phone joined a network — only an answer from our server does', () => {
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    // A café Wi-Fi is not our server: the event makes the app knock, it does not answer for it.
    expect(result.current).toBe(false);

    act(() => { reportServerReachable(); });
    expect(result.current).toBe(true);
  });

  it('comes back when a request actually gets through', () => {
    const { result } = renderHook(() => useOnlineStatus());

    jest.useFakeTimers();
    act(() => { reportServerUnreachable(); });
    expect(result.current).toBe(false);

    act(() => { reportServerReachable(); });

    expect(result.current).toBe(true);
    jest.useRealTimers();
  });

  it('comes back on a real answer even while the phone flag still says "no network"', () => {
    /**
     * The service worker no longer answers `/api` from its own copies (owner's rule 1), so an
     * answer is the server's; an iPad resumed from the background can hold the flag at false over
     * a working network, and the answer is what is true.
     */
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => { reportServerReachable(); });
    expect(result.current).toBe(true);
  });
});
