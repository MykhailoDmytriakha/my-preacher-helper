when: write lost after reload · offline edit lost · offline write hangs · await updateDoc never resolves offline · saving spinner stuck until reconnect · persisted mutation · paused mutation · resumePausedMutations · setMutationDefaults · registerOfflineMutationDefaults · mutationFn missing after reload · replay ids and timestamps · duplicate items after replay · WriteSubmission · persistedWrite · queuedMutation · awaitAcceptance · announceIfPersisted · useWriteRecovery · OfflineQueuedError · writeOutbox · replayOutbox · false success toast offline · офлайн · без сети · без интернета · правка пропала после перезагрузки · запись висит без сети · очередь записи · доиграть при появлении сети · дубли после повтора · ложное сообщение об успехе · DataEngine commit queue · useDataForm · submitted intent · durable draft · operation identity · движок данных · сохранённая очередь · черновик формы

# Keep a write across offline and reload

For an engine-owned collection, the DataEngine commit queue keeps a submitted request and its exact identity across editor unmount, reload and offline time. A manual form's unsent typing belongs to `useDataForm` and its durable stage. Use the public hooks in `frontend/app/data-engine/react.client.tsx`; do not add another queue.

## How

- `useDataDocument.update` persists local editing immediately; `commit` or `save` captures a submitted command in the shared queue. Closing an autosaving editor flushes savable typing. A submitted chain can continue after navigation or restart; unresolved branches and unsent manual drafts require explicit recovery.
- `useDataForm.begin/update` pins and durably stores unsent manual typing without sending it; `save` captures the chosen draft. Use its status, recovery identity and `useRecoveryDiscovery` for reload recovery.
- Preserve the operation identity when retrying unknown delivery. A locally completed action proves durable ownership on this device; server acceptance requires the matching acknowledged status and confirmed copy. Render `DataSyncStatus` and collection presentation rather than a false success toast.
- Do not put `recoverableWrite`, React Query paused mutations or a second outbox on an engine feature. Legacy client writers of engine collections refuse with `data-engine-required`.

## Legacy paths (unconverted collections only)

These compatibility paths are not templates for new features. Their contract is `frontend/docs/recoverable-writes.md`.

- Know who owns the write once the person lets go:
  - A React Query mutation offline pauses and is persisted to IndexedDB (only paused and failed ones: `shouldDehydrateMutation` in `frontend/app/providers/QueryProvider.tsx`), then resumed by `resumePausedMutations`. After a reload the `useMutation` closure is gone, so resume is a silent no-op unless `registerOfflineMutationDefaults` has `setMutationDefaults(key, { mutationFn })` for that key. Share the key constants (`GROUP_MUTATION_KEYS`, `PRAYER_MUTATION_KEYS`…) between the hook and the default.
  - A guarded field write (`conflictSafeUpdate`) offline becomes an outbox entry: patch, aggregate, the revision and field values it was built from, in localStorage. `replayOutbox` replays it through the same compare-and-set; if the server moved on, the entry is marked `conflicted` and keeps its text.
  - A plain client-SDK write offline sits in Firestore's own persistent queue.
- Variables must replay on their own: no closure state. Mint ids with `newClientId()` (`frontend/app/utils/clientId.ts`) and action-time timestamps BEFORE `mutate()` and put them in the variables — `addUpdate` in `frontend/app/hooks/usePrayerRequests.ts` carries `updateId` and `createdAt`. Minted inside the mutation function, a resumed or retried run makes new children (duplicates) and stamps replay time over action time. `expectedRevision` rides in the variables too; a replay that drops it is an unguarded overwrite.
- A create carries its client id, so a replayed create upserts the same document instead of a second one.
- Return right after the optimistic cache update. Never `await` the SDK write on an interactive path: offline it waits for the server acknowledgement and never resolves, so a modal, select or dropdown stays "saving" until reconnect (`useSeriesMembership`). The editor awaits acceptance, not persistence: `awaitAcceptance(submission, onLateFailure)`. `queuedMutation` accepts once the queue owns the write (after one tick, so an already failed write still rejects); `persistedWrite` accepts when the server has it and treats `OfflineQueuedError` as `queued`.
- Say "saved" only through `announceIfPersisted`; `queued` and `skipped` stay silent by construction.
- A refusal that arrives later is reported by the hook's `useWriteRecovery` descriptor, which carries the person's text. Its `owns` check is mandatory: failed mutations persist in a cache shared by every account on the device.
- Retry intent, local state and conflict metadata survive together. A retry kept in a component ref or closure dies with a reload, redirect or auth bounce.
- Residual risk: an online mutation still in flight is not persisted, so closing the tab at that moment loses it. For expensive text add a durable draft (`frontend/app/utils/durableDraft.ts`).

## Why

- 2026-03-16: optimistic records were persisted but retries lived in component refs; a reload, redirect or auth bounce stranded local edits for good.
- 2026-06-14: after moving to Firestore's native offline queue, handlers still awaited `updateDoc`-backed promises and controls hung in "saving" until reconnect.
- 2026-06-14: ids and timestamps minted inside the mutation function duplicated children and rewrote history with replay time on resume.

See also: `.howto/write-a-document-field.md` · `.howto/read-while-offline.md` · `.howto/update-react-query-cache.md`
