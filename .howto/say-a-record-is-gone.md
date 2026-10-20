when: not found · record is missing · deleted on another device · endless loading for a missing id · skeleton forever · "Failed to load" for a record that does not exist · old address · recheck · missing record · tombstone · absent · запись не найдена · не найдено · удалили на другом устройстве · вечная загрузка · вечный скелетон · старый адрес · «не удалось загрузить» вместо «нет такой»

# Say a record is gone

A screen opened on a record that is not there must name it — "not found", "deleted", or "not on this device yet" — with a way back to its list. Saying "it was deleted" when it was not destroys trust in the whole section; leaving a spinner or a "failed to load" is a dead end. Local fix: phase126 of `.cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov` records the six-screen baseline, genuine failing controls, final native evidence, and the earlier reverted attempt. Production acceptance is still a separate step in `docs/verification/local-bug-fixes.md`.

## The question is "whose no is this?"

Every trap below is the same mistake: an empty answer taken for the server's word about this very record.

- **A cached list is silence.** Firestore and the engine answer from the device first; a list without the row proves nothing until the server answered (`useDataCollection().state.freshness === 'server'`, no `error`). A refresh can settle on the cache too — a hidden page, a connection lost on the way.
- **An engine list mixes intent with the server.** `state.documents` includes this device's queued creates; a refused create the person discarded leaves the list — that is his own act, not a deletion elsewhere.
- **An opened engine document is not the server's word yet.** The editor opens on the cached snapshot (a cached "absent" may be old). `status.freshness` comes from the observer, which publishes before the controller applies its snapshot (`data-engine/engine.ts`), so freshness and `confirmed` can describe different copies for a moment.
- **His own deletion on its way empties the draft first.** `draft === null` with a `confirmed` copy that still has a value is his delete in flight, not absence.
- **The legacy React Query reads cannot prove absence.** `getDocs` does not tell the cache from the server.
- **Words kept on the device outlive the record.** A durable draft (`useDurableDraft` reads it before the editor initializes) must stay visible and copyable whatever the verdict.

## Mechanics that bit

- An effect that holds a callback a hook rebuilds every render cancels its own question on the next redraw (`gone = true` in cleanup) — key the question to the record and a question number, not to render identity.
- Re-asking because `loading` flipped is a loop: the recheck's own refresh flips it. Re-ask on presence or connection change only.
- In jsdom after a suite with fake timers, React updates from resolved promises may not flush; flush inside `act` (`await act(async () => { await new Promise(r => setTimeout(r, 0)); })`).

## Use the public presence answer

Use `useDataDocument().presence`, an open editor's `presence`, or `useDataCollection().presence(id)`. The engine pairs the answer with its own observation and resource identity. `present` may be cached; only a successful server answer or an actual acknowledged command proves `absent`. A complete server collection is required to infer absence from a missing row. Its exact acknowledged snapshot can answer before the list feed catches up; canonical revision ordering keeps a newer tombstone ahead of an older create acknowledgement. Queued local create and delete intents are `creating` and `deleting`, not server absence.

For an explicit decision from the recheck answer use `useDataCollection().refreshPresence(id)`: it classifies the exact returned refresh result before React echoes it and rejects an answer for a replaced owner/resource. A passive Retry that awaits the existing reader and lets its subscription redraw may forward `refresh`; do not make a separate absence decision from that promise. Screen adapters must forward public `presence(id)` with their content/loading, rather than reduce every unavailable row to `null` (the prayer detail adapter did that; local phase137). Features must not runtime-import the internal classifier. Do not derive presence from projected words, `draft === null`, or a separately read freshness label.

Use `RecordUnavailable` for a missing/unknown/deleting record, with a usable Back and explicit Retry. Keep retained content outside the verdict: a prior note draft (even just tags or references), submitted order steps, series metadata, an unfinished group meeting, and per-cell manual-plan text remain readable/copyable. This does not recreate a record or grant editing a proven-absent one. Show the copy-before-leaving warning where held words have no established reload durability. Do not start a new manual form without a live confirmed parent; keep an already started meeting on its pinned flow.

The new-note page waits for its owner collection before showing editable inputs. Retained words can appear during that wait. A just-created note has its explicit creation transition; it must not be mistaken for a missing existing note while the list catches up.

Acceptance: use a dedicated emulator for both SDKs and an empty API base. Open all six missing routes, exercise Back/Retry, then create a real disposable note, explicitly delete it, and reload the same profile. Check retained title/body, metadata-only tags/references, failed reads and delayed storage, real clipboard, and actual offline order typing followed by a later explicit delete. Keep raw console/request failures visible in the report; an offline fault creates expected network errors and is not a zero-diagnostics run. Physical-device and production acceptance remain separate.

For a collection-backed detail route, verify actual healthy content, complete-server absence, a cold refused read, a cached negative answer, retained warm content and explicit local deletion. Retry must target that collection, not a separate Settings failure above it. The prayer phase137 native run stops only the owned emulator, verifies real application/browser503, retries the unknown panel while unavailable, then restores owned local services and re-seeds the same authored test fields through canonical commands before actual panel Retry. This is a controlled replacement test stand, not evidence that data survived destruction of the store. The active service-worker hard-offline reload is a separate checked path. Keep these proof boundaries explicit.
