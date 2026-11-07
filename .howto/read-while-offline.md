when: offline · read offline · page empty offline · skeleton forever offline · navigator.onLine · isBrowserOffline · useOnlineStatus · getConnectivityStatus · useDeviceOnline · networkMode offlineFirst · enabled false offline · Wi-Fi on but server down · captive portal · UX blocks on network · persisted React Query cache · reportServerUnreachable · isUnreachableWriteError · deleted or just not loaded · офлайн · без сети · чтение офлайн · страница пустая без интернета · вечный скелетон без сети · Wi-Fi есть а сервер недоступен · показать кэш · нет соединения · The document is not available in the local cache · needs-connection · onceReachable · hidden tab · документ не открылся в скрытой вкладке · «С этой записью что-то пошло не так» после возврата сети · engine list skeleton offline · rows on the device but the list waits · restart drops the device read · список движка в скелетоне без сети · knock · connectivityKnock · /api/health · NetworkOnly · cached answer reads as online · стук · значок связи · NEXT_PUBLIC_API_BASE · icon stays after the server is back · production copy on another port · значок не гаснет после возврата сервера · Sermon not found or unavailable · проповедь не найдена на боевой копии · cross-origin · CORS · NEXT_PUBLIC_API_BASE · request to another domain · Failed to fetch · connection flickers · запрос на чужой домен · связь мигает

# Read data while offline

Show what the persisted cache holds at once; connectivity decides only whether to FETCH, never whether to SHOW. Ask connectivity through `frontend/app/utils/connectivity.ts`, read through `useServerFirstQuery` on top of the global `networkMode: 'offlineFirst'` in `frontend/app/providers/QueryProvider.tsx`. A collection switched to the data engine is read from the engine's local store (`useDataCollection` / `useDataDocument`, `.howto/use-data-engine-in-a-screen.md`).

## How

