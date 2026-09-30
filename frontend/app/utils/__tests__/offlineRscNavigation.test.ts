/**
 * @jest-environment node
 */
import { computeCacheBustingSearchParam } from 'next/dist/shared/lib/router/utils/cache-busting-search-param';

import {
  OFFLINE_RSC_CACHE,
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
  };
}

function offline(): (request: Request) => Promise<Response> {
  return async () => { throw new TypeError('Failed to fetch'); };
}

const stored = (caches: ReturnType<typeof fakeCaches>) => [...(caches.stores.get(OFFLINE_RSC_CACHE)?.keys() ?? [])];

describe('offline RSC navigation', () => {
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
      text: () => new Promise<string>(() => undefined) }) as unknown as Response;
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
    const settles = (work: Promise<void>) =>
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
    const settles = (work: Promise<void>) =>
      Promise.race([work.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('stuck'), 500))]);

    expect(await settles(nav.remember(new URL(`${ORIGIN}/sermons/abc`)))).toBe('settled');
    await nav.remember(new URL(`${ORIGIN}/sermons/abc`));

    expect(calls).toBe(2);
  });

  it('does not keep shared pages, whose metadata comes from live server data', () => {
    expect(isRememberedPage(new URL(`${ORIGIN}/sermons/abc`), ORIGIN)).toBe(true);
    expect(isRememberedPage(new URL(`${ORIGIN}/share/notes/token`), ORIGIN)).toBe(false);
  });
});
