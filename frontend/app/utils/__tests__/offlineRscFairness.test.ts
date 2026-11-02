/** @jest-environment node */

import { createOfflineRscNavigation } from '../offlineRscNavigation';
import { createOfflinePageStorageHarness } from '../../../test-utils/offlinePageStorageHarness';

const BASE = 'https://app.test/sermons/';
const TARGET = `${BASE}fairness-good`;
const BAD = Array.from({ length: 50 }, (_, index) => `${BASE}fairness-bad-${String(index).padStart(2, '0')}`);
const FLIGHT = { 'content-type': 'text/x-component' };

function navigation(storage: ReturnType<ReturnType<typeof createOfflinePageStorageHarness>['storage']>, now: () => number) {
  const fetched: string[] = [];
  const offline = createOfflineRscNavigation({
    fetchFn: async request => {
      const address = new URL(request.url).href.replace(/([?&])_rsc=[^&]*(&|$)/, (_match, before, after) => after ? before : '');
      fetched.push(address);
      return address === TARGET
        ? new Response('reachable-flight', { status: 200, headers: FLIGHT })
        : new Response('temporarily down', { status: 503 });
    },
    caches: createOfflinePageStorageHarness().legacyCaches,
    storage,
    now,
    warmTimeoutMs: 30_000,
    storageTimeoutMs: 1_000,
  });
  return { offline, fetched };
}

describe('offline RSC rewarm fairness', () => {
  jest.setTimeout(30_000);

  it('reaches a good target despite 50 unclaimed addresses that always return 503 and an expired claim', async () => {
    const harness = createOfflinePageStorageHarness({ initialNow: 1_000 });
    const storage = harness.storage('fairness-build');
    await storage.activate([TARGET, ...BAD]);
    const oldClaim = await storage.reserve(TARGET, { seen: false, leaseMs: 1 });
    expect(oldClaim.outcome).toBe('fetch');
    harness.advanceTime(2);

    const { offline, fetched } = navigation(storage, harness.now);
    for (let iteration = 0; iteration < 52; iteration += 1) await offline.rewarm();

    expect(fetched.filter(address => address === TARGET)).toHaveLength(1);
    expect(await storage.read(TARGET)).toBeDefined();
  });

  it('reaches the good target through the same 50 permanent 503 addresses without an expired claim', async () => {
    const harness = createOfflinePageStorageHarness({ initialNow: 2_000 });
    const storage = harness.storage('fairness-build');
    await storage.activate([TARGET, ...BAD]);

    const { offline, fetched } = navigation(storage, harness.now);
    for (let iteration = 0; iteration < 52; iteration += 1) await offline.rewarm();

    expect(fetched.filter(address => address === TARGET)).toHaveLength(1);
    expect(await storage.read(TARGET)).toBeDefined();
  });
});