- Two questions, kept apart on purpose:
  - "Has the phone said there is no network?" → `isBrowserOffline()`, true only when `navigator.onLine === false`, read fresh on every call. Never spell `navigator.onLine` inline. Its place is choosing a real queue ("queue only when we know we cannot send"): the outbox, and the wrapper of a Firestore SDK write (`acceptByPhoneFlag` in `frontend/app/utils/recoverableWrite.ts`). Whether a failed WRITE may be queued is narrower still: `isUnreachableWriteError` in `frontend/app/services/conflictSafeUpdate.client.ts`.
  - "Did the server answer?" → `useOnlineStatus()` / `getConnectivityStatus()`: one answer, the last real request (`frontend/app/utils/connectivity.ts`). Any HTTP answer, a 503 too, is yes; a request that did not reach is no unless it started before the latest success; the phone saying "no network" is no, joining a network is not yes. While it is no and the page is visible, `frontend/app/utils/connectivityKnock.ts` knocks `HEAD /api/health` after 2, 4, 8, 16 s, then every 30 s, and out of turn on the phone's `online`, the return to the page and a person's action. Every request to our API goes through `apiClient`, which reports the outcome. The engine (`browser.client.ts`) and React Query's `onlineManager` (`followConnectivityInQueries` in `QueryProvider.tsx`) follow the same answer.
  - The icon only shows (owner's decision 2026-10-10): it never gates a read, an edit or an AI button. An HTTP write is labelled by what happened to it (`mutationOutcomeWrite`), never by the icon.
- The service worker answers every private `/api` request from the network only (`frontend/app/sw.ts`, first rule; `/api/share` stays cached). Offline copies come from the engine's device store and the persisted React Query copy — a cached HTTP answer would read as the server answering.
- Queries default to `networkMode: 'offlineFirst'`, a 30 s `staleTime`, and are persisted to IndexedDB with no time limit and never dropped from memory (`PERSISTED_CACHE_MAX_AGE` in `frontend/app/providers/QueryProvider.tsx`): seen once, seen offline however long ago — a week's limit once threw away the share links, the church suggestions and the offline edits not yet sent. A query with data whose refetch did not reach the server stays in the saved copy, saved without the error (`shouldPersistQuery` + `isConnectionFailure` in `apiClient.ts`); a server's "gone" or "not yours" drops it. `useServerFirstQuery` lets React Query try and returns the cached data meanwhile (`frontend/app/hooks/__tests__/useServerFirstQuery.test.tsx`).
- Exhausted React Query read cycles keep a per-Query reconnect pause in `utils/queryReconnectRecovery.ts`:30/60/120seconds from terminal failure. Only a requested reconnect creates pending work; terminal errors alone never start a poll. A reconnect during an already-failing active retry is retained until its outcome. One timer coalesces observers, waits while hidden/offline and retires on an actual fetch success, a superseding fetch, removal or last-observer departure. Manual refetch, ordinary mount and healthy reconnect remain immediate; a server-first consumer retains its explicit focus-refetch behavior. An optimistic `setQueryData` patch does not complete the failed whole-query read; its already-requested recovery still runs. The app's one answer, knock intervals, store refusal state and paused writes are unchanged. Regression: `__tests__/providers/QueryProvider.test.tsx`.
- Never short-circuit a page on offline status (an early "offline" screen, a list forced empty): render the cache. A detail page does not wait for a first answer offline (`awaitingFirstAnswer` in `useSermon` requires `isOnline`). (The example file was removed 2026-10-13; its engine successor `useSermonRead` computes `awaitingFirstAnswer` as `!sermon && !engine.complete`, with no `isOnline` term.)
- Absence from an offline or cached list is not deletion: another device may have added it. Conclude "deleted" only from a list that succeeded after mount (`useStudyNoteDirectory().ready` in `frontend/app/hooks/useSermonNoteLinks.ts`). The engine likewise never shows an offline incomplete cache as an authoritative empty collection (`DataCollectionStatus`).
- Owner lists offline come from Firestore's local replica (`readOwnerList`, 8 s deadline) — `.howto/read-owner-documents.md`.

## Traps

- A single `getDoc` offline rejects when the document is not in the local cache, while a query returns whatever the cache holds (`frontend/app/services/atomicUpdate.client.ts`).
- The data engine refuses to open a document this device holds no copy of while the tab is hidden or offline (`readSnapshot`, `code: 'needs-connection'`). That refusal is temporary: `useDataDocument` asks `engine.onceReachable` and opens again when the tab is visible and online (BUG-20261006-hidden-tab-document-read-not-retried). An opening of your own outside that hook must do the same; a person's action (a menu action, recovering a draft) is never repeated by itself. To see it live, delete the document's key from the `snapshots` store of `preacher-data-engine-snapshots-v1` (the list refills it once the tab is visible) and load the page in the hidden automation tab.
- A first document request can start while reachable and fail after the tab goes hidden or offline. `readSnapshot` wraps only that transport failure in `PausedReadFailure` when the canonical `utils/connectionFailure.ts` rule applies and the engine cannot read now. `needsConnection` then reuses the same one-shot `onceReachable` opening continuation. The wrapper retains the original code/message/cause; it never marks a shared rejected Error. Cache persistence stays outside that catch. Permanent/server/storage failures remain explicit, and recovering a draft is never auto-repeated. Regressions: `documentInterruptedRead.test.tsx` and the explicit-recovery control in `react.client.test.tsx`.
- An engine list waits on its placeholder offline although its rows are on the device → a reader restart (connectivity or visibility changed) dropped the device read still in flight. `restart()` in `frontend/app/data-engine/collections.ts` reads the device again for a watched list not yet loaded (`collections.test.ts` "shows the stored rows when …"). Seen live 2026-10-11 on a cold start over a dead server: the first failed request said "no" a moment after the list began reading; before, a cached `/api` answer from the service worker hid it.
- No icon over a dead server → a request bypassed `apiClient` (a raw `fetch`) or the service worker answered it from a cache; only `apiClient`'s reports move the answer.
- A request to our API is a path (`/api/…`) on the page's own domain, never an address from the environment (`frontend/__tests__/architecture/apiOnPageDomain.test.ts`). A request sent to another domain is cross-origin: one the browser blocks (a header the server's CORS list lacks) reads as «no connection», the knock to `/api/health` as «connection back», and an open screen re-reads its lists every few seconds — on `my-preacher-helper.com` the old `NEXT_PUBLIC_API_BASE` (vercel.app) did that to the AI helpers, share links and the note cut from 2026-10-17 to 2026-10-21 (BUG-20261021-language-header-blocked-cross-origin). The same base once stranded a production copy on another port (2026-10-11) and a fresh origin (2026-10-12).
- A production copy served on another port (a live check with `next start -p 3400`): start the copy (`next start`) with the engine switches in the environment too (`DATA_ENGINE_COLLECTIONS`, `DATA_ENGINE_CLOSED_COLLECTIONS`, `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS` — the same values the build had): without them the server answers a sermon as «Sermon not found or unavailable» and the page falls back to English (2026-10-11, twice in one case).

