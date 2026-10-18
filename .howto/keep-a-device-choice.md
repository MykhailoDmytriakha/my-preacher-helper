when: device setting · per-device choice · remember a setting on this device · localStorage setting · switch flips back by itself · setting turns off by itself · choice lost after scroll · useSyncExternalStore localStorage · deviceChoice · настройка устройства · запомнить выбор на устройстве · переключатель сам выключается · настройка сбрасывается · выбор теряется

# Keep a choice on this device

A setting the person makes on one device and finds there again — which cross references show, the marker's colour and last tool — lives in `frontend/app/utils/deviceChoice.ts`. Do not write another store over `localStorage`.

## How

- `const choice = deviceChoice({ key: 'area:name', parse, fallback, onOtherTab? })` once per setting, at module level. `parse(raw | null)` turns the stored text into the setting and gives the defaults for nothing or a broken record; `fallback` is what the server and hydration draw.
- Components read `choice.useChoice()`; code reads `choice.read()`; a change is `choice.save(partial)`, which returns `'kept' | 'memory-only' | 'not-read-back'`. Put a result other than `'kept'` into the technical details (`recordDiagnostic`) — see `components/bible/crossReferencePrefs.ts`.
- Every stored record carries `__savedAt`, the moment of the action by this device's clock. Another tab's record replaces the page's choice only when it is newer, so in ordinary use a queued older event, or a write refused here, does not undo a newer choice. A record without the moment (the earlier version) is followed only by a page that has not chosen yet.
- Limits, accepted for one person with one app window (BUG-20261017-xref-switch-does-not-stay-on): two tabs changing different fields while one's event is still queued to the other lose the other's field; a clock set back plus a late event can misorder; a delayed clear of all storage resets a choice storage refused. Code that reads storage on every render had none of these, and it is what failed on the iPad.
- Tests: `localStorage.clear()` alone does not reset a choice the page already holds — call the store's reset (`resetCrossReferencePrefsForTests`, `resetMarkToolForTests`, or `choice.resetForTests()`) in `beforeEach`. Another tab is a second `deviceChoice` with the same key (it stamps its record), then `window.dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key), storageArea: window.localStorage }))` — without `storageArea` the event is ignored (`__tests__/utils/deviceChoice.test.ts`).
- A value read once when a screen opens and then kept in that screen's state (`components/bible/translation.ts`) does not need the module.

## Why

- 2026-10-17, BUG-20261017-xref-switch-does-not-stay-on: the stores re-read `localStorage` on every render (`useSyncExternalStore` getSnapshot). On the owner's iPad the "Стихи" switch went back to off after a little scrolling or half a minute, three times; the reports showed only "on" saves — no "off", no other tab, no refused write. Desktop WebKit and the simulator held. The module holds the choice in memory from the first read and takes storage again only from another tab's newer record, so nothing but the person's own save or another tab's later choice can change what the screen shows. Two rounds of Codex refutation the same day shaped the rest: a watcher only while a screen is open missed changes; taking an event's value, or storage as it was at the event, let a queued older event undo a newer choice; a failed first read cached as the defaults let the next save overwrite the record.

See also: `.howto/show-bible-cross-references.md` · `.howto/show-technical-details.md`
