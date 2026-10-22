when: screen opens slowly · spinner while a page opens · loading.tsx · route loading UI · skeleton · silhouette · placeholder while the data comes · router.prefetch · prefetch · fetch ahead · Link prefetch · a row that is a button opens slowly · first open shows a loader · ArrowPathIcon animate-spin on a whole page · долго открывается · крутится значок · зелёные стрелки · колесо загрузки · скелетон · силуэт · заранее подгрузить · открывается не сразу

# Open a screen at once

Two waits stand between a tap and a document screen: the route (its code and its RSC payload — the App Router shows the route's `loading.tsx` meanwhile) and the data (the page's own branch while its list comes from the device). Both show the **same silhouette of the screen**, never a spinner: a spinning arrow reads as "something is refreshing" (the owner, 2026-10-21, BUG-20261021-note-opens-with-spinner), a silhouette as "it is already here".

## The silhouette

- One component per screen in `frontend/app/components/skeletons/` (`SermonDetailSkeleton`, `NoteDetailSkeleton`, …), used by the route's `loading.tsx` **and** the page's loading branch. Two loaders drawn separately drift apart; that is how the note page ended up with two different spinners.
- CSS breakpoints only (`loading.tsx` is a server component; no media-query hooks), the page's own: measure the opened screen first (header height, panel width, where the text starts) and put the grey bars there, so the text comes in where the eye already is.
- If CSS gives the screen its frame through a marker (the note's `data-note-workspace` → `globals.css` zeroes its margins and gives it the full height on a wide screen), the silhouette carries the same marker, or it sits 32 px off on a desktop.

## Fetching ahead

- A `<Link>` fetches its target ahead by itself in production. A row that is a **button** calling `router.push` (a window that closes first, then leaves — `useFollowAfterClose`) does not.
- `router.prefetch(href)` for such rows was tried on 2026-10-21 for the Bible's «Моё к …» list and **taken out before shipping** (Codex review): the legacy router cache keeps a failed full prefetch — its `flightData` is the URL, a full browser navigation — for the static stale time (5 min), so after a short server failure the tap reloads the whole app even once the server is back (`next/dist/client/components/router-reducer/fetch-server-response.js`, the `!res.ok` branch and the `catch`; `prefetch-cache-utils.js`, `getPrefetchEntryCacheStatus`). `navigator.onLine` cannot see a server failure, and the service worker passes HTTP errors through. Prefetch only with a way to drop or retry a failed entry, and measure the gain on a production build first (`FEATURE_CONCEPTS.md`, «Заметка из окна «Моё к …» в Библии открывается сразу»).
- A full prefetch carries no `Next-Router-Prefetch` header, so the service worker takes it for a navigation (`isRscNavigation` in `frontend/app/utils/offlineRscNavigation.ts`).
- Each prefetch of a dynamic route (`ƒ` in the build output) is a server render on Vercel.

## Traps

- **Development never prefetches** (`createPrefetchURL` returns `null` when `NODE_ENV === 'development'`). On `next dev` the network shows no request and the timing does not change; only a production build shows the effect. A production build of the working tree in its own folder: `NEXT_TYPEGEN_DIST_DIR=.next-<name> NEXT_EXTERNAL_TYPECHECK=true NEXT_PUBLIC_ENABLE_TEST_LOGIN=true next build`, then `next start --port <free>` with the same env (`.cases/2026-10-12-block-diagram/demo-mine/start-prod.sh`). On 2026-10-21 that build over the emulator stand listed no notes while the dev server on the same emulator listed six — the cause is not established; check the list before measuring.
- Measure what shows, in 25 ms steps, by path (address · list · the other screen): `walk-mine.cjs noteload` logs `blank → SILHOUETTE → NOTE` and the RSC requests between opening the list and the tap. After the silhouette (dev stand, iPad width): by address 0.3–0.8 s, from the list 0.6 s, from the Bible 0.6 s of silhouette, then the note; before it the same waits showed a spinner.
