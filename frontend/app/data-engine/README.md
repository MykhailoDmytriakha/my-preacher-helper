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
The engine automatically continues one unambiguous **submitted** chain when a new
editor opens that resource. This covers queued creation and updates after navigation
or restart. Later unsent typing remains a separate recovery choice. Competing
submitted branches are never silently selected or combined.

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
- **Collections:** `useDataCollection(collection)` returns confirmed `snapshots`
  and read-only presentation `documents` separately. Render rows from `documents`:
  they include submitted local work and carry `pending`, `needsAttention` and
  `deleting` flags. Never use these values as a confirmed editor baseline.
  `DataCollectionStatus` is the shared list status component. A pending deletion
  stays addressable until ACK, including after refusal. An ACK bridges feed lag
  without upgrading collection completeness or freshness. Tombstones remain in
  the result; views exclude rows whose value is null. An offline
  incomplete cache must not be presented as an authoritative empty collection.
  While the server says `legacyOpen`, one shared, lifecycle-bounded collection
  sweep also discovers old writers that do not publish feed events. Closure stops
  that sweep. Cost and retention constraints are in
  `docs/architecture/data-engine-operations.md` at the repository root.

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
recovery itself never sends it. Discovery and direct recovery both require the same
action slot and field selection; sharing fields does not make opposite actions interchangeable. The fourth argument
`same-selection` is an explicit compatibility policy for equivalent creation openings
with unique slots (see `EngineThoughtModal`). Do not use it for opposite actions. An acknowledged or explicitly cancelled Save is
terminal: reopening starts from the current document, and clean inactive manual
records can be compacted. Later unsaved typing must still survive.

A clean active form preserves the document's queued/unknown/conflict/refused status;
it must not relabel an unresolved Save as a saved or merely stale form. Expose
`keepLocal` and `acceptRemote` from the same hook to resolve terminal delivery and
reopen the form from the chosen version. Keeping local submits that explicit choice.
For a known conflict/refusal, Keep local can include durable staged corrections;
ordinary Save refuses to create a successor of the failed request. Corrections are
suspended on disk until the replacement request is durable, so interrupted resolution
remains recoverable. Accept remote cannot discard unsent form input. Changes outside
the form's selected fields must be saved/cancelled or resolved through their owner first. Guards run inside the controller queue before and after
asynchronous retirement, so concurrent typing remains durable.

`components/council/CouncilOutcomeForm.tsx` is the integrated example. Its tests
exercise the real engine and storage adapters: open A, type B, observe C, Save
conflicts; Cancel sends nothing; restart recovers B only by choice. Every migrated
form needs these behavior checks and a screen-level wiring check.
`EngineEditSermonModal` is the metadata/date example: it pins the selected planned
row identity, persists all typed fields through the manual scope, and saves metadata
plus dates as one document request. Series membership remains its own pinned action
with separate delivery; metadata retry reuses that action's captured identity. Import gates
alone cannot detect a component that discards its opening ancestor in `useState`.

`EnginePreachDateModal` owns date add/edit/delete and mark/unmark actions. Its
selection includes both `preachDates` and the legacy `isPreached` fallback, so Save
captures one document command. `preachDateForm.ts` contains only domain transforms;
ID-based merge, delivery and recovery stay in the engine. A recovered mark uses the
changed preached row's durable ID, never a newly computed nearest date or a sibling
whose legacy status was only normalized. Unmark affects opening rows; independently
added remote dates are retained. Readers use `getEffectiveIsPreached`, because the
merged date statuses are authoritative over the legacy fallback flag.
`PreachDateModal` requires `sermonId` and routes enabled collections to this form;
calendar, history and menu wiring tests must prove legacy writers are not called.

`EngineOutlineModal` is the outline example: selected fields include the outline,
thoughts and placement aliases, because hierarchy edits affect all of them. The pure
`replaceSermonOutline` transform follows IDs through move/nest/promotion/delete; the
form pins the ancestor and owns persistence. `OutlineBoard.directText` emits every
keystroke into that form, while one outer Save submits the complete action. The board
itself owns no transport or conflict rules. A pending AI proposal needs the same
opening discipline; do not apply its old full outline to a newly read document.

