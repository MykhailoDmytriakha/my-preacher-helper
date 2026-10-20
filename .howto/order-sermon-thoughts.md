when: thought order differs between views · order of thoughts · plan order differs from structure · export order · audio order · sermonVisualOrder · getVisualOrderedThoughtsBySection · getSortedThoughts · sermonSorting · thoughtOrdering · canonicalizeStructure · getPreachOrderedThoughtsBySection · section counter shows zero · Manual > Outline > Tags · structure array · thoughtsBySection · ThoughtsBySection · position field · sub-point order · canonical section ids intro/main/conclusion · normalizeStructureTag · tag alias · mainPart · localized section name in logic · порядок мыслей · мысли в разном порядке · порядок в плане и структуре · порядок экспорта · порядок в аудио · счётчик секции ноль · вступление основная часть заключение · порядок подпунктов · thought jumps to ambiguous after edit · edited thought leaves its column · мысль уезжает в нераспределённые после правки · мысль выпадает из колонки

# Order sermon thoughts

Every user-facing thought order — Structure, Plan, audio raw/optimized previews, TXT and other exports — comes from `frontend/app/utils/sermonVisualOrder.ts` (`getVisualOrderedThoughtsBySection`, or the wrapper `getSortedThoughts` in `frontend/app/utils/sermonSorting.ts`). Section membership and section counts use the same resolution in `frontend/app/utils/thoughtOrdering.ts`.

## How

- Which section a thought belongs to: its outline point (`outlinePointId`) first, then the stored `structure` (older alias `thoughtsBySection`), then section tags, else `ambiguous`. A tag decides only when the thought carries exactly one distinct structure tag.
- Order inside a section (`canonicalizeStructure`): outline points in outline order group their thoughts; inside a point, and among section thoughts without a point, the `structure` array of IDs is the order; thoughts it does not list follow, by date. Do not re-sort a section by the thoughts' `position` fields.
- `getVisualOrderedThoughtsBySection` then interleaves each point's direct thoughts with its sub-points by `position` (`buildSubPointRenderableEntries` in `frontend/app/utils/subPoints.ts`). This last step is what callers of low-level `thoughtOrdering` miss: export or audio code calling it directly for display order reorders ideas against the Plan page.
- Section counters use the same path — `SermonOutline` counts `getPreachOrderedThoughtsBySection(..., { includeOrphans: true })`. Counting only `outlinePointId` gives false zeroes for thoughts placed by `structure` or by tag.
- Logic uses canonical IDs: structure-tag IDs `intro` / `main` / `conclusion` (`CanonicalStructureId`) and section keys `introduction` / `main` / `conclusion` / `ambiguous`. Localized names are for display only (`getTranslationKeyForTag`).
- Tag aliases: `normalizeStructureTag` (`frontend/app/utils/structureTags.ts`, re-exported by `tagUtils.ts`) trims, collapses spaces, lowercases, then looks up `STRUCTURE_ALIAS_TO_CANONICAL`. Add every new variant — camelCase such as `mainPart`, a localized name — as its lowercased form, or it never matches. Section keys go through `normalizeVisualSectionKey` (`mainPart` → `main`).
- Writers keep the order consistent: `insertThoughtIdInStructure` / `removeThoughtIdFromStructure`; the engine transforms in `frontend/app/utils/sermonThoughtEdits.ts` write `structure` and `thoughtsBySection` together.
- An edit reads the same order. `patchSermonThought` moves a thought only when the edit names another section — an outline point there, or a section tag the edit itself changed; a change of words or leaving a point keeps it where the person put it. A board drag stores the column in `structure` only and clears section tags, so an edit that re-derived the section from tags alone sent every dragged thought under review (2026-10-13).


## Scope a placement write while AI suggestions are visible

The structure board may display AI suggestions that have not been accepted. Its `containers` are a preview, not the stored arrangement. Every item-local action (drag, create, delete, move, audio-created thought, or one AI decision) calls `StructureWriter.updateStructure` with `StructureWriteOptions.thoughtIds` naming only its own thoughts. The engine writer uses `completeStoredThoughtPlacement` from `thoughtOrdering.ts`: it retains every stored placement and fills only missing IDs with the existing `canonicalizeStructure` fallback. It then applies `applyScopedThoughtPlacement`; it preserves every unselected thought's stored section and relative order. An ID absent from a proposal is not Delete: a just-created thought may not have reached the board. Domain deletion owns removal.

For an individual AI review decision, include selected assignment changes in `thoughtUpdates`, so its assignment and order share one `document.update` capture. For these item-local board actions, pass `thoughtIds`; explicit whole-board acceptance may omit it. The older `usePersistence` compatibility seam still accepts unscoped structure saves: it is not a review-decision boundary and must not receive an AI preview for an item-local action. Keep `structure` and `thoughtsBySection` identical.

Review closes only after the public writer promise resolves at durable local capture. A refusal leaves the selected proposal and retry controls available. `structure/utils/aiReviewPlacement.ts` advances the cancellation baseline only after a captured decision, preserving already accepted/manual placements when the rest are rejected. Native controls cover individual keep/reject, refusal followed by retry or reject, create/delete/move/drag, reconnect replay, and explicit acceptance of remaining proposals; provider quality and recording hardware require their own checks.

## Why

- 2026-04-25: section counters that counted only `outlinePointId` showed zero for valid thoughts placed in a section without a point.

See also: .howto/save-several-documents-atomically.md
