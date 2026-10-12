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
/**
 * What one warm-up found out about one address: kept — a payload of this build was already there;
 * stored — fetched and kept now; gone — the server said the page does not exist (404, 410); failed —
 * no usable answer: no network, out of time, a server error, or an answer without the page that may
 * change (a refusal, a redirect, "too many requests"); unstored — an answer the cache refused.
 */
export type WarmOutcome = 'kept' | 'stored' | 'gone' | 'failed' | 'unstored';
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

/** The list as stored. A copy that cannot be read throws: a broken list is not an empty one. */
async function readIndexStrict(index: CacheLike): Promise<string[]> {
  const stored = await index.match(OFFLINE_RSC_INDEX_URL);
  if (!stored) return [];
  const addresses: unknown = await stored.json();
  if (!Array.isArray(addresses)) throw new Error('The offline page list is unreadable');
  return addresses.filter((address): address is string => typeof address === 'string');
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
/** A read of the waiting list that has not answered in this long is given up on. */
const STORAGE_TIMEOUT_MS = 10_000;
/** How long a navigation to what this device already holds waits for the network before its kept copy answers. */
export const NAVIGATION_DEADLINE_MS = 3_000;
/** How long after the network's first answer a copy found in storage still counts. */
const STORAGE_GRACE_MS = 300;

function isFlightPayload(response: Response): boolean {
  return response.ok && (response.headers.get('content-type') ?? '').startsWith(RSC_CONTENT_TYPE_HEADER);
}

async function keepNewest(cache: CacheLike): Promise<void> {
  const keys = await cache.keys();
  for (const stale of keys.slice(0, Math.max(0, keys.length - OFFLINE_RSC_MAX_ENTRIES))) {
    await cache.delete(stale);
  }
}

/** `read`, or a failure once it has not answered within `ms` — storage that falls silent cannot hold a caller. */
function withinMs<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Offline page storage did not answer')), ms);
  });
  return Promise.race([read, silence]).finally(() => clearTimeout(timer));
}

/**
 * WHAT THIS DEVICE ALREADY HOLDS DOES NOT WAIT FOR A WEAK SIGNAL
 * (BUG-20261004-weak-network-delays-offline-navigation). Offline a request fails at once and the kept
 * copy answers; on a weak signal it neither answers nor fails, and the kept copy waited behind it for as
 * long as it hung. The first question is whether a copy is kept at all: storage answers in milliseconds,
 * so when nothing is kept — or storage has not answered shortly after the network did, which is then no
 * copy to count on — the network is handed over exactly as before, streaming. When a copy is kept, the
 * network has until the deadline, counted from the navigation, to arrive whole (first bytes and then
 * silence are as late as nothing). An answer the copy may not stand in for is the server's decision and is
 * handed over at once: an error, a redirect, or what the caller says is another kind (`replaceable` — for
 * a client-side navigation, anything Next would not apply as a payload). Past the deadline, or when the
 * network fails, the copy answers and the late answer stops downloading, however late its headers come.
 * Used for client-side navigations (their kept payload) and the start of the app (the precached offline
 * shell, `sw.ts`).
 */
export async function answerWithinDeadline(network: Promise<Response>, kept: () => Promise<Response | undefined>,
  { deadlineMs, storageTimeoutMs = STORAGE_TIMEOUT_MS, replaceable = () => true }:
  { deadlineMs: number; storageTimeoutMs?: number; replaceable?: (answer: Response) => boolean }): Promise<Response> {
  const started = performance.now();
  const lookup = withinMs(kept(), storageTimeoutMs).catch(() => undefined);
  // Storage answers in milliseconds: a copy it finds shortly after the network's first answer still
  // counts; storage slower than that is treated as holding none.
  const copy = await Promise.race([lookup.then(found => found ?? null),
    network.then(() => new Promise<null>(resolve => setTimeout(() => resolve(null), STORAGE_GRACE_MS)), () => new Promise<never>(() => undefined))]);
  if (!copy) return network;
  let abandoned = false;
  let reading: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const whole = network.then(async answer => {
    if (abandoned || !answer.ok || answer.redirected || !replaceable(answer)) return answer;
    const body = answer.clone();
    if (typeof body.body?.getReader !== 'function') { await body.arrayBuffer(); return answer; }
    reading = body.body.getReader();
    while (!(await reading.read()).done) { /* the whole answer, read to its end */ }
    return answer;
  });
  // What is left of the deadline: a copy found after it answers at once, unless the network is whole by then.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>(resolve => {
    timer = setTimeout(() => resolve('late'), Math.max(0, deadlineMs - (performance.now() - started)));
  });
  const first = await Promise.race([whole, late]).catch(() => 'failed' as const).finally(() => clearTimeout(timer));
  if (first !== 'late' && first !== 'failed') return first;
  // Headers that come after this point find the answer abandoned and are not read: cancelling the
  // answer itself then stops the download.
  abandoned = true;
  void reading?.cancel().catch(() => undefined);
  void network.then(answer => answer.body?.cancel()).catch(() => undefined);
  return copy;
}

