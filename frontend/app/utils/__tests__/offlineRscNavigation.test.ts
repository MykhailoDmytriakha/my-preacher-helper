/** @jest-environment node */
import { computeCacheBustingSearchParam } from 'next/dist/shared/lib/router/utils/cache-busting-search-param';
import { Response as PlatformResponse } from 'undici';

import {
  OFFLINE_RSC_MAX_ENTRIES,
  createOfflineRscNavigation as createOfflineRscNavigationActual,
  isRememberedPage,
  isRscNavigation,
  offlineRscKey,
} from '../offlineRscNavigation';
import { createOfflinePageStorageHarness } from '../../../test-utils/offlinePageStorageHarness';

type Harness = ReturnType<typeof createOfflinePageStorageHarness>;
const ORIGIN = 'https://app.test';
const SHELL_TREE = encodeURIComponent(JSON.stringify(['', { children: ['~offline', { children: ['__PAGE__', {}] }] }, null, null, true]));

function flight(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/x-component' } });
}

function navigationRequest(path: string, rsc: string, extra: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}${path.includes('?') ? '&' : '?'}_rsc=${rsc}`, {
    headers: { rsc: '1', 'next-router-state-tree': `tree-of-${rsc}`, ...extra },
  });
}

function fakeCaches(): Harness { return createOfflinePageStorageHarness(); }

function createOfflineRscNavigation({ caches, ...options }: Omit<Parameters<typeof createOfflineRscNavigationActual>[0], 'storage' | 'caches'> & { caches: Harness }) {
  const configuredOptions = { ...options, now: options.now ?? caches.now };
  let worker = createOfflineRscNavigationActual({ ...configuredOptions, storage: caches.storage(), caches: caches.legacyCaches });
  return {
    remember: (...args: Parameters<typeof worker.remember>) => worker.remember(...args),
    respond: (...args: Parameters<typeof worker.respond>) => worker.respond(...args),
    rewarm: (...args: Parameters<typeof worker.rewarm>) => worker.rewarm(...args),
    retire: async () => {
      const build = caches.advanceBuild();
      worker = createOfflineRscNavigationActual({ ...configuredOptions, storage: caches.storage(build), caches: caches.legacyCaches });
      await worker.retire();
    },
  };
}

function offline(): (request: Request) => Promise<Response> {
  return async () => { throw new TypeError('Failed to fetch'); };
}

const stored = (harness: Harness) => harness.stored();

/** Start with the prior build's durable catalog, then activate the next build. */
async function retiredSixty(harness: Harness) {
  const seen = createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches: harness });
  for (let i = 0; i < 60; i++) await seen.remember(new URL(`${ORIGIN}/sermons/${i}`));
  await createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches: harness }).retire();
}
const sermonId = (request: Request) => Number(new URL(request.url).pathname.split('/').pop());

/** Addresses still awaiting a usable payload, oldest first. */
async function waiting(harness: Harness): Promise<string[]> { return harness.waiting(); }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('offline RSC navigation', () => {
  it('keeps every address it could not warm yet, and finishes when the network is back', async () => {
    const caches = fakeCaches();
    const seen = createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches });
    for (let i = 0; i < 60; i++) await seen.remember(new URL(`${ORIGIN}/sermons/${i}`));
    let online = false;
    const fetched: string[] = [];
    const after = createOfflineRscNavigation({
      fetchFn: async request => {
        if (!online) throw new TypeError('Failed to fetch');
        fetched.push(new URL(request.url).pathname); return flight('new build');
      }, caches,
    });
    void after.retire();
    await after.rewarm(); // no network: nothing warmed, nothing forgotten
    expect(stored(caches)).toEqual([]);
    online = true;
    // The network is back: a worker started later finishes the list.
    const restarted = createOfflineRscNavigation({
      fetchFn: async request => { fetched.push(new URL(request.url).pathname); return flight('new build'); }, caches,
    });
    await restarted.rewarm();
    await restarted.rewarm();
    expect(new Set(fetched).size).toBe(60);
    expect(stored(caches)).toHaveLength(60);
  });

  it('does not starve reachable addresses behind ones that keep failing', async () => {
    const caches = fakeCaches();
    const seen = createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches });
    for (let i = 0; i < 60; i++) await seen.remember(new URL(`${ORIGIN}/sermons/${i}`));
    let requests = 0;
    // The fifty seen last are gone from the server; the ten older ones are fine.
    const fetchFn = async (request: Request) => {
      requests += 1;
      const id = Number(new URL(request.url).pathname.split('/').pop());
      return id >= 10 ? new Response('gone', { status: 404 }) : flight('new build');
    };
    const after = createOfflineRscNavigation({ fetchFn, caches });
    await after.retire();
    await after.rewarm(); // the server answered "no such page" fifty times: those are gone, not waiting
    expect(requests).toBe(50);
    const restarted = createOfflineRscNavigation({ fetchFn, caches });
    await restarted.rewarm();
    await restarted.rewarm();
    expect(requests).toBe(60); // no second round of the fifty gone pages
    expect(stored(caches).map(key => new URL(key).pathname).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `/sermons/${i}`).sort());
  });

  // BUG-20261011-sw-rewarm-skipped-or-forgets: a page already stored is no proof of a network, so
  // it must not turn a batch of failures into "the server answered, the rest are gone".
  it('forgets nothing when the only page that "warmed" was already stored', async () => {
    const caches = fakeCaches();
    const seen = createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches });
    for (let i = 0; i < 60; i++) await seen.remember(new URL(`${ORIGIN}/sermons/${i}`));
    const after = createOfflineRscNavigation({ fetchFn: offline(), caches });
    await after.retire();
    await after.rewarm(); // no network: the batch moves to the old end, all 60 kept
    // Online for a moment: the person opens one of them, its payload is stored.
    await createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches })
      .remember(new URL(`${ORIGIN}/sermons/5`));
    // The worker starts again without a network.
    await createOfflineRscNavigation({ fetchFn: offline(), caches }).rewarm();
    // The network is back: every page seen before warms again.
    const back = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
    await back.rewarm();
    await back.rewarm();
    expect(stored(caches)).toHaveLength(60);
  });

  it('warms again when the flag says offline but the network answers (BUG-20261011-sw-rewarm-skipped-or-forgets)', async () => {
    // An iPad back from the background keeps `navigator.onLine === false` while requests get through.
    const caches = fakeCaches();
    await createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches })
      .remember(new URL(`${ORIGIN}/sermons/a`));
    const fetched: string[] = [];
    const after = createOfflineRscNavigation({
      fetchFn: async request => { fetched.push(new URL(request.url).pathname); return flight('new build'); }, caches,
    });
    await after.retire();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await after.rewarm();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
    expect(fetched).toEqual(['/sermons/a']);
  });

  describe('each address is judged by what its own warm-up found (BUG-20261011-sw-rewarm-skipped-or-forgets)', () => {
    it('warms the older pages next when the newest ones were already stored again', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      const online = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
      for (let i = 10; i < 60; i++) await online.remember(new URL(`${ORIGIN}/sermons/${i}`));
      await online.rewarm();
      await online.rewarm();
      expect(stored(caches)).toHaveLength(60);
    });

    it('keeps an address the network could not reach, though another page in the batch warmed', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let flaky = true;
      const fetchFn = async (request: Request) => {
        if (flaky && sermonId(request) === 40) throw new TypeError('Failed to fetch');
        return flight('new build');
      };
      const nav = createOfflineRscNavigation({ fetchFn, caches });
      await nav.rewarm();
      flaky = false;
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toContain(`${ORIGIN}/sermons/40`);
      expect(stored(caches)).toHaveLength(60);
    });

    it('goes on in the same worker once the network is back', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let online = false;
      const nav = createOfflineRscNavigation({
        fetchFn: async () => { if (!online) throw new TypeError('Failed to fetch'); return flight('new build'); }, caches,
      });
      await nav.rewarm();
      online = true;
      await nav.rewarm();
      await nav.rewarm();
      expect(stored(caches)).toHaveLength(60);
    });

    it('keeps an address whose payload could not be stored', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      const target = `${ORIGIN}/sermons/40`;
      caches.failPayloadWrite(target);
      const nav = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
      await nav.rewarm();
      expect(await waiting(caches)).toContain(target);
      caches.allowPayloadWrite(target);
      caches.advanceTime(60_001);
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toContain(`${ORIGIN}/sermons/40`);
    });

    it('keeps an address while the server answers with an error, not as a page that is gone', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let failing = true;
      const nav = createOfflineRscNavigation({
        fetchFn: async () => (failing ? new Response('busy', { status: 503 }) : flight('new build')), caches,
      });
      await nav.rewarm();
      failing = false;
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toHaveLength(60);
    });

    it.each([401, 403, 408, 429, 200, 302])('keeps an address answered %s without a page: an answer that may change', async status => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let refusing = true;
      const nav = createOfflineRscNavigation({
        fetchFn: async () => (refusing ? new Response('<html>', { status, headers: { 'content-type': 'text/html' } }) : flight('new build')),
        caches,
      });
      await nav.rewarm();
      expect(await waiting(caches)).toContain(`${ORIGIN}/sermons/59`);
      if ([401, 403, 429, 200, 302].includes(status)) {
        expect(caches.entries().some(entry => entry.retryAt > caches.now())).toBe(true);
      }
      refusing = false;
      caches.advanceTime(60_001);
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toHaveLength(60);
    });

    it.each([404, 410])('drops an address the server answers %s: the page is gone', async status => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let requests = 0;
      const nav = createOfflineRscNavigation({
        fetchFn: async () => { requests += 1; return new Response('', { status }); }, caches,
      });
      await nav.rewarm();
      await nav.rewarm();
      await nav.rewarm();
      expect(requests).toBe(60);
    });

    it('does not starve the others behind an address that always fails, wherever it sits', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      const nav = createOfflineRscNavigation({
        fetchFn: async request => (sermonId(request) === 59 ? new Response('busy', { status: 503 }) : flight('new build')),
        caches,
      });
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toHaveLength(59);
    });

    it('keeps an address whose warm-up ran out of time', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let stalled = true;
      const nav = createOfflineRscNavigation({
        warmTimeoutMs: 5,
        fetchFn: () => (stalled ? new Promise<Response>(() => undefined) : Promise.resolve(flight('new build'))),
        caches,
      });
      await nav.rewarm();
      stalled = false;
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toHaveLength(60);
    });

    it('keeps an address whose payload was evicted while its batch ran', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      const online = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
      await online.remember(new URL(`${ORIGIN}/sermons/59`));
      // Simulate concurrent body eviction immediately before the next reservation validates metadata.
      caches.evictPayloadOnNextRead(`${ORIGIN}/sermons/59`);
      const nav = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
      await nav.remember(new URL(`${ORIGIN}/sermons/59`));
      for (let i = 0; i < 3; i++) await nav.rewarm();
      expect(stored(caches)).toContain(`${ORIGIN}/sermons/59`);
    });

    it('says what each warm-up found', async () => {
      const caches = fakeCaches();
      const answers: Record<string, () => Promise<Response>> = {
        '/sermons/ok': async () => flight('p'),
        '/sermons/gone': async () => new Response('', { status: 404 }),
        '/sermons/busy': async () => new Response('', { status: 503 }),
        '/sermons/down': async () => { throw new TypeError('Failed to fetch'); },
      };
      const nav = createOfflineRscNavigation({ fetchFn: request => answers[new URL(request.url).pathname](), caches });
      expect(await nav.remember(new URL(`${ORIGIN}/sermons/ok`))).toBe('stored');
      expect(await nav.remember(new URL(`${ORIGIN}/sermons/ok`))).toBe('kept');
      expect(await nav.remember(new URL(`${ORIGIN}/sermons/gone`))).toBe('gone');
      expect(await nav.remember(new URL(`${ORIGIN}/sermons/busy`))).toBe('failed');
      expect(await nav.remember(new URL(`${ORIGIN}/sermons/down`))).toBe('failed');
    });

    it('tries one address, not a whole batch, while there is no network', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let attempts = 0;
      const nav = createOfflineRscNavigation({
        fetchFn: async () => { attempts += 1; throw new TypeError('Failed to fetch'); }, caches,
      });
      await nav.rewarm();
      expect(attempts).toBe(1);
    });
  });

  it('keeps a page seen while the new version is still retiring the old one', async () => {
    const caches = fakeCaches();
    const nav = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
    const retiring = nav.retire();
    const remembering = nav.remember(new URL(`${ORIGIN}/sermons/fresh`));
    await Promise.all([retiring, remembering]);
    expect(stored(caches)).toEqual([`${ORIGIN}/sermons/fresh`]);
  });

  it('after a new version activates, warms the addresses seen before again, newest first, once', async () => {
    const caches = fakeCaches();
    const before = createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches });
    for (const id of ['a', 'b', 'c']) await before.remember(new URL(`${ORIGIN}/sermons/${id}`));
    const fetched: string[] = [];
    const after = createOfflineRscNavigation({
      fetchFn: async request => { fetched.push(new URL(request.url).pathname); return flight('new build'); }, caches,
    });
    // Activation: the old build's payloads go (Next would refuse them), the addresses stay known.
    await after.retire();
    expect(stored(caches)).toEqual([]);
    // The first page the person sees online brings them back without visiting each one again.
    await after.rewarm();
    expect(fetched).toEqual(['/sermons/c', '/sermons/b', '/sermons/a']);
    const answer = await createOfflineRscNavigation({ fetchFn: offline(), caches }).respond(navigationRequest('/sermons/a', 'from-anywhere'));
    expect(await answer.text()).toBe('new build');
    await after.rewarm();
    expect(fetched).toHaveLength(3);
  });


  it('answers an offline navigation from any page with the payload kept when the page was seen', async () => {
    const caches = fakeCaches();
    // Online: the preacher sees the sermon.
    await createOfflineRscNavigation({ fetchFn: async () => flight('root-level payload'), caches })
      .remember(new URL(`${ORIGIN}/sermons/abc`));

    // Offline, later: the same sermon is opened from another page, so Next asks with another _rsc.
    const answer = await createOfflineRscNavigation({ fetchFn: offline(), caches })
      .respond(navigationRequest('/sermons/abc', 'fromSeries'));

    expect(answer.headers.get('content-type')).toBe('text/x-component');
    expect(await answer.text()).toBe('root-level payload');
  });

  it('keeps the payload rendered against the offline shell tree, which patches right under the root', async () => {
    const requests: Request[] = [];
    const nav = createOfflineRscNavigation({
      fetchFn: async request => { requests.push(request); return flight('payload'); },
      caches: fakeCaches(),
    });

    await nav.remember(new URL(`${ORIGIN}/sermons/abc?mode=raw`));

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe('/sermons/abc');
    expect(url.searchParams.get('mode')).toBe('raw');
    expect(requests[0].headers.get('rsc')).toBe('1');
    expect(requests[0].headers.get('next-router-state-tree')).toBe(SHELL_TREE);
    expect(url.searchParams.get('_rsc')).toBe(computeCacheBustingSearchParam(undefined, undefined, SHELL_TREE, undefined));
  });

  it('answers online navigations with the network response itself and stores nothing from traffic', async () => {
    const caches = fakeCaches();
    const network = flight('fresh');
    const nav = createOfflineRscNavigation({ fetchFn: async () => network, caches });

    expect(await nav.respond(navigationRequest('/series', 'x'))).toBe(network);
    expect(stored(caches)).toEqual([]);
  });

  it('fails like before when the page was never seen, so Next falls back to a full navigation', async () => {
    const nav = createOfflineRscNavigation({ fetchFn: offline(), caches: fakeCaches() });

    await expect(nav.respond(navigationRequest('/sermons/never-seen', 'x'))).rejects.toThrow('Failed to fetch');
  });

  it('never keeps an answer that is not a successful flight payload', async () => {
    const caches = fakeCaches();
    const html = new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const failed = new Response('boom', { status: 500, headers: { 'content-type': 'text/x-component' } });
    for (const answer of [html, failed]) {
      await createOfflineRscNavigation({ fetchFn: async () => answer, caches }).remember(new URL(`${ORIGIN}/sermons/abc`));
    }

    expect(stored(caches)).toEqual([]);
  });

  it('asks the server once per address, also when the page is reported twice at the same time', async () => {
    let calls = 0;
    const nav = createOfflineRscNavigation({ fetchFn: async () => { calls += 1; return flight('p'); }, caches: fakeCaches() });

    await Promise.all([nav.remember(new URL(`${ORIGIN}/sermons/abc`)), nav.remember(new URL(`${ORIGIN}/sermons/abc#notes`))]);
    await nav.remember(new URL(`${ORIGIN}/sermons/abc`));

    expect(calls).toBe(1);
  });

  it('evicts the page seen longest ago, not the one stored first', async () => {
    const caches = fakeCaches();
    const nav = createOfflineRscNavigation({ fetchFn: async () => flight('p'), caches });
    const page = (i: number) => new URL(`${ORIGIN}/sermons/s${i}`);

    for (let i = 0; i < OFFLINE_RSC_MAX_ENTRIES; i += 1) await nav.remember(page(i));
    await nav.remember(page(0)); // the first page is seen again
    await nav.remember(page(OFFLINE_RSC_MAX_ENTRIES));

    const keys = stored(caches);
    expect(keys).toHaveLength(OFFLINE_RSC_MAX_ENTRIES);
    expect(keys).toContain(page(0).href);
    expect(keys).not.toContain(page(1).href);
  });

  it('keys an address without the cache-busting parameter or the fragment and keeps the rest of the query', () => {
    expect(offlineRscKey(new URL(`${ORIGIN}/studies?q=grace&_rsc=abc&tag=x#top`))).toBe(`${ORIGIN}/studies?q=grace&tag=x`);
  });

  it('handles page navigations only: not automatic prefetches, API calls, the offline shell or other origins', () => {
    expect(isRscNavigation(navigationRequest('/sermons/abc', 'x'), ORIGIN)).toBe(true);
    expect(isRscNavigation(navigationRequest('/sermons/message.v2', 'x'), ORIGIN)).toBe(true);
    expect(isRscNavigation(navigationRequest('/sermons/abc', 'x', { 'next-router-prefetch': '1' }), ORIGIN)).toBe(false);
    expect(isRscNavigation(navigationRequest('/api/sermons', 'x'), ORIGIN)).toBe(false);
    expect(isRscNavigation(navigationRequest('/~offline', 'x'), ORIGIN)).toBe(false);
    expect(isRscNavigation(navigationRequest('/sermons/abc', 'x'), 'https://other.test')).toBe(false);
    // Shared pages stay with the default cache: nothing of theirs is kept here to answer with.
    expect(isRscNavigation(navigationRequest('/share/notes/token', 'x'), ORIGIN)).toBe(false);
  });

  it('lets go of a warm-up whose answer stalls after its headers', async () => {
    let calls = 0;
    // Headers arrived; the payload body never finishes reading.
    const stalledBody = () => new PlatformResponse(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
    }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
    const caches = fakeCaches();
    const nav = createOfflineRscNavigation({
      warmTimeoutMs: 20,
      fetchFn: () => { calls += 1; return Promise.resolve(calls === 1 ? stalledBody() : flight('p')); },
      caches,
    });
    const settles = (work: Promise<unknown>) =>
      Promise.race([work.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('stuck'), 500))]);

    expect(await settles(nav.remember(new URL(`${ORIGIN}/sermons/abc`)))).toBe('settled');
    await nav.remember(new URL(`${ORIGIN}/sermons/abc`));

    expect(calls).toBe(2);
  });

  it('lets go of a stalled warm-up, so a later visit can keep the page', async () => {
    let calls = 0;
    const nav = createOfflineRscNavigation({
      warmTimeoutMs: 20,
      // Failing Wi-Fi: the first answer never comes at all.
      fetchFn: () => { calls += 1; return calls === 1 ? new Promise<Response>(() => undefined) : Promise.resolve(flight('p')); },
      caches: fakeCaches(),
    });
    const settles = (work: Promise<unknown>) =>
      Promise.race([work.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('stuck'), 500))]);

    expect(await settles(nav.remember(new URL(`${ORIGIN}/sermons/abc`)))).toBe('settled');
    await nav.remember(new URL(`${ORIGIN}/sermons/abc`));

    expect(calls).toBe(2);
  });

  describe('edges of the waiting list (BUG-20261011-sw-offline-cache-edges)', () => {
    it('keeps the addresses another version carried over while a re-warm was running', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const nav = createOfflineRscNavigation({ fetchFn: async () => { await gate; return flight('new build'); }, caches });
      const running = nav.rewarm();
      await pause(0);
      // Meanwhile a newer version: a page seen under it, then its retirement carries the address over.
      const newer = createOfflineRscNavigation({ fetchFn: async () => flight('newer build'), caches });
      await newer.remember(new URL(`${ORIGIN}/sermons/new`));
      await newer.retire();
      release();
      await running;
      expect(await waiting(caches)).toContain(`${ORIGIN}/sermons/new`);
    });

    it('lets a later re-warm run when the list\'s storage did not answer', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      const gate = caches.holdNextRead();
      let fetched = 0;
      const nav = createOfflineRscNavigation({ storageTimeoutMs: 5, fetchFn: async () => { fetched += 1; return flight('new build'); }, caches });
      try {
        void nav.rewarm();
        await gate.started;
        await pause(30); // The storage deadline expires while the catalog read is held.
        gate.release();
        await Promise.race([nav.rewarm(), pause(300)]);
        expect(fetched).toBeGreaterThan(0);
      } finally { gate.release(); }
    });

    it('does not keep an answer that came through a redirect: it is another page\'s', async () => {
      const caches = fakeCaches();
      const redirected = flight('sign-in page');
      Object.defineProperty(redirected, 'redirected', { value: true });
      const nav = createOfflineRscNavigation({ fetchFn: async () => redirected, caches });
      expect(await nav.remember(new URL(`${ORIGIN}/sermons/a`))).toBe('failed');
      expect(stored(caches)).toEqual([]);
    });

    it('rebuilds a list that broke while the batch ran from the copy read at its start', async () => {
      const caches = fakeCaches();
      await retiredSixty(caches);
      const catalogBeforeBatch = caches.catalogSnapshot();
      let corrupted = false;
      const nav = createOfflineRscNavigation({ fetchFn: async () => {
        if (!corrupted) { corrupted = true; caches.corruptCatalog({ schema: 99, brokenDuringBatch: true }); }
        return flight('new build');
      }, caches });
      await nav.rewarm();
      expect(corrupted).toBe(true);
      // Unreadable metadata is never replaced with an empty list; once the fixture restores the
      // transactionally saved copy, remaining addresses can still be processed in the next batch.
      caches.restoreCatalog(catalogBeforeBatch);
      await nav.rewarm();
      expect(await waiting(caches)).toHaveLength(10);
    });

    it('does not let a request that outlived its version store the old build over the new one', async () => {
      const caches = fakeCaches();
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const old = createOfflineRscNavigation({ fetchFn: async () => { await gate; return flight('old build'); }, caches });
      const lingering = old.remember(new URL(`${ORIGIN}/sermons/a`));
      await pause(0);
      const fresh = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
      await fresh.retire();
      await fresh.remember(new URL(`${ORIGIN}/sermons/a`));
      release();
      await lingering;
      const offlineNav = createOfflineRscNavigation({ fetchFn: offline(), caches });
      const answer = await offlineNav.respond(navigationRequest('/sermons/a', 'x'));
      expect(await answer.text()).toBe('new build');
    });

  });

  it('does not keep shared pages, whose metadata comes from live server data', () => {
    expect(isRememberedPage(new URL(`${ORIGIN}/sermons/abc`), ORIGIN)).toBe(true);
    expect(isRememberedPage(new URL(`${ORIGIN}/share/notes/token`), ORIGIN)).toBe(false);
  });
});

