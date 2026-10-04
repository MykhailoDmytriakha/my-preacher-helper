when: which copy is newer · may I replace the stored copy · serverCopyIsNewer · selectReadableCopy · reconcileServerList · readFreshness · stale copy keeps winning · edited elsewhere · changed on another device · useDocumentFreshness · DataFreshnessBanner · markSynced · freshness projection · sermonFreshnessProjection · contentFingerprint · remote change not shown · banner after every own save · freshness unknown · load newer version destroys text · list copy vs detail copy · rev counter · updatedAt fallback · свежесть данных · какая копия новее · локальная копия против серверной · слияние двух копий · изменено на другом устройстве · изменено в другой вкладке · плашка свежести · устаревшая копия побеждает · ревизия · счётчик версий · useDataDocument · useDataCollection · DataSyncStatus · DataCollectionStatus · engine freshness · engine conflict · свежесть движка · состояние синхронизации

# Compare a local copy with the server copy

For a migrated collection, `useDataDocument` and `useDataCollection` own freshness and remote changes. Render `DataSyncStatus` and `DataCollectionStatus`; a screen must not add `useDocumentFreshness` or its projections to an engine consumer. The public contract is `frontend/app/data-engine/README.md`.

## How

- Read `useDataDocument().data` for the editor draft, `confirmed` for the accepted baseline, and `remote` for a candidate held during local intent. Show `DataSyncStatus` with `status`, retry and explicit conflict actions; never silently replace unsaved text.
- Render a collection from `useDataCollection().state.documents`, which includes submitted local work, and show `DataCollectionStatus` for pending or incomplete lists. `snapshots` are confirmed copies, not an editor baseline from list projections.
- Freshness and delivery are separate: an acknowledged local save does not prove the latest server read, and an incomplete offline list is not an authoritative empty list.

## Legacy paths (unconverted collections only)

These compatibility paths are not templates for new features.

### Replacing a stored copy

- `serverCopyIsNewer(server, stored)` walks EVERY aggregate counter in `rev` (one counter per independently edited part: core, thoughts, plan…). If the local copy leads in any one, the answer is no: that part holds work the server has not accepted. Without `rev` on both sides it falls back to `updatedAt`; no evidence on either side → keep local; evidence only on the server side → server wins (a copy with no markers is an old snapshot, not fresh work).
- One document: `selectReadableCopy` — a document missing on one side is not evidence, keep whichever exists. A list: `reconcileServerList` — document by document; server-only rows are added, local-only rows kept.
- Users today: `useSermon`, `usePrayerDetail`, `useSermonStructureData`, `useSeriesMembership`, `useSermonNoteLinks`; the engine reuses it for snapshots without metadata (`frontend/app/data-engine/snapshotFreshness.ts`). Do not write a second comparison.
- Compare only copies of equal completeness. The trimmed list copy against the full detail copy is not a freshness question: the list copy is a fallback, never a candidate (`frontend/app/hooks/useSermon.ts`).
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
