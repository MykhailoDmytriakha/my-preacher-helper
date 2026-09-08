# Refactoring pilots: tests, settings mutations and settings UI

Baseline: `814461fd`; working tree contained only the untracked refactoring plan. Node v24.4.1, existing dependencies and lockfile retained. No commit or deployment performed.

## Stage 1 result

| Area | Before | After |
|---|---:|---:|
| Settings hook | 253 lines | 225 lines |
| Settings tests | 215 lines | 182 lines |
| Search tests | 2 files / 94 lines | 1 file / 57 lines |
| Full Jest suites | 565 | 564 |
| Full Jest cases | 5,322 | 5,338 |
| Global line coverage | 90.89% | 90.93% |
| Settings hook line coverage | 97.23% | 99.55% |
| Search line / branch coverage | 100% / 100% | 100% / 100% |

Case count rose because a compact operation table now checks each setting's service, patch, queue key and refusal. Repeated code and independently maintained rules decreased; unique requirements were retained. No runtime speed improvement is claimed.

## Mechanism simplified

Seven mutations repeated read cancellation, cache snapshotting, optimistic patching, rollback and invalidation. `updateCachedSettings` now owns the first three steps; shared callbacks own rollback and settings invalidation.

Each operation retains its own service, payload mapping and mutation key. Per-function model changes still refresh entitlement. Recovery descriptors, queue receipts, auth guard, cache keys, persistence formats, public methods and rendered UI are unchanged. No new runtime module or generic mutation framework was introduced.

## Search requirement mapping

Retained: `app/utils/__tests__/searchUtils.test.ts`. Removed: `__tests__/utils/searchUtils.test.ts`.

| Previous requirement | Remaining check |
|---|---|
| Empty content/query and whitespace-only inputs | Input table retains all four cases |
| No match | Input table checks an unmatched query |
| Zero context | Exact matching-word result |
| Whole context words | Exact complete-word result |
| Merge close matches without losing occurrences | Both original inputs, exact snippets |
| Separate distant matches | Two snippets, checking both matching ends |
| Long paragraphs without line breaks | Original paragraph; two snippets and all three occurrences |
| Match at the beginning | Exact complete first snippet |
| Literal punctuation and case-insensitivity | Additional exact result preserving capitalization |

The new suite passed alongside the older suite on unchanged runtime before the old file was removed. An initially over-broad expected context was corrected against the baseline: a one-character window excludes the preceding word when it begins on whitespace. The search implementation was never changed.

## Settings test replacement

Tests use real QueryClient, mutations and onlineManager. The read hook and external service operations are controlled: this does not simulate Firestore SDK persistence or IndexedDB.

The operation table retains service-call and unauthenticated requirements, adding optimistic patch/payload/key checks and late-failure rollback for every operation. Query result/refresh, both structure-preview boolean directions, model preferences and entitlement refresh remain covered. Additional cases distinguish early rejection from late refusal, exercise genuine offline pause/resumption and absent-cache creation/restoration.

The replacement passed before the runtime refactor and afterwards with unchanged expectations. Setup preserves the project's global Date.now stub and resets only its own service mocks; a blanket resetAllMocks in an early draft invalidated the clock fixture and was rejected.

## Fault-detection proof

Only disposable copies were fault-injected. Each control passed and each listed fault produced an assertion failure.

| Deliberate fault | Outcome |
|---|---|
| Keep only the first search match | Detected |
| Stop merging nearby windows | Detected |
| Cut words at context boundaries | Detected |
| Make search case-sensitive | Detected |
| Interpret query punctuation as regex | Detected |
| Remove optimistic settings patch | Detected |
| Remove rollback | Detected |
| Assign the wrong queue key | Detected |
| Skip entitlement invalidation | Detected |

An initial settings harness using a module alias still loaded the original source through Next/SWC resolution. Those results were discarded. The valid harness copied frontend sources, mutated the actual isolated file and ran unchanged tests. The working-tree runtime was never fault-injected.

Evidence directory: `/private/tmp/mph-refactor-20260907/`. Files include `baseline-coverage.log`, `final-coverage.log`, `final-lint.log`, `settings-before.log`, `settings-after.log`, `diff-coverage.json`, `search-faults/results.json` and `settings-faults/results.json`. This document retains the summary because temporary evidence is not a permanent archive.

## Stage 1 validation and limits

