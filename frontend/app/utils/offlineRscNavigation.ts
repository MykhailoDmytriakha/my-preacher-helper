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

import { nextOfflineWarmRetry } from '@/utils/offlineWarmRetry';

import type { OfflinePagePayload, OfflinePageStorage, OfflinePageTicket } from '@/utils/offlinePageStorage';

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

/** Whole cache work is cancellable; document writes use their separate, non-cancellable contract. */
function cacheWorkWithin<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, fallback: T, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let abandon!: () => void;
  const expired = new Promise<T>(resolve => { abandon = () => { controller.abort(); resolve(fallback); }; });
  const timer = setTimeout(abandon, Math.max(0, ms));
  if (parent?.aborted) abandon(); else parent?.addEventListener('abort', abandon, { once: true });
  return Promise.race([Promise.resolve().then(() => work(controller.signal)), expired]).finally(() => {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abandon);
  });
}

async function pagePayload(response: Response, signal: AbortSignal): Promise<OfflinePagePayload> {
  const reader = typeof response.body?.getReader === 'function' ? response.body.getReader() : undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (signal.aborted) throw signal.reason;
        if (next.done) break;
        chunks.push(next.value);
        length += next.value.byteLength;
      }
    }
    if (!reader) {
      const body = await response.arrayBuffer();
      if (signal.aborted) throw signal.reason;
      const headers = new Headers(response.headers);
      for (const header of ['content-encoding', 'content-length', 'transfer-encoding']) headers.delete(header);
      return { body, headers: [...headers], status: response.status, statusText: response.statusText };
    }
    const body = new ArrayBuffer(length);
    const bytes = new Uint8Array(body);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const headers = new Headers(response.headers);
    // Fetch has decoded the body; its old transfer/representation lengths no longer describe these bytes.
    for (const header of ['content-encoding', 'content-length', 'transfer-encoding']) headers.delete(header);
    return { body, headers: [...headers], status: response.status, statusText: response.statusText };
  } finally {
    signal.removeEventListener('abort', cancel);
    reader?.releaseLock();
  }
}

