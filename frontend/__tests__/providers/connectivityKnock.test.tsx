import { act, render } from '@testing-library/react';

import { ConnectionProvider } from '@/providers/ConnectionProvider';
import { __resetConnectivityForTests, getConnectivityStatus, reportServerUnreachable } from '@/utils/connectivity';

/**
 * KNOCKING — HOW THE APP LEARNS THE CONNECTION IS BACK (owner's rule 4,
 * BUG-20260908-cached-response-counts-as-live-connection).
 *
 * Losing the connection shows itself at the first request that does not reach; getting it back
 * does not, so while the answer is "no" and the screen is open the app asks our server. These pin
 * when it asks, when it stops, and the ceiling on a dead network.
 */
const setOnLine = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};
const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
};

const fetchMock = jest.fn();
const healthCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/health')).length;
const answer = (status = 204) => ({ ok: status >= 200 && status < 300, status, clone() { return this; }, json: async () => ({}) });
const deadNetwork = () => fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));

/** Let the timers run and every promise they started settle. */
const elapse = async (ms: number) => {
  await act(async () => {
    for (let left = ms; left > 0; left -= 250) {
      jest.advanceTimersByTime(Math.min(250, left));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    }
  });
};

describe('knocking while there is no connection', () => {
  let unmount: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    __resetConnectivityForTests();
    setOnLine(true);
    setVisibility('visible');
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    ({ unmount } = render(<ConnectionProvider><div /></ConnectionProvider>));
  });

  afterEach(() => {
    unmount();
    __resetConnectivityForTests();
    jest.useRealTimers();
  });

  it('asks nothing while there is a connection', async () => {
    deadNetwork();
    await elapse(5 * 60_000);
    expect(healthCalls()).toBe(0);
  });

  it('asks our server after 2, 4, 8 and 16 s, then every 30 s', async () => {
    deadNetwork();
    act(() => reportServerUnreachable());
    await elapse(1_900);
    expect(healthCalls()).toBe(0);
    await elapse(200);
    expect(healthCalls()).toBe(1);
    await elapse(4_000);
    expect(healthCalls()).toBe(2);
    await elapse(8_000);
    expect(healthCalls()).toBe(3);
    await elapse(16_000);
    expect(healthCalls()).toBe(4);
    await elapse(30_000);
    expect(healthCalls()).toBe(5);
    await elapse(30_000);
    expect(healthCalls()).toBe(6);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toEqual(expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
  });

  it('clears the icon at the first answer — a 503 too — and stops asking', async () => {
    deadNetwork();
    act(() => reportServerUnreachable());
    await elapse(2_100);
    expect(getConnectivityStatus()).toBe(false);
    fetchMock.mockImplementation(() => Promise.resolve(answer(503)));
    await elapse(4_100);
    expect(getConnectivityStatus()).toBe(true);
    const calls = healthCalls();
    await elapse(5 * 60_000);
    expect(healthCalls()).toBe(calls);
  });

  it('restores a network that takes 4 s to answer — the knock has the ordinary deadline', async () => {
    fetchMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(answer()), 4_000)));
    act(() => reportServerUnreachable());
    await elapse(2_100);
    await elapse(4_100);
    expect(getConnectivityStatus()).toBe(true);
  });

  it('does not knock on schedule in a hidden tab, and knocks at once on the way back', async () => {
    deadNetwork();
    setVisibility('hidden');
    act(() => reportServerUnreachable());
    await elapse(3 * 60_000);
    expect(healthCalls()).toBe(0);
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await elapse(10);
    expect(healthCalls()).toBe(1);
  });

  it('asks at once when the phone announces a network, even in a hidden tab', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer()));
    setVisibility('hidden');
    act(() => reportServerUnreachable());
    act(() => { window.dispatchEvent(new Event('online')); });
    await elapse(10);
    expect(healthCalls()).toBe(1);
    expect(getConnectivityStatus()).toBe(true);
  });

  it('keeps to two requests a minute on a dead network however much the person taps', async () => {
    deadNetwork();
    act(() => reportServerUnreachable());
    const perMinute: number[] = [];
    for (let minute = 0; minute < 3; minute += 1) {
      const before = healthCalls();
      for (let second = 0; second < 60; second += 1) {
        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        await elapse(1_000);
      }
      perMinute.push(healthCalls() - before);
    }
    expect(perMinute[1]).toBeLessThanOrEqual(2);
    expect(perMinute[2]).toBeLessThanOrEqual(2);
  });
});
