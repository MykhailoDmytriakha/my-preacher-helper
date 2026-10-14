/** @jest-environment node */
import { Response as PlatformResponse } from 'undici';

type WorkerCallback = (event: unknown) => void;
const mockListeners = new Map<string, WorkerCallback>();
const mockHandleFetch = jest.fn();
const mockHandleInstall = jest.fn();
const mockHandleActivate = jest.fn();
const mockHandleCache = jest.fn();
const mockMatchPrecache = jest.fn(async (url: string) => new Response(`precached ${url}`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
const mockCaches = { delete: jest.fn(async () => true), open: jest.fn(() => new Promise(() => undefined)) };
let mockOptions: {
  skipWaiting: boolean;
  clientsClaim: boolean;
  navigationPreload: boolean;
  runtimeCaching: { matcher: (args: { url: URL; request?: { mode?: string; url?: string; headers?: Headers } }) => boolean; handler?: unknown }[];
  fallbacks: { entries: { url: string; matcher: (args: { request: { destination: string } }) => boolean }[] };
};

jest.mock('@serwist/next/worker', () => ({ defaultCache: [] }));
jest.mock('serwist', () => ({
  CacheFirst: jest.fn().mockImplementation(function (this: { options: unknown }, options: unknown) {
    this.options = options;
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
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        origin: 'https://my-preacher-helper.com',
        __SW_MANIFEST: [],
        caches: mockCaches,
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

  it('retains install, activation and message handling', () => {
    const event = { waitUntil: jest.fn(), data: { type: 'CACHE_URLS' } };
    mockListeners.get('install')!(event);
    mockListeners.get('activate')!(event);
    mockListeners.get('message')!(event);
    expect(mockHandleInstall).toHaveBeenCalledWith(event);
    expect(mockHandleActivate).toHaveBeenCalledWith(event);
    expect(mockHandleCache).toHaveBeenCalledWith(event);
  });

  it('drops the previous build\'s offline navigation payloads when a new version activates, keeping their addresses', async () => {
    const put = jest.fn(async () => undefined);
    const cache = { keys: jest.fn(async () => [new Request('https://my-preacher-helper.com/sermons/example')]), put, match: jest.fn(), delete: jest.fn() };
    mockCaches.open.mockImplementation((() => Promise.resolve(cache)) as never);
    const event = { waitUntil: jest.fn() };
    mockListeners.get('activate')!(event);
    await event.waitUntil.mock.calls.at(-1)?.[0];
    expect(mockCaches.delete).toHaveBeenCalledWith('pages-rsc-offline');
    // The addresses go to the index, so the new version can warm them again (offlineRscNavigation).
    expect(mockCaches.open).toHaveBeenCalledWith('pages-rsc-offline-index');
    expect(put).toHaveBeenCalledTimes(1);
    mockCaches.open.mockImplementation(() => new Promise(() => undefined));
  });

  it('keeps a page the person has seen, and leaves other pages\' messages to Serwist', async () => {
    mockHandleCache.mockClear();
    const seen = { waitUntil: jest.fn(), data: { type: 'offline-page-seen', url: 'https://my-preacher-helper.com/sermons/example' } };
    mockListeners.get('message')!(seen);
    expect(seen.waitUntil).toHaveBeenCalledTimes(1);
    // Storing waits for a version's retirement to finish first (a microtask when there is none).
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCaches.open).toHaveBeenCalledWith('pages-rsc-offline');
    expect(mockHandleCache).not.toHaveBeenCalled();

    const shared = { waitUntil: jest.fn(), data: { type: 'offline-page-seen', url: 'https://my-preacher-helper.com/share/notes/token' } };
    mockListeners.get('message')!(shared);
    expect(shared.waitUntil).not.toHaveBeenCalled();
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

    it('applies only to the start pages opened as documents', () => {
      const rule = startRule();
      expect(rule.matcher(opened('https://my-preacher-helper.com/dashboard'))).toBe(true);
      expect(rule.matcher(opened(START, 'cors'))).toBe(false);
      expect(rule.matcher(opened('https://my-preacher-helper.com/sermons/a'))).toBe(false);
      expect(rule.matcher(opened('https://elsewhere.example/'))).toBe(false);
    });
  });
});