Use `form.propose(async source => next)` for asynchronous proposals. The engine
waits for the captured source to be durable before calling the producer, and rejects
late output after another edit/proposal, cancellation, owner change or closure.
The React facade aborts staging when its form unmounts; it does not promise to cancel
an already running external request. Successful output persists only a selected-field
stage. It never sends a document command or changes the opening ancestor.

`EngineOutlineModal` with `withScratch` is the example: manual placement and AI
output stage outline, dependent thought links and scratch consumption together.
Close retains the draft; Cancel discards unsent intent; Apply submits one action.
The compose API optionally checks `scratchComposeSource` (title, verse and selected
note contents/order) against the repository read before calling AI. Legacy callers
remain compatible. At Apply, `scratchConsumptionConflicts` checks consumed source
notes in the same server transaction as the outline merge. A changed or missing
source conflicts the whole action; independent new notes survive. Explicit Keep
local/Accept remote use the existing shared resolution path. Immutable receipts
make replay return the original decision, even after the source has changed again.

## Trusted server writers

Transcription, AI results and audio are computed on the server and stored by the server, so a
paid result survives the person leaving the screen. On a legacy document these routes keep their
legacy write. On an engine-owned document that write is refused (426), so they go through
`serverEdit.server.ts` instead: `writeOwnedDocument({ owner, resource, legacy, engine })` tries the
legacy road first (it re-reads the marker inside its own transaction) and on refusal sends the
same change as an ordinary update command through `processCommand`. Revision, feed and receipt
move exactly as for a browser save, and an open editor merges the result like any remote edit.

The `engine` argument is a function of the CURRENT document, never a value computed from an
earlier read: a competing edit of the same field makes it run again on the newer copy (three
attempts). Use the editor's own pure transforms (`addSermonThought`), so there is one rule.
`updateOwnedDocument` lays a legacy flat patch (`parent.child` keys) over the current copy and
leaves `rev` counters to the engine. Routes check early with `assertServerWritable` (an engine
document passes only where its collection is served) and answer failures with
`serverEditResponse`. A full replacement of what the person wrote (a sorted structure, a
generated plan over a manual one) is not a server write: it is a reviewed proposal through the
editor's form. Callers are the reviewed legacy-boundary routes only
(`__tests__/architecture/firestoreBoundary.ts`).

Legacy React Query rows of an engine-owned collection are session-only
(`shouldPersistLegacyQuery`): persisting them would make the next start archive a fresh read as
an unsaved copy from the previous version.

## Preserving previous clients' input

`DataEngineMigrationGate` mounts before `QueryProvider` can hydrate, expire or
replace its persisted cache. For councils and groups it archives owner-scoped legacy
query copies in the engine database. Group paused/error mutation payloads are
preserved too, including fields no longer present in an optimistic query row.
Old ID-only operations without provable ownership are retained in quarantine,
never assigned to the next signed-in account. Distinct contents remain separate; repeated
startup is idempotent. A failed archive keeps the original cache untouched and
holds workspace startup behind an explicit Retry. `LegacyDataRecoveryNotice`
exposes preview/export to the current owner only, without inventing a confirmed
ancestor or submitting any copy. These may be ordinary stale cache entries, not
necessarily unsaved changes, so the UI says that explicitly.

This protects input present at startup. It cannot recover text an old bundle never
persisted or already overwrote. Protective Firestore rules must be deployed before
the first engine write; whole-collection legacy closure remains a separate final
step. See the migration log for the ordered rollout and its remaining device gates.

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

## Series membership actions

Use `useDataMembership()` for assign/remove/reorder. Call `begin()` **before**
opening the selector, confirmation, or drag session: this pins the displayed series
and their exact submitted predecessors. `update(action)` persists an unsent stage;
`save()` freezes and captures one complete action. Do not open a new stage inside
an old form's final Save callback, and do not build a move from two document saves.

