/**
 * OFFLINE CLIENT-SIDE NAVIGATION (BUG-20260927-offline-navigation-reloads-whole-app).
 *
 * A client-side navigation in the App Router fetches the target's RSC payload. Next computes that
 * payload as a DIFF against the page the person is leaving (the `next-router-state-tree` header)
 * and puts a hash of that header into `_rsc`. So the same address gets a different payload and a
 * different `_rsc` from every page it is opened from, and a cache keyed by the full URL misses
 * offline almost always. Next then falls back to a full browser navigation: the whole app reloads
 * on every tap without network.
 *
 * Dropping `_rsc` from the key is not enough: a payload diffed against another page may not fit
 * the current router tree, and then Next applies nothing and only changes the address — the old
 * screen under the new URL (navigate-reducer's `newTree === null` branch has no fallback).
 *
 * What fits every page is a payload rendered against the offline shell's tree: its root child
 * differs from every page's, so the server starts the patch right under the root, and a patch
 * there applies whatever the router currently shows (measured on a production build: from the
 * shell tree the patch starts at `["children", "(pages)"]`). So, per address the person has seen
 * online, the worker keeps that root-level payload and answers an offline navigation with it.
 *
 * WHAT COUNTS AS SEEN is told by the page itself (`OfflinePageMemory`), not guessed from traffic:
 * a navigation served from Next's prefetch sends no request, the first page loads before the
 * worker controls it, and a full prefetch looks like a navigation on the wire.
 *
 * The payload carries the build id; after a deploy Next sees the mismatch and does the full
 * navigation it does today, and the worker drops the old payloads when the new version activates.
 * Known and accepted: offline `router.refresh()` gets a patch that is not a root render, so Next
 * keeps the current screen instead of reloading it.
 */

import {
  NEXT_ROUTER_PREFETCH_HEADER,
  NEXT_ROUTER_STATE_TREE_HEADER,
  NEXT_RSC_UNION_QUERY,
  RSC_CONTENT_TYPE_HEADER,
  RSC_HEADER,
} from 'next/dist/client/components/app-router-headers';
import { computeCacheBustingSearchParam } from 'next/dist/shared/lib/router/utils/cache-busting-search-param';

export const OFFLINE_RSC_CACHE = 'pages-rsc-offline';
/** Where a new version keeps the addresses the old one had, until it has warmed them again. */
export const OFFLINE_RSC_INDEX_CACHE = 'pages-rsc-offline-index';
/** How many of the most recently seen addresses a new version warms again by itself. */
export const OFFLINE_RSC_REWARM_MAX = 50;
/** A payload is ~10 kB; two hundred addresses cover every sermon, study and page a preacher keeps. */
export const OFFLINE_RSC_MAX_ENTRIES = 200;
/** The message a page sends the worker when the person has seen it. */
export const OFFLINE_PAGE_SEEN = 'offline-page-seen';

const OFFLINE_SHELL_PATH = '/~offline';
const ROOT_LEVEL_TREE = encodeURIComponent(
  JSON.stringify(['', { children: ['~offline', { children: ['__PAGE__', {}] }] }, null, null, true])
);
const ROOT_LEVEL_RSC = computeCacheBustingSearchParam(undefined, undefined, ROOT_LEVEL_TREE, undefined);

type CacheLike = Pick<Cache, 'match' | 'put' | 'keys' | 'delete'>;
type CacheStorageLike = { open(name: string): Promise<CacheLike>; delete?(name: string): Promise<boolean> };
const OFFLINE_RSC_INDEX_URL = 'https://offline-index.invalid/addresses';

