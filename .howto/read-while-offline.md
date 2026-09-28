when: offline · read offline · page empty offline · skeleton forever offline · navigator.onLine · isBrowserOffline · useOnlineStatus · getConnectivityStatus · useDeviceOnline · networkMode offlineFirst · enabled false offline · Wi-Fi on but server down · captive portal · UX blocks on network · persisted React Query cache · reportServerUnreachable · isUnreachableWriteError · deleted or just not loaded · офлайн · без сети · чтение офлайн · страница пустая без интернета · вечный скелетон без сети · Wi-Fi есть а сервер недоступен · показать кэш · нет соединения

# Read data while offline

Show what the persisted cache holds at once; connectivity decides only whether to FETCH, never whether to SHOW. Ask connectivity through `frontend/app/utils/connectivity.ts`, read through `useServerFirstQuery` on top of the global `networkMode: 'offlineFirst'` in `frontend/app/providers/QueryProvider.tsx`. A collection switched to the data engine is read from the engine's local store (`useDataCollection` / `useDataDocument`, `.howto/use-data-engine-in-a-screen.md`).

## How

- Two questions, kept apart on purpose:
  - "Has the browser said there is no network?" → `isBrowserOffline()`, true only when `navigator.onLine === false`, read fresh on every call. Never spell `navigator.onLine` inline. It is the narrow question for write paths ("queue only when we know we cannot send") and for picking a read road (`readOwnerList`). Whether a failed WRITE may be queued is narrower still: `isUnreachableWriteError` in `frontend/app/services/conflictSafeUpdate.client.ts`.
  - "Is the app usable?" → `useOnlineStatus()` / `getConnectivityStatus()`: the device flag combined with the outcome of real requests. `apiClient` reports `reportServerUnreachable` on a timeout or failed fetch, so Wi-Fi on with a dead server behaves like offline instead of refetching and blocking. `useDeviceOnline()` when you need the device alone (the freshness banner).
- Queries default to `networkMode: 'offlineFirst'`, a 30 s `staleTime`, and are persisted to IndexedDB for a week. `useServerFirstQuery` stops calling `queryFn` while offline yet still returns the cached data (`frontend/app/hooks/__tests__/useServerFirstQuery.test.tsx`), and its `isLoading` stays false when there is nothing to wait for.
- Never short-circuit a page on offline status (an early "offline" screen, a list forced empty): render the cache. A detail page does not wait for a first answer offline (`awaitingFirstAnswer` in `useSermon` requires `isOnline`).
- Absence from an offline or cached list is not deletion: another device may have added it. Conclude "deleted" only from a list that succeeded after mount (`useStudyNoteDirectory().ready` in `frontend/app/hooks/useSermonNoteLinks.ts`). The engine likewise never shows an offline incomplete cache as an authoritative empty collection (`DataCollectionStatus`).
- Owner lists offline come from Firestore's local replica (`readOwnerList`, 8 s deadline) — `.howto/read-owner-documents.md`.

## Traps

- A single `getDoc` offline rejects when the document is not in the local cache, while a query returns whatever the cache holds (`frontend/app/services/atomicUpdate.client.ts`).
- No offline icon in a session started with Wi-Fi off → a single flag that moved only on a failed request never moved; device and server evidence now live in separate fields of `connectivity.ts`.
- A cached "online" earned before a gap → the server field resets to `unknown` when watching restarts; only a real request moves it.

## Why

- 2026-01-15 / 2026-01-17: offline pages short-circuited on offline status and queries were switched off offline; the fix was to read the persisted cache and let `offlineFirst` handle the network.
- 2026-05-01: `navigator.onLine` only says the device has an interface; with the server unreachable the app kept refetching and blocking until API-client failures fed the online gate.

See also: `.howto/use-server-first-query.md` · `.howto/keep-a-write-across-offline.md` · `.howto/read-owner-documents.md`
