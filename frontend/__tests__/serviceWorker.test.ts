/** @jest-environment node */
import { webcrypto } from 'node:crypto';
import { Response as PlatformResponse } from 'undici';

import type { createOfflinePageStorageHarness } from '../test-utils/offlinePageStorageHarness';

type WorkerCallback = (event: unknown) => void;
const mockListeners = new Map<string, WorkerCallback>();
const mockHandleFetch = jest.fn();
const mockHandleInstall = jest.fn();
const mockHandleActivate = jest.fn();
const mockHandleCache = jest.fn();
const mockPrefetch = jest.fn<Promise<Response>, [unknown]>();
const mockMatchPrecache = jest.fn(async (url: string) => new Response(`precached ${url}`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
const mockManifest = [{ url: '/~offline', revision: 'worker-test' }];
let mockOfflineHarness: ReturnType<typeof createOfflinePageStorageHarness>;
let mockWorkerBuild: string | undefined;
let mockOptions: {
  skipWaiting: boolean;
  clientsClaim: boolean;
  navigationPreload: boolean;
  runtimeCaching: { matcher: (args: { url: URL; request?: { mode?: string; url?: string; headers?: Headers } }) => boolean; handler?: unknown }[];
  fallbacks: { entries: { url: string; matcher: (args: { request: { destination: string } }) => boolean }[] };
};

jest.mock('@serwist/next/worker', () => {
  const { NetworkFirst } = jest.requireMock('serwist');
  const PAGES_CACHE_NAME = { rscPrefetch: 'pages-rsc-prefetch' };
  return {
    PAGES_CACHE_NAME,
    defaultCache: [{
      matcher: ({ request, url }: { request: Request; url: URL }) =>
        url.origin === 'https://my-preacher-helper.com' && !url.pathname.startsWith('/api/')
        && request.headers.get('RSC') === '1' && request.headers.get('Next-Router-Prefetch') === '1',
      handler: new NetworkFirst({ cacheName: PAGES_CACHE_NAME.rscPrefetch }),
    }],
  };
});
jest.mock('serwist', () => ({
  CacheFirst: jest.fn().mockImplementation(function (this: { options: unknown }, options: unknown) {
    this.options = options;
  }),
  NetworkFirst: jest.fn().mockImplementation(function (this: { cacheName: string; handle: typeof mockPrefetch }, options: { cacheName: string }) {
    this.cacheName = options.cacheName;
    this.handle = mockPrefetch;
  }),
  NetworkOnly: jest.fn(),
  Serwist: jest.fn().mockImplementation((options) => {
    mockOptions = options;
    return {
      handleFetch: mockHandleFetch,
      handleInstall: mockHandleInstall,
      handleActivate: mockHandleActivate,
      handleCache: mockHandleCache,
      matchPrecache: mockMatchPrecache,
      addEventListeners: () => {
        mockListeners.set('fetch', mockHandleFetch);
        mockListeners.set('install', mockHandleInstall);
        mockListeners.set('activate', mockHandleActivate);
        mockListeners.set('message', mockHandleCache);
      },
    };
  }),
}));

describe('service worker transport boundary', () => {
  beforeAll(async () => {
    const { createOfflinePageStorageHarness } = jest.requireActual('../test-utils/offlinePageStorageHarness') as typeof import('../test-utils/offlinePageStorageHarness');
    mockOfflineHarness = createOfflinePageStorageHarness({
      acceptAddress: address => {
        try {
          const url = new URL(address);
          return url.origin === 'https://my-preacher-helper.com' && /^\/sermons\/[a-zA-Z0-9-]+$/.test(url.pathname)
            && !url.search && !url.hash;
        } catch { return false; }
      },
    });
    const previousBuild = mockOfflineHarness.storage('previous-build');
    await previousBuild.activate();
    const oldAddress = 'https://my-preacher-helper.com/sermons/example';
    const oldReservation = await previousBuild.reserve(oldAddress, { leaseMs: 10_000 });
    if (oldReservation.outcome !== 'fetch') throw new Error('Could not seed the previous build payload');
    await previousBuild.publish(oldReservation.ticket, {
      body: Uint8Array.from(new TextEncoder().encode('previous-build-payload')).buffer,
      headers: [['content-type', 'text/x-component']],
      status: 200,
      statusText: 'OK',
    });

    jest.doMock('../app/utils/offlinePageStorage', () => ({
      createOfflinePageStorage: ({ build, maxEntries }: { build: string; maxEntries: number }) => {
        mockWorkerBuild = build;
        return mockOfflineHarness.storage(build, maxEntries);
      },
    }));
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        origin: 'https://my-preacher-helper.com',
        __SW_MANIFEST: mockManifest,
        caches: mockOfflineHarness.legacyCaches,
        addEventListener: (name: string, callback: WorkerCallback) => mockListeners.set(name, callback),
      },
    });
    await import('../app/sw');
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'self');
  });

  it.each(['GET', 'POST'])('leaves Firestore %s requests to the browser without a cached response', (method) => {
    const event = {
      request: { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?SID=session', method },
      respondWith: jest.fn(),
    };
    mockListeners.get('fetch')!(event);
    expect(mockHandleFetch).not.toHaveBeenCalled();
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it.each([
    'https://my-preacher-helper.com/sermons/example',
    'https://my-preacher-helper.com/_next/static/chunks/app.js',
    'https://my-preacher-helper.com/api/sermons/example',
    'https://fonts.gstatic.com/example.woff2',
    'https://firestore.googleapis.com.example.org/resource',
  ])('preserves existing routing for %s', (url) => {
    const event = { request: { url, method: 'GET' } };
    mockListeners.get('fetch')!(event);
    expect(mockHandleFetch).toHaveBeenCalledWith(event);
  });

  it('drops the previous build\'s offline navigation payloads when a new version activates, keeping their addresses', async () => {
    const legacyAddress = 'https://my-preacher-helper.com/sermons/example';
    mockOfflineHarness.seedLegacyWaiting([legacyAddress]);
    mockOfflineHarness.seedLegacyPayload(legacyAddress, new Response('legacy payload', {
      headers: { 'content-type': 'text/x-component' },
    }));
    const event = { waitUntil: jest.fn() };
    mockListeners.get('activate')!(event);
    await event.waitUntil.mock.calls.at(-1)?.[0];
    expect(mockWorkerBuild).toMatch(/^rsc-v1:[a-f0-9]{64}$/);
    expect(mockOfflineHarness.entries().map(entry => entry.address)).toEqual(expect.arrayContaining([
      'https://my-preacher-helper.com/sermons/example', legacyAddress,
    ]));
    expect(mockOfflineHarness.payload('https://my-preacher-helper.com/sermons/example')).toBeUndefined();
    expect(mockOfflineHarness.payload(legacyAddress)).toBeUndefined();
  });

  it('retains install, activation and message handling', () => {
    const event = { waitUntil: jest.fn(), data: { type: 'CACHE_URLS' } };
    mockListeners.get('install')!(event);
    mockListeners.get('activate')!(event);
    mockListeners.get('message')!(event);
    expect(mockHandleInstall).toHaveBeenCalledWith(event);
    expect(mockHandleActivate).toHaveBeenCalledWith(event);
    expect(mockHandleCache).toHaveBeenCalledWith(event);
  });

  it('keeps a page the person has seen, and leaves other pages\' messages to Serwist', async () => {
    mockHandleCache.mockClear();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('new-build-payload', {
      headers: { 'content-type': 'text/x-component' },
    }));
    const seen = { waitUntil: jest.fn(), data: { type: 'offline-page-seen', url: 'https://my-preacher-helper.com/sermons/example' } };
    mockListeners.get('message')!(seen);
    expect(seen.waitUntil).toHaveBeenCalledTimes(1);
    await seen.waitUntil.mock.calls[0][0];
    const entry = mockOfflineHarness.entries().find(page => page.address === seen.data.url);
    expect(entry?.warm).toBe(true);
    expect(mockOfflineHarness.payload(seen.data.url)).toMatchObject({ build: mockWorkerBuild, status: 200 });
    expect(await new Response(mockOfflineHarness.payload(seen.data.url)?.body).text()).toBe('new-build-payload');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockHandleCache).not.toHaveBeenCalled();

    const shared = { waitUntil: jest.fn(), data: { type: 'offline-page-seen', url: 'https://my-preacher-helper.com/share/notes/token' } };
    mockListeners.get('message')!(shared);
    expect(shared.waitUntil).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  function prefetchPage(path: string): Promise<Response> {
    const url = new URL(`https://my-preacher-helper.com${path}?_rsc=offline-shell`);
    const request = new Request(url, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
    const options = { request, url, event: { waitUntil: jest.fn() } };
    const handler = mockOptions.runtimeCaching.find(rule => rule.matcher(options))?.handler;
    if (typeof handler === 'function') return handler(options);
    return (handler as { handle: (args: typeof options) => Promise<Response> }).handle(options);
  }

  async function retainPrefetchFixture() {
    const url = 'https://my-preacher-helper.com/sermons/warm-prefetch';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('saved root Flight', {
      headers: { 'content-type': 'text/x-component' },
    }));
    try {
      const seen = { waitUntil: jest.fn(), data: { type: 'offline-page-seen', url } };
      mockListeners.get('message')!(seen);
      await seen.waitUntil.mock.calls[0][0];
      expect(mockOfflineHarness.payload(url)).toBeDefined();
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it('answers a failed automatic prefetch for a seen route from the saved Flight payload', async () => {
    await retainPrefetchFixture();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    try {
      mockPrefetch.mockRejectedValueOnce(new Error('prefetch network and cache unavailable'));

      const answer = await prefetchPage('/sermons/warm-prefetch');

      expect(answer.headers.get('content-type')).toBe('text/x-component');
      expect(await answer.text()).toBe('saved root Flight');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('preserves successful, refused, and unseen automatic prefetch outcomes', async () => {
    await retainPrefetchFixture();
    const fresh = new Response('exact prefetch', { headers: { 'content-type': 'text/x-component' } });
    const refused = new Response('refused', { status: 403 });
    mockPrefetch.mockResolvedValueOnce(fresh).mockResolvedValueOnce(refused).mockRejectedValueOnce(new Error('no saved answer'));
    await expect(prefetchPage('/sermons/warm-prefetch')).resolves.toBe(fresh);
    await expect(prefetchPage('/sermons/warm-prefetch')).resolves.toBe(refused);
    await expect(prefetchPage('/sermons/never-seen')).rejects.toThrow('no saved answer');
    expect(mockOfflineHarness.entries().some(entry => entry.address.endsWith('/sermons/never-seen'))).toBe(false);
  });

  it('uses the saved page when an automatic prefetch stalls past the navigation deadline', async () => {
    await retainPrefetchFixture();
    mockPrefetch.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    jest.useFakeTimers();
    try {
      const answer = prefetchPage('/sermons/warm-prefetch').then(response => response.text());
      await jest.advanceTimersByTimeAsync(4000);
      await expect(answer).resolves.toBe('saved root Flight');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the Bible text in its own cache, answered first, before the default rules', async () => {
    // 66 book files would push each other out of the default 32-entry static-JSON cache.
    const { CacheFirst } = jest.requireMock('serwist');
    const index = mockOptions.runtimeCaching.findIndex(rule => rule.handler instanceof CacheFirst);
    expect(index).toBe(1);
    type BiblePlugin = {
      cacheWillUpdate: (args: { response: Response }) => Promise<Response | null>;
      handlerDidError: (args: { request: Request }) => Promise<Response>;
    };
    const options = (mockOptions.runtimeCaching[index].handler as { options: { cacheName: string; plugins: BiblePlugin[] } }).options;
    expect(options.cacheName).toBe('bible-text');
    // Only a book is kept, checked before the background write: a "200" Wi-Fi sign-in page or a JSON
    // error must never become the book.
    const keep = (response: Response) => options.plugins[0].cacheWillUpdate({ response });
    const json = (body: unknown, status = 200) =>
      new PlatformResponse(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }) as unknown as Response;
    const book = json({ id: 'Jude', source: 720, chapters: [['¶Иуда']] });
    await expect(keep(book)).resolves.toBe(book);
    await expect(keep(json({ error: 'gateway' }))).resolves.toBeNull();
    await expect(keep(json({ id: 'Jude', chapters: [[]] }))).resolves.toBeNull();
    await expect(keep(json({ id: 'Jude', chapters: [['a']] }, 404))).resolves.toBeNull();
    await expect(keep(new PlatformResponse('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response)).resolves.toBeNull();
    // A store that refuses to read must not keep the book from the network.
    const answer = new PlatformResponse('{}') as unknown as Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer).mockRejectedValueOnce(new TypeError('offline'));
    const request = new Request('https://my-preacher-helper.com/bible-text/rst/v1/jude.json');
    await expect(options.plugins[0].handlerDidError({ request })).resolves.toBe(answer);
    await expect(options.plugins[0].handlerDidError({ request })).resolves.toMatchObject({ status: 503 });
    fetchSpy.mockRestore();
    const matches = (href: string) => mockOptions.runtimeCaching[index].matcher({ url: new URL(href) });
    expect(matches('https://my-preacher-helper.com/bible-text/rst/v1/1-timothy.json')).toBe(true);
    expect(matches('https://my-preacher-helper.com/bible')).toBe(false);
    expect(matches('https://my-preacher-helper.com/api/bible-text/x.json')).toBe(false);
    expect(matches('https://elsewhere.example/bible-text/rst/v1/1-timothy.json')).toBe(false);
  });

  it('answers every private API request from the network only, first among the rules', () => {
    // Owner's rule 1 (BUG-20260908-cached-response-counts-as-live-connection): a stored `/api` answer
    // handed back when the network failed looked like the server answering. First, so the default
    // static-JSON rule cannot catch `/api/…json`; the public shared-note API keeps its caching.
    const apiRule = mockOptions.runtimeCaching[0];
    expect(apiRule.handler).toBeInstanceOf(jest.requireMock('serwist').NetworkOnly);
    const matches = (href: string) => apiRule.matcher({ url: new URL(href) });
    expect(matches('https://my-preacher-helper.com/api/sermons/example')).toBe(true);
    expect(matches('https://my-preacher-helper.com/api/groups')).toBe(true);
    expect(matches('https://my-preacher-helper.com/api/data-engine/read/note.json')).toBe(true);
    expect(matches('https://api.example.org/api/me/settings')).toBe(true);
    expect(matches('https://my-preacher-helper.com/api/share/notes/token')).toBe(false);
    expect(matches('https://my-preacher-helper.com/sermons/example')).toBe(false);
    const fallback = mockOptions.fallbacks.entries[0];
    expect(fallback.url).toBe('/~offline');
    expect(fallback.matcher({ request: { destination: 'document' } })).toBe(true);
    expect(fallback.matcher({ request: { destination: '' } })).toBe(false);
    expect(mockOptions).toMatchObject({ skipWaiting: true, clientsClaim: true, navigationPreload: true });
  });

  /**
   * BUG-20261004-weak-network-delays-offline-navigation: the installed app opens at `/` and went on
   * waiting for a weak signal that neither answered nor failed — 20–30 s on the owner's phone. The
   * precached shell holds the dashboard: past a short wait it answers the start of the app.
   */
  describe('the start of the app on a weak signal', () => {
    const START = 'https://my-preacher-helper.com/';
    const opened = (href: string, mode = 'navigate') => ({ url: new URL(href), request: { mode, url: href, headers: new Headers() } });
    const startRule = () => mockOptions.runtimeCaching.find(rule => rule.matcher(opened(START)))!;
    const answer = (fetchImpl: () => Promise<Response>) => {
      const original = globalThis.fetch;
      globalThis.fetch = jest.fn(fetchImpl) as typeof fetch;
      const handler = startRule().handler as (options: { request: Request; event: unknown; url: URL }) => Promise<Response>;
      const result = handler({ request: new Request(START), event: { preloadResponse: Promise.resolve(undefined) }, url: new URL(START) });
      return result.finally(() => { globalThis.fetch = original; });
    };

    it('opens the precached shell when the network neither answers nor fails', async () => {
      const opened = await answer(() => new Promise<Response>(() => undefined));
      expect(await opened.text()).toBe('precached /~offline');
    }, 10_000);

    // Codex refute-weak r4: the start waits for any successful page, whatever its headers say.
    it('opens the precached shell when the page began and fell silent without saying its type', async () => {
      // A real streaming body: the jest setup replaces the global Response with one that has none.
      const opened = await answer(async () => new PlatformResponse(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('<!doctype html>')); },
      }), { status: 200 }) as unknown as Response);
      expect(await opened.text()).toBe('precached /~offline');
    }, 10_000);

    it('opens the page from the network when it answers in time', async () => {
      const opened = await answer(async () => new Response('fresh start'));
      expect(await opened.text()).toBe('fresh start');
    });

    it('asks the network itself when the navigation preload is refused', async () => {
      const original = globalThis.fetch;
      globalThis.fetch = jest.fn(async () => new Response('fetched start')) as typeof fetch;
      const handler = startRule().handler as (options: { request: Request; event: unknown; url: URL }) => Promise<Response>;
      const refused = Promise.reject(new Error('preload failed')); refused.catch(() => undefined);
      try {
        const opened = await handler({ request: new Request(START), event: { preloadResponse: refused }, url: new URL(START) });
        expect(await opened.text()).toBe('fetched start');
      } finally { globalThis.fetch = original; }
    });

    it.each(['/settings/user', '/sermons/example', '/groups/example/conduct', '/sermons/example/plan/manual'])(
      'opens the saved shell by the deadline for a pending document at %s', async path => {
        jest.useFakeTimers();
        const original = globalThis.fetch;
        globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as typeof fetch;
        const href = `https://my-preacher-helper.com${path}`;
        let finished = false;
        try {
          const rule = mockOptions.runtimeCaching.find(rule => rule.matcher(opened(href)));
          const handler = rule?.handler as undefined | ((options: { request: Request; event: unknown; url: URL }) => Promise<Response>);
          // A document outside the bounded rule follows the ordinary pending network request.
          const response = handler
            ? handler({ request: new Request(href), event: { preloadResponse: Promise.resolve(undefined) }, url: new URL(href) })
            : fetch(href);
          const observed = response.then(answer => { finished = true; return answer; });
          await jest.advanceTimersByTimeAsync(3001);
          expect(finished).toBe(true);
          expect(await (await observed).text()).toBe('precached /~offline');
        } finally { globalThis.fetch = original; jest.useRealTimers(); }
      }
    );

    it('applies only to supported shell pages opened as same-origin documents', () => {
      const rule = startRule();
      expect(rule.matcher(opened('https://my-preacher-helper.com/dashboard'))).toBe(true);
      expect(rule.matcher(opened(START, 'cors'))).toBe(false);
      expect(rule.matcher(opened('https://my-preacher-helper.com/sermons/a'))).toBe(true);
      expect(rule.matcher(opened('https://my-preacher-helper.com/admin'))).toBe(true);
      for (const path of ['/login', '/share/notes/token', '/api/me/settings', '/admin/private', '/unknown', '/settings/new-section']) {
        expect(rule.matcher(opened(`https://my-preacher-helper.com${path}`))).toBe(false);
      }
      expect(rule.matcher(opened('https://elsewhere.example/'))).toBe(false);
    });
  });
});
