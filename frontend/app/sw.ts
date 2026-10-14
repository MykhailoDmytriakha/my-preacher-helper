import { defaultCache } from "@serwist/next/worker";
import { CacheFirst, NetworkOnly, Serwist } from "serwist";

import { BIBLE_TEXT_CACHE, isBibleTextAnswer, isBibleTextPath, isBookShaped } from "./utils/bibleTextCache";
import { NAVIGATION_DEADLINE_MS, OFFLINE_PAGE_SEEN, answerWithinDeadline, createOfflineRscNavigation, isRememberedPage, isRscNavigation } from "./utils/offlineRscNavigation";

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";

// Serwist service worker (replaces next-pwa). `defaultCache` from @serwist/next
// already caches App Router page navigations + RSC + RSC-prefetch. Firestore's
// session-specific transport bypasses this resource cache; its SDK owns offline data.

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Offline, a client-side navigation is answered with the root-level payload stored for that address
// when the person saw it online, so moving between pages without network stays inside the running
// app instead of reloading it (BUG-20260927-offline-navigation-reloads-whole-app; the why is in the module).
const offlineNavigation = createOfflineRscNavigation({
  fetchFn: (request) => fetch(request),
  caches: self.caches,
});

/**
 * THE START OF THE APP ON A WEAK SIGNAL (BUG-20261004-weak-network-delays-offline-navigation). The
 * installed app opens at `/`; on a signal that neither answered nor failed the page waited for it — on
 * the owner's phone 20–30 s with nothing on screen. The precached offline shell holds the dashboard
 * itself, built with this worker, so past a short wait it answers instead. Only these addresses: other
 * pages need their own code, which a device may not hold yet after a release, so they wait for the
 * network as before rather than open on a "no connection" card while the page is on its way.
 */
const START_PAGES = new Set(["/", "/dashboard"]);

const runtimeCaching: RuntimeCaching[] = [
  /**
   * ONLY REAL ANSWERS FROM OUR API (owner's rule 1, BUG-20260908-cached-response-counts-as-live-connection).
   *
   * Serwist's defaults keep the last GET of every `/api` route for a day and hand it back when the
   * network fails — and the page could not tell that copy from the server answering, so a café
   * Wi-Fi with no route out looked like a working connection. The app keeps its own copies of what
   * it showed (the data engine's snapshots, the persisted React Query cache), so the worker's are not
   * needed. This rule goes FIRST: otherwise `/api/…json` is caught by the default static-JSON rule.
   * The public shared-note API keeps the default caching — it is read without an account.
   */
  {
    matcher: ({ url }) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/share/"),
    handler: new NetworkOnly(),
  },
  /**
   * THE BIBLE TEXT STAYS ON THE DEVICE. A book's file never changes under its address (a new text
   * gets a new version folder, `utils/bibleTextCache.ts`), so the copy is answered first and kept
   * without expiry, in its own cache. Without this rule the default static-JSON rule would take the
   * 66 books into a 32-entry, 24-hour cache, where they would push each other out. Only a book is
   * kept: a "200" sign-in page of a hotel Wi-Fi or a JSON error must not become the book for ever.
   * The check runs here, before the write — the worker writes in the background, after it has
   * answered the page, so the page throwing a bad copy away could otherwise lose the race. A store
   * that refuses to read sends the request to the network instead of failing it.
   */
  {
    matcher: ({ url }) => url.origin === self.origin && isBibleTextPath(url.pathname),
    handler: new CacheFirst({
      cacheName: BIBLE_TEXT_CACHE,
      plugins: [{
        cacheWillUpdate: async ({ response }) => {
          if (!isBibleTextAnswer(response)) return null;
          const data: unknown = await response.clone().json().catch(() => null);
          return isBookShaped(data) ? response : null;
        },
        handlerDidError: async ({ request }) => fetch(request).catch(() => new Response(null, { status: 503 })),
      }],
    }),
  },
  {
    matcher: ({ request }) => isRscNavigation(request, self.origin),
    handler: ({ request }) => offlineNavigation.respond(request),
  },
  {
    matcher: ({ request, url }) => request?.mode === "navigate" && url.origin === self.origin && START_PAGES.has(url.pathname),
    handler: ({ request, event }) => answerWithinDeadline(
      // A refused navigation preload is no answer: the network is asked directly, as Serwist does.
      Promise.resolve((event as FetchEvent).preloadResponse).catch(() => undefined).then(preloaded => preloaded ?? fetch(request)),
      () => serwist.matchPrecache("/~offline"),
      { deadlineMs: NAVIGATION_DEADLINE_MS },
    ),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  // Offline app-shell: when a navigation (document) request fails offline and the
  // route's HTML wasn't cached (App Router SPA-visited routes only cache RSC, not
  // the document), serve the precached /~offline shell, which boots the React app
  // from cache instead of a dead-end. /~offline is precached via
  // additionalPrecacheEntries in next.config.mjs.
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

// Use Serwist's public lifecycle handlers so Firestore streams never enter its
// routing, response cloning or Cache Storage fallback. The browser handles these
// requests normally; Firestore's IndexedDB persistence and retries stay intact.
self.addEventListener("install", serwist.handleInstall);
self.addEventListener("activate", (event: ExtendableEvent) => {
  serwist.handleActivate(event);
  // Stored payloads carry the previous build id and would only be refused; the addresses are kept,
  // and the new version warms them again when a page next tells it it is seen (below).
  event.waitUntil(offlineNavigation.retire());
});
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  // A page the person has seen (OfflinePageMemory) — keep its payload for offline navigations to it.
  const data = event.data as { type?: unknown; url?: unknown } | null;
  if (data?.type === OFFLINE_PAGE_SEEN && typeof data.url === "string") {
    const url = new URL(data.url);
    if (isRememberedPage(url, self.origin)) event.waitUntil(Promise.all([offlineNavigation.remember(url), offlineNavigation.rewarm()]));
    return;
  }
  serwist.handleCache(event);
});
self.addEventListener("fetch", (event: FetchEvent) => {
  if (new URL(event.request.url).hostname === "firestore.googleapis.com") return;
  serwist.handleFetch(event);
});
