/**
 * @jest-environment node
 */
import { computeCacheBustingSearchParam } from 'next/dist/shared/lib/router/utils/cache-busting-search-param';

import {
  OFFLINE_RSC_CACHE,
  OFFLINE_RSC_INDEX_CACHE,
  OFFLINE_RSC_MAX_ENTRIES,
  createOfflineRscNavigation,
  isRememberedPage,
  isRscNavigation,
  offlineRscKey,
} from '../offlineRscNavigation';

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

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (key: RequestInfo | URL) => (typeof key === 'string' ? key : key instanceof URL ? key.href : key.url);
  return {
    stores,
    async open(name: string) {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        async match(key: RequestInfo | URL) { return store.get(keyOf(key))?.clone(); },
        async put(key: RequestInfo | URL, response: Response) { store.delete(keyOf(key)); store.set(keyOf(key), response); },
        async keys() { return [...store.keys()].map(url => new Request(url)); },
        async delete(key: RequestInfo | URL) { return store.delete(keyOf(key)); },
      } as unknown as Cache;
    },
    async delete(name: string) { return stores.delete(name); },
  };
}

function offline(): (request: Request) => Promise<Response> {
  return async () => { throw new TypeError('Failed to fetch'); };
}

const stored = (caches: ReturnType<typeof fakeCaches>) => [...(caches.stores.get(OFFLINE_RSC_CACHE)?.keys() ?? [])];

/** Sixty pages seen under the old build, then a new version retires their payloads. */
async function retiredSixty(caches: ReturnType<typeof fakeCaches>) {
  const seen = createOfflineRscNavigation({ fetchFn: async () => flight('old build'), caches });
  for (let i = 0; i < 60; i++) await seen.remember(new URL(`${ORIGIN}/sermons/${i}`));
  await createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches }).retire();
}
const sermonId = (request: Request) => Number(new URL(request.url).pathname.split('/').pop());

/** The addresses waiting to be warmed again, oldest first, whatever the entries carry besides. */
async function waiting(caches: ReturnType<typeof fakeCaches>): Promise<string[]> {
  const list = caches.stores.get(OFFLINE_RSC_INDEX_CACHE)?.values().next().value as Response | undefined;
  if (!list) return [];
  const entries = await list.clone().json() as Array<string | { address: string }>;
  return entries.map(entry => (typeof entry === 'string' ? entry : entry.address));
}
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
      const real = caches.open.bind(caches);
      let full = true;
      caches.open = async (name: string) => {
        const cache = await real(name);
        if (name !== OFFLINE_RSC_CACHE) return cache;
        return { ...cache, put: async (key: RequestInfo | URL, response: Response) => {
          if (full && String(typeof key === 'string' ? key : (key as Request).url).endsWith('/sermons/40')) {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
          }
          return cache.put(key, response);
        } } as unknown as Cache;
      };
      const nav = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
      await nav.rewarm();
      full = false;
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
      refusing = false;
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
      // Another page's eviction, decided on an older order, lands right after 59 is refreshed.
      const real = caches.open.bind(caches);
      let evict = true;
      caches.open = async (name: string) => {
        const cache = await real(name);
        if (name !== OFFLINE_RSC_CACHE) return cache;
        return { ...cache, put: async (key: RequestInfo | URL, response: Response) => {
          await cache.put(key, response);
          const url = typeof key === 'string' ? key : (key as Request).url;
          if (evict && url.endsWith('/sermons/59')) { evict = false; await cache.delete(url); }
        } } as unknown as Cache;
      };
      const nav = createOfflineRscNavigation({ fetchFn: async () => flight('new build'), caches });
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
    // Headers arrived; the body never finishes.
    const stalledBody = () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/x-component' }),
      text: () => new Promise<string>(() => undefined), arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined) }) as unknown as Response;
    const caches = fakeCaches();
    const reading = {
      // A real cache reads the whole body before it stores it.
      open: async (name: string) => {
        const cache = await caches.open(name);
        return { ...cache, match: cache.match, keys: cache.keys, delete: cache.delete,
          put: async (key: RequestInfo | URL, response: Response) => { await response.text(); await cache.put(key, new Response('p')); } };
      },
    };
    const nav = createOfflineRscNavigation({
      warmTimeoutMs: 20,
      fetchFn: () => { calls += 1; return Promise.resolve(calls === 1 ? stalledBody() : flight('p')); },
      caches: reading as never,
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
      const real = caches.open.bind(caches);
      let silent = true;
      caches.open = async (name: string) => (silent && name === OFFLINE_RSC_INDEX_CACHE ? new Promise<Cache>(() => undefined) : real(name));
      let fetched = 0;
      const nav = createOfflineRscNavigation({ storageTimeoutMs: 5, fetchFn: async () => { fetched += 1; return flight('new build'); }, caches });
      void nav.rewarm();
      await pause(30);
      silent = false;
      await Promise.race([nav.rewarm(), pause(300)]);
      expect(fetched).toBeGreaterThan(0);
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
      const index = caches.stores.get(OFFLINE_RSC_INDEX_CACHE)!;
      let broken = false;
      const nav = createOfflineRscNavigation({ fetchFn: async () => {
        if (!broken) { broken = true; index.set('https://offline-index.invalid/addresses', new Response('{broken')); }
        return flight('new build');
      }, caches });
      await nav.rewarm();
      // The fifty newest warmed and left; the ten older ones are still waiting, in a list that reads again.
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
