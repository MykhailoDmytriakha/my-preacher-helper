when: demo data for the test user · show a feature with seeded data · Firestore emulator with real sign-in · production quota exceeded · RESOURCE_EXHAUSTED during a live check · second dev server talks to :3000 · Working offline banner on a second server · data engine reads nothing in a hidden tab · демо-данные тестовому пользователю · показать фичу на данных · эмулятор базы · квота прода кончилась · вкладка скрыта

# Run a demo on the Firestore emulator

A demo, or a live check that needs particular data, runs against the local Firestore emulator: the shared production database is untouched (no load, no test data among real records) and the demo still works when production refuses reads. The dev test user signs in for real; only Firestore is local.

## How

- **Emulator.** A folder with its own `firebase.json` (`firestore` on a free port, `hub`/`logging` ports shifted, `singleProjectMode`), a copy of `frontend/firestore.rules` made at every start (the emulator refuses rules outside its folder), `--project my-preacher-helper`, `--import` / `--export-on-exit` into a data folder so the demo survives a restart. The firebase CLI is `frontend/node_modules/.bin/firebase`. Real ID tokens are accepted (the emulator warns it does not check signatures).
- **Server.** A second `next dev` on its own port with: `NEXT_TYPEGEN_DIST_DIR=.next-<name>` · `NEXT_PUBLIC_FIRESTORE_EMULATOR=true` and `NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=<port>` (browser SDK, `app/config/firebaseClientDb.ts`) · `FIRESTORE_EMULATOR_HOST=127.0.0.1:<port>` (Admin SDK in routes) · the engine switches from `.howto/fix-stuck-dev-server.md` · **`NEXT_PUBLIC_API_BASE=` empty**.
- **Data.** Write through the app's own path: sign in by REST (`identitytoolkit … accounts:signInWithPassword`, the dev login from `app/utils/testLogin.ts`) and POST `/api/data-engine/commands` with `{ protocol: 1, operationId, owner, resource, generation: null, dependsOn: [], kind: 'create', value }`. A document written straight into the emulator has no `_dataEngine` metadata and no change-feed entry. The `users/{uid}` profile is created by the app at first sign-in.
- **Looking at it.** Drive a headless Chrome (Playwright, `channel: 'chrome'`, a persistent profile per viewport, cookie `lang=ru`). Screenshots from it are the visual evidence.
- Worked example with every script (start, seed, walk scenarios, stop): case `2026-10-19-mesto-pisaniya-tekst-i-gde-esche-ispolzuetsya`, folder `demo/`.

## Traps

- In a deliberate emulator outage/restart check, wait the full `Retry-After` measured from the completed refusal response. A listening emulator port does not establish that the existing application client has recovered: require an actual authenticated application read to return 200 before claiming recovery. If it still answers 503, retain that attempt and honor its new response pause; bound any local recheck. Never use such a retry loop against an exhausted production quota.

- When testing a production-Firestore deny guard, wrap stub transports before loading it and assert the guard refuses before those stubs are called. Even a broken guard must not send the negative-control probe to production. Keep its expected-block log separate from the real QA server guard log; pure policy tests and actual Admin SDK emulator preflight prove different things.
- For a production-built QA stand, compile `NEXT_PUBLIC_FIRESTORE_EMULATOR=true`, the selected emulator port and an explicitly empty API base into the build; changing only `next start` cannot change compiled public variables. Verify the exact build and both browser/API routing before data views. A temporary fake server credential plus an explicit production-Firestore network guard is useful extra protection; it does not replace actual emulator endpoint verification.
- Seed through commands and compare against accepted canonical values. `data-engine/serverRelations.ts` derives a note’s `isDraft` from tags/references, and the command mechanism owns `updatedAt`; a raw placeholder is not the accepted baseline. Compare authored fields structurally, keep array order exact, and verify that a read-only view does not create a new revision. Node `isDeepStrictEqual` avoids treating JSON object member order as content. The native Phase115 metadata probe found all5notes still at revision1; earlier raw-fixture assumptions were not product regressions.
- The installed Admin SDK normalizes `FIRESTORE_EMULATOR_HOST` into `_settings.servicePath`, numeric `port` and `ssl:false`, deleting `host`. A QA preflight that inspects this installed version must check those actual fields after a local read, not assert a removed `host` property. These are harness diagnostics, not a product API.

- **`NEXT_PUBLIC_API_BASE=http://localhost:3000` in `.env.local`.** A second server's pages send the connectivity knock and several service calls (`studies.service`, `outline.service`, …) to :3000 — another server, backed by production. Symptoms: «Работаем офлайн» on a working server, data from the wrong database. Empty the variable for any second server.
- **Port 8080 may be taken** (2026-10-19: Apple's WebDriver service). The browser SDK used to hard-code it; the port is now `NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT`.
- **A hidden tab reads nothing.** The data engine pauses server reads while `document.visibilityState` is `hidden` (`app/data-engine/browser.client.ts`). A Claude-in-Chrome tab in a window covered by other windows is hidden on macOS: the note spins forever and «Настройки» shows «С этой записью что-то пошло не так». Not a bug of the page; look with a headless browser, or bring the window forward.
- `next dev` with `NEXT_TYPEGEN_DIST_DIR` adds its folder to `frontend/tsconfig.build.json`; take back only that line right after the start (memory `feedback_second_dev_server_leaves_trace.md`).

## Why

- 2026-10-19: production answered `RESOURCE_EXHAUSTED` to every read while the owner asked for a demo with full data; seeding production was impossible and would have mixed test records into the shared base. The emulator stand showed the feature the same day.
