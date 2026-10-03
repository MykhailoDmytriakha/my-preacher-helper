when: read owner's documents · owner list · readOwnerList · readOwnerDocument · readOwnerListFromServer · /api/owner-list · OWNER_COLLECTIONS · Unknown collection · device waits forever · list never loads · skeleton forever on iPad · getDocs never resolves · Firestore silent · second road · SDK deadline · isSilentReadError · accountChangedError · bare getDocs · чтение документов владельца · список не грузится · вечный скелетон · бесконечная загрузка на iPad · Firestore молчит · запасной путь через сервер · дедлайн чтения · useDataDocument · useDataCollection · readOnly · copySource · readOnlyReason · deviceStorage · DataCollectionStatus · чтение через движок · копия только для чтения · хранилище устройства молчит

# Read the owner's documents

For an engine-owned collection, read through `useDataDocument` or `useDataCollection` in `frontend/app/data-engine/react.client.tsx`. If device storage is silent, the facade can offer server or device content for reading while the durable editor opens. Show the available copy and disable edits until the editor is ready; an absent `editor` alone must not keep a readable page on a skeleton.

## How

- For a document, opt into `{ readOnlyCopy: true }` when the screen can display a copy while its editor waits. Render `data` when available and use `readOnly`, `copySource` and `readOnlyReason` to explain and enforce the read-only state. Never turn that copy into an editable local draft or replay actions later.
- `useDataCollection` offers a read-only server/device list copy while list storage is silent. Render `state.documents` with `DataCollectionStatus` and disable mutations when `readOnly` is true; a copy is not proof of server completeness or saved intent.
- `frontend/app/utils/deviceStorage.ts` watches bounded storage reads, records silence diagnostics and lets read gates stop waiting. It does not cancel or falsely fail an indeterminate write. The normal editor replaces the copy when storage answers.

## Legacy paths (unconverted collections only)

These compatibility readers are not templates for new features. `readOwnerList` and `readOwnerDocument` live in `frontend/app/services/ownerListRead.client.ts`.

- Shape: `readOwnerList(collection, owner, viaSdk, hydrate)`. The caller keeps its own SDK query and its own shaping of raw documents (`hydrate`), e.g. `getAllSeriesViaClient` in `frontend/app/services/series.service.ts`.
- Online: the SDK gets 2.5 s. If it times out or fails with a "no answer" code (`isSilentReadError`: unavailable, deadline-exceeded, internal, unknown, cancelled), the HTTPS read starts and both race — the first answer wins; the SDK read is overtaken, not abandoned. It fails only when both fail, and the whole read is bounded at 9 s.
- A refusal such as permission-denied is an answer: it is thrown, not asked again of the other road.
- Offline: SDK only (it answers from the local replica), 8 s deadline.
- Whose list is decided by who asked: if the signed-in account changes during the read, it throws `accountChangedError()` rather than file one account's documents under another's cache key.
- The route serves ONLY collections in `OWNER_COLLECTIONS` (sermons, prayerRequests, planTemplates, serviceOrders, councils, series, groups, studyNotes); any other answers 400 "Unknown collection", which means that collection has no second road at all. It follows every page to the end (a half list is never returned; past 5000 documents it refuses with 507) and skips engine tombstones.
- One document has no route of its own on purpose: `readOwnerDocument` takes it out of the owner list rather than opening a second door to guard. Sermons are the exception: `readSermonFromServer` (`frontend/app/services/sermonReadFallback.client.ts`) uses the existing `/api/sermons/[id]`.
- Not yet wired: tags (`getTagsViaClient` in `frontend/app/services/tag.service.ts` is a bare `getDocs`).

## Why

- 2026-09-06: on the owner's iPad the SDK delivered zero server snapshots while the HTTPS road answered in 205 ms on the same device; `getDocs` neither resolved nor threw, so the screen showed a heading over a skeleton.
- Until 2026-09-16 series and groups were missing from `OWNER_COLLECTIONS`, so the series screen had no second road and stayed a skeleton on that iPad.
- 2026-10-02: a read-only copy must keep its screen, not swap in a bare reader — the group page and the group meeting screen did, and the owner could neither read the group nor run the meeting for 45 minutes. A meeting writes nothing while it runs, so the conduct screen runs on the copy (`groups/[id]/conduct/page.tsx`). The reason is said once, by `DeviceStorageNotice`; a screen repeats it only when it covers that banner (a modal, a full-screen overlay).
- 2026-10-02: aborting the engine's in-flight transactions on `pagehide persisted` and replaying them on `pageshow` was built and rejected (Codex review, confirmed by runs): replay reverses the order of writes, an idb-keyval `update` aborted before its first read never settles, and an evicted page loses a write Chrome would have finished. Transaction atomicity gives no ordering. Evidence and the open direction: `BUG-20260927-engine-open-hangs-on-silent-device-storage`.

See also: `.howto/read-while-offline.md` · `.howto/use-server-first-query.md`
