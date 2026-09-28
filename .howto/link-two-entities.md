when: link two entities · relationship between documents · one-way link · reverse side · seriesId · seriesPosition · series.items · sermonIds · badge shows series but series page is empty · add sermon to series · series membership · useSeriesMembership · commitSeriesBatch · replayMembershipOutbox · getSeriesForRef · useDataMembership · relation-command-required · sourceNoteIds · useSourceNoteLink · useSermonsBuiltOnNote · applySourceNoteLinkPatch · remove the last link does nothing · first link always refused · updatedAt bumped on siblings · связь двух сущностей · связь между документами · обратная сторона связи · проповедь в серии · добавить проповедь в серию · членство в серии · страница серии пустая · заметка и проповедь · односторонняя связь · studyMaterials.noteIds · material-notes · relation owner · server-derived links · связь материала и заметки · владелец связи · команда отношения

# Link two entities

For engine-owned collections, use the relation owner through the public engine facade: `useDataMembership()` owns series membership and member creation. `studyMaterials.noteIds` owns material-note membership, with the server deriving reverse note links. `Sermon.sourceNoteIds` owns sermon source-note links through the migrated `useSourceNoteLink` hook. Keep one relationship truth and one action for all affected documents.

## How

- Start a series action with `useDataMembership.begin()` before opening the selector; update its pinned stage, then `save()` one atomic command. For a new sermon/group in a series, use `beginCreate`, `openSeries`, `updateCreation` and one `save()`. Delivery, retry and whole-action discard come from the same hook.
- `studyMaterials.noteIds` is the material membership owner. The engine's `material-notes` relation command updates the material and stages reverse `studyNotes.materialIds` links on the server; consumers must not write the reverse field independently (`frontend/app/data-engine/serverRelations.ts`).
- For sermon source notes, `useSourceNoteLink` takes the engine `useDocumentActions().commit` path when sermons are enabled; `sourceNoteIds` remains the stored owner and `useSermonsBuiltOnNote` derives the other view.
- No mirrored copy on the other side. `sermon.seriesId`, `group.seriesId` and `seriesPosition` are deprecated and ignored by readers; nothing sets them any more except cleanup to `null`. The engine refuses them in an ordinary create or update with `relation-command-required` (`frontend/app/data-engine/serverRelations.ts`), and likewise `series.items`, `sermonIds`, `seriesKind`.

## Legacy paths (unconverted collections only)

These compatibility paths are not templates for new features. `frontend/app/services/seriesMembership.client.ts` remains a compatibility writer.

- The legacy membership writer stores transforms (`add` / `remove` / `reorder`). Online: one transaction over every series it touches, reads first, each transform applied to what is stored; a missing target aborts the whole move. Offline, with a signed-in owner, the transforms are queued all-or-nothing in localStorage and `replayMembershipOutbox` replays them one entry at a time through the same transaction. Exception: when that storage refuses, or no one is signed in, it falls back to a Firestore batch of computed arrays (`frontend/app/services/seriesMembership.client.ts`) — that path can overwrite a concurrent membership change, so never copy it as a safe merge. `sermonIds`, `seriesKind` and the `rev.items` counter move in the same write.
- A change that touches two documents (a move between series) lands whole or not at all; never report success for half a link.
- Derived side: `getSeriesForRef(refId, seriesList)` / `buildInSeriesRefIds` over the cached series list; "sermons built on this note" filters the cached `sermonListKey` list by `sourceNoteIds`. A new relation takes the same shape.
- A list-valued link is written through the guarded door (`updateSermon` → `conflictSafeUpdate`) with the revision the editor rendered and a baseline of exactly that one field, captured at open time (`openingContextOf`). Keep `null` (never linked) apart from `[]` (emptied): the guard hashes a missing field as `null`, so an opening `[]` on a never-linked sermon would refuse every first link. Test the list with `Array.isArray`, not truthiness — a writer that skips falsy values makes "remove the last link" a no-op (`frontend/app/services/sermons.client.ts`).
- Publish the result as a patch each owner of a copy merges (`applySourceNoteLinkPatch`), never a whole entity.
- Do not write a no-op: compare with what is stored first (`sameIdSet`). Linkage is index metadata — a membership write touches only series documents, and a sync or repair loop must never rewrite unchanged siblings, or it bumps their `updatedAt` and they look freshly edited.

### When a legacy link goes wrong

- Badge says "series", series page is empty → compare the series document's `items` with its `sermonIds` mirror (`seriesContainsRef` reads both); a sermon's `seriesId` is not evidence. Repair through the membership writer, which rebuilds `items`, `sermonIds` and `seriesKind` together.
- Suites that render a parent break after adding a child that uses React Query → stub the child there as the file already stubs `OptionMenu`, and let the stub echo its props so the wiring stays asserted (`MockSourceNoteChips` in `frontend/__tests__/components/sermon/SermonHeader.test.tsx`).
- A count label shows English in Russian or Ukrainian → add `_few` and `_many` beside `_one` / `_other`.

## Why

- 2026-02-25 / 2026-05-01: `entity.seriesId` and `series.items` were two stores; writing one without the other produced "badge says series, series says empty". Since then `series.items` is the single truth.
- 2026-03-19 / 2026-04-25: unconditional sync writes rewrote unchanged sibling sermons and made them look recently edited.
- 2026-08-16: the note ↔ sermon link already had two dead half-implementations when it was built live; storing only `sourceNoteIds` avoided a third mirrored copy.

See also: `.howto/write-a-document-field.md` · `.howto/clear-a-field-over-the-wire.md` · `.howto/write-in-a-firestore-transaction.md`
