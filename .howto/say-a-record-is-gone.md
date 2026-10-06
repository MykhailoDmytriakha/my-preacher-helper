when: not found · record is missing · deleted on another device · endless loading for a missing id · skeleton forever · "Failed to load" for a record that does not exist · old address · recheck · missing record · tombstone · absent · запись не найдена · не найдено · удалили на другом устройстве · вечная загрузка · вечный скелетон · старый адрес · «не удалось загрузить» вместо «нет такой»

# Say a record is gone

A screen opened on a record that is not there must name it — "not found", "deleted", or "not on this device yet" — with a way back to its list. Saying "it was deleted" when it was not destroys trust in the whole section; leaving a spinner or a "failed to load" is a dead end. Open case: `BUG-20261004-missing-record-dead-end-screens` in `BUGS.md` holds the per-screen roots and an attempt reverted after two review rounds (`.cases/2026-10-06-bugs-26/artifacts/missing-record-r2.patch`).

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
