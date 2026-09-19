# DataEngine: the user-data boundary

User-data features read and edit through `react.client.tsx`. They do not choose
Firestore vs HTTP, construct commands, manage outboxes, compare revisions, or merge
remote copies. Those decisions belong here and have direct behavioral tests.

**Migration is in progress.** Every switch defaults to off. A domain is switched on per
collection: `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS` (compiled into the bundle) and the server's
`DATA_ENGINE_COLLECTIONS`; the older `*_ENABLED=true` pair still means every collection.
A third switch, `DATA_ENGINE_CLOSED_COLLECTIONS`, refuses every legacy write to a collection and
is thrown LAST, once every device runs the new bundle — `activation.ts` explains why the two
cannot be thrown together. Between them legacy writers and the engine share the collection:
the server says `legacyOpen` and lists are re-read, because a legacy write raises no feed event.
The order, its rollbacks and its residual risks: "Rollout order" in
`docs/architecture/data-engine-migration-log.md`. Do not flip anything from memory.
The remaining debt is recorded in `docs/architecture/data-engine-implementation-plan.md`
at the repository root and the architecture test ledger. The ledger is a shrinking
inventory, not permission to add another bypass.

## Public React interface

Mount `DataEngineWorkspace` once around authenticated pages, including pages hiding
navigation. It creates and disposes an owner-scoped engine when enabled. A page with
several editors for the same document uses `DataDocumentProvider`; all matching
`useDataDocument` calls inside it share one editor. The provider owns autosave timing.
Different documents remain independent.

Every opening allocates a new editor identity. A closed, acknowledged checkpoint may
already be compacted; reusing its identity would restart the edit counter behind the
durable deduplication watermark. Share a mounted editor through the provider, and
recover previous work explicitly rather than reusing an earlier page identity.

```tsx
import { DataDocumentProvider, useDataDocument } from '@/data-engine/react.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';

function NoteWorkspace({ id }: { id: string }) {
  return <DataDocumentProvider resource={{ collection: 'studyNotes', id }}>
    <NoteContent id={id} />
  </DataDocumentProvider>;
}

function NoteContent({ id }: { id: string }) {
  const note = useDataDocument({ collection: 'studyNotes', id });
  // Wire fields to note.data and note.update(current => next).
  // Catch rejected actions; note.error also exposes the failure to this banner.
  return <DataSyncStatus status={note.status} error={note.error}
    onRetry={note.retry} onKeepLocal={note.keepLocal}
    onAcceptRemote={note.acceptRemote} />;
}
```

- **Read:** `data` is the editor draft; `confirmed` is the last accepted baseline;
  `remote` is a candidate held while there is local intent. Never seed confirmed
  state from an optimistic React Query value or an incomplete list projection.
- **Update:** `update(current => next)` uses the latest editor value. It persists
  locally immediately; default autosave delays delivery by 750 ms. Apply the user's
  patch to `current`; do not replace it with a render-time stale object.
- **Explicit Save:** `commit(current => next)` captures the intended value before
  awaiting local persistence. Do not compose `await update(...); await save()`:
  later typing may happen during that await. A saved request must survive editor
  unmount and reload independently of the newest unsaved draft.
- **Create:** use a stable client-generated document ID and `{ create: true,
  autoSave: false }`; submit the valid initial document with `commit(() => value)`.
- **Delete:** `remove()` queues a delete against the editor's confirmed baseline.
  It refuses while an earlier outcome is unresolved. Use `status.canRemove` for UI
  eligibility and retain the normal explicit delete action/confirmation.
- **Delivery:** `edit`, `update`, `commit`, `save` and `remove` resolving proves local ownership,
  not server acceptance. Only `status.phase === 'saved'` with the associated confirmed
  state proves the current editor has no outstanding changes. Freshness is separate:
  a cached saved copy is not evidence of a successful current server read.
- **Leaving:** a screen that goes away closes its editor with `close({ flush })`; the React
  layer passes the document's autosave setting. A savable draft — typed inside the autosave
  delay, or a deletion not yet queued — becomes a durable request in the engine's queue before
  the editor closes, and a hidden or departing page (`visibilitychange`, `pagehide`) saves at once.
  Never navigate away expecting a later timer to send anything; never call `dispose()` from a
  screen that had autosave (it drops the last edit). Manual forms and creation pass `flush: false`.
