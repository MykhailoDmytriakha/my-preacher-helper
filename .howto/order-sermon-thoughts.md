when: thought order differs between views · order of thoughts · plan order differs from structure · export order · audio order · sermonVisualOrder · getVisualOrderedThoughtsBySection · getSortedThoughts · sermonSorting · thoughtOrdering · canonicalizeStructure · getPreachOrderedThoughtsBySection · section counter shows zero · Manual > Outline > Tags · structure array · thoughtsBySection · ThoughtsBySection · position field · sub-point order · canonical section ids intro/main/conclusion · normalizeStructureTag · tag alias · mainPart · localized section name in logic · порядок мыслей · мысли в разном порядке · порядок в плане и структуре · порядок экспорта · порядок в аудио · счётчик секции ноль · вступление основная часть заключение · порядок подпунктов

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

## Why

- 2026-04-25: section counters that counted only `outlinePointId` showed zero for valid thoughts placed in a section without a point.

See also: .howto/save-several-documents-atomically.md
