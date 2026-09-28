when: feature switch · feature flag · NEXT_PUBLIC flag · per-collection switch · NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS · DATA_ENGINE_COLLECTIONS · DATA_ENGINE_CLOSED_COLLECTIONS · rollout order · already-running devices · old bundle still running · flip a flag in Vercel · deploy that flips the switch fails its own tests · legacyOpen · related-collection-not-enabled · 426 refusal · cascade across collections · rollback after enabling · tracker says blocker · переключатель функции · фича-флаг · выкатка · порядок выкатки · флаг в Vercel · старый бандл на устройствах · откат после включения · включить коллекцию на движке

# Roll out a feature switch

Order a rollout by when each switch takes effect on a device that is ALREADY running. A server switch acts at once; a `NEXT_PUBLIC_*` switch is compiled into the bundle and reaches a device only after a build, a service-worker swap and a voluntary reload, which takes days. For the data engine the switches live in `frontend/app/data-engine/activation.ts` and the order in "Rollout order" of `docs/architecture/data-engine-migration-log.md`.

## How

- Serve first, close last. `DATA_ENGINE_COLLECTIONS` (server) and `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS` (bundle) turn a collection on. `DATA_ENGINE_CLOSED_COLLECTIONS` refuses every legacy write and is a separate LAST switch, thrown only when every device runs the new bundle: check the app version on each device, a server env change proves nothing. `isClosedToLegacyWriters` counts a closure only for a served collection.
- Make the mixed stage safe on its own. While legacy writers share a served collection, the server reports `legacyOpen` and readers re-read whole lists, because a legacy write raises no feed event.
- A shipped bundle is a reader you can no longer change; shape every answer and every stored document for it. Legacy writes to an engine-owned document are refused with 426 (`LEGACY_REFUSAL_STATUS` in `frontend/app/data-engine/legacyBoundary.server.ts`), because shipped clients read 409 as a compare-and-set conflict and dropped the person's text. A tombstone names its owner in `_dataEngineOwner` (`TOMBSTONE_OWNER_FIELD`), never in the legacy `userId`, or every legacy `where(userId == uid)` query sees a blank editable document. A domain-policy failure ends in a terminal `refused`, never a request `queued` for ever.
- A per-collection switch does not cover cascades. `processCommand` in `frontend/app/data-engine/server.ts` checks every planned write against the served collections before persisting anything and refuses the whole action with `related-collection-not-enabled`. Read-only references need no activation. Which operation writes which other collection: the dependency table under "Rollout order".
- List collections explicitly. Add `users` only with the migrated `UserSettingsProvider` and authenticated `/api/me/settings` bootstrap/heartbeat adapter (implemented 2026-09-28). Verify settings, public sign-in/language and reload before activating; an engine-marked profile already refuses old SDK settings writes, even before collection-wide closure. The all-or-nothing `*_DATA_ENGINE_ENABLED=true` switches are not for rollout (`frontend/app/data-engine/README.md`).
- Clear every new switch in `frontend/jest.setup.js`. The build runs the tests with the production env, so otherwise the very deploy that flips the switch fails its own gate. `frontend/__tests__/architecture/buildEnvIsolation.test.ts` is the alarm.
- A serving switch proves the protocol is served, not that the screen is migrated or that devices reloaded; those are separate gates.

## Traps

- After the first engine write, switching the client off is not a safe rollback: marked documents refuse legacy writes. Fix forward.
- A tracker entry is a claim about the past. Check the code before planning around it: on 2026-09-18 seven engine defects filed as "open blockers" had been fixed in the engine's first commit, and a P1 was a misread of the markup.
- A test pinned to a seeded date with no frozen clock turns red on that very day, on `main` too, where it blocks the deploy. Freeze the clock in the test.

## Why

- 2026-09-18: the first rollout design closed a collection to legacy writers at the moment the engine began serving it. Every bundle already running would have lost the ability to save.

See also: `.howto/migrate-domain-to-data-engine.md` · `.howto/get-a-deploy-through-vercel.md` · `.howto/test-with-fake-timers.md`
