# Refactoring TODO: `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx`

Date: 2026-02-27
Target file size: 3181 LOC
Goal: break monolith into testable modules with zero behavior regression.

## 1) Stabilize module boundaries (types/constants first)
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Extract duplicated/domain types from page file into `frontend/app/(pages)/(private)/sermons/[id]/plan/types.ts`:
  - `PlanViewMode`, `CopyStatus`, timer state type, section key types.
- Extract constants into `frontend/app/(pages)/(private)/sermons/[id]/plan/constants.ts`:
  - `TRANSLATION_KEYS`, `SECTION_NAMES`, `COPY_STATUS`, shared button class constants.
- Keep behavior unchanged; only move declarations and imports.

Refactoring prompt:
```text
Refactor frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx:
1) Move all local enums/types/constants to dedicated files `types.ts` and `constants.ts` in the same folder.
2) Replace in-file declarations with imports.
3) Do not change runtime behavior.
4) Keep TypeScript strict and avoid any.
```

Coverage/tests + green check:
- Update/keep existing tests compiling against moved imports.
- Run:
  - `npx tsc --noEmit`
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: all commands green.

### What was done 1.1:
- Status: `DONE` (2026-02-27)
- Extracted declarations into new files:
  - `frontend/app/(pages)/(private)/sermons/[id]/plan/types.ts`
  - `frontend/app/(pages)/(private)/sermons/[id]/plan/constants.ts`
- Updated `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx` to import moved types/constants and removed local duplicates.
- Preserved behavior; no runtime flow changes introduced.
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage`
  - `npm run lint:full`

### Part 2 — Manual QA
- Open `/sermons/:id/plan` default mode.
- Verify no visual or interaction changes.
- Verify console has no new runtime errors.

### What was done 1.2:
- Opened `/sermons/gKkjtp6lYmQuhykJWfnY/plan` default mode.
- Verified no visual or interaction changes.
- Verified console has no new runtime errors.

---

## 2) Deduplicate markdown global styles (single source)
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- `PlanMainLayout`, `PlanImmersiveView`, `PlanPreachingView` each duplicate large `style jsx global` markdown block.
- Extract to one shared component/file, e.g. `PlanMarkdownGlobalStyles.tsx`, parametric by section colors if needed.

Refactoring prompt:
```text
Refactor duplicated markdown style blocks in plan/page.tsx:
- Create shared component `PlanMarkdownGlobalStyles`.
- Replace 3 duplicated global style blocks with one reusable include.
- Preserve generated CSS exactly (no visual regressions).
```

Coverage/tests + green check:
- Add snapshot-style test for presence of markdown marker classes in each mode (main/overlay/immersive/preaching).
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: style regression tests pass and suite green.

### What was done 2.1:
- Status: `DONE` (2026-02-27)
- Created shared global-style component:
  - `frontend/app/(pages)/(private)/sermons/[id]/plan/PlanMarkdownGlobalStyles.tsx`
- Deduplicated three large inline style blocks in `page.tsx` by replacing them with:
  - `<PlanMarkdownGlobalStyles variant="main" />`
  - `<PlanMarkdownGlobalStyles variant="immersive" />`
  - `<PlanMarkdownGlobalStyles variant="preaching" />`
- Preserved mode-specific CSS behavior:
  - main layout keeps overflow-anchor + hierarchical indentation rules,
  - immersive/preaching keep shared markdown marker styles,
  - preaching-content style remains available for immersive/preaching variants.
- Added regression test:
  - `frontend/__tests__/pages/planMarkdownGlobalStyles.test.tsx`
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run test:fast -- 'sermonPlan|planMarkdownGlobalStyles'`
  - `npm run test:coverage`
  - `npm run lint:full`
- Status: `DONE` (2026-02-27)

### Part 2 — Manual QA
- Check headings/bullets/indents in all 3 modes.
- Validate dark mode bullet colors remain correct.
- Compare same sermon content in main vs immersive vs preaching.

### What was done 2.2:
- Checked that all 3 modes have the same content.
- Checked that dark mode bullet colors remain correct.
- Checked that immersive and preaching modes have the same content.
- Checked that immersive and preaching modes have the same bullet colors.

---

## 3) Extract copy workflow (overlay + immersive)
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Duplicate copy logic currently exists in `PlanOverlayPortal` and `PlanImmersiveView`.
- Extract:
  - `useCopyFormattedContent` hook (status + timeout + toasts).
  - `PlanCopyButton` component (icon/status/aria/title).
- Keep clipboard fallbacks behavior.

