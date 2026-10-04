when: cross-account · another account sees my data · shared computer · signed out then signed in as someone else · previous account's data on screen · persisted cache leak · service worker cache /api · apis cache · NetworkFirst · owner-scoped key · uid in query key · recording draft owner · validateCollectionSnapshots · ownedBy · getDoc from cache another account · Server snapshot ownership · чужие данные · другой аккаунт · общий компьютер · вышел и вошёл другим · утечка кэша между аккаунтами · данные прошлого пользователя

# Keep accounts apart on one device

Every store on the device belongs to the device, not to an account, so each one has to name its owner or refuse a foreign one. A leak needs only one layer that forgets; the 2026-10-03 fix found five at once (cross-account entry, BUGS.md history).

## How

- **Service worker (open).** Serwist's `defaultCache` keeps same-origin `GET /api/*` in one "apis" cache (NetworkFirst, 10 s timeout): on a dropped network or a slow server it hands account A's answer to account B. Putting private API reads on `NetworkOnly` was tried on 2026-10-03 and withdrawn: some screens have no other offline copy (the referral count in settings), so it needs owner-scoped offline replacements first — part of the open construction decision. The public `/api/share/notes/<token>` must keep a cache either way, so a shared note opens offline.
- **Data engine reads.** `frontend/app/data-engine/transport.client.ts` checks the owner on every snapshot it accepts — lists, changes and the single-document `read` — with `validateCollectionSnapshots`; a foreign snapshot is `data-loss`. The snapshot store keys `[owner, collection, id]` and validates on read (`snapshots.client.ts`).
- **Firestore SDK cache.** Its IndexedDB persistence is per device. A list query filters by owner, but a single `getDoc` answers offline or on a slow network from the local cache with whatever account last read that id. Every single-document read that reaches a screen passes `ownedBy(owner, document)` (`frontend/app/services/ownerListRead.client.ts`; used by `readOwnerDocument`, `getSermonByIdViaClient`, `getPrayerRequestById`). Reads before a write need no check: the server's rules refuse the write.
- **Query cache.** The React Query cache is persisted under one key per device with no time limit (what was seen stays for offline use). A key that holds an account's data must name the owner (`frontend/app/utils/queryKeys.ts`; see `.howto/update-react-query-cache.md`); a key without it is readable by the next account. Changing an EXISTING key orphans the copies already on devices: offline after the update the person loses their own cached data until the next online read. So a key change needs a migration of the old copies — only where their ownership can be verified — and that is part of the open construction decision (series, group, prayer and preach-dates detail keys are still without owner).
- **Device stores of your own (open)** (IndexedDB, localStorage): a record needs the owner of the WORK, captured when the work starts — not whoever is signed in when it is saved. The recording-draft attempt of 2026-10-03 stamped the owner at save time, so a transcription that failed after a change of account moved the author's recording to the next account; and a fence that built a new array each render reset the audio player. Both were withdrawn; drafts stay ownerless in the open entry.
- Prove each layer with a test where another account's copy sits in the store (old key shape and foreign owner) and the server refuses; the screen must not show it.

## Do not

- Do not wipe the caches when the owner changes: it was tried and reverted, because it also removed paused offline mutations (unsent edits).
- Do not filter persistence by "the current owner" at write time: before auth restores on boot the owner is unknown, and the first persist would drop the person's own offline cache.

## Why

- 2026-07-25: account B opened A's sermon by direct link and saw A's text from the persisted query cache.
- 2026-10-03: after sermons moved to the engine, other paths still reached B's screen (worker API cache, engine document read without an owner check, Firestore SDK single reads, series and prayer detail keys, recording drafts). Three first fixes were rolled back for making the person's own data worse: changing detail keys without migrating old copies, taking private API reads off the worker cache while some screens had no other offline copy, and stamping recording drafts with the owner at save time. Three review rounds each found one more path of the same class, so the entry stays open with a construction decision for the owner: partition every device store by owner at the root, so that no read point has to remember the owner (BUGS.md, "Cross-account утечка persisted-кэша").

See also: `.howto/update-react-query-cache.md` · `.howto/set-up-the-service-worker.md` · `.howto/migrate-domain-to-data-engine.md`