async function readIndex(index: CacheLike): Promise<string[]> {
  const stored = await index.match(OFFLINE_RSC_INDEX_URL);
  if (!stored) return [];
  try {
    const addresses: unknown = await stored.json();
    return Array.isArray(addresses) ? addresses.filter((address): address is string => typeof address === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(index: CacheLike, addresses: string[]): Promise<void> {
  if (!addresses.length) { await index.delete(OFFLINE_RSC_INDEX_URL); return; }
  await index.put(OFFLINE_RSC_INDEX_URL, new Response(JSON.stringify(addresses), { headers: { 'content-type': 'application/json' } }));
}

function withoutCacheBusting(url: URL): URL {
  const clean = new URL(url.href);
  clean.searchParams.delete(NEXT_RSC_UNION_QUERY);
  clean.hash = '';
  return clean;
}

/** One key per address, whichever page it is opened from. */
export function offlineRscKey(url: URL): string {
  return withoutCacheBusting(url).href;
}

/** A page of this app — not an API call, a Next asset or the offline shell itself. */
export function isAppPage(url: URL, selfOrigin: string): boolean {
  return url.origin === selfOrigin
    && !url.pathname.startsWith('/api/')
    && !url.pathname.startsWith('/_next/')
    && url.pathname !== OFFLINE_SHELL_PATH;
}

/**
 * Pages worth keeping for offline navigation. Shared pages are left out: they are public, their
 * metadata is rendered from live server data, and a kept payload would freeze it.
 */
export function isRememberedPage(url: URL, selfOrigin: string): boolean {
  return isAppPage(url, selfOrigin) && !url.pathname.startsWith('/share/');
}

/**
 * A client-side navigation to a page this worker keeps. Automatic prefetches, and pages it never
 * keeps (shared ones), are left to the default cache: answering them here could only miss.
 */
export function isRscNavigation(request: Request, selfOrigin: string): boolean {
  return request.headers.get(RSC_HEADER) === '1'
    && request.headers.get(NEXT_ROUTER_PREFETCH_HEADER) === null
    && isRememberedPage(new URL(request.url), selfOrigin);
}

function rootLevelRequest(url: URL, signal?: AbortSignal): Request {
  const target = withoutCacheBusting(url);
  target.searchParams.set(NEXT_RSC_UNION_QUERY, ROOT_LEVEL_RSC);
  return new Request(target.href, {
    headers: { [RSC_HEADER]: '1', [NEXT_ROUTER_STATE_TREE_HEADER]: ROOT_LEVEL_TREE },
    credentials: 'same-origin',
    signal,
  });
}

/** Long enough for a slow but working connection; short enough that a dead one frees the address. */
const WARM_TIMEOUT_MS = 20_000;

function isFlightPayload(response: Response): boolean {
  return response.ok && (response.headers.get('content-type') ?? '').startsWith(RSC_CONTENT_TYPE_HEADER);
}

async function keepNewest(cache: CacheLike): Promise<void> {
  const keys = await cache.keys();
  for (const stale of keys.slice(0, Math.max(0, keys.length - OFFLINE_RSC_MAX_ENTRIES))) {
    await cache.delete(stale);
  }
}

export function createOfflineRscNavigation({ fetchFn, caches, warmTimeoutMs = WARM_TIMEOUT_MS }: {
  fetchFn: (request: Request) => Promise<Response>;
  caches: CacheStorageLike;
  warmTimeoutMs?: number;
}) {
  const inFlight = new Map<string, Promise<void>>();

  async function store(url: URL, key: string, signal?: AbortSignal): Promise<void> {
    try {
      const cache = await caches.open(OFFLINE_RSC_CACHE);
      const stored = await cache.match(key);
      if (stored) {
        // Seen again: move it to the newest end, so eviction drops what was seen longest ago.
        await cache.put(key, stored);
        return;
      }
      const response = await fetchFn(rootLevelRequest(url, signal));
      if (!isFlightPayload(response)) return;
      await cache.put(key, response);
      await keepNewest(cache);
    } catch {
      // No network or no storage: the address is simply not available offline yet.
    }
  }

  /**
   * The person has seen this page: keep its root-level payload (once per build) and mark it recent.
   *
   * A warm-up that never finishes — failing Wi-Fi, an answer whose body stalls — must not hold
   * the address, because every later visit waits on the one in flight. The whole of it, request,
   * body and storing, is given up on time, and the request aborted where the platform can.
   */
  function remember(url: URL): Promise<void> {
    const key = offlineRscKey(url);
    const running = inFlight.get(key);
    if (running) return running;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => { controller?.abort(); resolve(); }, warmTimeoutMs);
    });
    // After a version's retirement, so a page seen during activation is not stored and then dropped.
    const work = Promise.race([retiring.then(() => store(url, key, controller?.signal)), deadline]).finally(() => {
      clearTimeout(timer);
      inFlight.delete(key);
    });
    inFlight.set(key, work);
    return work;
  }

  /** Network first; without network, the stored root-level payload for this address. */
  async function respond(request: Request): Promise<Response> {
    try {
      return await fetchFn(request);
    } catch (error) {
      const cache = await caches.open(OFFLINE_RSC_CACHE);
      const stored = await cache.match(offlineRscKey(new URL(request.url)));
      if (stored) return stored;
      throw error;
    }
  }

  /**
   * A NEW VERSION ACTIVATES (BUG-20260927-engine-open-hangs-on-silent-device-storage, its trigger).
   * The old build's payloads are dropped — Next would refuse them — but their addresses are carried
   * over, together with any still waiting from an earlier version, so the new version can warm them
   * again instead of leaving offline navigation empty until each page is visited online once more.
   * Without that, the first offline tap after a deploy was a full page load, and a full load is what
   * freezes the previous page in Safari's back-forward cache.
   */
  let retiring: Promise<void> = Promise.resolve();
  function retire(): Promise<void> {
    retiring = (async () => {
      try {
        const index = await caches.open(OFFLINE_RSC_INDEX_CACHE);
        const waiting = await readIndex(index);
        const kept = (await (await caches.open(OFFLINE_RSC_CACHE)).keys()).map(request => request.url);
        await writeIndex(index, [...waiting.filter(address => !kept.includes(address)), ...kept].slice(-OFFLINE_RSC_MAX_ENTRIES));
      } catch { /* Nothing to carry over: pages warm up again as they are seen. */ }
      await caches.delete?.(OFFLINE_RSC_CACHE);
    })();
    return retiring;
  }

  /**
   * Warm the carried-over addresses again, the most recently seen first, a batch per page the person
   * sees online. Without network it does not try. A batch that warms nothing (the server or the
   * network is down) moves to the old end of the list and the worker stops trying until it starts
   * again; a batch that warms some proves the network works, so the addresses that failed in it are
   * pages that are gone, and they are dropped — they warm again whenever they are visited.
   */
  let rewarming: Promise<void> | null = null;
  let rewarmPaused = false;
  function rewarm(): Promise<void> {
    if (rewarmPaused || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
    return rewarming ??= (async () => {
      try {
        await retiring;
        const index = await caches.open(OFFLINE_RSC_INDEX_CACHE);
        const waiting = await readIndex(index);
        if (!waiting.length) return;
        const batch = waiting.slice(-OFFLINE_RSC_REWARM_MAX);
        const rest = waiting.slice(0, waiting.length - batch.length);
        const payloads = await caches.open(OFFLINE_RSC_CACHE);
        let warmed = 0;
        for (const address of [...batch].reverse()) {
          await remember(new URL(address));
          if (await payloads.match(address)) warmed += 1;
        }
        if (warmed === 0) {
          rewarmPaused = true;
          await writeIndex(index, [...batch, ...rest]);
        } else {
          await writeIndex(index, rest);
        }
      } catch { /* The list stays as it was; the next page seen tries again. */ } finally {
        rewarming = null;
      }
    })();
  }

  return { respond, remember, retire, rewarm };
}