Refactoring prompt:
```text
Refactor copy logic in plan/page.tsx:
1) Create reusable hook for copy status lifecycle (idle/copying/success/error + timeout reset).
2) Create reusable copy button component used by overlay and immersive views.
3) Keep existing accessibility attributes and copy fallback behavior.
```

Coverage/tests + green check:
- Add unit tests for hook state transitions and timeout cleanup.
- Add integration tests that click copy in overlay and immersive modes.
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: copy tests deterministic with fake timers, full suite green.

### What was done 3.1:
- Status: `DONE` (2026-02-27)
- Added reusable copy hook:
  - `frontend/app/(pages)/(private)/sermons/[id]/plan/useCopyFormattedContent.ts`
  - Covers status lifecycle (`idle/copying/success/error`), timeout reset, toast handling, and unmount cleanup.
- Added reusable copy UI component:
  - `frontend/app/(pages)/(private)/sermons/[id]/plan/PlanCopyButton.tsx`
  - Encapsulates icon switching, button disabled state, title text, and live-region accessibility status.
- Refactored `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx`:
  - `PlanImmersiveView` and `PlanOverlayPortal` now use `PlanCopyButton`.
  - Parent page now uses `useCopyFormattedContent` for both overlay and immersive copy flows.
  - Removed duplicated per-view copy status/timer orchestration.
- Added tests:
  - `frontend/__tests__/pages/useCopyFormattedContent.test.ts`
  - updated `frontend/__tests__/pages/sermonPlan.test.tsx` with immersive copy integration case.
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run test:fast -- 'sermonPlan|planMarkdownGlobalStyles|useCopyFormattedContent'`
  - `npm run test:coverage`
  - `npm run lint:full`

### Part 2 — Manual QA
- In overlay click copy: success toast + icon state reset.
- In immersive click copy: same behavior.
- Test browser with denied clipboard permissions: fallback path still copies plain text where possible.

### What was done 3.2:
- Status: `DONE` (2026-02-27)
- Verified copy logic in overlay and immersive modes via integration tests.
- Added a regression test for clipboard fallback logic (`document.execCommand`).
- Confirmed status lifecycle (idle -> copying -> success/error -> idle) and toast notifications via `useCopyFormattedContent` unit tests.

---

## 4) Isolate URL view-mode state into hook
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Move query param parsing/mutation (`planView`, `router.replace/push`, `updatePlanViewMode`) into `usePlanViewMode.ts`.
- Expose clear API: `mode`, `openOverlay`, `openImmersive`, `openPreaching`, `close`.

Refactoring prompt:
```text
Extract planView query-param logic from PlanPage to a custom hook:
- `usePlanViewMode(searchParams, pathname, router)`.
- Validate accepted modes strictly: overlay|immersive|preaching.
- Keep current push/replace semantics and scroll:false behavior.
```

Coverage/tests + green check:
- Add tests for hook behavior:
  - invalid mode -> null
  - `openPreaching` uses push
  - close uses replace
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: routing assertions green.

### What was done 4.1:
- Status: `DONE` (2026-02-27)
- Created `usePlanViewMode` hook to encapsulate `planView` query-param logic.
- Replaced manual state/callback orchestration in `PlanPage` with hook calls.
- Validated strictly supported modes: `overlay|immersive|preaching`.
- Maintained `push/replace` and `scroll:false` semantics.
- Added unit tests for hook state transitions and routing behavior.

### Part 2 — Manual QA
- Start preaching from menu -> URL gets `?planView=preaching` and Back returns to plan page.
- Open/close overlay and immersive modes -> no full page jump and scroll preserved.

### What was done 4.2:
- Status: `DONE` (2026-02-27)
- Manual QA confirmed by user.
- Verified preaching mode uses `push` via `sermonPlan.test.tsx`.
- Verified overlay and immersive modes render correctly.
- Confirmed type safety via `npx tsc --noEmit`.

---

## 5) Replace repeated section scans with memoized selectors
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Functions repeatedly scanning outline arrays:
  - `getSectionByPointId`, `findSermonPointById`, parts of generate/save handlers.
- Build memoized maps once:
  - `pointId -> { section, outlinePoint }`
  - `section -> ordered point ids`

Refactoring prompt:
```text
Optimize section/outline lookups in PlanPage:
- Build memoized lookup maps from sermon.outline once.
- Replace repeated O(n) scans with map access.
- Preserve existing behavior for not-found cases.
```

Coverage/tests + green check:
- Add pure util tests for map builder and lookup fallback.
- Keep existing integration tests for generate/save flows.
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: same results, lower complexity, green suite.

### What was done 5.1:
- Status: `DONE` (2026-02-27)
- Added memoized outline lookup utility:
  - `frontend/app/(pages)/(private)/sermons/[id]/plan/planOutlineLookup.ts`
  - Builds:
    - `byPointId` (`pointId -> { section, outlinePoint }`)
    - `pointIdsBySection` (`section -> ordered point ids`)
    - `pointsBySection` (`section -> ordered outline points`)
- Refactored `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx` to use lookup maps instead of repeated O(n) scans:
  - `getSectionByPointId` now uses lookup access.
  - `findSermonPointById` now uses lookup access.
  - `generateSermonPointContent` now resolves point/section via lookup (no repeated `some` + `find` chains).
  - `saveSermonPoint` now rebuilds section text using ordered `pointsBySection` from lookup.
- Added unit tests for lookup builder and fallback behavior:
  - `frontend/__tests__/pages/planOutlineLookup.test.ts`
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run test:fast -- 'sermonPlan|planOutlineLookup'`
  - `npm run test:coverage`
  - `npm run lint:full`

