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

  it('stays offline while the server is proven unreachable, whatever the device says', () => {
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

    // The device is back, but nothing has reached the server yet.
    expect(result.current).toBe(true);
  });

  it('comes back when a request actually gets through', () => {
    const { result } = renderHook(() => useOnlineStatus());

    jest.useFakeTimers();
    act(() => { reportServerUnreachable(); });
    expect(result.current).toBe(false);

    act(() => { reportServerReachable(); });
    act(() => { jest.advanceTimersByTime(3000); });

    expect(result.current).toBe(true);
    jest.useRealTimers();
  });

  it('does not come back on a reply while the device still has no network', () => {
    /**
     * An installed app serves cached responses offline. Reading one as recovery is how the
     * offline icon disappeared over no connection at all.
     */
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    jest.useFakeTimers();
    act(() => { reportServerReachable(); });
    act(() => { jest.advanceTimersByTime(3000); });

    expect(result.current).toBe(false);
    jest.useRealTimers();
  });
});
