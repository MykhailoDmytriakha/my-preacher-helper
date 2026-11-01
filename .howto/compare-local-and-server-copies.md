when: which copy is newer · may I replace the stored copy · serverCopyIsNewer · selectReadableCopy · reconcileServerList · readFreshness · stale copy keeps winning · edited elsewhere · changed on another device · useDocumentFreshness · DataFreshnessBanner · markSynced · freshness projection · sermonFreshnessProjection · contentFingerprint · remote change not shown · banner after every own save · freshness unknown · load newer version destroys text · list copy vs detail copy · rev counter · updatedAt fallback · свежесть данных · какая копия новее · локальная копия против серверной · слияние двух копий · изменено на другом устройстве · изменено в другой вкладке · плашка свежести · устаревшая копия побеждает · ревизия · счётчик версий · useDataDocument · useDataCollection · DataSyncStatus · DataCollectionStatus · engine freshness · engine conflict · свежесть движка · состояние синхронизации

# Compare a local copy with the server copy

For a migrated collection, `useDataDocument` and `useDataCollection` own freshness and remote changes. Render `DataSyncStatus` and `DataCollectionStatus`; a screen must not add `useDocumentFreshness` or its projections to an engine consumer. The public contract is `frontend/app/data-engine/README.md`.

## How

- Read `useDataDocument().data` for the editor draft, `confirmed` for the accepted baseline, and `remote` for a candidate held during local intent. Show `DataSyncStatus` with `status`, retry and explicit conflict actions; never silently replace unsaved text.
- Render a collection from `useDataCollection().state.documents`, which includes submitted local work, and show `DataCollectionStatus` for pending or incomplete lists. `snapshots` are confirmed copies, not an editor baseline from list projections.
- A feature that must ask the server before retiring an original uses canonical useRemotePeek({ fresh: true }). It keeps engine owner, visibility and identity checks and opts into a unique HTTP query per read, so an older active worker cannot answer from an earlier exact-URL API cache entry. Default readers keep their existing contract. Never replace a draft with the returned snapshot; failed reads prove neither equality nor absence.
- A note row rendered from the collection may contain queued words. `useStudyNotesEngine().noteDelivery` carries the canonical per-note `pending` evidence beside that value; the editor may show Saved only for its current row with `pending === false` and no private edits. A timestamp or local capture callback is insufficient. Missing/null rows remain unknown; pending work in another note does not hide the current accepted note. An unchanged accepted cached note may retain Saved offline. This display gate does not repair the legacy writer's broader persistence/callback contract.
- Freshness and delivery are separate: an acknowledged local save does not prove the latest server read, and an incomplete offline list is not an authoritative empty list.
- The owner's product model (2026-10-15, `CLAUDE.md` §2) is one person continuing their work across devices. A reliably later action wins within what it changes; late delivery of an earlier action is not a new intent. Record action time separately from local capture and database commit time when extending this mechanism, retaining operation identity, the seen version and predecessors through retry. Do not replace a whole stale document merely because one field was edited later, or guess the order of old copies from two device clocks.
- Current evidence is partial: `types.ts` carries operation identity and dependencies, `commits.ts` carries the baseline and predecessor, and `runtime.ts` assigns `JournalEntry.createdAt` when a prepared command enters the journal. That timestamp is not the original UI action time. `server.ts` stores committed version evidence in the receipt; an explicit action-time/database-commit-time pair is not implemented yet. Inspect these canonical modules before proposing a new history store or claiming chronological delete resolution already works.
- Engine `updatedAt` now records one server acceptance time for each changed live transaction effect (`acceptedResource.server.ts` via `server.ts`); ACK and stored snapshots agree. Bookkeeping-only edits, no-ops and receipt replays do not advance it. This is not an action-time/database-commit-time pair, nor a content priority rule. Resource-document rebase excludes root timestamp metadata and update application leaves it for the accepted-write rule (`protocol.ts`). Generic value merge, including nested authored fields, remains ordinary content.

## Identity across nested plan lists

`protocol.ts:mergeFields` delegates the configured `preparation.exegeticalPlan` tree to
`identityTreeMerge.ts` before merging individual sibling lists. One point ID owns one
place across the whole tree. Own fields, parent and sibling order merge separately:
a move and independent word edit compose; competing homes/order, branch deletion
against a changed branch, or a combined parent cycle retain a whole-tree conflict.
Its local candidate keeps independently merged words and remote-only points. When a
chosen destination was deleted, a locally kept point retains its required local
ancestry instead of being dropped as an orphan; only remote-only additions under
a locally deleted branch may be omitted from that local candidate. The
ordinary `DataSession.keepLocal` and server command path use that same merge, so a
choice must be tested through its actual retried ACK, not only the candidate value.