/**
 * BUG-20261004-weak-network-delays-offline-navigation. On a weak signal a request neither answers nor
 * fails, and a navigation to a page already seen waited for it for as long as it lasted — the kept copy
 * was read only after a failure. Next applies a navigation only once it has its whole payload, so a
 * reply that sent its first bytes and fell silent is as late as one that never began. After a short
 * wait the kept copy answers; the network keeps the first word while it answers in time, and still
 * wins if it lands while the copy is being looked for; with nothing kept, it is waited for as before.
 */
describe('a navigation on a weak network', () => {
  const DEADLINE = 50;
  const never = () => new Promise<Response>(() => undefined);
  const settled = <T,>(promise: Promise<T>, ms = 1000) => Promise.race([promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still waiting')), ms))]);
  const later = (ms: number, body: string) => () => new Promise<Response>(resolve => setTimeout(() => resolve(flight(body)), ms));
  // A real streaming body: the jest setup replaces the global Response with one that has none.
  const startedThenSilent = () => async () => new PlatformResponse(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('first bytes')); },
  }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
  async function seen(caches: ReturnType<typeof fakeCaches>) {
    await createOfflineRscNavigation({ fetchFn: async () => flight('kept'), caches }).remember(new URL(`${ORIGIN}/sermons/abc`));
  }

  it('opens the kept copy when the network neither answers nor fails', async () => {
    const caches = fakeCaches(); await seen(caches);
    const nav = createOfflineRscNavigation({ fetchFn: never, caches, navigationDeadlineMs: DEADLINE });
    expect(await settled(nav.respond(navigationRequest('/sermons/abc', 'x')).then(answer => answer.text()))).toBe('kept');
  });

  it('opens the kept copy when the answer began and fell silent', async () => {
    const caches = fakeCaches(); await seen(caches);
    const nav = createOfflineRscNavigation({ fetchFn: startedThenSilent(), caches, navigationDeadlineMs: DEADLINE });
    expect(await settled(nav.respond(navigationRequest('/sermons/abc', 'x')).then(answer => answer.text()))).toBe('kept');
  });

  it('keeps the network answer that arrives whole in time', async () => {
    const caches = fakeCaches(); await seen(caches);
    const nav = createOfflineRscNavigation({ fetchFn: later(5, 'fresh'), caches, navigationDeadlineMs: DEADLINE });
    expect(await settled(nav.respond(navigationRequest('/sermons/abc', 'x')).then(answer => answer.text()))).toBe('fresh');
  });

  it('waits for the network as before when nothing is kept for the page', async () => {
    const nav = createOfflineRscNavigation({ fetchFn: later(DEADLINE * 3, 'fresh'), caches: fakeCaches(), navigationDeadlineMs: DEADLINE });
    expect(await settled(nav.respond(navigationRequest('/sermons/never-seen', 'x')).then(answer => answer.text()))).toBe('fresh');
  });

  it('takes the network answer that lands while the kept copy is still being looked for', async () => {
    const caches = fakeCaches(); await seen(caches);
    const gate = caches.holdNextRead();
    const nav = createOfflineRscNavigation({ fetchFn: later(DEADLINE * 2, 'fresh'), caches, navigationDeadlineMs: DEADLINE });
    try {
      const answer = nav.respond(navigationRequest('/sermons/abc', 'x')).then(response => response.text());
      await gate.started;
      await pause(DEADLINE * 3); // The whole network answer arrives while storage is still pending.
      gate.release();
      expect(await settled(answer)).toBe('fresh');
    } finally { gate.release(); }
  });

  it('is not held by storage that does not answer once the network does', async () => {
    const caches = fakeCaches(); await seen(caches);
    const gate = caches.holdNextRead();
    const nav = createOfflineRscNavigation({ fetchFn: later(DEADLINE * 2, 'fresh'), caches, navigationDeadlineMs: DEADLINE });
    try {
      const answer = nav.respond(navigationRequest('/sermons/abc', 'x')).then(response => response.text());
      await gate.started;
      expect(await settled(answer)).toBe('fresh');
    } finally { gate.release(); }
  });

  it('hands a streaming answer over at once when nothing is kept to answer instead', async () => {
    let more!: ReadableStreamDefaultController<Uint8Array>;
    const streaming = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      start(controller) { more = controller; controller.enqueue(new TextEncoder().encode('first ')); },
    }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: streaming, caches: fakeCaches(), navigationDeadlineMs: 2000 });
    const answer = await settled(nav.respond(navigationRequest('/sermons/never-seen', 'x')), 500);
    more.enqueue(new TextEncoder().encode('rest')); more.close();
    expect(await answer.text()).toBe('first rest');
  });

  it('stops downloading the late answer once the kept copy has answered', async () => {
    const caches = fakeCaches(); await seen(caches);
    let cancelled = false;
    const endless = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      pull(controller) { return new Promise(resolve => setTimeout(() => { if (!cancelled) controller.enqueue(new Uint8Array(1024)); resolve(); }, 5)); },
      cancel() { cancelled = true; },
    }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: endless, caches, navigationDeadlineMs: DEADLINE });
    expect(await settled(nav.respond(navigationRequest('/sermons/abc', 'x')).then(answer => answer.text()))).toBe('kept');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(cancelled).toBe(true);
  });

  // Codex refute-weak r2: each of these went behind HEAD.
  it('hands a streaming answer over soon when storage does not answer', async () => {
    const caches = fakeCaches(); await seen(caches);
    const gate = caches.holdNextRead();
    let more!: ReadableStreamDefaultController<Uint8Array>;
    const streaming = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      start(controller) { more = controller; controller.enqueue(new TextEncoder().encode('fresh ')); },
    }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: streaming, caches, navigationDeadlineMs: 3000 });
    try {
      const answerPromise = nav.respond(navigationRequest('/sermons/abc', 'x'));
      await gate.started;
      const answer = await settled(answerPromise, 1000);
      more.enqueue(new TextEncoder().encode('root')); more.close();
      expect(await answer.text()).toBe('fresh root');
    } finally { gate.release(); }
  });

  it('hands over a refusal from the server at once, even when its body stalls', async () => {
    const caches = fakeCaches(); await seen(caches);
    const refused = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('sign in')); },
    }), { status: 403, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: refused, caches, navigationDeadlineMs: DEADLINE });
    const answer = await settled(nav.respond(navigationRequest('/sermons/abc', 'x')));
    expect(answer.status).toBe(403);
  });

  it('lets the page stop an answer it no longer wants when nothing is kept', async () => {
    let cancelled = false;
    const endless = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      pull(controller) { return new Promise(resolve => setTimeout(() => { if (!cancelled) controller.enqueue(new Uint8Array(512)); resolve(); }, 5)); },
      cancel() { cancelled = true; },
    }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: endless, caches: fakeCaches(), navigationDeadlineMs: DEADLINE });
    const answer = await settled(nav.respond(navigationRequest('/sermons/never-seen', 'x')));
    await answer.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(cancelled).toBe(true);
  });

  // Codex refute-weak r3.
  it('counts the deadline from the navigation, so a copy found after it answers at once', async () => {
    const caches = fakeCaches(); await seen(caches);
    const gate = caches.holdNextRead();
    const nav = createOfflineRscNavigation({ fetchFn: never, caches, navigationDeadlineMs: 100 });
    let answered = false;
    const answer = nav.respond(navigationRequest('/sermons/abc', 'x')).then(() => { answered = true; });
    try {
      await gate.started;
      await pause(150); // The deadline passes while the read remains outstanding.
      expect(answered).toBe(false);
      gate.release();
      await answer;
      expect(answered).toBe(true);
    } finally { gate.release(); }
  });

  it('stops an answer whose headers arrive only after the kept copy has answered', async () => {
    const caches = fakeCaches(); await seen(caches);
    let cancelled = false;
    let sent = 0;
    const lateEndless = () => new Promise<Response>(resolve => setTimeout(() => resolve(new PlatformResponse(new ReadableStream<Uint8Array>({
      pull(controller) { return new Promise(done => setTimeout(() => { if (!cancelled) { sent += 1; controller.enqueue(new Uint8Array(1024)); } done(); }, 5)); },
      cancel() { cancelled = true; },
    }), { status: 200, headers: { 'content-type': 'text/x-component' } }) as unknown as Response), DEADLINE * 2));
    const nav = createOfflineRscNavigation({ fetchFn: lateEndless, caches, navigationDeadlineMs: DEADLINE });
    expect(await settled(nav.respond(navigationRequest('/sermons/abc', 'x')).then(answer => answer.text()))).toBe('kept');
    await new Promise(resolve => setTimeout(resolve, DEADLINE * 2 + 100));
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(3);
  });

  it('hands over at once a page the server sends instead of the payload, even when its body stalls', async () => {
    const caches = fakeCaches(); await seen(caches);
    const document = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('<!doctype html>')); },
    }), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: document, caches, navigationDeadlineMs: DEADLINE });
    const answer = await settled(nav.respond(navigationRequest('/sermons/abc', 'x')));
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  // Codex refute-weak r4: Next applies as a payload only `text/x-component`, case-sensitive; anything
  // else it opens as a document, and that decision must reach it.
  it.each([['TEXT/X-COMPONENT; charset=utf-8'], [null]])('hands over at once an answer Next would not apply as a payload (content type %p)', async type => {
    const caches = fakeCaches(); await seen(caches);
    const other = async () => new PlatformResponse(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('first bytes')); },
    }), { status: 200, headers: type ? { 'content-type': type } : {} }) as unknown as Response;
    const nav = createOfflineRscNavigation({ fetchFn: other, caches, navigationDeadlineMs: DEADLINE });
    const answer = await settled(nav.respond(navigationRequest('/sermons/abc', 'x')));
    expect(answer.headers.get('content-type')).toBe(type);
  });

  it('still answers from the kept copy at once when the network fails', async () => {
    const caches = fakeCaches(); await seen(caches);
    const nav = createOfflineRscNavigation({ fetchFn: offline(), caches, navigationDeadlineMs: 10_000 });
    expect(await settled(nav.respond(navigationRequest('/sermons/abc', 'x')).then(answer => answer.text()))).toBe('kept');
  });
});
