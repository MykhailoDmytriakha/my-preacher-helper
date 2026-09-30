when: service worker · Serwist · offline navigation reloads the app · _rsc cache miss · pages-rsc-offline · переход без сети перезагружает приложение · @serwist/next · next-pwa · app/sw.ts · public/sw.js · runtimeCaching · defaultCache · NetworkOnly · NetworkFirst · Workbox networkTimeoutSeconds · API response cached by SW · AI result replayed from cache · old bundle after deploy · offline page on localhost · /~offline · GenerateSW has been called multiple times · InjectManifest has been called multiple times · dev:pwa · dev:no-pwa · preview:pwa · NEXT_PUBLIC_ENABLE_SERVICE_WORKER · localhost controlled by old service worker · unregister service worker · сервис-воркер · PWA · кэш сервис-воркера · старый бандл после деплоя · страница офлайн на localhost · отключить сервис-воркер · ответ API из кэша

# Set up and run the service worker

The service worker is built by Serwist (the successor to next-pwa) from `frontend/app/sw.ts` into `public/sw.js`, configured in `frontend/next.config.mjs`. Production always has it. In `next dev` it is on only with `NEXT_PUBLIC_ENABLE_SERVICE_WORKER=true`, which `npm run dev` and `npm run dev:pwa` set and `npm run dev:no-pwa` does not. For true offline parity use `npm run preview:pwa` (`next build && next start`).

## How

- Add a route rule to `runtimeCaching` in `frontend/app/sw.ts`, BEFORE `...defaultCache`. Serwist's `defaultCache` sends same-origin `GET /api/*` through `NetworkFirst` (cache `apis`, network timeout 10 s): a GET slower than 10 s is answered from the cache.
- A slow AI generation exposed as a same-URL `GET` must bypass that cache: a `NetworkOnly` rule (as for `/api/sermons/<id>` and `/api/sermons/<id>/plan`), `Cache-Control: no-store` on the response (`jsonNoStore` in the plan route), a unique request id, or a non-GET method (`defaultCache` caches `GET` only). Otherwise a slow model answer is replaced by an older cached one.
- Firestore never enters Serwist: the `fetch` listener returns early for `firestore.googleapis.com`, and the Firestore SDK owns offline data.
- Offline data does not depend on the service-worker switch: Firestore `persistentLocalCache` (`frontend/app/config/firebaseClientDb.ts`) and the persisted React Query cache stay on in every mode. Keep it that way; turning the worker off must not turn offline data off.
- An offline navigation whose HTML was never cached gets the precached `/~offline` shell (`frontend/app/~offline/page.tsx`, `additionalPrecacheEntries`, revisioned by `VERCEL_GIT_COMMIT_SHA`). `reloadOnOnline: false`: a reload on reconnect would wipe unsaved form state.
- In `next dev` Serwist builds the worker with no precache manifest and no additional entries, so `/~offline` is not precached there. Test the offline shell with `npm run preview:pwa`.
- An offline client-side navigation is answered by `frontend/app/utils/offlineRscNavigation.ts`: for every address the person has seen online the worker keeps the RSC payload rendered against the `/~offline` shell's tree, which patches right under the root and so fits whatever page is open. "Seen" is told by the page (`frontend/app/components/OfflinePageMemory.tsx`, posted on every committed address and again on `controllerchange`), not guessed from traffic: a navigation served from Next's prefetch sends no request, and the first page loads before the worker controls it. Never key real navigation payloads without `_rsc`: a payload diffed against another page may not fit, and Next then changes only the URL and keeps the old screen.

## Traps

- Localhost fails intermittently on first load after switching to `dev:no-pwa` → a worker from an earlier run still controls the origin, and `public/sw.js` is still on disk (a disabled Serwist neither unregisters nor deletes it). Unregister it (DevTools → Application → Service workers) and name the mode explicitly in the command you run.
- The comment at the top of `next.config.mjs` says `npm run dev` stays worker-free. It is stale since 2026-05-10; `frontend/package.json` is the truth.
- `GenerateSW has been called multiple times` was next-pwa regenerating the worker in webpack watch mode. Serwist builds with the precache manifest disabled in dev and returns before its own `InjectManifest has been called multiple times` check, so under `next dev` that warning is not expected.
- After a deploy an open tab keeps running its loaded bundle until a real reload (`skipWaiting` and `clientsClaim` swap the worker, not the code in memory). `AppUpdateButton` offers the reload once `/api/health` reports a different version.
- Checking offline behaviour on a local production build gives false results after a rebuild: the shell's precache revision is `"dev"` (`next.config.mjs`, no `VERCEL_GIT_COMMIT_SHA`), so the worker keeps the shell of an older build, and Next rejects every payload of the new build by its build id. Unregister the worker and clear Cache Storage before each such check.

## Why

- 2026-09-30: every tap without network reloaded the whole app (BUG-20260927-offline-navigation-reloads-whole-app): `_rsc` hashes the page being left, so a full-URL cache missed almost always.
- 2026-05-24: an AI generation `GET` slower than the worker's network timeout was answered from the `apis` cache.
- 2026-05-10: an old worker still controlling localhost while the dev run had the worker off made first-load failures intermittent and misleading.

See also: `.howto/fix-stuck-dev-server.md` · `.howto/read-while-offline.md` · `.howto/raise-route-time-limit.md`
