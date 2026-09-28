when: updateDoc · setDoc · write a document field · save a field · conflictSafeUpdate · revisionedUpdate · revisionBump · StaleWriteError · isStaleWriteError · serverValues · OfflineQueuedError · save refused as stale · conflict on every save · text lost after a conflict · migration script changes stored content · rev not bumped · writesGoThroughTheInterface · publish a write to the cache · list copy vs detail copy · false success toast · сохранить поле · запись поля документа · конфликт при сохранении · слияние правок · затёрло чужую правку · отказ как устаревшая запись · текст пропал после конфликта · ревизия не увеличилась · ложный успех · useDataDocument · useDataForm · useDocumentActions · serverEdit.server.ts · dataEngineBoundary · durable intent · acknowledgement · движок данных · долговечная правка · подтверждение сервера

# Write a document field

For an engine-owned collection, write through the public facade in `frontend/app/data-engine/react.client.tsx`: `useDataDocument.update/commit`, a pinned `useDataForm`, or `useDocumentActions` for a one-shot action. The engine owns durable intent, delivery, revisions and conflicts. Trusted server-generated edits use `frontend/app/data-engine/serverEdit.server.ts`. See `frontend/app/data-engine/README.md`.

## How

- `useDataDocument.update(current => next)` persists the latest editor value locally; `commit(current => next)` captures an explicit Save before awaiting storage. A Save resolving means local ownership, not server acceptance. Use the hook's status and `DataSyncStatus` for delivery, retry and conflict choices.
- `useDataForm(resource, slot, selection)` pins the fields and ancestor when a manual form opens. `update()` durably stages typing without sending it; `save()` submits that stage. Use `useDocumentActions().commit/create/remove` for a one-shot action on a document no screen has open.
- Let the engine's editor and `useDataCollection().state.documents` publish submitted intent and acknowledgements. Keep `snapshots` as confirmed data; do not write an optimistic result directly into React Query or confirmed snapshots. Render `DataCollectionStatus` for list delivery and incompleteness.
- Trusted server-computed changes use `serverEdit.server.ts`, which submits an engine command on engine-owned documents. `frontend/__tests__/architecture/dataEngineBoundary.test.ts` freezes SDK, internal-module and legacy-HTTP bypass counts; the exception ledger only shrinks.

## Legacy paths (unconverted collections only)

These compatibility paths are not templates for new features.

- `conflictSafeUpdate(...)` compares the value the editor opened with (the baseline) against the server, then writes or refuses; offline it queues the intent. It bumps the aggregate's counter `rev.<aggregate>` itself.
- `revisionedUpdate(...)` is the named unguarded door, for writes where a refusal would be wrong (cleanup). It still advances the counter through `revisionBump(aggregate)`.
- Never a bare `updateDoc` / `setDoc` for an own-document write: it silently drops the race check, the outbox and the typed errors. `frontend/__tests__/architecture/writesGoThroughTheInterface.test.ts` freezes the remaining direct writes per file — a number may only go down. It also counts `writeBatch` and `runTransaction`; it cannot see an aliased import.
- Per-item leaf writes (`planText.<nodeId>`): scope the check to that item's baseline, not the whole aggregate — otherwise editing two different points reports a conflict that does not exist.
- Every writer of a field moves its counter: scripts and migrations included (`frontend/scripts/migrate-plan-text.js` bumps `rev.plan`), and a second writer of the same field bumps the same revision before scheduling its write (outline Apply and the manual save both write `sermon.outline`).
- Report a legacy write as a patch of what changed; each side — list cache, detail cache, screen — merges it into the copy it owns. Never hand a whole entity across a boundary: the list copy and the detail copy differ in completeness and are not comparable (`frontend/app/hooks/useSermon.ts`, "the list copy is a fallback, not a candidate").

### When the legacy write is refused

- `isStaleWriteError(error)` → `error.serverValues` is what the transaction found on the server. Adopt it as the new baseline, keep the person's text on screen and still marked unsaved, and say so; a second, deliberate press then means "mine wins". A guard without this exit only moves where the text is lost.
- `OfflineQueuedError` → the intent is queued; tell the person it will be delivered.
- On a detected race show the banner, never a silent overwrite. An online save promise must reject back to the UI, so a failure shows an error and not a success toast.

## Why

- 2026-08-15: a new plan-text writer called `updateDoc` directly — the same trap had been stepped in five times, always by a new feature copying a neighbour. So the rule is structural: the guard test keeps the door shut, not the author's memory.
- 2026-08-15: `migrate-plan-text.js` first moved content without touching `rev`, so a copy cached before the move could never be proven older; the stale copy kept winning and the guard refused legitimate saves. Documents moved before the fix were retrofitted with `frontend/scripts/touch-plan-revision.js`.

### Legacy traps

- A save is refused although the value is really on the server → the screen and the refusal read different fields (legacy cells merged on read vs the raw `planText`). Judge both by the same canonical value.
- Two different points of one plan "conflict" → the baseline is aggregate-wide; scope it to the item.

See also: `.howto/compare-local-and-server-copies.md` · `.howto/keep-a-write-across-offline.md` · `.howto/use-data-engine-in-a-screen.md`
