import {
  __resetConnectivityForTests,
  beginConnectivityRequest,
  getConnectivityState,
  getConnectivityStatus,
  reportProbeSucceeded,
  reportServerReachable,
  reportServerUnreachable,
  subscribeToConnectivity,
} from '@/utils/connectivity';

/**
 * THE TWO QUESTIONS BEHIND ONE BOOLEAN.
 *
 * "The device has a network" and "our server answered" have different evidence and
 * different consumers, and collapsing them is what produced the original defect: the flag
 * lived in the transport, started at "online", and moved only when a request failed — so an
 * app opened with the Wi-Fi off reported a working connection for its whole session, while
 * a different mechanism that DID ask the device put a diagnostic panel on screen instead.
 *
 * These pin the rules that keep the two apart, including the ones that were learned the
 * expensive way: a joined network is not a reachable server, a cached response is not proof
 * of a network, and a page that was frozen in the background must re-read the device rather
 * than trust what it knew before the freeze.
 */
const setOnLine = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};

describe('connectivity', () => {
  beforeEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  it('ignores stale outcomes across a device disconnect and reconnect', () => {
    subscribeToConnectivity(() => {});
    const old = beginConnectivityRequest();
    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    setOnLine(true);
    window.dispatchEvent(new Event('online'));
    reportServerUnreachable(old);
    expect(getConnectivityState().server).toBe('unknown');
    reportServerReachable(old);
    expect(getConnectivityState().server).toBe('unknown');
    reportProbeSucceeded(old);
    expect(getConnectivityState().server).toBe('unknown');
  });

  it('keeps a newer failure when an older success arrives', () => {
    subscribeToConnectivity(() => {});
    const old = beginConnectivityRequest();
    const recent = beginConnectivityRequest();
    reportServerUnreachable(recent);
    reportServerReachable(old);
    expect(getConnectivityStatus()).toBe(false);
  });

  it('allows a new failure to cancel recovery but ignores one older than a manual probe', () => {
    jest.useFakeTimers();
    subscribeToConnectivity(() => {});
    reportServerUnreachable();
    reportServerReachable(beginConnectivityRequest());
    reportServerUnreachable(beginConnectivityRequest());
    jest.advanceTimersByTime(3000);
    expect(getConnectivityStatus()).toBe(false);
    const old = beginConnectivityRequest();
    reportProbeSucceeded(beginConnectivityRequest());
    reportServerUnreachable(old);
    expect(getConnectivityStatus()).toBe(true);
    jest.useRealTimers();
  });

  it('invalidates in-flight evidence when all subscribers leave and reattach', () => {
    const unsubscribe = subscribeToConnectivity(() => {});
    const old = beginConnectivityRequest();
    unsubscribe();
    subscribeToConnectivity(() => {});
    reportServerUnreachable(old);
    expect(getConnectivityState().server).toBe('unknown');
  });

  it('reports offline when the device has no network at the first read', () => {
    setOnLine(false);

    expect(getConnectivityStatus()).toBe(false);
  });

  it('reports online when the device has a network and nothing has failed', () => {
    expect(getConnectivityStatus()).toBe(true);
    expect(getConnectivityState().server).toBe('unknown');
  });

  it('goes offline on the device event without waiting for a request to fail', () => {
    const seen: boolean[] = [];
    subscribeToConnectivity(() => seen.push(getConnectivityStatus()));

    setOnLine(false);
    window.dispatchEvent(new Event('offline'));

    expect(getConnectivityStatus()).toBe(false);
    expect(seen.at(-1)).toBe(false);
  });

  it('does not treat a reply as recovery while the device says there is no network', () => {
    /**
     * An installed app serves same-origin GETs from its cache while offline. That cached
     * 200 reaching the transport used to read as recovery: the offline icon and strip
     * disappeared and the AI controls re-enabled, over no connection at all.
     */
    subscribeToConnectivity(() => {});
    setOnLine(false);
    window.dispatchEvent(new Event('offline'));

    reportServerReachable();

    expect(getConnectivityStatus()).toBe(false);
  });

  it('stays offline while the server is unreachable, even with a network', () => {
    subscribeToConnectivity(() => {});

    reportServerUnreachable();

    expect(getConnectivityStatus()).toBe(false);
    expect(getConnectivityState().device).toBe(true);
  });

  it('confirms a recovery only after the link has been quiet for a moment', () => {
    /**
     * On a shaky link successes and failures alternate. Publishing every success at once
     * would flash the offline icon on and off and let the AI controls enable between two
     * failures, so a recovery has to settle first. A loss is believed immediately: being
     * told late that you are offline is the failure this area exists to prevent.
     */
    jest.useFakeTimers();
    subscribeToConnectivity(() => {});
    reportServerUnreachable();
    expect(getConnectivityStatus()).toBe(false);

    reportServerReachable();
    expect(getConnectivityStatus()).toBe(false);

    jest.advanceTimersByTime(3000);

    expect(getConnectivityStatus()).toBe(true);
    jest.useRealTimers();
  });

  it('abandons a recovery if the link fails again while it is settling', () => {
    jest.useFakeTimers();
    subscribeToConnectivity(() => {});
    reportServerUnreachable();

    reportServerReachable();
    jest.advanceTimersByTime(1500);
    reportServerUnreachable();
    jest.advanceTimersByTime(5000);

    expect(getConnectivityStatus()).toBe(false);
    jest.useRealTimers();
  });

  it('forgets what it knew about the server when the network goes away', () => {
    /**
     * Carrying "reachable" across a disconnection is how an app comes back from airplane
     * mode still believing it can reach everything, and re-runs work that will fail.
     */
    jest.useFakeTimers();
    subscribeToConnectivity(() => {});
    reportServerReachable();
    jest.advanceTimersByTime(3000);
    jest.useRealTimers();

    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    setOnLine(true);
    window.dispatchEvent(new Event('online'));

    expect(getConnectivityState().server).toBe('unknown');
  });

  it('re-reads the device when the page becomes visible again', () => {
    /**
     * An installed app frozen in the background can miss the `offline` event entirely.
     * Without this re-read the app would keep believing in a connection it lost hours ago:
     * no icon, no strip, and every read firing into nothing.
     */
    subscribeToConnectivity(() => {});
    expect(getConnectivityStatus()).toBe(true);

    setOnLine(false); // the transition happened while the page was frozen — no event
    document.dispatchEvent(new Event('visibilitychange'));

    expect(getConnectivityStatus()).toBe(false);
  });

  it('notifies subscribers only when something actually moved', () => {
    /**
     * Notification follows a change of STATE, not of the derived boolean, because a screen
     * may care specifically about the device half. Readers of the boolean lose nothing:
     * `useSyncExternalStore` compares snapshots and skips the render itself.
     */
    jest.useFakeTimers();
    let calls = 0;
    subscribeToConnectivity(() => { calls += 1; });

    reportServerUnreachable();
    reportServerUnreachable();   // no change
    reportServerReachable();
    jest.advanceTimersByTime(3000);
    reportServerReachable();     // no change

    expect(calls).toBe(2);
    jest.useRealTimers();
  });

  it('attaches no listeners until someone subscribes, and drops them when the last leaves', () => {
    /**
     * Nothing may run at import: the module is loaded during server rendering too, and a
     * listener registered per module evaluation accumulates copies across Fast Refresh.
     */
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const first = subscribeToConnectivity(() => {});
    const second = subscribeToConnectivity(() => {});
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    const addedAfterTwo = addSpy.mock.calls.length;

    first();
    expect(removeSpy).not.toHaveBeenCalledWith('offline', expect.any(Function));

    second();
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    // The second subscriber did not add a second set.
    expect(addedAfterTwo).toBe(addSpy.mock.calls.length);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('connectivity — evidence that must not be trusted, and evidence that must', () => {
  const setOnLine = (value: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  };

  beforeEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
    jest.useRealTimers();
  });

  it('does not let a reply received while offline vouch for the NEXT connection', () => {
    /**
     * An installed app serves cached responses offline, and they are indistinguishable
     * here from real ones. Recording one would damage the app twice: it would look like
     * recovery now, and the memory of it would survive into the next reconnection — so a
     * café portal could clear the offline icon with nothing having been reached.
     */
    jest.useFakeTimers();
    subscribeToConnectivity(() => {});
    setOnLine(false);
    window.dispatchEvent(new Event('offline'));

    reportServerReachable();          // a cached 200 arrives
    jest.advanceTimersByTime(5000);

    setOnLine(true);                  // Wi-Fi rejoined — a portal, nothing reached yet
    window.dispatchEvent(new Event('online'));

    expect(getConnectivityState().server).toBe('unknown');
  });

  it('lets an explicit successful check overrule a device flag that is stuck', () => {
    /**
     * A PWA resumed from the background on iPadOS can report no network over a working
     * connection. The manual button is the way out, and its evidence is trustworthy for a
     * reason: a HEAD the service worker does not cache, made because someone asked.
     */
    setOnLine(false);
    subscribeToConnectivity(() => {});
    expect(getConnectivityStatus()).toBe(false);

    reportProbeSucceeded();

    expect(getConnectivityStatus()).toBe(true);
  });

  it('forgets reachability across a period when nothing was watching', () => {
    /**
     * The last screen unmounts, the network drops and returns, a new screen mounts. The
     * store was not listening for any of it, so a `reachable` from before that gap is not
     * evidence about now.
     */
    jest.useFakeTimers();
    const release = subscribeToConnectivity(() => {});
    reportServerReachable();
    jest.advanceTimersByTime(3000);
    expect(getConnectivityState().server).toBe('reachable');

    release();
    subscribeToConnectivity(() => {});

    expect(getConnectivityState().server).toBe('unknown');
  });
});

describe('connectivity — verdicts that must not outlive the moment they describe', () => {
  const setOnLine = (value: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  };

  beforeEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
    jest.useRealTimers();
  });

  it('does not carry a failure from before a disconnection into the reconnection', () => {
    /**
     * A request that began before the network died rejects LATE, after the offline event,
     * and marks the server unreachable while we are already offline. Left in place, that
     * verdict survives the reconnection and keeps every server-first read disabled over a
     * perfectly good connection — with nothing running that could disprove it.
     */
    subscribeToConnectivity(() => {});

    setOnLine(false);
    window.dispatchEvent(new Event('offline'));
    reportServerUnreachable();          // the late rejection lands here

    setOnLine(true);
    window.dispatchEvent(new Event('online'));

    expect(getConnectivityState().server).toBe('unknown');
    expect(getConnectivityStatus()).toBe(true);
  });

  it('tells subscribers when re-attaching changes the answer', () => {
    /**
     * The store keeps its state across a period with no subscribers, but resets what it
     * believed about the server. If that reset is not published, the app can sit showing
     * "offline" while the store already says otherwise, and an ordinary successful response
     * takes the fast path and publishes nothing either.
     */
    const release = subscribeToConnectivity(() => {});
    reportServerUnreachable();
    expect(getConnectivityStatus()).toBe(false);

    release();
    let notified = 0;
    subscribeToConnectivity(() => { notified += 1; });

    expect(getConnectivityStatus()).toBe(true);
    expect(notified).toBeGreaterThan(0);
  });

  it('drops a settling recovery when the last screen goes away', () => {
    jest.useFakeTimers();
    const release = subscribeToConnectivity(() => {});
    reportServerUnreachable();
    reportServerReachable();            // starts settling

    release();
    jest.advanceTimersByTime(5000);
    subscribeToConnectivity(() => {});

    // The timer must not have written anything from a period nobody was watching.
    expect(getConnectivityState().server).toBe('unknown');
  });

  it('lets a proven server outrank the device flag without pretending the device is fine', () => {
    /**
     * Write paths across the app read `navigator.onLine` directly. If this store answered
     * a successful probe by claiming the device is fine, it would assert something it never
     * observed and those paths would silently disagree — the app saying "connection is
     * back" while a save is quietly queued.
     */
    setOnLine(false);
    subscribeToConnectivity(() => {});

    reportProbeSucceeded();

    expect(getConnectivityStatus()).toBe(true);
    expect(getConnectivityState().device).toBe(false);
  });
});