export function createOfflineRscNavigation({ fetchFn, caches, storage, warmTimeoutMs = WARM_TIMEOUT_MS,
  storageTimeoutMs = STORAGE_TIMEOUT_MS, navigationDeadlineMs = NAVIGATION_DEADLINE_MS, now = Date.now }: {
  fetchFn: (request: Request) => Promise<Response>;
  caches?: CacheStorageLike;
  storage: OfflinePageStorage | (() => Promise<OfflinePageStorage>);
  warmTimeoutMs?: number;
  storageTimeoutMs?: number;
  navigationDeadlineMs?: number;
  now?: () => number;
}) {
  let loaded: Promise<OfflinePageStorage> | undefined;
  const pages = () => loaded ??= typeof storage === 'function' ? storage() : Promise.resolve(storage);
  let retiring: Promise<void> = Promise.resolve();
  let activating: Promise<void> | undefined;
  let activationRequested = false, activationReady = false;

  async function legacyAddresses(signal: AbortSignal): Promise<string[]> {
    if (!caches) return [];
    // Legacy copies stay untouched. Reconciliation can discover a late old writer on a later event;
    // the atomic catalog remembers which addresses were imported, so a gone page is not re-added forever.
    const [waiting, kept] = await Promise.all([
      withinMs(caches.open(OFFLINE_RSC_INDEX_CACHE).then(readIndex), Math.min(storageTimeoutMs, STORAGE_GRACE_MS)).catch(() => [] as string[]),
      withinMs(caches.open(OFFLINE_RSC_CACHE).then(cache => cache.keys()), Math.min(storageTimeoutMs, STORAGE_GRACE_MS))
        .then(keys => keys.map(request => request.url)).catch(() => [] as string[]),
    ]);
    if (signal.aborted) return [];
    const normalized: string[] = [];
    for (const address of [...waiting, ...kept]) {
      try { normalized.push(offlineRscKey(new URL(address))); } catch { /* A corrupt legacy key is not a fetch target. */ }
    }
    return [...new Set(normalized)];
  }

  function retire(): Promise<void> {
    activationRequested = true;
    if (activating) return activating;
    activating = cacheWorkWithin(async signal => {
      const saved = await pages();
      await saved.activate([], signal);
      activationReady = true;
      await saved.importLegacy(await legacyAddresses(signal), signal);
    }, storageTimeoutMs, undefined).catch(() => undefined).finally(() => { activating = undefined; });
    retiring = activating;
    return activating;
  }
  async function ready(): Promise<void> {
    // Constructors also run for waiting workers: activate lazily only once a functional event
    // arrives, or when the browser explicitly dispatches activate. A restarted active worker can
    // thus finish an activation handler that was interrupted, without clearing same-build bodies.
    if (!activationRequested) { await retire(); return; }
    await retiring;
    // A browser can finish activation after an interrupted handler. Retry on a later event without
    // holding the page; same-build activation is idempotent and never clears this build's bodies.
    if (activationRequested && !activationReady) await retire();
  }

  type Attempt = WarmOutcome | 'skipped';
  function warm(url: URL, { seen, generation, timeoutMs = warmTimeoutMs, parent }: {
    seen: boolean; generation?: number; timeoutMs?: number; parent?: AbortSignal;
  }): Promise<Attempt> {
    const deadline = now() + timeoutMs;
    let claim: { saved: OfflinePageStorage; ticket: OfflinePageTicket } | undefined;
    let settled = false;
    return cacheWorkWithin<Attempt>(async signal => {
      await ready();
      if (signal.aborted || now() >= deadline) return 'failed';
      const saved = await pages();
      const reservation = await saved.reserve(offlineRscKey(url), { seen, generation, leaseMs: timeoutMs, deadline, signal });
      if (reservation.outcome === 'kept') return 'kept';
      if (reservation.outcome !== 'fetch') return 'skipped';
      const ticket = reservation.ticket;
      claim = { saved, ticket };
      if (signal.aborted || now() >= deadline) return 'failed';
      let response: Response;
      try { response = await fetchFn(rootLevelRequest(url, signal)); }
      catch { await saved.finish(ticket, {}, signal).then(() => { settled = true; }).catch(() => undefined); return 'failed'; }
      if (response.redirected || !isFlightPayload(response)) {
        if (typeof response.body?.cancel === 'function') void response.body.cancel().catch(() => undefined);
        const gone = !response.redirected && (response.status === 404 || response.status === 410);
        const retry = gone ? {} : nextOfflineWarmRetry(response, ticket.previousRefusals, now());
        await saved.finish(ticket, { ...retry, gone }, signal);
        settled = true;
        return gone ? 'gone' : 'failed';
      }
      try {
        const payload = await pagePayload(response, signal);
        const stored = await saved.publish(ticket, payload, signal);
        settled = stored;
        return stored ? 'stored' : 'failed';
      } catch {
        await saved.finish(ticket, {}, signal).then(() => { settled = true; }).catch(() => undefined);
        return signal.aborted ? 'failed' : 'unstored';
      }
    }, timeoutMs, 'failed', parent).catch(() => 'unstored' as const).then(outcome => {
      if (claim && !settled) {
        const { saved, ticket } = claim;
        // Queue conditional cleanup before a later reservation. A timer can fire one clock tick
        // early; the next visit must still retry at once. A killed worker leaves only a bounded lease.
        void cacheWorkWithin(signal => saved.finish(ticket, {}, signal), Math.min(storageTimeoutMs, warmTimeoutMs), false)
          .catch(() => undefined);
      }
      return outcome;
    });
  }

  /** One durable per-address claim suppresses duplicate background fetches across worker instances. */
  async function remember(url: URL): Promise<WarmOutcome> {
    const outcome = await warm(url, { seen: true });
    return outcome === 'skipped' ? 'failed' : outcome;
  }

  function respond(request: Request, preferredResponse = fetchFn(request)): Promise<Response> {
    return answerWithinDeadline(preferredResponse, () => cacheWorkWithin(async signal => {
      await ready();
      const payload = await (await pages()).read(offlineRscKey(new URL(request.url)), signal);
      if (!payload) return undefined;
      const response = new Response([204, 205].includes(payload.status) ? null : payload.body, {
        headers: payload.headers, status: payload.status, statusText: payload.statusText,
      });
      return isFlightPayload(response) ? response : undefined;
    }, storageTimeoutMs, undefined), { deadlineMs: navigationDeadlineMs, storageTimeoutMs, replaceable: isFlightPayload });
  }

  let rewarming: Promise<void> | undefined;
  function rewarm(): Promise<void> {
    return rewarming ??= cacheWorkWithin(async signal => {
      const started = now();
      await ready();
      const saved = await pages();
      await saved.importLegacy(await legacyAddresses(signal), signal);
      await saved.releaseExpiredClaims(signal);
      const entries = await withinMs(saved.entries(signal), storageTimeoutMs);
      const eligible = entries.filter(page => !page.warm && page.retryAt <= now()
        && (!page.claim || page.claim.until <= now()));
      const waiting = eligible.slice(-OFFLINE_RSC_REWARM_MAX).reverse();
      for (const page of waiting) {
        const remaining = warmTimeoutMs - (now() - started);
        if (signal.aborted || remaining <= 0) break;
        const outcome = await warm(new URL(page.address), { seen: false, generation: page.generation, timeoutMs: remaining, parent: signal });
        if (outcome === 'failed' || outcome === 'unstored') break;
      }
    }, warmTimeoutMs, undefined).catch(() => undefined).finally(() => { rewarming = undefined; });
  }
  return { respond, remember, retire, rewarm };
}
