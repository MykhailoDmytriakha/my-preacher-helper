/** @jest-environment node */

type WorkerCallback = (event: unknown) => void;
const mockListeners = new Map<string, WorkerCallback>();
const mockHandleFetch = jest.fn();
const mockHandleInstall = jest.fn();
const mockHandleActivate = jest.fn();
const mockHandleCache = jest.fn();
const mockCaches = { delete: jest.fn(async () => true), open: jest.fn(() => new Promise(() => undefined)) };
let mockOptions: {
  skipWaiting: boolean;
  clientsClaim: boolean;
  navigationPreload: boolean;
  runtimeCaching: { matcher: (args: { url: URL }) => boolean }[];
  fallbacks: { entries: { url: string; matcher: (args: { request: { destination: string } }) => boolean }[] };
};

jest.mock('@serwist/next/worker', () => ({ defaultCache: [] }));
jest.mock('serwist', () => ({
  NetworkOnly: jest.fn(),
  Serwist: jest.fn().mockImplementation((options) => {
    mockOptions = options;
    return {
      handleFetch: mockHandleFetch,
      handleInstall: mockHandleInstall,
      handleActivate: mockHandleActivate,
      handleCache: mockHandleCache,
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

  it('keeps recovery reads network-only and the offline fallback limited to documents', () => {
    const recovery = mockOptions.runtimeCaching[0].matcher;
    expect(recovery({ url: new URL('https://my-preacher-helper.com/api/sermons/example') })).toBe(true);
    expect(recovery({ url: new URL('https://my-preacher-helper.com/api/sermons/example/plan') })).toBe(true);
    expect(recovery({ url: new URL('https://my-preacher-helper.com/api/groups') })).toBe(false);
    expect(recovery({ url: new URL('https://other.example/api/sermons/example') })).toBe(false);
    const fallback = mockOptions.fallbacks.entries[0];
    expect(fallback.url).toBe('/~offline');
    expect(fallback.matcher({ request: { destination: 'document' } })).toBe(true);
    expect(fallback.matcher({ request: { destination: '' } })).toBe(false);
    expect(mockOptions).toMatchObject({ skipWaiting: true, clientsClaim: true, navigationPreload: true });
  });
});