## Why

- 2026-01-15 / 2026-01-17: offline pages short-circuited on offline status and queries were switched off offline; the fix was to read the persisted cache and let `offlineFirst` handle the network.
- 2026-05-01: `navigator.onLine` only says the device has an interface; with the server unreachable the app kept refetching and blocking until API-client failures fed the online gate.
- 2026-10-11: the owner's construction replaced the device/server split, the settle timer and the icon as a gate with one answer by the last real request plus knocking (BUG-20260908-cached-response-counts-as-live-connection and the four records closed with it).

See also: `.howto/use-server-first-query.md` · `.howto/keep-a-write-across-offline.md` · `.howto/read-owner-documents.md`


## A cached document exists but a new address opens the generic card

Check the route registry in frontend/app/~offline/page.tsx before changing data reads. Each supported
screen needs a lazy route entry; detail screens use useRouteId so the shell can read identity from
the actual URL when Next params are empty. The default segment index is1; nested care paths pass2.
Keep imports lazy so the shell bootstrap stays small. The build-time policy independently precaches emitted application JS/CSS, while data availability remains device-owned; see `.howto/set-up-the-service-worker.md`.
Care covers overview, council/order lists, both detail screens and council conduct.
A generic fallback card is a grid item: retain min-w-0 so a long requested URL can truncate on a phone.
Behavior tests: offlineShell.engine.test.tsx and useRouteId.test.tsx; geometry needs a real browser.

A nested section also needs its real layout: offline route metadata carries an optional lazy Layout,
so settings reuse settings/layout.tsx instead of copying navigation or providers. Use the existing
useShellPathname for its active section. Import the same layout module already loaded by an online
visit; an offline-only wrapper chunk may never have been cached. Keep static reserved addresses
(such as /studies/share-links) before a generic /studies/[id] matcher. Prayer detail and group conduct
use the same useRouteId owner as other detail pages. A route entry alone does not solve a page whose
access/data exist only in live API memory (admin); preserve its access boundary and track that domain
separately. Verify index/legacy redirects and cached lazy chunks with real worker restarts, beyond
mounted route probes.


## Open a cached document at its beginning

The private shell already owns viewport height. A nested note or its loading silhouette must use natural document height on narrow screens: another `min-h-screen` can leave the root at viewport top after shrink, making the router preserve a clamped offset under a sticky header. Wide note panes keep their existing bounded height in the workspace CSS. Verify the first paragraph, not just whether the root is on screen.

A new card can inherit the old list offset when a short full-page fallback clamps the viewport before cached content expands. First trace native anchoring separately from explicit scroll calls and history restoration. The router remains the navigation owner; do not add a reset timer or `scrollTo` to each screen.

The existing full-page fallback declares `data-page-loading`. One rule in `app/globals.css`, `html:has([data-page-loading]) { overflow-anchor: none; }`, suspends native document anchoring only while that state exists. Use the actual loading root: sermon/series skeletons and group/prayer/study route/page fallbacks. `RecordUnavailable` requires both `checking` and explicit `pageLoading`; a caller with retained series/group content does not opt in. A study workspace declares only its empty pre-initialization state, never a visible recovered draft. Inline spinners, card activity and ordinary reading must not declare full-page loading. The marker leaves with the waiting state, restoring normal anchoring.

