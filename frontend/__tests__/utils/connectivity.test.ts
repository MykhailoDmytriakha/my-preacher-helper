import {
  __resetConnectivityForTests,
  beginConnectivityRequest,
  getConnectivityStatus,
  isBrowserOffline,
  reportServerReachable,
  reportServerUnreachable,
  subscribeToConnectivity,
} from '@/utils/connectivity';

/**
 * YES — THE LAST REAL REQUEST REACHED OUR SERVER. NO — IT DID NOT.
 *
 * The owner's rule 2 (BUG-20260908-cached-response-counts-as-live-connection, decision 2026-10-10).
 * The previous construction kept the device and the server apart, held an "unknown", waited three
 * seconds before believing a recovery and ordered evidence by request start; each of those was a way
 * to get stuck. These pin the one answer that replaced them.
 */
const setOnLine = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};
const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
};

describe('connectivity — the last real request decides', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetConnectivityForTests();
    setOnLine(true);
    setVisibility('visible');
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
    jest.useRealTimers();
  });

  it('starts from what the phone says', () => {
    expect(getConnectivityStatus()).toBe(true);
    __resetConnectivityForTests();
    setOnLine(false);
    expect(getConnectivityStatus()).toBe(false);
  });

  it('says no at the first request that does not reach', () => {
    reportServerUnreachable();
    expect(getConnectivityStatus()).toBe(false);
  });

  it('says yes at once when a request gets an answer — no settling wait', () => {
    reportServerUnreachable();
    reportServerReachable();
    // The old construction held a recovery for three seconds; the icon stayed on after the server answered.
    expect(getConnectivityStatus()).toBe(true);
  });

  it('never sets aside a success, whatever order the requests started in', () => {
    // R1 starts, R2 starts and fails, then R1 genuinely returns: the server has just answered.
    const first = beginConnectivityRequest();
    const second = beginConnectivityRequest();
    reportServerUnreachable(second);
    expect(getConnectivityStatus()).toBe(false);
    reportServerReachable(first);
    expect(getConnectivityStatus()).toBe(true);
  });

  it('does not let a failure from before the latest success overrule it', () => {
    const early = beginConnectivityRequest();
    const late = beginConnectivityRequest();
    reportServerReachable(late);
    reportServerUnreachable(early);
    expect(getConnectivityStatus()).toBe(true);
  });

  it('says no when the phone announces it has no network', () => {
    subscribeToConnectivity(() => undefined);
    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    expect(getConnectivityStatus()).toBe(false);
  });

  it('does not say yes because the phone joined a network — a café Wi-Fi is not our server', () => {
    subscribeToConnectivity(() => undefined);
    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    setOnLine(true);
    window.dispatchEvent(new Event('online'));
    expect(getConnectivityStatus()).toBe(false);
    reportServerReachable();
    expect(getConnectivityStatus()).toBe(true);
  });

  it('lets a real answer restore yes while the phone flag is stuck at "no network", and keeps it on return', () => {
    // An iPad PWA resumed from the background can report navigator.onLine === false over a working network.
    subscribeToConnectivity(() => undefined);
    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    reportServerReachable();
    expect(getConnectivityStatus()).toBe(true);
    // The flag is still false on the way back into the page: no change, so the phone said nothing new.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getConnectivityStatus()).toBe(true);
  });

  it('notices on the way back in a network lost while the page was frozen', () => {
    subscribeToConnectivity(() => undefined);
    expect(getConnectivityStatus()).toBe(true);
    // The `offline` event was slept through; only the flag changed.
    setOnLine(false);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getConnectivityStatus()).toBe(false);
  });

  it('tells subscribers only when the answer moves', () => {
    const listener = jest.fn();
    subscribeToConnectivity(listener);
    reportServerReachable();
    expect(listener).not.toHaveBeenCalled();
    reportServerUnreachable();
    reportServerUnreachable();
    expect(listener).toHaveBeenCalledTimes(1);
    reportServerReachable();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('attaches no listeners until someone subscribes, and drops them when the last leaves', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    expect(add).not.toHaveBeenCalled();
    const stopA = subscribeToConnectivity(() => undefined);
    const stopB = subscribeToConnectivity(() => undefined);
    expect(add.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(1);
    stopA();
    expect(remove.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(0);
    stopB();
    expect(remove.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('isBrowserOffline', () => {
  afterEach(() => setOnLine(true));

  it('is true only when the browser explicitly says there is no network', () => {
    setOnLine(false);
    expect(isBrowserOffline()).toBe(true);
  });

  it('is false while the browser says there is a network', () => {
    setOnLine(true);
    expect(isBrowserOffline()).toBe(false);
  });

  it('reads the flag fresh on every call', () => {
    setOnLine(true);
    expect(isBrowserOffline()).toBe(false);
    setOnLine(false);
    expect(isBrowserOffline()).toBe(true);
  });
});
