/** @jest-environment node */
import { createOfflinePageStorageHarness } from '../../../test-utils/offlinePageStorageHarness';
import { createOfflineRscNavigation, OFFLINE_RSC_MAX_ENTRIES } from '../offlineRscNavigation';

const ORIGIN = 'https://app.test';
const page = (id: string) => new URL(`${ORIGIN}/sermons/${id}`);
const flight = (body: string) => new Response(body, { headers: { 'content-type': 'text/x-component' } });
const decode = (body: ArrayBuffer) => new TextDecoder().decode(body);
type Harness = ReturnType<typeof createOfflinePageStorageHarness>;
function navigation(harness: Harness, fetchFn: (request: Request) => Promise<Response>, warmTimeoutMs = 20_000) {
  return createOfflineRscNavigation({ fetchFn, storage: harness.storage(), caches: harness.legacyCaches, now: harness.now, warmTimeoutMs });
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' did not settle')), 2000);
  })]).finally(() => clearTimeout(timer));
}

/** The same five user-visible invariants reproduced against the prior CacheStorage implementation. */
describe('offline RSC cache maintenance', () => {
  it('retains a concurrently revisited oldest page when the 201st page is being stored', async () => {
    const harness = createOfflinePageStorageHarness();
    const nav = navigation(harness, async request => flight(new URL(request.url).pathname));
    for (let index = 0; index < OFFLINE_RSC_MAX_ENTRIES; index++) await nav.remember(page(String(index)));
    const held = harness.holdNextRead('catalog');
    const adding = nav.remember(page('200'));
    let revisit: Promise<unknown> | undefined;
    try {
      await bounded(held.started, 'new page reservation');
      // Atomic storage serializes this intent after the held transaction. Both must complete;
      // awaiting the revisit before releasing the transaction would deliberately deadlock the test.
      revisit = nav.remember(page('0'));
    } finally { held.release(); }
    expect(await bounded(adding, 'new page')).toBe('stored');
    expect(['kept', 'stored']).toContain(await bounded(revisit!, 'revisited page'));
    const addresses = harness.stored();
    expect(addresses).toHaveLength(OFFLINE_RSC_MAX_ENTRIES);
    expect(new Set(addresses).size).toBe(OFFLINE_RSC_MAX_ENTRIES);
    expect(addresses).toContain(page('0').href);
    expect(addresses).not.toContain(page('1').href);
    expect(new Set(addresses)).toEqual(new Set(['0', ...Array.from({ length: 199 }, (_, index) => String(index + 2))].map(id => page(id).href)));
    for (const address of addresses) expect(decode((await harness.storage().read(address))!.body)).toBe(new URL(address).pathname);
  });

  it('honors an explicit 60-second Retry-After across fresh workers, then rewarms', async () => {
    jest.useFakeTimers();
    const harness = createOfflinePageStorageHarness();
    try {
      await harness.storage().activate([page('retry').href]);
      const retryAt = harness.now() + 60_000;
      const requests: string[] = [];
      const fetchFn = async (request: Request) => {
        requests.push(request.url);
        return harness.now() < retryAt
          ? new Response('slow down', { status: 429, headers: { 'Retry-After': '60' } })
          : flight('warmed after Retry-After');
      };
      await navigation(harness, fetchFn).rewarm();
      expect(requests).toHaveLength(1);
      await navigation(harness, fetchFn).rewarm();
      expect(requests).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(61_000);
      await navigation(harness, fetchFn).rewarm();
      expect(requests).toHaveLength(2);
      expect(harness.stored()).toContain(page('retry').href);
      expect(harness.waiting()).not.toContain(page('retry').href);
      expect(decode((await harness.storage().read(page('retry').href))!.body)).toBe('warmed after Retry-After');
    } finally { jest.useRealTimers(); }
  });

  it('keeps every carried address when an older partially completed rewarm finishes late', async () => {
    const harness = createOfflinePageStorageHarness();
    await harness.storage().activate(Array.from({ length: 60 }, (_, index) => page(String(index)).href));
    const started = deferred(), release = deferred();
    let requests = 0;
    const old = navigation(harness, async request => {
      if (++requests === 50) { started.resolve(); await release.promise; }
      return flight('rewarmed ' + new URL(request.url).pathname);
    });
    const warming = old.rewarm();
    let carried: string[] = [];
    try {
      await bounded(started.promise, 'old fiftieth request');
      harness.advanceBuild();
      await harness.storage().activate();
      expect(await navigation(harness, async () => flight('new generation')).remember(page('new'))).toBe('stored');
      harness.advanceBuild();
      await harness.storage().activate();
      carried = harness.waiting();
      expect(carried).toHaveLength(61);
      expect(carried).toContain(page('new').href);
    } finally { release.resolve(); }
    await bounded(warming, 'older rewarm');
    expect(new Set(harness.waiting())).toEqual(new Set(carried));
  });

  it('does not let an old 404 erase a same-address generation remembered and retired meanwhile', async () => {
    const harness = createOfflinePageStorageHarness();
    const address = page('same-address').href;
    await harness.storage().activate([address]);
    const started = deferred(), release = deferred();
    const old = navigation(harness, async () => {
      started.resolve(); await release.promise; return new Response('gone', { status: 404 });
    });
    const warming = old.rewarm();
    try {
      await bounded(started.promise, 'old missing-page request');
      harness.advanceBuild();
      await harness.storage().activate();
      expect(await navigation(harness, async () => flight('new generation')).remember(new URL(address))).toBe('stored');
      harness.advanceBuild();
      await harness.storage().activate();
      expect(harness.waiting()).toContain(address);
    } finally { release.resolve(); }
    await bounded(warming, 'old missing-page answer');
    expect(harness.waiting()).toContain(address);
  });

  it('does not let a timed-out old publication replace a fresh payload after its gate is released', async () => {
    const harness = createOfflinePageStorageHarness();
    const address = page('late-put');
    let held: ReturnType<Harness['holdNextRead']> | undefined;
    const old = navigation(harness, async () => {
      held = harness.holdNextRead('catalog');
      return flight('old payload');
    }, 20);
    const warming = old.remember(address);
    // The fetch is reached after reservation, so the armed gate intercepts the publication read.
    for (let turn = 0; turn < 100 && !held; turn++) await Promise.resolve();
    if (!held) throw new Error('Old payload fetch was not reached');
    try {
      await bounded(held.started, 'old publication');
      expect(await bounded(warming, 'old warm deadline')).toBe('failed');
      expect(await navigation(harness, async () => flight('fresh payload')).remember(address)).toBe('stored');
    } finally { held.release(); }
    const offline = navigation(harness, async () => { throw new TypeError('offline'); });
    expect(await (await offline.respond(new Request(address.href, { headers: { rsc: '1' } }))).text()).toBe('fresh payload');
  });
});