- **Conflict:** show `DataSyncStatus`; `keepLocal` and `acceptRemote` are explicit
  choices. Unknown outcomes cannot be discarded. Remote deletion cannot be changed
  into an update/create of the same generation.
- **Recovery:** use `useRecoveryDiscovery` from the public React facade to discover
  records when the document opens and its delivery changes; discovery does not restore.
  Pass the document's opaque `recoveryIdentity` to fence account/document changes.
  Show each candidate and preview, and call `recover(id)` only for the chosen record.
  Durable ACKs are projected before listing so delivered requests are not offered again.
  Recovery forks the complete
  checkpoint, including the exact pending operation. It does not steal another tab's
  editor or silently apply an old draft.
- **Collections:** `useDataCollection(collection)` returns confirmed snapshots,
  completeness and freshness separately. Tombstones are retained in the result;
  views exclude their rows while still knowing a deletion was confirmed. An offline
  incomplete cache must not be presented as an authoritative empty collection.

Browser composition outside React may use `browser.client.ts`. Type-only imports
from the module are allowed. Runtime imports of internal modules by features are
blocked by `__tests__/architecture/dataEngineBoundary.test.ts`.

## Manual forms during migration

A Save-button form must retain the baseline that the person actually opened.
Passing its local text to a fresh shared document at Save time loses that baseline.
Putting unfinished form text into a shared autosaving document sends it too early.
Use `useDataForm(resource, slot, selection)` inside the same `DataDocumentProvider`
as its parent screen. `begin()` pins the selected fields; `update()` persists a
stage without sending it; `save()` submits that stage; `cancel()` retires only
unsaved typing. `initialData` is the pinned ancestor (possibly an earlier queued
Save, not a server confirmation). The form's own `status`, `error` and `durable`
describe that stage, including remote changes while it is open.

Use its `recoveryIdentity`, `listRecoverable` and `recover` with the public
`useRecoveryDiscovery`. A reload offers unfinished work for explicit recovery;
recovery itself never sends it. An acknowledged or explicitly cancelled Save is
terminal: reopening starts from the current document, and clean inactive manual
records can be compacted. Later unsaved typing must still survive.

`components/council/CouncilOutcomeForm.tsx` is the integrated example. Its tests
exercise the real engine and storage adapters: open A, type B, observe C, Save
conflicts; Cancel sends nothing; restart recovers B only by choice. Every migrated
form needs these behavior checks and a screen-level wiring check. Import gates
alone cannot detect a component that discards its opening ancestor in `useState`.

## Invariants owned here

1. Checkpoint before journal submission; accepted projection before receipt retirement.
2. Unknown delivery retries the same operation ID and immutable payload.
3. An earlier ACK rebases only later local edits; it cannot clear a newer draft.
4. Owner, resource and lifecycle generations fence every asynchronous result.
5. Independent object fields and ID-based items merge; competing changes preserve
   the baseline, local and remote versions for an explicit decision.
6. Deletes leave generation-bearing tombstones and enter the collection change feed. A tombstone
   names its owner in `_dataEngineOwner`, never in the legacy owner field: no legacy
   `where(userId == uid)` query — including the one inside bundles already shipped — may return it.
7. SDK observations are read-only; pending SDK writes are not server confirmations.
8. Collection cursors advance only after all corresponding snapshots are durable.
9. Explicit Retry repairs local persistence offline and refreshes only the requested
   document; background journal retries do not add a second read-polling loop.
10. A draft the domain policy cannot turn into a command ends as a terminal `refused` request
    the person can resolve; only a failure without a policy code (a target unreadable offline)
    stays retryable. A queue that retries the impossible leaves the editor no way out.
11. Closing an editor never strands a savable draft: with `flush` it becomes a durable request
    first (BUG-20260919-engine-leaving-strands-last-edit).

## Verification and migration evidence

Run the architecture gate from `frontend`:

```sh
npx jest --runInBand --coverage=false __tests__/architecture/dataEngineBoundary.test.ts
```

Direct tests live alongside runtime modules and in `__tests__/data-engine`.
The opt-in Firestore Emulator integration suite is documented in its test header;
`test-utils/data-engine-browser/README.md` documents actual browser/IndexedDB adverse
scenarios. These checks are distinct from production activation, PWA app-shell offline
availability, and validation on physical iOS/Android/macOS devices.