- `npm run test:coverage && npm run lint:full` passed on final code. Zero lint errors; one warning remains in the unchanged study-note page at line 647 (cognitive complexity 23 versus 20).
- All 28 added instrumented settings-hook lines are covered. Its sole uncovered line, 51, is an unchanged no-owner fallback. No artificial test was added to call private details just to reach it.
- The literal project-memory requirement of another five coverage percentage points cannot be met from 97.23%. Actual coverage is reported above; no threshold/configuration was weakened. The owner subsequently delegated this decision: preserve contracts, cover changed logic, maintain the file floor and existing coverage without artificial tests for an impossible increase. Global thresholds remain unchanged.
- Production settings were inspected read-only for design context. This does not validate the changed hook on production. No account settings were changed. No production build, deployment, physical-device test or live Firestore fault simulation was performed.
- At this stage, the two settings appearances remained proposals. The owner requested side-by-side comparison; neither was applied. The comparison was checked at 736px and 360px, including local toggle synchronization. It does not persist real settings.

## Next steps

The owner delegated design choices. Stage 2 below implements variant B. Next, inspect clipboard tests separately for fallback expectations and browser-global isolation. Before decomposing larger screens, trace one full operation and eliminate unnecessary steps/state before extraction.

API reference checked: [TanStack Query useMutation](https://tanstack.com/query/latest/docs/framework/react/reference/functions/useMutation).


## Stage 2: compact settings and one content tree

The owner delegated all routine decisions after viewing the alternatives. Chosen design: four feature switches in one panel with compact rows. Existing translated titles/descriptions remain; redundant extra Beta chips were removed because the translated titles already include Beta. Debug and build-version settings retain their separate presentation in this bounded stage.

`SettingsToggleRow` owns presentation, loading skeleton, switch styling and accessible title/description associations. Each feature retains its write handler. Four synchronous effects no longer carry cancellation flags or cleanup callbacks: they had no asynchronous work to cancel. The cached-versus-local enabled state distinction has not been redesigned here.

The page previously mounted separate mobile and desktop content trees and hid one with CSS. It now mounts one content tree in a responsive container. Both navigation layouts remain available at their respective breakpoints. The unreachable fallback section duplicated a subset of the valid user section and was removed; all four typed section values still render. Tests now expect one content instance; navigation, freshness, auth and admin-link tests retain their requirements.

| Structural measure | Before | After |
|---|---:|---:|
| Page + four feature components, including new shared row | 735 lines | 571 lines |
| Prep/structure test suites vs shared contract + row tests | 540 lines | 144 lines |
| Mounted settings content trees | 2 | 1 |

Line reduction is maintenance evidence, not a runtime latency benchmark. One tree means one instance of each settings child; no claim is made that Firestore request counts or latency halve, because query/cache deduplication already exists.

### Replacement test crosswalk

Removed `PrepModeToggle.test.tsx` (391 lines) and `StructurePreviewToggle.test.tsx` (149 lines). Retained requirements are covered by `FeatureToggle.contract.test.tsx` and direct `SettingsToggleRow.test.tsx`:

| Original requirement | Retained check |
|---|---|
| Initial loading hides control/title and shows skeleton | Contract loading cycle + row loading test |
| Enabled, disabled and null settings | Both input states plus loaded-to-null refresh |
| Correct title/description | Component translation-key assertions; row accessible associations |
| Toggle both directions and call update with boolean | Inverse-state table and exactly one write |
| Refusal restores switch, logs error, does not alert | Immediate/late refusal table with exact error and no-alert assertions |
| No owner means unchecked switch and no write | Logout reset and guarded click |
| Enabled/disabled track color and thumb position | Direct shared row test preserves both style checks |
| Preserve control after first load | Genuine loading → loaded → refreshing → loaded cycle (old structure test did not actually rerender) |

The same 18 contract cases passed on the original components in an isolated copy and on the refactored components. Audio now runs this entire matrix too. The groups suite remains separate and additionally proves: duplicate clicks are blocked during persistence and refresh; refresh waits for persistence; the event is emitted exactly once with the confirmed boolean; logout blocks writes; a loaded enabled value survives a background refresh and adopts the next loaded result. Existing groups error/alert requirements remain.

### Fault sensitivity

Disposable source-copy control passed. Four deliberate faults each failed an assertion: remove audio late-refusal rollback; remove structure owner guard; disconnect the shared switch action; skip groups refresh. The initial log classifier did not recognize Testing Library's `expect(element)` assertion format; the actual late-refusal test was already red, and the classifier was corrected before reporting results. No fault was applied to the working tree.

Evidence: `ui-replacement-before.log`, `ui-replacement-after.log`, `ui-faults/results.json` under `/private/tmp/mph-refactor-20260907/`.

### Browser verification

Local Next dev build, service worker disabled, existing authenticated `testuser@example.com` session. Inspected actual app at 1675px and 360px; checked the 768px breakpoint. All three widths had no horizontal document overflow and exactly six switches in the DOM (four feature switches plus debug/version). Headings and switches were readable on mobile; row switches have distinct accessible names/descriptions.

On the test account, structure preview started false; Space enabled it; a reload retained true; Space restored false; another reload retained false. This proves the exercised local-app persistence flow and keyboard operation. It does not prove every feature against a live refused/offline write. Groups' different persistence contract is checked with controlled deferred promises; existing real QueryClient tests cover queue/offline behavior.

An initial dev chunk produced a Chrome syntax error and blank screen. Reloading resolved it without a code/configuration change; Node parsed the on-disk chunk and all 137 embedded modules. The cause was not established, so no product fix or recurrence guarantee is claimed. The viewport override was reset and the local dev server stopped before the final full gate. No production deployment, production build or physical-device verification was performed.


### Coverage cross-check

The consolidated full run initially reported groups lines 24–26 as uncovered. A direct loaded-true/background-refresh assertion was added rather than relying on incidental coverage from other suites. A focused coverage run of the final five settings UI modules then passed 28 tests with **100% lines, statements, branches and functions (298/298 lines; 79/79 branches)**. Its report is in `ui-focused-coverage/`.

Full-run aggregate coverage also moved in untouched files (for example, EditSermonModal, usePreachingTimer and Button), so aggregate percentage is reported separately from the direct changed-code evidence; no claim is made that test reduction itself caused a loss or gain in those unrelated contracts. No thresholds, coverage exclusions, timing or worker settings were changed. Final root gate results follow below.


### Additional visual acceptance requested by the owner

Inspected the actual settings UI in dark mode on the normal desktop viewport and at 360px, including visible keyboard focus on the audio switch. Text wrapping, row separators and switch alignment remained intact; no horizontal overflow. Navigated mobile settings to Tags, Plan templates (including the loaded empty state), AI and limits, then back to User settings. Inspected the mobile AI section visually too. No tag, template or model setting was changed. Restored the original System theme and viewport; structure preview remained false.

The first full gate after adding the groups loading test passed Jest but TypeScript caught a missing argument in the mock hook invocation. The test now passes the owner id explicitly. The final full gate below includes that correction; the earlier type-check failure is not counted as a green gate.


## Stage 2 final gate

Scope: all staged + unstaged runtime changes and new runtime files (the working tree includes stage 1). Exact root command: `npm run test:coverage && npm run lint:full`.

- **Passed: 564 suites / 5,349 tests. Global lines: 90.94% (107,006/117,659)**, versus 90.93% before the UI stage and 90.89% at the original pilot baseline. No performance improvement inferred from elapsed times or percentage changes.
- ESLint: zero errors; one unchanged study-note complexity warning. TypeScript and unused-code checks passed. `git diff --check` passed.
- Focused final UI run: **28 tests, 100% lines/statements/functions/branches**.

| Runtime file | Before UI stage: lines | Final full run: lines | Final focused UI run: lines |
|---|---:|---:|---:|
| settings/page.tsx | 86.06% | 88.27% | — |
| AudioGenerationToggle.tsx | 66.37% | 100% | 100% |
| GroupsFeatureToggle.tsx | 100% | 95.16% | 100% |
| PrepModeToggle.tsx | 83.03% | 100% | 100% |
| SettingsToggleRow.tsx (new) | — | 100% | 100% |
| StructurePreviewToggle.tsx | 100% | 100% | 100% |
| useUserSettings.ts (stage 1) | 99.55% | 99.55% | — |

All runtime files exceed the 80% floor. The new shared row has its own direct suite. The combined evidence covers all **200 added/changed instrumented lines**: the full run reports 199/200; the focused run covers the remaining groups loading line 24, plus its surrounding block (24–26). The groups loaded-true assertion passes in both runs. The full/focused reporting discrepancy persists; its cause is unresolved and is not hidden by excluding code or weakening gates. `ui-diff-coverage.json` records full-run and combined evidence separately.

Final evidence: `ui-complete-coverage.log`, `ui-complete-lint.log`, `ui-focused-coverage.log`, `ui-diff-coverage.json`. Four UI fault injections augment the nine stage-1 fault checks. No deployment was performed; larger-screen refactoring remains future work.