Missing and empty `children` compare as the same authored branch. Only the configured
child key is traversed; attachment IDs are not plan IDs. Inputs with ambiguous or
preexisting duplicate IDs retain the prior merge fallback: do not silently choose an
old copy to remove. Other trees and coupled thought/scratch placements are separate
contracts; do not register them here without their own integrity and choice matrix.
The module reuses `mergeFields` and the pure `outlineMergeParts.mergeOutlineOrder`;
it adds no action clock, writer, persistence format, or transport. Regression paths:
`planTreeIdentityMerge.test.ts`, `planTreeTwins.test.ts`, `protocol.test.ts`, and
`session.test.ts` under `frontend/app/data-engine/__tests__/`.

## An explicit outline choice

`PlanEditorModal` keeps the real opened outline through a refusal, using `useOutlineConflict` over the shared `usePersistedConflict` store. `utils/outlineChoice.ts:chooseOutlineLocalChanges` chooses only local changes against that ancestor and the shown saved snapshot: fields, location and sibling order are separate; untouched saved words remain, and each point/subpoint identity has one location. This is an explicit decision helper, not the ordinary background merge policy. Its algorithm lives in pure `utils/outlineChoiceCore.ts:chooseOutlineChanges` with an injected field-merge port; `outlineChoice.ts` retains the existing public UI adapter and error export. Engine code can reuse the core without importing the React facade. This extraction changes no choice policy. `mergeOutline` retains that separate role; both use `outlineMergeParts` for identical optional-field normalization and sequence ordering.

A selected value is a pending local choice, not an unanswered question. Preserve it and later typing durably until the exact current capture completes. Board and inline outline edits call shared `utils/outlineCapture.ts` immediately: delaying the public writer call can lose accepted words during route cleanup. The engine owns local persistence and delivery scheduling. The helper tracks only per-editor input ancestry while captures wait; the ordinary engine writer applies it inside its current-draft merge, preserving unseen saved points without treating an earlier own input as a foreign edit. This in-memory ancestry is neither a second stored draft nor proof that disk succeeded. Only the newest capture publishes its result/error to the screen; the base and visible outline advance together when that result arrives. Older responses cannot overwrite newer input. A local capture is not server acceptance. An answered question remains backed up until its exact current capture succeeds, and a departed answer cannot be restored over its newer captured continuation.

An older backup without `baseOutline` has unknown scope; `null` explicitly records an absent ancestor and is different from a missing property. Keep both copies readable. Require opening the saved-structure comparison before the explicit whole-structure replacement. `OutlineChoiceReviewRequiredError` uses the same review path for a valid mixed conversion that cannot fit the two-level structure. Never silently fall back from a scoped choice to replacing the entire old board. A later unknown edit still passes through the ordinary writer and may raise a new question.

Named-document conflict writes keep their own durable backup but publish only into the matching currently displayed document. This storage boundary does not repair a writer whose mutable resource reference targets a different document: inspect the public writer lifetime separately.

Local regression evidence: cases146/148, `PlanEditorKeepMine.engine.test.tsx`, `outlineChoice.test.ts`, `PlanEditorMerge.test.tsx`, `PlanEditorModal.engine.test.tsx`, `sermon/SermonOutline.engineWriter.test.tsx`, `outlineCapture.test.ts`, and `usePersistedConflict.test.tsx`. Genuine compiled-browser loss before the fix and emulator-only close/cold/offline/reconnect checks after it are retained in the local case. Reproduce against emulators using `.howto/run-a-demo-on-the-emulator.md`.

## Previous-version archive review

The archive notice is internal cache maintenance, not another freshness reader. `snapshots.client.ts` publishes owner/resource-only `subscribeSnapshotChanges` signals after an accepted, changed IndexedDB write completes; document and collection readers share that adapter. `LegacyQueryCopies` uses the signal to rerun the existing `retireLegacyEchoes` comparison and reread its local archive. It keeps differing, missing and unreadable copies; accepted comparison choices remain bound to the server fingerprint. The local signal does not cross tabs: visible/focus return rereads their shared IndexedDB. Do not turn this signal into a network query, restore writer, or proof that the server is current.

## Legacy paths (unconverted collections only)

These compatibility paths are not templates for new features.

### Replacing a stored copy

