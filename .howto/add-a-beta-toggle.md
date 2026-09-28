when: beta toggle · feature toggle in settings · add a setting · user setting flag · per-user feature flag · UserSettings · enableStructurePreview · SETTINGS_WRITABLE_FIELDS · useUserSettings · SettingsToggleRow · SETTINGS_MUTATION_KEYS · toggle does not save · toggle snaps back · setting lost after reload · settings/user page · бета-переключатель · переключатель в настройках · добавить настройку · флаг пользователя · настройка не сохраняется · переключатель отскакивает назад · настройка пропала после перезагрузки

# Add a beta toggle to settings

A per-user feature flag is a boolean field on the `users/{uid}` settings document. It passes through model → engine schema → shared settings hook → toggle component → settings page; copy `enableStructurePreview` end to end. Toggles render on `frontend/app/(pages)/(private)/settings/user/page.tsx` (`/settings` itself only redirects to a section).

## How

1. `UserSettings` in `frontend/app/models/models.ts`: add `enableX?: boolean` with a one-line comment.
2. Add the field to `users` in `frontend/app/data-engine/protocol.ts` and `resourceSchemas.ts`. Keep identity and server-managed fields out of writable settings.
3. In `frontend/app/hooks/useUserSettings.ts`, add the engine updater using the existing shared editor patch helper. Do not mount a second editor or add another offline queue.
4. Keep the flag-off compatibility path complete: updater in `userSettings.service.ts` (the authenticated route derives allowed fields from the engine policy), mutation key/default in `mutationDefaults.ts`, and the legacy mutation/recovery hook. Add its field/key to legacy settings archival and its recovery label in all three locales. This path stays disabled with `users` on the engine.
5. Build the component on `SettingsToggleRow`, copying `StructurePreviewToggle.tsx`: use `awaitSettingsWrite` for local acceptance and respect `readOnly`/busy. Delivery and conflicts belong to the global `UserSettingsSyncStatus`; acceptance alone does not mean the server saved it.
6. Render it in `settings/user/page.tsx`; add the title/description to all three locales. Extend the legacy fingerprint only for flag-off compatibility; enabled settings use the engine's freshness mechanism.
7. Add a row to `FeatureToggle.contract.test.tsx` and cover the new field in the engine hook test where behavior differs.
8. Read `settings?.enableX` through `useUserSettings`. The private workspace provider shares settings across routes and nested document providers.

## Traps

- A rejected field points to the shared `users` writable policy/schema or the operation-specific allowlist in `serverEdit.server.ts`. Check both before changing the UI.
- Never put identity or server-managed fields (`paidTier`, `promotion`, `usage`, `role`, `referredBy`) in the writable policy; the engine and authenticated adapter enforce that boundary.
- A field missing from the engine schema is rejected. A fulfilled local commit can still be waiting for server delivery: never show it as server-confirmed or restart a legacy mutation to replay it.

## Why

- 2026-02-24: the chain was first written down as five files. The current code needs the extra steps above (writable list, offline replay, recovery, freshness, contract test), so copy an existing toggle rather than the bare list.
