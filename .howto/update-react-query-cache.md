when: setQueryData · invalidateQueries · cancelQueries · refetchType none · optimistic update · publish a write to the cache · stale list after save · ghost data after save · flicker after save · old value comes back after save · list and detail disagree · UI jumps on focus · excessive refetch · refetchOnMount · refetchOnWindowFocus · cache key · queryKeys · sermonListKey · sermonDetailKey · owner-scoped key · invent a key inline · isFetching in skeleton · публикация записи · опубликовать запись в кэш · обновить кэш · кэш после сохранения · старое значение возвращается после сохранения · список и карточка расходятся · мигание после сохранения · ключ кэша · оптимистичное обновление · лишние запросы

# Update the React Query cache after a write

Publish a write with `cancelQueries` → `setQueryData` → `invalidateQueries({ refetchType: 'none' })`, for EVERY key that holds the changed document, using keys from `frontend/app/utils/queryKeys.ts`. The reference is `setSermon` in `frontend/app/hooks/useSermon.ts`. On a collection switched to the data engine the screen renders the engine's draft and writes are not published this way (`useEngineSermonSource` has a no-op `setSermon`) — `.howto/use-data-engine-in-a-screen.md`.

## How

- `cancelQueries({ queryKey })` first. A fetch that started before the write would land after your merge and restore the old value, and with `refetchType: 'none'` nothing would come to correct it.
- `setQueryData(key, old => merge(old, patch))`: merge the patch into what the cache holds NOW. Never write back the whole entity the save started from — edits made during the round trip would be undone (`publish` in `frontend/app/hooks/useSermonNoteLinks.ts`).
- `invalidateQueries({ queryKey, refetchType: 'none' })` marks it stale without an immediate refetch: the persisted copy is re-saved with the merged value, and no eventually consistent read flickers the old value back. `setQueryData` alone is the named anti-pattern.
- Every key that holds the document: detail AND list (`sermonDetailKey` + `sermonListKey`), and any batch or derived query built from it. A write that updates one key leaves ghost data in the others and the screen stops being trusted even though the save succeeded.
- Keys come only from `queryKeys.ts` (`sermonDetailKey`, `sermonListKey`, `studyNoteListKey`, `serviceOrderListKey`, `councilListKey`, owner from `resolveOwnerUid`). They are owner-scoped because the cache is persisted to IndexedDB and outlives a sign-out. Never spell a key inline: two spellings are two caches that disagree.
- A skeleton condition never includes `isFetching`: a background refresh is not loading.
- UI jumping or refetching on focus: check the global defaults in `frontend/app/providers/QueryProvider.tsx` (`refetchOnMount: true`, `refetchOnWindowFocus: false`, `staleTime` 30 s) and the wrapper's mode (`.howto/use-server-first-query.md`) before debugging the screen.
- Resumable mutations invalidate their list on success (`registerOfflineMutationDefaults` in `frontend/app/utils/mutationDefaults.ts`).
- Legacy query rows of an engine-owned collection stay in memory only (`shouldPersistLegacyQuery`).

## Why

- 2026-01-18: a global `refetchOnMount: 'always'` refetched on every mount and made focus mode jump; the global default is now `true`.
- 2026-01-18: shared data under different keys was updated in one and left stale in the others; `setQueryData` + invalidation was applied in six places.
- 2026-01-26 / 2026-02-23: invalidating with a refetch after an optimistic write flickered the old value back in an eventually consistent store; `cancelQueries` + `refetchType: 'none'` removed it.
- 2026-03-13: a detail-page write did not invalidate a batch query that the workspace read, and the workspace showed ghost metadata.

See also: `.howto/use-server-first-query.md` · `.howto/compare-local-and-server-copies.md` · `.howto/write-a-document-field.md`
