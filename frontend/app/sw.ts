import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";

import { OFFLINE_PAGE_SEEN, createOfflineRscNavigation, isRememberedPage, isRscNavigation } from "./utils/offlineRscNavigation";

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

const runtimeCaching: RuntimeCaching[] = [
  // Plan generation and recovery reads must hit the network. A cached recovery
  // response would be false proof of freshness. This precedes the default /api rule.
  {
    matcher: ({ url }) =>
      self.origin === url.origin && /^\/api\/sermons\/[^/]+(?:\/plan)?$/.test(url.pathname),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request }) => isRscNavigation(request, self.origin),
    handler: ({ request }) => offlineNavigation.respond(request),
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
