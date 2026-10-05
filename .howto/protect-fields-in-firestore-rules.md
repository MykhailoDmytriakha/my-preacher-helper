when: firestore.rules · security rules · client can write a server field · server-managed field · privilege field · paidTier · role · usage · promotion · referredBy · referralWarning · referralLedger · affectedKeys · diff · hasAny · keys() · client whitelist is not authorization · rules test · emulator · test:rules · rules-test.cjs · assertFails · _dataEngine marker · legacyExisting · permission-denied after a rules change · правила безопасности · правила Firestore · защитить поле · клиент пишет серверное поле · тариф · роль · запрет записи · тест правил · эмулятор · отказ в доступе после правки правил · выкатить правила · deploy rules · closure · closedToBrowserWrites · закрытие разделов

# Protect server-managed fields in Firestore rules

A field the browser must never set (tier, role, usage, referral, the engine marker) is refused in `frontend/firestore.rules` — on create by the incoming keys, on update by the keys the write changes — and both the allowed and the refused writes are proven on the emulator (`frontend/rules-test.cjs`, `npm run test:rules` in `frontend/`). A field whitelist in a client service is not protection: it constrains that one service, and any other client code can write anything the rules allow.

## How

- Create: `!request.resource.data.keys().hasAny([...protected])`.
- Update: `!request.resource.data.diff(resource.data).affectedKeys().hasAny([...protected])`. On an update `request.resource.data` is the WHOLE future document, not only the fields sent, so a `keys()` check there would refuse every save of a document that already holds the field. The diff sees only what this write changes.
- The live example is `match /users/{uid}`: `paidTier`, `promotion`, `usage`, `role`, `referredBy`, `referralWarning`, `referralLedger` are refused on create and update, while the settings the app really writes stay allowed (`frontend/app/services/userSettings.service.ts` keeps its own whitelist on top).
- The same idea guards engine documents: `legacyExisting()` / `legacyIncoming()` refuse any browser write to a document carrying `_dataEngine`, and they check the EXISTING document too, so an old queued full `setDoc` cannot erase the marker.
- Keep owner checks on both sides of an update: `ownsExisting('userId') && ownsIncoming('userId')`, so a document cannot be reassigned to someone else.
- The Admin SDK bypasses rules. A server path that changes such a field is where its authorization lives, and a server writer of content must advance the `rev` counter itself.
- Prove both directions: per protected field one `assertFails` on create and one on update; `assertSucceeds` for every UX field the app writes (language, the settings toggles, the `lastSeenAt` heartbeat through a merge `setDoc`). The suite runs under `firebase emulators:exec`; `frontend/rules-test-closed.cjs` covers collections closed to browser writes.
- Rules deploy separately from the app bundle. Protective rules go out before the code that relies on them (engine rollout order: `docs/architecture/data-engine-migration-log.md`). A NEW server-managed field especially: the repository is public, so its name is known the moment the code is pushed, and until the rule ships a client can write it on its own profile — a value nothing can later tell from the server's. Deploy the rule from the working tree first (`npm run test:rules` green), confirm no user holds the field, then push (F6 referral fields, 2026-10-05).

## Traps

- **Deploy rules only from an up-to-date `main`.** Since 2026-09-28 the rules close the ten engine collections to browser writes (`closedToBrowserWrites`). A deploy from a checkout older than `8a7d779c` ships an empty list and silently reopens all ten. Pull first; `npm run test:rules` must pass — `rules-test-closed.cjs` pins the shipped list to exactly the ten. After the deploy, compare the released ruleset with the file (Firebase Rules API `projects/my-preacher-helper/releases/cloud.firestore` → ruleset source; the 2026-09-28 check matched byte for byte).
- The commented `advancesRevision` draft in `firestore.rules` is not a switch. Checking one aggregate's counter on every update refuses most of today's saves (a sermon has four counters and a save moves one). Read the comment block first: the working form is driven by `affectedKeys()`, wired per collection, `users` left out, proven on the emulator.

## Why

- 2026-07-12: the client settings service wrote only whitelisted fields, which looked like protection but did not stop any other client write; the privilege fields were then refused in the rules and proven on the emulator in both directions.

See also: `.howto/write-a-document-field.md` · `.howto/write-in-a-firestore-transaction.md`