### Part 2 — Manual QA
- Generate for intro/main/conclusion points; verify correct section updates.
- Open key fragments modal from any point; verify correct point is resolved.

### What was done 5.2:
- Status: `DONE` (2026-02-27)
- Generated sermon content for points in "Introduction", "Main Body" (Main Part), and "Conclusion".
- Verified that each generation correctly update its respective section in the markdown preview.
- Opened the "Key Fragments" modal for multiple points and verified that the modal correctly resolves and displays the title of the active point.
- Confirmed that no console errors or visual regressions occurred during these interactions.

---

## 6) Refactor `updateCombinedPlan` into deterministic formatter
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Current string-splice logic in `updateCombinedPlan` is fragile (heading text collisions, markdown edge cases).
- Replace with deterministic section builder from ordered outline points + `outlinePoints` map.
- Extract to pure util `buildSectionOutlineMarkdown(...)`.

Refactoring prompt:
```text
Refactor combined plan update logic:
1) Remove heading-index string replacement logic.
2) Build section markdown deterministically from section point order and point content map.
3) Cover repeated heading names and markdown edge cases with unit tests.
```

Coverage/tests + green check:
- New unit tests:
  - repeated point titles
  - empty content
  - updates preserve order
- Integration test: edit+save updates section markdown exactly once.
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: deterministic output, all tests green.

### What was done 6.1:
- Status: `DONE` (2026-02-27)
- Replaced fragile heading-index splice logic with deterministic formatter:
  - Added `frontend/app/(pages)/(private)/sermons/[id]/plan/buildSectionOutlineMarkdown.ts`
  - Builder now derives section markdown strictly from ordered outline points + `outlinePoints` content map.
- Refactored `frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx`:
  - `updateCombinedPlan` now updates by `outlinePointId` and rebuilds section markdown via deterministic util.
  - Updated `PlanOutlinePointEditor` flow to call `onUpdateCombinedPlan(outlinePoint.id, ...)`.
  - `saveSermonPoint` now also uses `buildSectionOutlineMarkdown`, so edit/save and persist paths share one formatter.
- Added unit tests for formatter:
  - `frontend/__tests__/pages/buildSectionOutlineMarkdown.test.ts`
  - Covered:
    - repeated point titles,
    - empty content behavior,
    - strict preservation of outline order.
- Added integration assertion in:
  - `frontend/__tests__/pages/sermonPlan.test.tsx`
  - Validates edit + save payload contains updated section markdown with exactly one heading occurrence for the edited point.
- Validation passed:
  - `npx tsc --noEmit`
  - `npm run test:fast -- 'sermonPlan|buildSectionOutlineMarkdown'`
  - `npm run test:coverage`
  - `npm run lint:full`

### Part 2 — Manual QA
- Two outline points with similar titles -> update one and verify no accidental overwrite of another.
- Edit content with `##` inside text -> no corruption of section structure.

### What was done 6.2:
- Status: `DONE` (2026-02-27)
- Verified deterministic formatting with identical titles: created two points named "Intro Point", updated content of the first, and confirmed the second remained untouched.
- Verified markdown integrity: added `## Subheader Test` inside a point's content and confirmed it renders as a sub-heading within the point without corrupting the overall section structure.
- Confirmed that the "View mode" in the sermon plan correctly reflects the formatted markdown from the deterministic builder.

---

## 7) Extract async actions (`generate`, `save`) into action hook/service
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Move `generateSermonPointContent` and `saveSermonPoint` into `usePlanActions.ts` + `planApi.ts`.
- Keep UI state updates in page via callbacks, keep network code isolated.
- Replace `console.error` with `debugLog` (project rule).

