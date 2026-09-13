# Local DataEngine browser validation fixture

This is a test consumer of the real engine, IndexedDB stores and Firestore Emulator. It is deliberately not a production screen. Its HTTP adapter has a fixed demo owner and can return a simulated lost response after committing a real command. It must never be mounted against a production database.

The fixture was exercised in Chrome on 2026-09-12 against `demo-data-engine` on `127.0.0.1:8188`. The local Next development server ran on `127.0.0.1:3188`, with fake Firebase public configuration and a preinitialized demo Admin app. The production SDK observation adapter and production authentication boundary are covered separately; this fixture uses the real HTTP fallback observer with an intentionally silent SDK source.

## Scenarios verified through the browser UI

1. Seed and open a sermon. Edit note A without pressing Save. The checkpoint reports `dirty: true`, `durable: true`, no pending command. Reload, then explicitly recover: note A remains unchanged in the editor and the server baseline remains original.
2. Open the same resource in a second tab. Edit note B and save. Return to the first tab: its note A draft remains, and the remote candidate contains B. Save A: the accepted revision contains both A and B, no conflict, no pending command.
3. Open the accepted resource, edit its title, arm Lose next acknowledgement and save. The server commits, the fixture returns HTTP 503, and the journal reports `unknown`. Type a newer title, reload and recover. The same operation ID is acknowledged at the original revision; the newer title remains a dirty local draft. Save it: the next revision contains the newer title, and the journal is empty.

The Node companion suite is `__tests__/data-engine/emulator.integration.test.ts`. Opt in with `DATA_ENGINE_EMULATOR_TEST=true FIRESTORE_EMULATOR_HOST=127.0.0.1:8188`. It rejects any other emulator host and uses project `demo-data-engine`; a normal Jest run skips this integration suite.

## Temporary route mounting

For local validation only, mount `page.tsx` from `app/dev/data-engine-check/page.tsx` and `route.ts` from `app/api/dev-data-engine-check/route.ts`. Set `DATA_ENGINE_BROWSER_FIXTURE=true`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8188`, and use development mode. The route refuses all other configurations. Preinitialize Firebase Admin with project `demo-data-engine` before loading Next; do not provide application service-account credentials. Remove the temporary route mounts after testing.

Use a new `?id=<unique-test-resource>` for each run. Each browser tab remembers only the source editor identifier in sessionStorage; recovery forks the complete checkpoint into a new editor and leaves the source untouched. This pointer is fixture navigation state, not an ownership lock or a production recovery policy.

## Evidence limits

Reload recovery is verified with real IndexedDB, not simulated process Maps. The response-loss case is deliberate fault injection, not a naturally occurring network drop. This does not prove offline app-shell loading, storage eviction resistance, physical iPad/iOS/Android behavior, or production screen migration. The service worker was disabled during this fixture run.


## Durable request queue recheck (2026-09-12 15:48)

Chrome, real IndexedDB and the same local emulator were exercised after introducing
immutable commit requests and per-request IndexedDB rows. Resource
`sermons/browser-20260912-1548` was newly seeded for this run.

1. Pause delivery through the fixture lifecycle control (the network remains
   available; this is explicit transport-lifecycle fault injection). Save title A,
   save title B, type C without Save. The durable checkpoint has two distinct
   pending requests and draft C.
2. Reload without opening an editor. Read server confirms original revision 1.
   Resume delivery. Read server confirms B at revision 3 and journal is empty while
   the page editor state is still null. A and B operation IDs remain respectively
   `256d1d35-0ea2-4ef1-87af-c5c8034636f9` and
   `51541b69-f243-4003-9b93-79b7a5086d8c`.
3. Explicit recovery restores C, confirmed B, no conflict and no pending request.
4. Save C with the next response deliberately lost after commit; journal displays
   unknown operation `0ae82389-75c1-4c48-ae4e-4a2db003eb54`. Type D and reload.
   Background delivery resolves that same operation at revision 4; server remains
   C. Explicit recovery restores D, confirmed C, no conflict and an empty journal.

The temporary mounts and development server were removed/stopped after verification.
This proves the request queue with browser persistence. It does not claim physical
network isolation, PWA cold-start availability or physical-device validation.
