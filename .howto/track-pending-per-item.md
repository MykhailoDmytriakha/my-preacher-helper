when: spinner jumps to another item · loader stops on the wrong row · loader disappears while the request is still running · activeId shared between items · one loading id for a list · per-item loading state · pending state per entity · generatingIds · busyIds · parallel actions on list items · two items generating at once · спиннер прыгает на другой элемент · загрузка на каждом элементе · лоадер пропал раньше времени · состояние загрузки по элементу · два элемента генерируются одновременно · индикатор загрузки

# Track pending state per item

When several items in a list can each start their own async work, keep the pending state keyed by the item's id and clear only the id that finished. A single shared "active id" makes the spinner jump to the last clicked item, and the first request to finish erases the loader of another item that is still running.

## How

- State is a map keyed by entity id, `Record<string, boolean>` or `Set<string>`: `generatingIds` in `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx` (set by `usePlanActions.ts`), `busyIds` in `frontend/app/components/audio-recorder/RecordingDraftBanner.tsx`.
- Start and finish with the functional updater: `setGeneratingIds((prev) => ({ ...prev, [outlinePointId]: true }))`, and in `finally` copy `prev` and remove only that key. An updater that closes over an old copy of the map puts back or wipes the flags of items that changed meanwhile.
- Clear in `finally`, so an early return or a failure does not leave the loader on.
- Each row reads its own flag (`generatingIds[outlinePoint.id]` in `PlanMainLayout.tsx`); "anything running" is derived from the map (`Object.values(generatingIds).some(Boolean)`), not kept as a second variable.
- Guard re-entry per item, not globally: `RecordingDraftBanner` returns early only when `busyIds[draft.id]` is set, so another row can start while this one runs.

## Why

- 2026-04-26: parallel item actions shared one active id; loaders jumped between items, and one completed request cleared another item's running animation.

See also: `.howto/show-an-error-once.md`
