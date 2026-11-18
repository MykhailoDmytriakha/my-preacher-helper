when: notice pops up while preaching · banner over the sermon · toast during a meeting · offline line moves the text · плашка в режиме проповеди · всплывает при проведении группы · ничего не должно выскакивать · тихий экран · quiet screen · useQuietScreen · holdQuietScreen

# Keep a screen quiet

A screen in front of people says nothing but its own: the preaching plan and the group and council conduct screens (owner, 2026-11-17/18). Every notice waits and speaks on the screen after.

## How

- **The holder is one:** `PrivateChrome` (`frontend/app/components/PrivateWorkspace.tsx`) computes `quiet` from the address and calls `useHoldQuietScreen(quiet)`. A new quiet screen is one more predicate there — never a hold inside the page.
- **A notice reads the flag:** `const quiet = useQuietScreen()` from `frontend/app/utils/quietScreen.ts`, and renders nothing while it is true. Readers today: `DataSyncStatus`, `OfflineBanner`, the `OutlineWriteRecovery` alert, `FeedbackDelivery` (holds its toast until the hold ends).
- **Hide words, keep workers:** chrome blocks with background work (recovery prompts, conflict banners) get `hidden={…}`, not conditional rendering — the outbox drain once died with a banner that the preaching screen unmounted.
- **Dialogs a person opened stay:** the flag silences what appears by itself, not a window the person asked for.

## Check

`frontend/__tests__/pages/privateLayout.studyWorkspace.test.tsx` (holder per screen), `frontend/app/data-engine/__tests__/DataSyncStatus.test.tsx` and `frontend/__tests__/components/OfflineBanner.test.tsx` (readers wait, then speak). Live: open the screen, in the page set `navigator.onLine` false and dispatch `offline` — no line appears, `.preaching-content` top does not move.
