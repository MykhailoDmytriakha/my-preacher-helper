when: field not cleared on server · clearing a field does nothing · unassign does nothing · removed value comes back after reload · undefined dropped by JSON.stringify · send null · null vs undefined · deleteField · deepCleanUndefined · outlinePointId null · subPointId null · remove a nested key · changedFields ignores a missing key · outbox JSON · empty list vs never set · очистить поле · поле не очищается · значение возвращается после перезагрузки · null вместо undefined · удалить вложенный ключ · снять привязку · пустой список или не задано

# Clear a field over the wire

To clear a field, send a value that SAYS "empty" — `null` in JSON payloads, mutation variables and optimistic entities, `deleteField()` for a direct Firestore update of a nested path — never `undefined` or a missing key. `undefined` vanishes on the way: `JSON.stringify` drops it, and `deepCleanUndefined` (`frontend/app/utils/deepCleanUndefined.ts`) strips it before every Firestore write, so the other side hears "untouched" and the clear silently does nothing.

## How

- JSON (HTTP body, persisted mutation, outbox entry): `null`. `JSON.stringify({ outlinePointId: undefined })` is `{}`.
- Unassign a thought: `outlinePointId: null, subPointId: null` (`frontend/app/(pages)/(private)/sermons/[id]/structure/page.tsx`). The thought merge in `frontend/app/services/sermons.client.ts` treats a PRESENT key as a change and stores `?? null`; an absent key keeps the old value.
- A diff walks only the keys of the new value (`changedFields` in `frontend/app/utils/changedFields.ts`): delete the key from the object and the field counts as untouched. Keep the key, set it to `null`.
- Direct SDK update of a nested field: `deleteField()` (removed `preparation.<step>` in `sermons.client.ts`). Just leaving the path out keeps the old value on the server.
- `deleteField()` is a sentinel object and does not survive JSON: in a patch that may be queued in the outbox it replays as a junk map, not a removal. Send removals through an ordinary write (`revisionedUpdate`, whose sentinel Firestore's own queue keeps intact), or blank the value (`""`) inside the guarded write and sweep the key afterwards (`frontend/app/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus.ts`).
- `null` is kept by `deepCleanUndefined` on purpose: Firestore stores it, and it means something different from absence.
- Lists: `null` or absent = never set, `[]` = emptied. A writer that skips falsy values, or a baseline that turns `null` into `[]`, makes "remove the last item" a no-op or refuses the first write — test with `Array.isArray` (`.howto/link-two-entities.md`).
- Data-engine commands accept JSON values only (`validateJson` in `frontend/app/data-engine/protocol.ts`), so the same rule holds there.

## Why

- Undated archive entry: unassigning an outline point did nothing because the optimistic entity and the payload carried `undefined`; the backend never received the clear.

See also: `.howto/write-a-document-field.md` · `.howto/keep-a-write-across-offline.md`