export function createOfflineRscNavigation({ fetchFn, caches, warmTimeoutMs = WARM_TIMEOUT_MS, storageTimeoutMs = STORAGE_TIMEOUT_MS, navigationDeadlineMs = NAVIGATION_DEADLINE_MS }: {
  fetchFn: (request: Request) => Promise<Response>;
  caches: CacheStorageLike;
  warmTimeoutMs?: number;
  storageTimeoutMs?: number;
  navigationDeadlineMs?: number;
}) {
  const inFlight = new Map<string, Promise<WarmOutcome>>();

  /**
   * A READ of the waiting list that storage does not answer is given up on, so it cannot hold the
   * re-warm for ever (BUG-20261011-sw-offline-cache-edges). Only reads: a write given up on would still
   * land later, over whatever was written after it.
   */
  function withinStorage<T>(read: Promise<T>): Promise<T> {
    return withinMs(read, storageTimeoutMs);
  }

  async function store(url: URL, key: string, signal?: AbortSignal): Promise<WarmOutcome> {
    let cache: CacheLike;
    try {
      cache = await caches.open(OFFLINE_RSC_CACHE);
      const stored = await cache.match(key);
      if (stored) {
        // Seen again: move it to the newest end, so eviction drops what was seen longest ago.
        await cache.put(key, stored);
        return 'kept';
      }
    } catch {
      return 'unstored';
    }
    let response: Response;
    try {
      response = await fetchFn(rootLevelRequest(url, signal));
    } catch {
      // No network: the address is simply not available offline yet.
      return 'failed';
    }
    // An answer that arrived through a redirect is another page's: kept under this address it would open
    // that page here offline (BUG-20261011-sw-offline-cache-edges).
    if (response.redirected || !isFlightPayload(response)) return response.status === 404 || response.status === 410 ? 'gone' : 'failed';
    try {
      await cache.put(key, response);
      await keepNewest(cache);
      return 'stored';
    } catch {
      return 'unstored';
    }
  }

  /**
   * The person has seen this page: keep its root-level payload (once per build) and mark it recent.
   *
   * A warm-up that never finishes — failing Wi-Fi, an answer whose body stalls — must not hold
   * the address, because every later visit waits on the one in flight. The whole of it, request,
   * body and storing, is given up on time, and the request aborted where the platform can.
   */
  function remember(url: URL): Promise<WarmOutcome> {
    const key = offlineRscKey(url);
    const running = inFlight.get(key);
    if (running) return running;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<WarmOutcome>((resolve) => {
      timer = setTimeout(() => { controller?.abort(); resolve('failed'); }, warmTimeoutMs);
    });
    // After a version's retirement, so a page seen during activation is not stored and then dropped.
    const work = Promise.race([retiring.then(() => store(url, key, controller?.signal)), deadline]).finally(() => {
      clearTimeout(timer);
      inFlight.delete(key);
    });
    inFlight.set(key, work);
    return work;
  }

  /** A client-side navigation: the payload kept for this address answers a weak signal (`answerWithinDeadline`). */
  function respond(request: Request): Promise<Response> {
    return answerWithinDeadline(fetchFn(request),
      async () => (await caches.open(OFFLINE_RSC_CACHE)).match(offlineRscKey(new URL(request.url))),
      // Next applies only a Flight payload; any other answer it opens as a document, and that is its call.
      { deadlineMs: navigationDeadlineMs, storageTimeoutMs, replaceable: isFlightPayload });
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
   * sees. Each address is judged by what its own warm-up found: kept or stored — warm, it leaves the
   * list once its payload is still there when the list is written (an eviction during the batch must
   * not lose it); gone — dropped, it warms again whenever it is visited; failed or unstored — the batch
   * stops there, and that address moves to the old end of the list, so the others are not starved
   * behind it. Without a network that is one attempt per page seen, not a batch; the next page seen
   * tries again, and the list loses nothing. Nothing about the network is concluded from what already
   * lies in the cache, and the phone's flag is not asked: a flag stuck at false over a working network
   * (an iPad back from the background) kept every page cold (BUG-20261011-sw-rewarm-skipped-or-forgets).
   */
  let rewarming: Promise<void> | null = null;
  function rewarm(): Promise<void> {
    return rewarming ??= (async () => {
      try {
        await retiring;
        const index = await withinStorage(caches.open(OFFLINE_RSC_INDEX_CACHE));
        const waiting = await withinStorage(readIndex(index));
        if (!waiting.length) return;
        const untried = waiting.slice(-OFFLINE_RSC_REWARM_MAX);
        const warm: string[] = [];
        const gone: string[] = [];
        const stuck: string[] = [];
        while (untried.length) {
          const address = untried.pop() as string;
          const outcome = await remember(new URL(address));
          if (outcome === 'failed' || outcome === 'unstored') { stuck.push(address); break; }
          (outcome === 'gone' ? gone : warm).push(address);
        }
        // The list as it is now, not the copy read above: a version activating meanwhile may have carried
        // addresses over, and they stay. A list that cannot be read now, or does not answer, is rebuilt
        // from that copy, as it always was (BUG-20261011-sw-offline-cache-edges).
        const current = await withinStorage(readIndexStrict(index)).catch(() => waiting);
        const payloads = await caches.open(OFFLINE_RSC_CACHE);
        const cold: string[] = [];
        const leaving = new Set(gone);
        for (const address of warm) {
          if (await payloads.match(address)) leaving.add(address);
          else cold.push(address);
        }
        const oldEnd = [...stuck, ...cold].filter(address => current.includes(address));
        await writeIndex(index, [...oldEnd, ...current.filter(address => !leaving.has(address) && !oldEnd.includes(address))]);
      } catch { /* The list stays as it was; the next page seen tries again. */ } finally {
        rewarming = null;
      }
    })();
  }

  return { respond, remember, retire, rewarm };
}
