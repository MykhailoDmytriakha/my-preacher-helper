import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";

// Serwist service worker (replaces next-pwa). `defaultCache` from @serwist/next
// already caches App Router page navigations + RSC + RSC-prefetch, so we only add
// the one app-specific rule and the offline navigation fallback.

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const runtimeCaching: RuntimeCaching[] = [
  // AI sermon-plan generation must always hit the network — never serve a cached
  // generation. Placed before defaultCache (which has a NetworkFirst /api rule).
  {
    matcher: ({ url }) =>
      self.origin === url.origin && /^\/api\/sermons\/[^/]+\/plan$/.test(url.pathname),
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

serwist.addEventListeners();
