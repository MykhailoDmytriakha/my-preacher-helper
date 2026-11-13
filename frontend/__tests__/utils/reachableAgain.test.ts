import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';
import { __resetReachableAgainForTests, reachableAgainCount, subscribeToReachableAgain } from '@/utils/reachableAgain';

/*
 * The moment a read that failed for want of the server is worth asking again: this tab enters "the app's one
 * answer is yes and the page is in sight". The Bible's files ask again on it (`hooks/useReadAgainWhenReachable`,
 * BUG-20261112-link-texts-stay-dots-after-reconnect).
 */
function showPage(visible: boolean, sign: 'visibilitychange' | 'focus' | 'pageshow' = 'visibilitychange') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
  (sign === 'visibilitychange' ? document : window).dispatchEvent(new Event(sign));
}

let told = 0;
let stop: () => void = () => undefined;

beforeEach(() => {
  __resetReachableAgainForTests();
  __resetConnectivityForTests();
  showPage(true);
  told = 0;
  stop = subscribeToReachableAgain(() => { told += 1; });
});

afterEach(() => stop());

describe('the server back in reach', () => {
  it('is a moment when the answer turns to yes with the page in sight', () => {
    reportServerUnreachable();
    expect(reachableAgainCount()).toBe(0);
    reportServerReachable();
    expect(reachableAgainCount()).toBe(1);
    expect(told).toBe(1);
  });

  it('is a moment when the person comes back to the page while the answer is yes — by any of the three signs of a return', () => {
    for (const sign of ['visibilitychange', 'focus', 'pageshow'] as const) {
      showPage(false);
      showPage(true, sign);
    }
    expect(reachableAgainCount()).toBe(3);
    expect(told).toBe(3);
  });

  it('waits for the page: an answer that turns to yes behind another tab becomes a moment at the return', () => {
    reportServerUnreachable();
    showPage(false);
    reportServerReachable();
    expect(reachableAgainCount()).toBe(0);
    showPage(true);
    expect(reachableAgainCount()).toBe(1);
  });

  it('is no moment while the answer is no, however often the person comes back', () => {
    reportServerUnreachable();
    showPage(false);
    showPage(true);
    showPage(true, 'focus');
    expect(reachableAgainCount()).toBe(0);
    expect(told).toBe(0);
  });

  it('is no moment while nothing changed: another answer that reached, another sign of a page already in sight', () => {
    reportServerReachable();
    reportServerReachable();
    showPage(true, 'focus');
    showPage(true, 'pageshow');
    expect(reachableAgainCount()).toBe(0);
  });

  it('is counted only while somebody listens, from what is true when the listening begins', () => {
    stop();
    reportServerUnreachable();
    reportServerReachable();
    expect(reachableAgainCount()).toBe(0);

    reportServerUnreachable();
    stop = subscribeToReachableAgain(() => { told += 1; });
    reportServerReachable();
    expect(reachableAgainCount()).toBe(1);
    expect(told).toBe(1);
  });
});
