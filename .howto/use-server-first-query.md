when: useServerFirstQuery · mode cache-first · mode server-first · cached data hidden while online · server-fetched flag · did the server answer · dataUpdatedAt · repeated fetch on every navigation · offline navigation blocked by a wrapper · staleTime 0 · refetchOnMount always · networkMode online · wrapper hook defeats React Query defaults · isLoading vs isFetching · skeleton during background refetch · сначала сервер · сначала кэш · запрос при каждом переходе · скелетон при фоновом обновлении · обёртка над useQuery · данные из кэша скрыты · ответил ли сервер

# Use useServerFirstQuery

`useServerFirstQuery` (`frontend/app/hooks/useServerFirstQuery.ts`) is the app's `useQuery` wrapper for owner data. The default `mode: 'cache-first'` shows the cached value at once and refreshes in the background; `mode: 'server-first'` refetches on every mount and focus. It does NOT hide cached data and carries no "server-fetched" flag.

## How

- Cache-first (default): `staleTime` 30 s, `refetchOnMount: true`, no refetch on window focus, `networkMode: 'offlineFirst'`. Use it for lists and anything navigated to often.
- Server-first: `staleTime` 0, `refetchOnMount: 'always'`, refetch on focus, `networkMode: 'online'`. Only for a detail whose staleness costs more than a fetch — today `useSermon`, `usePrayerDetail`, `useAiUsage`. Any option you pass overrides the mode's default.
- `enabled` is combined with `useOnlineStatus()`: offline or with the server unreachable nothing is fetched, and cached data is still returned.
- `isLoading` is true only when the query is enabled and there is no data yet. A background refetch (`isFetching`) is not loading; never put `isFetching` into a skeleton condition.
- The result also carries `isOnline`.
- "Did the server answer since this screen opened?" is not a property of the wrapper. A cached success can be 30 s old, or a persisted week old. Derive it declaratively from the query result — `isSuccess`, `data !== undefined`, not `isFetching`, and `dataUpdatedAt` at or after the moment your consumer mounted — not from a ref set inside this hook's `queryFn`: when another observer of the same key did the fetch, that ref never moves. Example: `ready` in `useStudyNoteDirectory` (`frontend/app/hooks/useSermonNoteLinks.ts`).
- Repeated fetches on every navigation: read the wrapper's and the global defaults (`frontend/app/providers/QueryProvider.tsx`) before blaming Firestore or Next routing. A wrapper that hardcodes `staleTime: 0`, `refetchOnMount: 'always'`, focus refetch and `networkMode: 'online'` silently defeats offline-first for every caller.
- Publishing a write into its cache: `.howto/update-react-query-cache.md`.

## Why

- 2026-01 to 2026-04: the wrapper hid cached data while online until a fresh fetch, tracked by a `useRef` flag plus a `useState` re-render trigger keyed on `dataUpdatedAt`. It needed repeated race fixes and blocked offline navigation; commit `a721e573` (2026-05-01) replaced it with the two modes above. Do not reintroduce hide-until-fresh.

See also: `.howto/read-while-offline.md` · `.howto/update-react-query-cache.md`
