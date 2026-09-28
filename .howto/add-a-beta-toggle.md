when: beta toggle · feature toggle in settings · add a setting · user setting flag · per-user feature flag · UserSettings · enableStructurePreview · SETTINGS_WRITABLE_FIELDS · useUserSettings · SettingsToggleRow · SETTINGS_MUTATION_KEYS · toggle does not save · toggle snaps back · setting lost after reload · settings/user page · бета-переключатель · переключатель в настройках · добавить настройку · флаг пользователя · настройка не сохраняется · переключатель отскакивает назад · настройка пропала после перезагрузки

# Add a beta toggle to settings

A per-user feature flag is a boolean field on the `users/{uid}` settings document. It passes through model → service → hook → toggle component → settings page; copy `enableStructurePreview` end to end. Toggles render on `frontend/app/(pages)/(private)/settings/user/page.tsx` (`/settings` itself only redirects to a section).

## How

1. `UserSettings` in `frontend/app/models/models.ts`: add `enableX?: boolean` with a one-line comment.
2. `frontend/app/services/userSettings.service.ts`: add the name to `SETTINGS_WRITABLE_FIELDS`, and an `updateXAccess(userId, enabled)` that calls `updateUserSettingsViaClient`.
3. `frontend/app/utils/mutationDefaults.ts`: a key in `SETTINGS_MUTATION_KEYS` plus a `setMutationDefaults` entry, so a toggle flipped offline survives a reload and replays on reconnect.
4. `frontend/app/hooks/useUserSettings.ts`: a `useMutation` with that key and `onMutate` calling `updateCachedSettings` (instant flip, revert on error), a `useSettingRecovery` line, and the returned updater wrapped in `guarded(...)`.
5. A component in `frontend/app/components/settings/` built on `SettingsToggleRow`, copied from `StructurePreviewToggle.tsx`: `await awaitAcceptance(update(newValue), reportFailure)`; on failure only restore the switch, since the message comes from the shared recovery toast.
6. Render it in `settings/user/page.tsx`; add `settings.<key>.title` and `.description` to all three locales; add the field to the freshness fingerprint in `settings/layout.tsx`, so a change made on another device shows up.
7. Add a row to `frontend/__tests__/components/settings/FeatureToggle.contract.test.tsx`.
8. Read the flag where the feature lives: `settings?.enableX` from `useUserSettings` (see `enableStructurePreview` in `sermons/[id]/page.tsx`).

## Traps

- The toggle flips, then the value is gone after reload: the field is missing from `SETTINGS_WRITABLE_FIELDS`. The writer copies only listed fields and returns silently when nothing is left, so no error appears.
- Never put identity or server-managed fields (`paidTier`, `promotion`, `usage`, `role`, `referredBy`) in that list; `frontend/firestore.rules` refuses them from the client.
- The data engine lists the same user fields (`users` in `frontend/app/data-engine/protocol.ts`, which become its writable fields, and in `resourceSchemas.ts`). `users` stays on the legacy road by decision (`frontend/app/data-engine/README.md`); the lists match field for field today, so add the new field there too.

## Why

- 2026-02-24: the chain was first written down as five files. The current code needs the extra steps above (writable list, offline replay, recovery, freshness, contract test), so copy an existing toggle rather than the bare list.