Verify geometry in a real browser after warming the actual list and document, waiting for an actual controlling service worker, then disabling the network and opening from a meaningfully scrolled list. Repeat the opening. `serviceWorker.ready` alone may precede controller assignment; wait for `navigator.serviceWorker.controller` separately. Measure the first body paragraph when a sticky title can hide the failure. JSDOM only verifies the state declaration/release; it does not implement native anchoring. Record source/build pins, visible body/title geometry, `auto → none → auto`, unchanged retained-content controls and cleanup. Back/Forward offsets are a separate navigation contract; an ordinary-card fix does not prove history restoration.


## Return to the reading place in history

`utils/windowHistoryPosition.client.ts` is the one window-position owner, mounted by the root
`WindowHistoryPosition` client effect. It reuses `utils/historyEntry.ts` and the existing
`bibleEntry` key. Each pushed visit gets its own identity, even at the same address; a supplied
fresh Bible identity and all router fields survive. A replace keeps the current identity. Read
`PopStateEvent.state` in capture phase before the router replaces state. Native fragment entries
without app state remain native: do not mint an identity for them while traversing.

Keep at most 100 visit positions in sessionStorage, with an in-document fallback when storage
refuses the convenience. Save the outgoing visit before push/pagehide. A restored visit must
match its saved address. Wait while `data-page-loading` exists or the requested coordinates do
not fit; after four stable layout frames restore, then settle again because the restored scroll
can collapse a header. Wheel, touch, pointer, key input and a new navigation retire pending
restoration. Do not compare the new page's total height with its previous height: shortened
words or a different layout can still fit the remembered position. Do not create filler height.
Clamp negative rubber-band readings, check both axes without a frame spin when a coordinate is
unreachable, and allow navigation without optional Navigation Timing measurements. A shorter
final document whose saved coordinate is no longer reachable keeps native scrolling available
until newer input/navigation; the module does not promise a semantic anchor for changed words.

The Bible route keeps its own verse/arrival owner (`lastPlace`/`BibleBookReader`); note panes
keep `useNoteScrollPosition`. This is a bounded history return, not continuous page anchoring.
Keep native `history.scrollRestoration` unchanged, and never add reset timers or writers to
individual screens. Cleanup disconnects observers/listeners and pending frames. If a later
router wrapper retained the old history methods, the disposed wrapper delegates unchanged.

The real regression needs a warmed actual app, service worker and local emulators: scroll a
list, open a document, read farther down, Back, Forward, then make a new ordinary opening.
Measure the same entry and search, and inspect the actual paragraph/textarea as well as scrollY.
Repeat online/offline at phone/tablet widths. Cover series, groups, prayers, service orders,
councils and study notes; keep Bible material-to-document-and-Back controls. For a delayed
geometry probe, declare its CSS hold and release explicitly; after newer wheel input the late
restore must not pull the person back. Check a shorter page that still fits the old offset and
native fragment Back/Forward with null state. Synthetic geometry controls are separate from
ordinary UI acceptance. Four stable frames cannot prove the absence of every future unmarked
async layout; retain the exact exercised evidence and physical-device boundaries.

JSDOM checks the controller, not native layout/history restoration. Preserve actual browser RED
before source edits and mutation-check new deterministic tests. Rebuild after root integration,
pin tracked and new source files plus compiled/worker bytes, use the same browser callback after
the fix, and retain failed attempts. Stop/export only PID-verified owned services after every
browser context closes. Local evidence and future production steps live in
`docs/verification/local-bug-fixes.md` under `BUG-20261021-offline-history-scroll-position`.


## Keep the contents of a retained service

CollectionReader can retain a null-value tombstone while a disconnect changes its freshness from server to cache. collectionRecordPresence then conservatively says unknown instead of asserting a fresh server absence. A screen showing a retained copy must choose its words from the local draft or that retained copy, not from an absent live row. Service-order detail uses the existing RetainedOrderSteps with typed ?? kept.steps in both retained branches. Keep this display fallback out of liveSteps/typedRef and the writer; retain an intentional empty array. Test an actual title-only draft/refusal, acknowledged deletion and real offline transition: a mocked orders=[] alone does not prove reachability. Viewing must not recreate the deleted record. The retained view tells the person to copy before leaving; do not mistake it for a hard-reload persistence guarantee.
