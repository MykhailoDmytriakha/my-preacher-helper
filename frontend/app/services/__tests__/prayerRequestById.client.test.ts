import { getDoc } from 'firebase/firestore';

import { getPrayerRequestByIdViaClient } from '@/services/prayerRequests.client';
import { __resetConnectivityForTests, getConnectivityStatus, reportServerReachable } from '@/utils/connectivity';

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({
  ...jest.requireActual('@/utils/queryKeys'),
  resolveOwnerUid: () => 'test-user-id',
}));

const setPhoneFlag = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });

/** Settles to the outcome at a moment, without leaving a rejection unhandled. */
const outcome = (read: Promise<unknown>) => {
  const seen: { state: 'pending' | 'resolved' | 'rejected' } = { state: 'pending' };
  read.then(() => { seen.state = 'resolved'; }, () => { seen.state = 'rejected'; });
  return seen;
};

describe('getPrayerRequestByIdViaClient — how long a silent read is waited for', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetConnectivityForTests();
    setPhoneFlag(true);
    jest.useFakeTimers();
    (getDoc as jest.Mock).mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    jest.useRealTimers();
    setPhoneFlag(true);
  });

  it('gives up at the online deadline when a request has reached the server, though the phone flag is stuck on offline', async () => {
    // BUG-20261011-raw-phone-flag-in-read-paths: an iPad back from the background keeps
    // `navigator.onLine === false` while requests get through.
    setPhoneFlag(false);
    getConnectivityStatus();
    reportServerReachable();
    const seen = outcome(getPrayerRequestByIdViaClient('prayer'));
    await jest.advanceTimersByTimeAsync(4000);
    expect(seen.state).toBe('rejected');
  });

  it('keeps the long wait for the cache when nothing has reached the server and the phone says offline', async () => {
    setPhoneFlag(false);
    const seen = outcome(getPrayerRequestByIdViaClient('prayer'));
    await jest.advanceTimersByTimeAsync(4000);
    expect(seen.state).toBe('pending');
    await jest.advanceTimersByTimeAsync(4000);
    expect(seen.state).toBe('rejected');
  });
});
