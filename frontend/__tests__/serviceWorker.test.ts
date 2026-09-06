/** @jest-environment node */

type WorkerCallback = (event: unknown) => void;
const mockListeners = new Map<string, WorkerCallback>();
const mockHandleFetch = jest.fn();
const mockHandleInstall = jest.fn();
const mockHandleActivate = jest.fn();
const mockHandleCache = jest.fn();
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
    const event = {};
    mockListeners.get('install')!(event);
    mockListeners.get('activate')!(event);
    mockListeners.get('message')!(event);
    expect(mockHandleInstall).toHaveBeenCalledWith(event);
    expect(mockHandleActivate).toHaveBeenCalledWith(event);
    expect(mockHandleCache).toHaveBeenCalledWith(event);
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