- `serverCopyIsNewer(server, stored)` walks EVERY aggregate counter in `rev` (one counter per independently edited part: core, thoughts, plan…). If the local copy leads in any one, the answer is no: that part holds work the server has not accepted. Without `rev` on both sides it falls back to `updatedAt`; no evidence on either side → keep local; evidence only on the server side → server wins (a copy with no markers is an old snapshot, not fresh work).
- One document: `selectReadableCopy` — a document missing on one side is not evidence, keep whichever exists. A list: `reconcileServerList` — document by document; server-only rows are added, local-only rows kept.
- Users today: `usePrayerDetail`, `useSermonStructureData`, `useSeriesMembership`, `useSermonNoteLinks` (`useSermon` was also a user; removed 2026-10-13); the engine reuses it for snapshots without metadata (`frontend/app/data-engine/snapshotFreshness.ts`). Do not write a second comparison.
- Compare only copies of equal completeness. The trimmed list copy against the full detail copy is not a freshness question: the list copy is a fallback, never a candidate (`frontend/app/hooks/useSermon.ts`). (Legacy path; removed 2026-10-13 — engine screens read the document instead, via `useSermonRead.ts`, `useSermonCoreDataDocument.ts`, `useEngineSermonSource.ts`.)
- A write receipt that reports one counter is compared as a whole copy with only that counter replaced; a bare `{core: n}` makes every other aggregate look like zero (`applySourceNoteLinkPatch`).

### Telling the person

- `useDocumentFreshness` only observes: never writes, never touches React Query, never replaces the editor. States are `fresh` / `stale` / `unknown`; `remote` holds the newer value and is never applied for you. The person decides.
- `known` is what the editor opened with (then what a save confirmed), for this `uid` and `docId` — never the live query cache, which may already hold the newer server value while the screen still shows the old text. Same baseline rule as `frontend/app/utils/changedFields.ts`.
- `known` and `select` go through ONE projection function (`sermonFreshnessProjection`, `planFreshnessProjection`, `frontend/app/utils/serviceOrderFreshness.ts`), compared by `contentFingerprint`. A new field on a watched document goes into the projection, or a remote change to it is invisible (`sourceNotes` was added for that reason).
- Own writes: pending snapshots are skipped by `hasPendingWrites`; after an acknowledged save call `markSynced(value)` with exactly the saved value. Nothing broader may silence the banner.
- Show `unknown` (offline, access denied, listener stopped, silence too long) instead of implying fresh.
- In production every collection that still calls `useDocumentFreshness` (users, serviceOrders, series, studyNotes, prayerRequests, sermons; groups through its legacy editor) is on the engine — the list is baked into the bundle as `NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS` (production chunk, 2026-10-04) — so the hook returns `fresh` without a listener (`useDocumentFreshness.ts:158`, test "stays silent and never subscribes"). BUG-20260915-deleted-elsewhere-may-arrive-as-access-denied was closed as superseded on this path, not disproved: the legacy listener on a deleted document was never tested live, and a REST read of a missing own document answers 403 (2026-09-15) because `ownsExisting` needs an existing document. If the legacy path comes back, expect "access denied" instead of "deleted" and give the read rule a branch for an absent document. On the engine a delete is a tombstone readable through `_dataEngineOwner` (`firestore.rules` `ownsExisting`), and a clean tombstone reads as `deleted` (`data-engine/status.ts`); whether a screen shows it is the screen's job — see BUG-20261004-missing-record-dead-end-screens.
- `DataFreshnessBanner`: pass `onRefresh` only when a refresh cannot touch unsaved text; with `dirty` the action becomes "review". Never reload the page or replace editor state while anything is unsaved; keep both versions until the person resolves them.

### Legacy traps

- "Changed elsewhere" after every own thought → position was compared; thoughts are compared by content, outline and plan by order (`sermonFreshnessProjection`).
- A just-created document shows an old, empty copy for ever → the local copy had no `rev`/`updatedAt` and "keep local" always won; now server evidence beats local silence (BUG-20260815-list-copy-hides-scratch, in `readFreshness.ts`).

## Why

- 2026-07-25: a listener compared the server with a query cache that had already refreshed while the editor still showed its open-time text; reduced selectors, hidden unknown states and a destructive "load newer" turned the safety banner into silence or data loss. Freshness is a proof about what the person is actually seeing.

See also: `.howto/write-a-document-field.md` · `.howto/update-react-query-cache.md` · `.howto/use-data-engine-in-a-screen.md`