`delivery` reports the whole action, separately from local stage `phase` and
`durable`. `retry()` resumes frozen capture or replays the same identity;
`discard()` is permitted only for proven failed delivery and retires the whole
chain while preserving subsequent metadata edits. Use `delivery.canDiscard` for
presentation; the engine enforces the same rule again. Unknown delivery must be
retried, not replaced. A participant's document Keep Local/Accept Remote cannot
resolve an atomic action.

`dismiss()` preserves unsent work. `listRecoverable()` and `recover(scopeId)`
explicitly reopen it; recovery alone never submits. `cancel()` cancels an unsent
stage only. Never implement domain-owned journals or read a fresh baseline at
Save time. Series UI migration is still in progress; the public API being available
is not authorization to enable the collection in production.


The series detail is an example consumer: `EngineEditSeriesModal` owns a pinned
manual form; `SeriesMembershipDialog` owns one complete membership stage. Render
pending membership from the engine collection projection, never by replacing an
open document draft with another scope's payload. `DataMembershipStatus` exposes
whole-action retry/discard. `recoveryIdentity` and `recoveryVersion` feed the shared
`useRecoveryDiscovery` hook, including when no action dialog is mounted.

Mount `SeriesMembershipRecovery` once in the private workspace so closed stages
remain discoverable after navigation. `listRecoverable({ closedOnly: true })`
omits stages held, opening, or finishing release in this engine. The React hook
claims a recovered stage exclusively within its engine; a second dialog cannot
take over the same scope. This is not a cross-tab lock: durable storage still
arbitrates concurrent runtime changes. Account changes fence discovery and claims.
Selectors on group details and sermon menus reuse `SeriesMembershipDialog` with
`mode="target"`; its choices come from the pinned stage, not a refreshed baseline.
The existing-sermon form uses `useEngineSeriesField`, a presentation adapter over
the same stage. An empty complete series list is valid; selecting an uncaptured
target is always refused. Metadata and membership currently have separate delivery
outcomes, and retrying metadata must reuse any already captured membership action.

For a new sermon/group, `beginCreate(collection, initialValue, requestedSeriesId?)` durably allocates its
identity without reading any collection. `creation` exposes that resource and its
current draft. `updateCreation(updater)` persists typing without sending. Only
`openSeries()` reads and pins the optional destination catalog; show selection
controls after `creation.seriesOpened` is true. Assign only the new typed member
through `update`, or use `update(null)` for standalone creation. `save()` validates
the complete draft before freezing, then captures the new document and selected
destination atomically. Recovery/retry keeps the original ID and capture identity.

For a preset series, the stage stores `requestedSeriesId` before the catalog read.
Save is blocked until `openSeries` pins and selects that target, or explicit
`update(null)` clears the requirement. Missing targets/read failures keep the preset
through restart; they never silently create outside the intended series.

Creation scopes use a separate durable range so older membership-only dialogs
cannot recover half of their intent. `EngineCreateSermonModal` and workspace recovery
are example consumers. `AddSermonModal` selects this form for enabled sermons and
never invokes its legacy write callbacks; the engine series picker passes a durable
preset. `useSermonsDataCollection` supplies dashboard/list/calendar reads and submitted
creation immediately, with `DataCollectionStatus` for pending/incomplete lists.
Existing sermon editors and other writers still require migration; creation availability
does not authorize activation. Old dashboard mutation inputs are archived before
query hydration and refused before service replay under the sermon switch.

Sermon thought forms use `components/thought/EngineThoughtModal.tsx`: fixed child
identity, pinned manual ancestry and atomic thought/placement edits. Pure domain
transforms are in `utils/sermonThoughtEdits.ts`; no transport or merge lives there.
`sermonIntegrity.ts` checks the final merged document for new dangling point/subpoint
references, missing thoughts and duplicate placements. Existing untouched defects
remain repairable. Outline writers must update affected assignments in the same command.

A manual form exposes `openingData` separately from `initialData` (last saved intent).
`openingSelection` remains unchanged across Save/recovery until an explicit fresh
opening. Embedded creation uses it to retain its own child identity after refusal.
Older already-saved scopes lacking that evidence expose `openingData: null`; features
that require an origin must preserve/export their text rather than infer an identity.