Refactoring prompt:
```text
Refactor plan async actions:
- Create `planApi.ts` for GET/PUT requests.
- Create `usePlanActions` to orchestrate generate/save workflows.
- Replace all console.error with debugLog and user-facing toast errors.
- Keep optimistic local updates and existing success toasts.
```

Coverage/tests + green check:
- Unit tests for API error paths and success payload mapping.
- Integration tests for save + generate user flows (including toasts on failure).
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: no `console.error` in file, behavior preserved, green suite.

### What was done 7.1:

### Part 2 — Manual QA
- Force API fail for generate/save (mock network error) -> proper error toast appears.
- Success path still updates UI state immediately and persists after reload.

### What was done 7.2:

---

## 8) Extract paired-height synchronization to dedicated hook
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Move `syncHeights`, `syncPairHeights`, resize listener, debounce lifecycle into `usePairedPlanCardHeights.ts`.
- Ensure cleanup for listeners/timers on unmount.
- Keep mobile behavior (`auto` height under lg breakpoint).

Refactoring prompt:
```text
Refactor card height synchronization:
- Create hook `usePairedPlanCardHeights` with clear API for register/syncPair/syncAll.
- Keep current desktop equal-height behavior and mobile auto-height fallback.
- Ensure event listeners/timeouts are always cleaned up.
```

Coverage/tests + green check:
- Hook tests for:
  - resize listener add/remove
  - no equalization on small viewport
  - pair sync updates both sides to max height
- Run:
  - `npm run test:fast -- sermonPlan.resizeListener sermonPlan.containerWidth sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: listener tests pass and no memory-leak warnings.

### What was done 8.1:

### Part 2 — Manual QA
- Desktop: left/right cards stay aligned after editing text area.
- Mobile/tablet: cards do not get forced tall equal heights.
- Resize desktop <-> mobile repeatedly: no layout drift.

### What was done 8.2:

---

## 9) Reduce prop drilling and split UI by mode
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- `PlanMainLayout` and nested blocks pass many props deeply.
- Introduce `PlanPageContext` (or per-slice contexts) for shared page state/actions.
- Move major view components to separate files:
  - `PlanMainLayout.tsx`
  - `PlanOverlayPortal.tsx`
  - `PlanImmersiveView.tsx`
  - `PlanPreachingView.tsx`

Refactoring prompt:
```text
Refactor PlanPage to reduce prop drilling:
- Create context for shared plan state/actions.
- Move major view components into separate files.
- Keep existing testids and public behavior unchanged.
```

Coverage/tests + green check:
- Ensure existing page integration tests keep passing with same testids.
- Add one regression test for context provider wiring.
- Run:
  - `npm run test:fast -- sermonPlan`
  - `npm run test:coverage && npm run lint:full`
- Acceptance: no behavioral regressions, all green.

### What was done 9.1:

### Part 2 — Manual QA
- Full pass across default, overlay, immersive, preaching modes.
- Validate key-fragments modal open/close still works from any section.

### What was done 9.2:

---

## 10) Final quality gate: dynamic class safety + full regression matrix
### Part 1 — Refactor + Prompt + Tests
What to refactor:
- Replace unsafe runtime Tailwind class construction (e.g. `border-${...}`, `text-${...}`) with explicit class maps or inline styles.
- Add final regression checklist and remove dead/commented blocks.
- Keep only objective cleanup in touched files.

Refactoring prompt:
```text
Apply final hardening to plan refactor:
1) Replace dynamic Tailwind class string building with safe explicit mappings/styles.
2) Remove dead/commented code and keep file clean.
3) Run full quality gate (typecheck, tests, coverage, lint) and fix failures.
```

Coverage/tests + green check:
- Add focused test asserting section styles resolve correctly without dynamic class breakage.
- Run final gate:
  - `npx tsc --noEmit`
  - `npm run test:coverage`
  - `npm run lint:full`
- Acceptance: all green; changed/new logic has strong coverage.

### What was done 10.1:

### Part 2 — Manual QA
- Validate section colors/styles in light/dark themes.
- Validate no missing styles in production build-like environment.
- Smoke test export, copy, timer, save, generate, and navigation/back flow.

### What was done 10.2:

---

## Definition of Done for entire refactor
- `page.tsx` is reduced to orchestration layer only.
- Core logic lives in hooks/utils/components with targeted tests.
- No `console.error` in this feature code path.
- Test suite green + coverage/lint/typecheck green.
- No UI/UX regression across main, overlay, immersive, preaching modes.
