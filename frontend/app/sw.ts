import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";

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

const runtimeCaching: RuntimeCaching[] = [
  // Plan generation and recovery reads must hit the network. A cached recovery
  // response would be false proof of freshness. This precedes the default /api rule.
  {
    matcher: ({ url }) =>
      self.origin === url.origin && /^\/api\/sermons\/[^/]+(?:\/plan)?$/.test(url.pathname),
    handler: new NetworkOnly(),
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
self.addEventListener("activate", serwist.handleActivate);
self.addEventListener("message", serwist.handleCache);
self.addEventListener("fetch", (event: FetchEvent) => {
  if (new URL(event.request.url).hostname === "firestore.googleapis.com") return;
  serwist.handleFetch(event);
});
