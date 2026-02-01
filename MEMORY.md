# Project Memory (Project Operating Manual)

> **Принцип:** Memory — это не хранилище, а pipeline обучения.
> **Flow:** Lessons (сырые) → Short-Term (осмысление) → Long-Term (инструкции)

---

## 🧠 Principles (Context Engineering)

> **Concept:** OpenAI "Context Engineering". Instead of reading all code, the agent reads these Principles.
> **Goal:** High-level "Map", strict Conventions, and immutable Axioms. **Read this first.**

### 🗺️ Architecture Map (The "Where")
*   **Structure:** `app/` (Next.js 15 App Router) | `api/` (Server Actions/Routes) | `utils/` (Pure Logic).
*   **State Hierarchy:** React Query (Server/Async) > URL Params (Nav/Bookmarks) > Zustand (Global Client) > Context (Dependency Injection).
*   **Data Flow:** Firestore (Backend Truth) → IndexedDB (Offline Persistence) → React Query (Memory Cache) → UI.
*   **AI Stack:** OpenAI (`gpt-4o`, `gpt-4o-mini`, `tts-1`) | Zod Schema Validation (Strict) | Client-side Streaming.

### 📐 Coding Conventions (The "How")
*   **Strict Boundaries:** Use `zod` for ALL external data limits (API, AI, Forms). Types must strictly match Zod schemas.
*   **Localization:** `i18next` with `useTranslation`. Transactional updates (EN+RU+UK). No ICU plural syntax (use `_one`, `_other` keys).
*   **Testing:** `jest` + `RTL`. Test Behavior, not Implementation. Mock modules with explicit factories. Use `data-testid` for stable anchors. For AI chains, use **Sequence-Aware Mocking** to verify context passing.
*   **React Hooks:** Rules of Hooks Absolute. Logic Complexity > 20 → Extract to Custom Hook.
*   **Normalization:** Always transform external metadata (tags, labels, user input) to a canonical, lowercase format before logical matching.
*   **File Structure:** Vertical Slices (Feature Folder: `page.tsx`, `hooks/`, `utils/`, `components/`) > Horizontal Layers.

### ⚖️ Domain Axioms (The "Why")
*   **Offline-First:** UX must never block on network. Read from Cache (IndexedDB) immediately. Sync later. Use `networkMode: 'offlineFirst'`.
*   **Sermon Integrity:** The "Outline" (Structure) is the source of truth for ordering. Tags are metadata. Logic: Outline → Structure → Tags.
*   **User Control:** "Heavy" AI actions require explicit triggers (Buttons), not auto-magic/implicit effects.
*   **Session-Log:** One Chat = One Session Log. Single Source of Truth for Context.

### ⛔ Anti-Patterns (The "Never")
*   **Implicit AI Parsing:** Never parse AI text with Regex. Always use JSON Mode / Structured Output.
*   **Conditional Hooks:** Never return early (`if (loading) return...`) before hook definitions.
*   **Stale Cache:** Never rely on `setQueryData` alone for persistence; always pair with `invalidateQueries` or `cancelQueries`.
*   **Console Log:** Never `console.log` in production code; use `debugLog()`.

---

## 🆕 Lessons (Inbox) — Только что выучено

### 2026-02-01 Refactoring to Reduce Cognitive Complexity
**Problem:** `DashboardPage` had high cognitive complexity (23 > 20) due to mixed state management, filtering logic, and complex rendering ternaries.
**Solution:** (1) Extracted filtering/sorting logic into `useFilteredSermons` hook. (2) Extracted conditional rendering (Loading/Empty/Grid) into `DashboardContent` component.
**Why it worked:** Splitting "Data Preparation" (Hook) from "Data Presentation" (Component) and "Conditional Rendering" (Sub-cmp) removed nested branches from the main controller.
**Principle:** When a component is too complex, extract: Logic -> Custom Hook, Rendering -> Sub-component. Specifically, replacing nested ternaries in JSX `return` with a dedicated `Content` component that uses early returns is a huge complexity win.

### 2026-02-01 Hierarchical Sermon Sorting Logic
**Problem:** `getSortedThoughts` ignored `sermon.outline`. Thoughts assigned to outline points were treated as orphans, leading to incorrect ordering when no manual structure existed.
**Solution:** Refactored utility to resolve order by: (1) Manual Structure, (2) Outline Points order, (3) Tag-based orphans.
**Why it worked:** Explicitly iterating through the outline points array before gathering leftovers ensures the UI respects the hierarchical relationship of the sermon model.
**Principle:** **Hierarchical Data Resolution**: When multiple sources of truth exist, resolve them in descending order of user intentionality (Manual > Planned > Metadata).

### 2026-02-01 Tag Normalization & Aliasing
**Problem:** Normalization logic for sermon sections was case-sensitive and missed camelCase variants like `mainPart`, causing "orphaned" thoughts even when tagged correctly.
**Solution:** Added `mainpart` to the canonical alias map and enforced lowercasing during normalization.
**Why it worked:** Canonical matching now captures all variations of "Main Part" regardless of casing.
**Principle:** **Pre-processing Normalization**: Always transform external/user metadata (tags, input) to a canonical, lowercase, space-normalized format before logical lookups.

### 2026-02-01 Sequence-Aware Mocking for AI Chains
**Problem:** Testing sequential AI loops (context passing) with standard mocks led to race conditions where the Nth call received the wrong mock value.
**Solution:** Used `mockResolvedValueOnce` chains to simulate sequential API responses and `toHaveBeenNthCalledWith` to verify that the Nth call correctly received the (N-1)th output as `previousContext`.
**Why it worked:** FIFO mock consumption mirrors the sequential `for...of` loop execution.
**Principle:** To verify stateful chain integrity (e.g. "short-term memory" in AI), use discrete mock responses and positional argument assertions.

### 2026-02-01 Jest Transform Issue with New Files
**Problem:** Newly created test files in `__tests__` failed with "SyntaxError: Cannot use import statement outside a module", while existing files worked fine. Resetting cache didn't help.
**Cause:** Likely a Jest/Babel configuration caching issue or strict transform pattern match that didn't pick up the new file immediately.
**Solution:** Merged the new tests into an existing, working test file (`ExportButtons.test.tsx`) instead of fighting the configuration.
**Why it worked:** The existing file was already being correctly transformed by the test runner.
**Principle:** When the build system fights you on file recognition, merging into a known-good context is often a faster path to value than debugging the toolchain.

### 2026-02-01 Safe Global Mocking in Jest
**Problem:** `Object.assign(navigator, ...)` failed or was unsafe for mocking `clipboard` in strict environments (JSDOM/TypeScript readonly properties).
**Solution:** Used `Object.defineProperty(navigator, 'clipboard', { value: ... })` which bypasses assignment checks and allows defining usually read-only properties for testing.
**Why it worked:** `defineProperty` is the standard way to override read-only properties in JavaScript environments.
**Principle:** Always use `Object.defineProperty` to mock global browser APIs (`navigator`, `window.URL`) to ensure compatibility and avoid "read-only property" errors.

### 2026-02-01 Context-Aware Audio Generation
**Problem:** Parallel generation of sermon audio chunks resulted in disjointed, "robotic" transitions because the AI didn't know what it had just said in the previous chunk.
**Solution:** Switched from `Promise.all` (parallel) to a sequential `for...of` loop. Captured the last ~1000 characters of chunk N and passed it as `previousContext` to the prompt for chunk N+1, explicitly instructing the AI to create a natural transition.
**Why it worked:** Giving the AI "short-term memory" of its own previous output allows it to generate connective tissue (transitions) that makes the whole speech sound cohesive, even if generated in parts.
**Principle:** For long-form AI content generation where coherence matters, favor sequential processing with context passing ("tail context") over faster parallel processing. Coherence requires state.

### 2026-02-01 Coverage for Skeletons
**Problem:** `DashboardStatsSkeleton` had 0% coverage despite being used in `DashboardPage`, because the page test explicitly mocked it.
**Solution:** (1) Added `data-testid` to the Skeleton component. (2) Removed the mock from the page test. (3) Updated the test to expect the real component via `getByTestId`.
**Why it worked:** The test now renders the actual skeleton code (divs, classes), registering as coverage.
**Principle:** To cover visual-only components (skeletons, icons) in integration tests, do not mock them; instead, give them stable test IDs and let them render.

### 2026-02-01 Mobile Subpixel Rendering Seams
**Problem:** A thin vertical line appeared on the left edge of the "Classic Mode" sermon view on mobile.
**Cause:** The container used `width: 200%` and `x: -50%` to slide content. On some mobile viewports, subpixel rendering caused a 1px gap/bleed from the adjacent slide.
**Solution:** Overshift the slide by 1px using `x: calc(-50% - 1px)` and add `pl-px` to the inner container to compensate for the content clipping.
**Why it worked:** The 1px overlap covers the subpixel gap, and the padding restores the visual alignment of the content.
**Principle:** When using percentage-based transforms for sliders (`x: -50%`), beware of subpixel rendering gaps on mobile; use a 1px overlap (`calc`) to mask the seam.

### 2026-02-01 Dashboard Tabs Wrapping
**Problem:** Dashboard tabs overflowed horizontally on narrow mobile screens (390px), breaking the layout.
**Solution:** Switched from `flex-nowrap` + `space-x` to `flex-wrap` + `gap`. Updated styling to use "pills" on mobile for clearer touch targets in a multiline layout.
**Why it worked:** `flex-wrap` allows tabs to flow naturally onto a second line, and `gap` ensures consistent spacing both horizontally and vertically.
**Principle:** For navigation tabs that may exceed viewport width on mobile, prefer `flex-wrap` + `gap` over scrolling or hiding, unless horizontal swipe is an explicit design choice.

### 2026-02-01 Export Action Layout Alignment
**Problem:** "Word" export button (short label) rendered significantly smaller than "PDF" (longer label) and "Preach" (icon only) in the sermon header flex container.
**Solution:** Enforced equal width for all action slots using `flex-1 basis-0 min-w-[64px]` and a shared `ActionButton` base component.
**Why it worked:** `flex-1 basis-0` forces Flexbox to distribute available space equally regardless of content size, provided the content fits or wraps.
**Principle:** To visually equalize a row of buttons with varying label lengths (Text vs Icon), use `flex-1 basis-0` on their containers rather than relying on padding or content size.

### 2026-02-01 Dashboard Word Export: Plan Badge vs Disabled Button
**Problem:** Dashboard showed the "Есть план" badge, but the Word export button was disabled.
**Attempts:** Verified UI state; traced export gating to `planData` being missing on the card.
**Solution:** Build `planData` from `sermon.draft || sermon.plan` in `SermonCard` and pass it into `ExportButtons`, aligning gating with plan presence.
**Why it worked:** Word export now receives the same structured plan data used to determine plan readiness, so enabled state matches the badge.
**Principle:** Feature availability must be driven by the same source of truth as its UI indicators to avoid UX mismatches.

### 2026-02-01 Export i18n Coverage: UI + Document Strings
**Problem:** Some export UI labels/tooltips/aria and Word document strings remained hardcoded, causing partial localization.
**Attempts:** Initial i18n pass missed new strings and export-only text.
**Solution:** Added export-specific i18n keys (buttons, tooltips, aria) and localized Word headers/date/filename/placeholder, with safe fallbacks for tests.
**Why it worked:** All export-facing strings now come from i18n with locale-aware dates, so language switches don’t leave stray English/Russian text.
**Principle:** Export UI and output must be fully i18n-driven, with safe fallbacks for non-initialized i18n contexts.

### 2026-02-01 Tooltip Clipping: SermonCard Overflow
**Problem:** Dashboard export tooltip was clipped by the SermonCard border.
**Attempts:** None.
**Solution:** Switched SermonCard container to `overflow-visible` so tooltips can render outside the card boundary.
**Why it worked:** Tooltips are absolutely positioned and need overflow visible or a portal to escape the card bounds.
**Principle:** Containers hosting tooltips should not use overflow clipping unless the tooltip is rendered in a portal.

### 2026-02-01 Jest Mock: Named Export Fidelity
**Problem:** New Column tests crashed with "Element type is invalid" because a mocked component resolved to `undefined`.
**Attempts:** Mocked the component as a default export while the real code imported a named export.
**Solution:** Match the module's export shape in the mock (export the named symbol).
**Why it worked:** React components must resolve to a valid function; mismatched export shapes yield `undefined` at render time.
**Principle:** Jest mocks must mirror the real module's export shape (named vs default) or React will render `undefined`.

### 2026-01-31 Word Export: Language-Independent Structured Data Flow
**Problem:** Word export relied on parsing markdown strings with regex to find headers like "Вступление" (Introduction). This broke when the UI language changed, as headers were translated, leading to empty exports or missing sections.
**Attempts:** Initially tried adding more language aliases to the parser, but realized it was a fragile approach.
**Solution:** (1) Removed `parseMarkdownPlan` entirely. (2) Added a structured `planData` prop (matching the `PlanData` interface) to the `ExportButtons` component. (3) Updated pages (`PlanPage`, `StructurePage`) to construct and pass this object directly.
**Why it worked:** Business logic now operates on stable, typed data objects instead of volatile UI text. The export logic no longer cares about the language of the headers in the markdown; it just map-joins the structured points.
**Principle:** Never use UI-facing localized strings (headers, labels) as anchor points for data extraction or business logic. Use structured, technical data as the source of truth.

### 2026-01-31 Export Connectivity: Standardizing Prop Flow across Workspaces
**Problem:** `ExportButtons` had inconsistent data sources depending on whether it was in a Column (Focus Mode) or on the Plan Page, making it hard to maintain consistent Word formatting.
**Solution:** (1) Standardized on `planData={planData}` and `focusedSection={id}` props. (2) Updated `Column.tsx` to pass these down. (3) Modified `wordExport.ts` to accept `focusedSection` for filtering.
**Why it worked:** Explicit props make component behavior predictable and testable. Filtering at the export utility level ensures that global metadata (title, verses) is always included even in section-specific exports.
**Principle:** When a component is used in multiple contexts (dashboard, focus mode, detail page), synchronize its data requirements through explicit, unified props rather than generic "blob" getters.

### 2026-01-31 Middleware CORS tests failing on Vercel (CI)
**Problem:** Middleware tests passed locally but failed on Vercel build: `Access-Control-Allow-Origin` was expected `http://localhost:3000` but received `null`.
**Cause:** On Vercel, `process.env.CORS_ALLOWED_ORIGINS` is set (e.g. to production domain only). The tests assumed default env (unset), so the middleware used DEFAULT_ALLOWED_ORIGINS (which includes localhost). In CI, the env was set, so localhost was not in the allowed list.
**Solution:** In tests that assert behavior for a specific origin (e.g. localhost), explicitly `delete process.env.CORS_ALLOWED_ORIGINS` so the middleware falls back to DEFAULT_ALLOWED_ORIGINS. Save/restore env in beforeEach/afterEach so tests are isolated and don't leak state.
**Why it worked:** Tests no longer depend on the runner's environment; they control the env for each case.
**Principle:** Tests that rely on `process.env` for behavior (e.g. CORS allowed list) must set or clear the relevant env inside the test (or beforeEach) and restore in afterEach so they pass in any CI/CD environment (Vercel, GitHub Actions, etc.).

### 2026-01-31 Skeleton Loader vs Empty State Logic
**Problem:** Skeleton loader persisted even when data fetching was complete (but empty/null), preventing the "Sermon not found" state from showing and failing tests.
**Attempts:** Initial logic was too broad: `if (loading || (!sermon && !error))`, showing skeleton for both loading and missing data.
**Solution:** Strict separation: Only show Skeleton if `loading` is true. Handle `!sermon` explicitly as a separate "Not Found" state.
**Why it worked:** "Loading" implies an active process; "Not Found" is a terminal state. Conflating them prevents the UI from settling into the terminal state.
**Principle:** Do not use "Skeleton" for "Empty/Missing" states. Skeleton is for *waiting*; Empty State is for *result*.

### 2026-01-31 React Hooks: Conditional Return Placement
**Problem:** A "Rendered more hooks than during the previous render" error occurred when a conditional return for a skeleton state was placed before `useCallback` hook definitions.
**Attempts:** Initially moved the return logic to handle the visibility glitch, but forgot about the Rules of Hooks.
**Solution:** Moved the conditional `if (loading || ...)` return statement to the very end of the hook block, after all `useState`, `useEffect`, and `useCallback` declarations.
**Why it worked:** React requires all hooks to be called in the same order on every render. Placing conditional returns after all hooks ensures that the set of hooks called is consistent for that render.
**Principle:** Always place conditional "early returns" (skeletons, loading, error screens) *after* all hook definitions in a component.

### 2026-01-31 UI State: Persistence via URL Query Parameters
**Problem:** Dashboard tab state (Active/Preached/All) was lost when navigating to a sermon detail page and back because it was managed by local `useState`.
**Attempts:** Proposed and implemented a switch to URL-driven state.
**Solution:** Replaced `useState` with `useSearchParams()` to read the state and `useRouter().push()` to update it.
**Why it worked:** The URL is part of the browser's history and persists across navigation, unlike component state which is destroyed when unmounting.
**Principle:** For UI filters/tabs that should persist across navigation or be bookmarkable, prefer URL query parameters over local component state.

### 2026-01-31 Testing: Mocking Next.js 15 Navigation Hooks
**Problem:** Dashboard tests failed after switching to `useSearchParams` and `useRouter` because the `next/navigation` hooks were not mocked.
**Attempts:** Initially forgot to add mocks; later added basic `jest.mock`.
**Solution:** Implemented explicit mocks for `useRouter` (returning `push`, `replace`, etc.) and `useSearchParams` (returning an object with a `get` method). Tests use `mockUseSearchParams.mockReturnValue({ get: () => 'tab-id' })` to control the simulated URL state.
**Why it worked:** Providing a controlled mock allows tests to simulate different URL parameters and verify that the component responds correctly without requiring a real browser navigation environment.
**Principle:** When component logic depends on URL parameters via `useSearchParams`, explicitly mock the hook to return a controllable object with a `get` method in tests.

### 2026-01-31 React Hooks: Destructuring missing data from useSermon
**Problem:** TypeScript error when trying to use `error` from `useSermon` because it wasn't being destructured in `page.tsx`, even though the hook returned it.
**Solution:** Added `error` to the destructuring list of `useSermon(id)`.
**Principle:** Always destructure all necessary state/flags from custom hooks to ensure type safety and handle error branches correctly.


### 2026-01-30 React Query: Server-First Race Condition Fix
**Problem:** `useServerFirstQuery` logic caused infinite loading because `serverFetchedRef` was resetting to false on re-renders, while `shouldReveal` didn't account for `queryResult.isSuccess` independently.
**Attempts:** Added debug logging to trace state; discovered `serverFetchedRef` flip-flopping.
**Solution:** Updated `shouldReveal` to check `(serverFetchedRef.current || (queryResult.isSuccess && queryResult.data !== undefined))`. Updated `isLoading` to respect `shouldReveal`.
**Why it worked:** Explicitly checking `isSuccess` + `data` ensures that once data is available, we show it, even if the "first fetch" ref flag was lost or reset during a render cycle.
**Principle:** Reliability > Flags. For loading states, always prefer derived truth (`isSuccess && data`) over mutable imperative flags (`useRef`), or combine them defensively.

### 2026-01-30 Testing: Mocking Local Modules and ReferenceErrors
**Problem:** Tests failing with `ReferenceError: debugLog is not defined` after adding it to source code, because the mock in `series-detail.test.tsx` was incomplete or using `requireActual` incorrectly for a module with named exports.
**Attempts:** Tried mocking with `requireActual`, resulted in element not found errors implying the mock wasn't working as expected.
**Solution:** Simplified the mock to a plain object returning `jest.fn()` for all exports, removing `requireActual`.
**Why it worked:** Jest's module resolution can be tricky with partial mocks. A clean, explicit mock object ensures the test environment has exactly what it needs without side effects from the actual module.
**Principle:** When mocking simple utility modules causes ReferenceErrors, prefer a full explicit mock object over `requireActual` to eliminate module resolution complexity.

### 2026-01-30 Jest Mocks: Parallel Requests Consumption
**Problem:** `StepByStepWizard` test failed because "Generate Audio" button never appeared. The test mocked sequential steps (Optimize -> Save -> Generate), but the component fired 3 parallel optimization requests (Intro/Main/Conclusion).
**Attempts:** Added standard sequential mocks; test failed as the "Save" mock was consumed by the 2nd parallel optimization request, breaking the flow.
**Solution:** Updated the mock chain to provide 3 discrete `mockResolvedValueOnce` responses for the parallel optimization step *before* adding the mock for the subsequent "Save" step.
**Why it worked:** `fetch` mocks are consumed FIFO. Parallel requests consume N mocks immediately. If the chain is too short, subsequent logical steps receive the wrong response or undefined.
**Principle:** When a component executes parallel requests (e.g. `Promise.all`), explicitly mock N responses for that batch before mocking the next sequential step.

### 2026-01-26 React Query: Hybrid Ref/State for Synchronous Data Availability and Async Re-renders
**Problem:** In `useServerFirstQuery`, a pure `useState` for `serverFetched` status caused a one-render-cycle delay. This broke tests that checked the state immediately after `act()` and caused UI desynchronization when data was updated via `setQueryData` (which doesn't trigger the `queryFn` where the state was normally set).
**Attempts:** Initially used only `useRef` (fixed tests but broke re-renders on manual cache updates) and then only `useState` (fixed re-renders but broke tests).
**Solution:** Implemented a hybrid approach: (1) Use `useRef` for immediate "serverFetched" status during the `queryFn` execution. (2) Use a `renderTrigger` (state) and `useEffect` to force a re-render when the cache is updated externally (monitored via `dataUpdatedAt`). (3) Added synchronous state reset on key changes to prevent showing stale data from previous keys.
**Why it worked:** The `ref` provides the "truth" immediately for logic and tests, while the `state` ensures the UI actually reacts to that truth when it changes outside of the hook's own query lifecycle.
**Principle:** When wrapping shared queries that must hide stale cache, use a hybrid Ref/State pattern to provide immediate state access for logic while maintaining React's declarative re-render guarantees.

### 2026-01-26 React Query: Solving "Disappear-Reappear" Flicker with Strict Online-First logic
**Problem:** Marking a sermon as preached caused it to flicker (disappear then reappear). This was a race condition: `invalidateQueries` triggered a background refetch that returned stale data (Firestore eventual consistency) before the server update Propagated, overwriting the local optimistic update.
**Attempts:** Initially used `setQueryData` + `invalidateQueries` (previous project standard) to ensure IndexedDB sync.
**Solution:** (1) Implemented strict Online-First logic in `useServerFirstQuery`: never show cached data when online until fresh fetch completes. (2) Replaced immediate invalidation with `cancelQueries` (stops stale refetches) followed by `invalidateQueries({ refetchType: 'none' })`. (3) Removed redundant component-layer invalidations.
**Why it worked:** `refetchType: 'none'` marks the query as stale (ensuring IndexedDB sync) without triggering the immediate "stale" refetch that caused the flicker. `cancelQueries` protects the local state from overwrites.
**Principle:** When performing optimistic updates in an eventually consistent environment, use `cancelQueries` and `invalidateQueries({ refetchType: 'none' })` to maintain local UI integrity while ensuring background persistence.

### 2026-01-26 Architectural Fix: Canonical structural tags for language independence
**Problem:** Features like "missing tag" warnings, search, and statistics broke when switching languages because they relied on hardcoded localized strings (e.g., "Основная часть"). Additionally, a race condition in Focus Mode caused new thoughts to lose their structural context during save.
**Attempts:** Initially tried adding more localized aliases, but realized it was a losing battle against language scale.
**Solution:** (1) Introduced canonical IDs (`intro`, `main`, `conclusion`) in Firestore and logic. (2) Updated `ThoughtCard`, `StructureStats`, and `OutlinePointSelector` to use `normalizeStructureTag` bridge. (3) Unified export logic to use current user's translation for header matching. (4) Resolved race condition in `useSermonActions.ts` by deriving the next state structure during the mutation payload construction.
**Why it worked:** Decoupling business logic from UI labels ensures consistent behavior regardless of the user's interface language. Explicitly passing IDs instead of UI strings eliminates ambiguity.
**Principle:** Always use canonical technical IDs for logical operations (validation, search, mapping) and keep localized strings strictly for the display layer.

### 2026-01-26 Data Consistency: Respecting structure-driven order over individual positions
**Problem:** Thoughts in Focus Mode sidebar appeared in a different sequence than on the main sermon page because `useSermonStructureData` was re-sorting items by their `position` field, overriding the order defined in the `structure` object.
**Attempts:** Unified the layout and badge positions, then identified the sorting mismatch in the data hook.
**Solution:** Removed redundant `sortByPosition` calls in `useSermonStructureData.ts`. The `structure` object (the array of IDs from DnD) is now the absolute source of truth for the sequence.
**Why it worked:** DnD operations update the array of IDs representing the order; re-sorting by individual fields can revert or break this manual sequence if positions are out of sync.
**Principle:** When an explicit order is provided via a container mapping (e.g., `structure`), treat that mapping as the primary source of truth for sequence instead of individual item fields.

### 2026-01-26 UI Consistency: Aligning Sidebar elements across modes
**Problem:** Focus Mode sidebar had a layout discrepancy (badge before icons) and different badge behavior (hover-only) compared to the main page.
**Attempts:** Rearranged elements and Unified styles with the main page.
**Solution:** Swapped badge and icon positions in `Column.tsx` to match `SermonOutline.tsx`. Moved the badge outside the hover-only container to ensure constant visibility while preserving Focus Mode color themes per user preference.
**Why it worked:** Standardizing the functional order of actions and info (icons → badge) creates a predictable UX across different views of the same data.
**Principle:** Maintain consistent functional ordering of interactive elements (e.g., actions always before/after metadata) across different view modes.

### 2026-01-25 Session logs: One chat → one session file
**Problem:** Multiple session logs were created for a single chat, splitting progress and decisions across files.
**Attempts:** Continued logging in parallel files, then had to reconcile entries manually.
**Solution:** Merged all entries into a single session log and added an explicit rule in `AGENTS.md` to enforce “one chat = one session log”.
**Why it worked:** A single log becomes the source of truth, avoiding fragmented context and duplicated work.
**Principle:** For each chat, maintain exactly one session log; if duplicates appear, merge them immediately and tighten the protocol.

### 2026-01-21 React Query: Server-first mask must handle shared observers
**Problem:** Series badge disappeared on Dashboard even though `/api/series` returned data; debug logs showed count flipping from 7 to 0.
**Attempts:** Enabled server-first reads with `useServerFirstQuery`, added uid resolution to run the series query.
**Solution:** Track `dataUpdatedAt` inside `useServerFirstQuery` and mark `serverFetched` when data updates, not only when the local `queryFn` runs.
**Why it worked:** When multiple components subscribe to the same query, only one observer runs the `queryFn`; others never set `serverFetchedRef` and masked data as empty. Using `dataUpdatedAt` detects cache updates for every observer.
**Principle:** In shared-query hooks, derive “server-fetched” state from cache update signals (e.g., `dataUpdatedAt`), not only from local `queryFn` execution.

### 2026-01-21 Testing: Coverage-driven test fixes need typed mocks + fresh queries
**Problem:** Coverage tests failed or TypeScript compile failed after adding new tests due to stale DOM references and strict mock typings (read-only fields, wrong arg types).
**Attempts:** Clicked container instead of checkbox; used require() in tests; passed wrong mock args and tried to assign to readonly fields.
**Solution:** Re-query DOM elements after state updates, click the checkbox directly, use static imports, and loosen mock typings/casts for readonly fields and params.
**Why it worked:** React state updates are async and DOM refs go stale; TypeScript enforces readonly and exact signatures for mocks, so typings must match the real hook/service contracts.
**Principle:** When tests fail after adding coverage, re-query the DOM after state changes and align mock typings with real signatures (use typed jest.fn and safe casts for readonly fields).

### 2026-01-18 Implementation: Fixed Dashboard Preached Status Sync Issue
**Problem:** Sermon preached status wasn't updating immediately in dashboard after marking as preached/unpreached - status showed old state for several seconds before refreshing.
**Attempts:** Initially investigated cache race conditions, examined PersistQueryClientProvider behavior, checked timing between API calls and cache updates.
**Solution:** Added proper query invalidation for dashboard cache ['sermons', uid] in OptionMenu component's handleTogglePreached and handleSavePreachDate functions, ensuring both calendar and dashboard caches update simultaneously.
**Why it worked:** OptionMenu was only invalidating calendar cache ['calendarSermons'] but dashboard uses ['sermons', uid] - adding the missing invalidation ensures immediate UI sync across all components.
**Principle:** When updating shared data across multiple components with different query keys, invalidate ALL relevant query keys to prevent UI desynchronization and stale data display.

### 2026-01-18 Implementation: Fixed All 6 Cache Desync Issues Across App
**Problem:** Applied invalidateQueries pattern to all 6 locations with setQueryData cache desynchronization: useSermon.setSermon, useSeriesDetail operations (reorder/add/remove), and useDashboardSermons cache functions.
**Attempts:** Systematically added queryClient.invalidateQueries() after all setQueryData calls affecting persisted data, ensuring guaranteed cache synchronization through successful refetch pattern.
**Solution:** Consistent application of setQueryData + invalidateQueries pattern across all optimistic update locations, guaranteeing persisted cache sync and eliminating data loss on app restarts.
**Why it worked:** Single reliable pattern (invalidateQueries after setQueryData) applied uniformly, leveraging React Query's built-in cache persistence for successful queries, with minimal code changes and comprehensive test coverage.
**Principle:** When implementing optimistic updates with setQueryData, always immediately follow with invalidateQueries for the same key to guarantee persisted cache synchronization and prevent data loss.

### 2026-01-18 Research: Found 3 More Locations with Same Cache Desync Pattern
**Problem:** Investigated other setQueryData usage patterns, found 3 additional locations with same persisted cache desynchronization issue affecting sermon editing, series management, and dashboard.
**Attempts:** Systematically analyzed all setQueryData usage across codebase, identified patterns where invalidateQueries missing, confirmed same root cause applies to multiple features.
**Solution:** Documented critical issues in useSermon.setSermon (sermon page updates), useSeriesDetail.updateDetailCache (series reordering), and useDashboardSermons cache functions (dashboard UI) - all need invalidateQueries addition.
**Why it worked:** Comprehensive pattern analysis revealed systematic issue across optimistic update implementations, confirming root cause affects multiple user workflows beyond initial focus mode fix.
**Principle:** When implementing optimistic updates with setQueryData, always pair with invalidateQueries to ensure persisted cache synchronization, otherwise data loss occurs on app restart.

### 2026-01-18 Implementation: IndexedDB Cache Sync Fix Applied
**Problem:** Applied invalidateQueries after setQueryData in setSermon method to fix persisted cache desynchronization, ensuring thought order persistence across app restarts.
**Attempts:** Modified useSermonStructureData.ts to combine setQueryData (immediate UI feedback) with invalidateQueries (guaranteed persisted cache sync), tested with existing test suite.
**Solution:** Added queryClient.invalidateQueries(["sermon", sermonId]) after setQueryData to ensure every sermon state update triggers refetch and persisted cache synchronization.
**Why it worked:** Simple one-line addition following standard React Query patterns guarantees cache persistence without complex PersistQueryClientProvider modifications, with minimal performance trade-off.
**Principle:** When fixing cache synchronization issues, prefer adding invalidateQueries to existing setQueryData calls rather than modifying dehydration logic, as it guarantees proper persistence through standard query lifecycle.

### 2026-01-18 Impact Analysis: Simple Solution for IndexedDB Cache Sync Issues
**Problem:** Analyzed full impact of IndexedDB persisted cache desynchronization affecting sermon data persistence, identified invalidateQueries as simple reliable fix.
**Attempts:** Mapped complete system dependencies and downstream effects, found medium blast radius isolated to sermon workflow, designed minimal-change solution using standard React Query patterns.
**Solution:** Replace setQueryData with invalidateQueries for sermon updates to guarantee persisted cache synchronization with server state, ensuring thought order persistence across app restarts.
**Why it worked:** Systematic impact mapping revealed invalidateQueries as lowest-risk, highest-reliability fix that follows existing app patterns and guarantees cache sync without complex PersistQueryClientProvider modifications.
**Principle:** When fixing persisted cache synchronization issues, prefer standard React Query invalidation patterns over complex cache manipulation, as they guarantee proper dehydration and persistence.

### 2026-01-18 IndexedDB Cache Desynchronization Breaking Data Persistence
**Problem:** User correctly identified that thought order changes were saved locally but lost on restart due to IndexedDB persisted cache not syncing with setQueryData updates.
**Attempts:** Investigated PersistQueryClientProvider behavior, found that setQueryData updates in-memory cache but persisted cache only saves queries with status 'success', causing desynchronization.
**Solution:** Identified that PersistQueryClientProvider's shouldDehydrateQuery filter prevents local setQueryData updates from persisting to IndexedDB, causing data loss on app restart.
**Why it worked:** Systematic investigation validated user's hypothesis 100%, tracing from setQueryData behavior through dehydration filters to cache restoration overwrite mechanism.
**Principle:** When using PersistQueryClientProvider, setQueryData updates don't persist to IndexedDB unless the query has status 'success'; use invalidateQueries or mutations for reliable persistence.

### 2026-01-18 Thought Order Loss Due to Cache Race Conditions
**Problem:** User sets thought order (1,2,3) but finds it reverted (3,1,2) after returning later, due to race condition between debounced position saves and React Query cache invalidation.
**Attempts:** Investigated position persistence, found it working correctly; identified race between 500ms debounced saves and 30s staleTime causing refetch before saves complete.
**Solution:** Identified primary root cause as `refetchOnMount: 'always'` + `staleTime: 30s` + 500ms debounce creating 29.5s race window where refetch loads old positions before debounced saves complete.
**Why it worked:** Systematic 150% investigation traced from user symptoms through cache timing to specific code lines, revealing the race condition window and optimistic update conflicts.
**Principle:** When optimistic updates use debounced saves, ensure cache invalidation timing doesn't create race windows where refetch can load stale data before pending saves complete.

### 2026-01-18 Focus Mode Thoughts Jumping Root Cause Analysis
**Problem:** Thoughts were jumping in focus mode when adding thoughts or over time, suspected to be related to recent IndexedDB changes.
**Attempts:** Investigated IndexedDB persistence, React Query cache behavior, URL navigation patterns, and component mounting cycles.
**Solution:** Identified primary root cause as global React Query `refetchOnMount: 'always'` setting from January 18 cache fix, causing excessive refetches on every component mount during UI interactions.
**Why it worked:** Systematic 150% investigation (100% core + 50% context) traced the issue from user symptoms through configuration changes to specific code lines, establishing 95% confidence in the primary root cause.
**Principle:** When investigating UI jumping or unexpected re-renders, always check global data fetching configuration changes first, as `refetchOnMount: 'always'` can cause excessive network requests during component interactions.

### 2026-01-17 Tooltip Boundary Detection Implementation
**Problem:** OutlinePointGuidanceTooltip was extending beyond scrollable container boundaries, causing poor UX where tooltip content would be cut off or not visible.
**Attempts:** Initially considered fixed positioning, but needed container-aware positioning within scrollable areas.
**Solution:** Implemented boundary detection using getBoundingClientRect() to measure container bounds, with automatic repositioning from above→below button when insufficient space, and horizontal alignment adjustments to prevent overflow.
**Why it worked:** Absolute positioning with z-index works for global positioning, but scrollable containers require measuring container bounds relative to viewport and trigger position; useEffect with DOM measurements enables dynamic repositioning.
**Principle:** For tooltips in scrollable containers, implement boundary detection using container.closest('.scrollable-class') and getBoundingClientRect() measurements, with fallback positioning strategies (above→below, left→right adjustments).

### 2026-01-17 AddThoughtManual button disabled offline due to useTags enabled condition
**Problem:** "Добавить мысль вручную" button stopped working on production after IndexDB offline mode addition because useTags had `enabled: Boolean(userId) && isOnline`, preventing cache reads offline.
**Attempts:** Analyzed AddThoughtManual component logic, traced dataReady calculation, identified useTags offline behavior.
**Solution:** Changed useTags query to `enabled: Boolean(userId)` and `networkMode: isOnline ? 'online' : 'offlineFirst'` to allow persisted cache reads when offline while preventing network requests.
**Why it worked:** React Query with persisted cache can serve data offline, but `enabled: false` prevents both fetching and cache reading; `networkMode: 'offlineFirst'` allows cache-first behavior offline.
**Principle:** For offline-capable queries, use `networkMode: 'offlineFirst'` instead of disabling queries offline to preserve cache access while preventing network requests.

### 2026-01-17 Dynamic Debug Logging Pattern Implementation
**Problem:** Need user-controllable debug logging without console pollution in production.
**Attempts:** Considered conditional console.log calls, but needed centralized control.
**Solution:** Implemented `debugLog()` utility from `@/utils/debugMode` with user toggle in settings. Applied pattern to AddThoughtManual component for troubleshooting.
**Why it worked:** Single source of truth for debug state, persisted in localStorage, allows users to enable detailed logging without code changes.
**Principle:** Use `debugLog()` instead of `console.log` for user-controllable debugging with settings UI toggle.

### 2026-01-16 Faster offline fallback requires shorter Workbox timeout
**Problem:** Offline navigation felt inconsistent because Workbox waited too long before falling back to cache.
**Attempts:** Observed slow/offline behavior with default `networkTimeoutSeconds` values.
**Solution:** Set Workbox `networkTimeoutSeconds` to 1 for HTML, RSC, and default runtime caches.
**Why it worked:** A shorter timeout triggers cache fallback quickly when the network is unavailable or flaky.
**Principle:** For reliable offline UX, keep Workbox `networkTimeoutSeconds` low so cache wins fast on bad networks.

### 2026-01-15 Offline structure requires React Query cache alignment
**Problem:** `/sermons/[id]/structure` and focus mode showed "Sermon not found" offline because data initialization returned early and bypassed persisted cache.
**Attempts:** Traced data flow, confirmed direct `getSermonById`/`getSermonOutline` usage and offline early-return path.
**Solution:** Align `useSermonStructureData` with React Query cache, remove offline early-return, and read outline from query cache or `sermon.outline`.
**Why it worked:** Persisted React Query cache is the only durable offline data source; removing the early return allows the hook to hydrate from cache.
**Principle:** Offline pages must read from persisted React Query cache instead of short-circuiting on offline status.

### 2026-01-15 React Query tests require QueryClientProvider
**Problem:** Plan page tests started failing with "No QueryClient set" after migrating to React Query hooks.
**Solution:** Wrap PlanPage renders in tests with `QueryClientProvider` using a test `QueryClient`.
**Principle:** Any test that renders components calling `useQueryClient`/React Query hooks must provide a QueryClient via provider.

### 2026-01-15 Ignore generated Workbox in ESLint
**Problem:** `public/workbox-*.js` generated by PWA tooling triggered ESLint errors and duplicate-string warnings.
**Solution:** Add `public/workbox-*.js` to ESLint ignores and allow CommonJS `require` in `next.config.js`.
**Principle:** Treat generated build artifacts as lint-ignored sources and explicitly allow config-level CommonJS where required.

### 2026-01-14 Calendar Analytics Refactor Verified
**Problem:** `AnalyticsSection.tsx` exceeded `sonarjs/cognitive-complexity`, and a safe refactor needed high-confidence behavior parity.
**Attempts:** Researched refactor options and verified existing behavior boundaries via tests and data flow inspection.
**Solution:** Extracted analytics computation into `calendarAnalytics.ts`, split logic into pure helpers, expanded unit tests, ran full test suite + lint, and manually compared prod vs localhost.
**Why it worked:** Moving complex logic into pure utilities reduced complexity without UI changes; tests plus manual parity check validated behavior.
**Principle:** To reduce cognitive complexity safely, extract pure logic into utilities, keep UI thin, and validate with targeted tests plus full-suite and real-world parity checks.

### 2026-01-14 KnowledgeSection Refresh Should Update sectionHints
**Problem:** Refresh button in “Suggested Plan” visually referenced section hints but called full-plan generation, so UI appeared unchanged when sectionHints existed.
**Attempts:** Investigated UI triggers and backend routes to verify actual API calls.
**Solution:** Wire the refresh action to `generateThoughtsBasedPlan` (`POST /api/insights/plan`) and update tests to assert this call.
**Why it worked:** The button now refreshes the data source it renders (`insights.sectionHints`), eliminating the mismatch between UI expectations and side effects.
**Principle:** Refresh actions must update the same data source that the UI section renders; otherwise users perceive a “no-op” and confusion.

### 2026-01-11 Decoupling Complex Component Logic (Refactoring Protocol 150)
**Problem:** `handleSaveEdit` in `page.tsx` had a cognitive complexity of 42 due to nested loops, redundant state checks, and interleaved server/UI logic.
**Attempts:** Initially extracted logic to sub-functions within the component, which reduced complexity but didn't improve testability or structural clarity.
**Solution:** (1) Extracted pure data transformation helpers (`findOutlinePoint`, `buildItemForUI`) to `utils/structure.ts`. (2) Extracted interaction handlers and related state (`handleSaveEdit`, `handleCreateNewThought`, etc.) to a custom hook `useSermonActions.ts`. (3) Verified with 174 targeted unit tests and manual browser validation.
**Why it worked:** Custom hooks allow encapsulating related state and effects, making the main component declarative. Pure utilities in separate files enable 100% test coverage without component overhead.
**Principle:** When a component's handler logic exceeds complexity limits, decouple stateful interactions into custom hooks and pure business logic into utilities for isolation and testability.

### 2026-01-12 Testing Async UI Interaction updates
**Problem:** Test failed to find a newly added tag element after simulated user input, despite using `waitFor`.
**Attempts:** `userEvent.type` + `userEvent.click` failed to update state fast enough for `getByText`.
**Solution:** (1) Use `fireEvent.change` for reliable input value setting in JSDOM. (2) Use `await screen.findByText` instead of `getByText` to leverage built-in retry mechanisms for element appearance.
**Why it worked:** `fireEvent` is synchronous and direct; `findBy` queries are async and poll the DOM, handling React's render cycle delays automatically.
**Principle:** When asserting the presence of elements appearing after an interaction, prefer `await screen.findBy*` over `waitFor(() => screen.getBy*)` for cleaner and more reliable tests.

### 2026-01-11 JSDOM window override for SSR branches
**Problem:** Needed to cover the `typeof window === 'undefined'` branch in share URL tests, but JSDOM always provides `window`.
**Solution:** Override `global.window` using `Object.defineProperty` during the test and restore it afterward.
**Principle:** To exercise SSR-only branches in JSDOM, temporarily redefine `window` with `Object.defineProperty` instead of direct assignment.

### 2026-01-11 CSS Grid Header Alignment
**Problem:** Column headers didn't match values vertically in a table using CSS Grid due to calculating widths based on different content (text vs buttons).
**Solution:** Use fixed pixel widths for all metadata/action columns and only one `1fr` column for the primary flexible content.
**Why it worked:** Constraining all but one column ensures identical grid calculation for both header and rows regardless of inner content size.
**Principle:** For perfect Grid alignment between header and rows, use fixed widths for all metadata columns and only a single `1fr` column for flexible content.

### 2026-01-11 i18n labels update after mount in ThemeModeToggle
**Problem:** Theme mode tests failed because translated labels render after mount, and duplicate labels exist in sr-only elements.
**Attempts:** `getByText('System')` assertions failed with multiple matches and timing issues.
**Solution:** Use `waitFor` for mounted text and `getAllByText` (or more specific queries) to handle duplicates.
**Why it worked:** The component updates labels in `useEffect`, so waiting avoids race conditions; multiple matches are expected by design.
**Principle:** For i18n/mounted labels, use `waitFor` and `getAllByText` (or scoped queries) instead of assuming unique immediate text.

### 2026-01-11 Testing conditional visual states in UI components
**Problem:** Needed to test conditional styling (emerald vs gray) for share link icon based on hasShareLink prop, but no existing pattern for testing CSS classes in complex conditional logic.
**Solution:** Use `screen.getByRole('button', { name: 'aria-label' })` to target the specific button, then `expect(button).toHaveClass('expected-classes')` for each conditional class, testing both light and dark variants separately.
**Why it worked:** RTL's className assertions work reliably for conditional Tailwind classes; testing both states (hasShareLink true/false) ensures complete coverage.
**Principle:** For conditional visual states, test both true/false branches with explicit className assertions on targeted elements using ARIA labels for reliable selection.

### 2026-01-07 AudioRecorder test timing + matchMedia typing
**Problem:** New AudioRecorder coverage tests failed (keyboard shortcut stop didn’t fire; TypeScript complained about matchMedia mocks with undefined addEventListener).
**Attempts:** Triggered Ctrl+Space twice and asserted completion; mocked matchMedia with missing methods.
**Solution:** Wait for the stop button to render before sending the stop shortcut; cast legacy matchMedia mocks via `as unknown as MediaQueryList`.
**Why it worked:** The UI needs to transition to recording state before stop is handled; TS needs an explicit bridge when mocks intentionally omit interface members.
**Principle:** For async UI keyboard flows, wait for state-driven DOM before asserting side effects; when mocking partial Web APIs in TS, use `unknown` casts to satisfy structural typing.

### 2026-01-11 Testing dynamic UI class changes in React
**Problem:** Tests for dynamic modal width and drawer expansion failed because assertions used stale element references or fired before state updates finished.
**Attempts:** `expect(modalContainer).toHaveClass(...)` failed even after `userEvent.type`.
**Solution:** (1) Re-find the element inside `waitFor` to ensure it targets the updated DOM node. (2) Use `data-testid` for stable selection. (3) Use `fireEvent.change` for large text blocks instead of `userEvent.type` to speed up tests.
**Why it worked:** React re-renders might replace the DOM node; `waitFor` + fresh query ensures we check the latest state.
**Principle:** For dynamic UI class assertions, always re-query the element inside `waitFor` and use stable `data-testid` anchors.

### 2026-01-11 Threshold logic ordering for auto-expansion
**Problem:** Drawer wouldn't expand to fullscreen because the `medium` threshold (1000) was checked before `fullscreen` (2000) in an `if/else if` block.
**Solution:** Reorder logic to check the largest/most specific threshold first.
**Principle:** When implementing multi-threshold triggers, always evaluate conditions from most restrictive (largest) to least restrictive.

### 2026-01-11 exhaustive-deps vs functional updates
**Problem:** `useEffect` for auto-expansion had a lint warning because `size` was used in the logic but omitted from deps to avoid loops.
**Solution:** Use the functional update pattern `setSize((prev) => ...)` to read the current state without including it in the dependency array.
**Principle:** To avoid `exhaustive-deps` warnings and unnecessary effect re-runs when state logic depends on previous state, use the functional update pattern.

### 2026-01-15 Use lcov.info for accurate per-file coverage
**Problem:** `coverage-summary.json` was stale after `npm run test`, making per-file coverage checks unreliable.
**Solution:** Read `frontend/coverage/lcov.info` directly to compute per-file line coverage (e.g., for `plan/page.tsx`).
**Principle:** In this repo, trust `lcov.info` as the source of truth for per-file coverage when validating thresholds.

### 2026-01-15 Max coverage for complex DnD handler
**Problem:** `useStructureDnd` needed the highest possible test coverage, but several branches were hard to reach.
**Attempts:** Added targeted DragOver/DragEnd tests across container/item/placeholder cases and inspected remaining uncovered lines.
**Solution:** Covered 95.77% lines and 85.4% branches with focused event-shape tests; documented remaining branches as unreachable without invalid inputs.
**Why it worked:** Simulating realistic DnD event payloads exercised nearly all paths; the remaining branches require impossible states under normal inputs.
**Principle:** For complex event handlers, use targeted event-shape tests and accept unreachable branches rather than forcing invalid inputs just to hit 100%.

---

### 2026-02-01 Mocking next/server in Jest
**Problem:** `route.test.ts` failed with `Response.json is not a function` because Jest's environment (JSDOM/node) doesn't polyfill the complete Next.js Request/Response API.
**Solution:** Explicitly mock `next/server` with a custom `NextRequest` class and `NextResponse` object that mimics the production API's behavior (`json()` method).
**Why it worked:** The test environment now has a working implementation of the API surface used by the route handler.
**Principle:** For Next.js Route Handlers tested in Jest, mocking `next/server` is often more reliable than relying on partial polyfills.

### 2026-02-01 Race Conditions in UI Tests (toBeEnabled)
**Problem:** `StepByStepWizard` test failed because it clicked "Generate Audio" immediately after an async state update, but the button was still disabled/loading or not fully interactive.
**Solution:** Added `expect(btn).toBeEnabled()` inside a `waitFor` block before the click action.
**Why it worked:** `waitFor` retries until the assertion passes, effectively waiting for the async state to settle and the UI to become interactive.
**Principle:** Always verify that a button is interactive (`toBeEnabled()`) inside `waitFor` before clicking it in tests, especially if its state depends on async operations.

---

## 🔄 Short-Term Memory (Processing) — На осмыслении

> Lessons которые нужно обработать. Группировать похожие, извлекать принципы.

### Focus Mode & Sermon Structure Integrity (3 lessons)
**Common Pattern:** Desynchronization between Focus Mode UI and sermon data models, often due to locale-specific logic or sorting overrides.
- Canonical structural tags (2026-01-26)
- Respecting structure-driven order (2026-01-26)
- Aligning Sidebar elements (2026-01-26)

**Emerging Principle:** Focus mode is a specialized view of core sermon data; it must consume the same canonical IDs and sequence ordering as the main workspace to prevent phantom bugs.

### UI/UX Consistency & Refactoring (3 lessons)
**Common Pattern:** UI changes that affect layout, alignment, and component structure
- Badge alignment in wrapped outline titles (2026-01-04)
- Focus sidebar refactor boundaries (2026-01-04)
- Safe UI modularization preserves DOM (2026-01-05)

**Emerging Principle:** UI refactoring requires preserving DOM structure and testing logical sections across all modes.

### Testing Quality & Coverage (5 lessons)
**Common Pattern:** Test failures and coverage gaps after changes
- Coverage requires changed-line verification (2026-01-04)
- Duplicate label tests need specific queries (2026-01-05)
- Mock override must beat default beforeEach (2026-01-05)
- Compile failures from typed test fixtures (2026-01-05)
- Dynamic UI class test failures (2026-01-11)
- Coverage ceiling for DnD handlers with normalized inputs (2026-01-15)

**Emerging Principle:** Tests must explicitly verify changed lines of dynamic UI (widths/heights) using fresh queries inside `waitFor` and stable anchors.

### Offline Mode Implementation Patterns (6 lessons)
**Common Pattern:** Offline functionality broken by aggressive online-only guards and cache access issues
|- AddThoughtManual button disabled offline due to useTags enabled condition (2026-01-17)
|- Offline structure requires React Query cache alignment (2026-01-15)
|- React Query tests require QueryClientProvider (2026-01-15)
|- Faster offline fallback requires shorter Workbox timeout (2026-01-16)
|- Ignore generated Workbox in ESLint (2026-01-15)
|- Offline banner requires offline status hook (2026-01-15)

**Emerging Principle:** Offline features require: (1) `networkMode: 'offlineFirst'` for cache-first queries, (2) QueryClientProvider in tests, (3) Short Workbox timeouts, (4) Proper ESLint ignores for generated files.

### Logic Decoupling & Protocol 150 (3 lessons)
**Common Pattern:** Extracting logic from monolithic components and validating with multi-layered testing.
- Refactor handleSaveEdit logic extraction (2026-01-11)
- Plan prompt refactor regression guard (2026-01-04)
- Calendar Analytics pure-logic extraction + parity verification (2026-01-14)

**Emerging Principle:** Decoupling logic into hooks/utils reduces cognitive complexity and enables focused tests; reinforce with full-suite + parity checks for confidence.

### Data Consistency (1 lesson)
**Pattern:** Export order divergence from UI order
- Export order mismatch in focus mode (2026-01-04)

**Emerging Principle:** Export ordering should match UI ordering source to prevent divergence.

### Refactoring Safety (1 lesson)
**Pattern:** Regression after helper extraction
- Plan prompt refactor regression guard (2026-01-04)

**Emerging Principle:** After helper extraction, audit downstream usage and add targeted tests for new paths.


---

## 💎 Long-Term Memory (Operating Protocols) — Интернализированные правила

> Инструкции по взаимодействию с проектом. Формат: "Контекст → Протокол → Причина"

### 📝 Debugging Protocols

**Debug Logging**
*   **Context:** Debug logging is used to track the flow of data and the state of the application.
*   **Protocol:** Use `debugLog` for logging debug messages.
*   **Reasoning:** Debug logging is used to track the flow of data and the state of the application.

### 🔧 Code Quality & Linting Protocols

**String Duplication Management**
*   **Context:** Проект использует SonarJS правила.
*   **Protocol:** При появлении 3+ одинаковых строк — **ОБЯЗАТЕЛЬНО** выносить в константу в начале файла.
*   **Reasoning:** Предотвращает ошибки копипасты и усложнение поддержки (`sonarjs/no-duplicate-string`).

**Cognitive Complexity Control**
*   **Context:** React компоненты и бизнес-логика.
*   **Protocol:** Если Cognitive Complexity > 20 (или warning):
    *   JSX: Выносить условные блоки в отдельные компоненты/рендер-хелперы.
    *   Logic: Использовать map/object lookups вместо вложенных тернарников.
*   **Reasoning:** Поддерживаемость кода. В React условный рендеринг в основном теле компонента сильно увеличивает сложность.

**Component Prop Cleanup**
*   **Context:** Удаление неиспользуемых пропсов.
*   **Protocol:** Действовать каскадно: Interface → Destructuring → Usage (grep) → Tests.
*   **Reasoning:** Оставленные "висячие" пропсы создают путаницу в API компонента.

**ESLint-Induced Test Failures**
*   **Context:** Автоматические фиксы линтера.
*   **Protocol:** После применения ESLint fixes — **НЕМЕДЛЕННО** запускать тесты.
*   **Reasoning:** Авто-фиксы могут ломать логику (например, перемещение хуков или изменение порядка импортов).

### 🧪 Testing Protocols

**Jest Mocking Architecture**
*   **Context:** Module loading phase в Jest.
*   **Protocol:** В `jest.mock()` использовать **ТОЛЬКО** строковые литералы. Переменные объявлять внутри фабрики или использовать `doMock`.
*   **Reasoning:** Переменные вне мока не инициализированы в момент поднятия мока (`ReferenceError`).

**Named Export Mock Fidelity**
*   **Context:** React components imported as named exports.
*   **Protocol:** Jest mocks must export the same named symbol (not default) when the real module uses named exports.
*   **Reasoning:** Mismatched export shapes yield `undefined` components and "Element type is invalid" render failures.

**Browser API Simulation**
*   **Context:** JSDOM окружение.
*   **Protocol:** Для API, отсутствующих в JSDOM (`matchMedia`, `ResizeObserver`, `clipboard`):
    *   Создавать полные моки с методами-заглушками.
    *   Тестировать fallback-сценарии (если API недоступно).
*   **Reasoning:** Компоненты падают при рендеринге без этих API.

**Framework Constraints Priority**
*   **Context:** Конфликт "Чистый код" vs "Требования тестов".
*   **Protocol:** Если требования Jest/RTL конфликтуют с красотой кода (например, дублирование моков) — **ВЫБИРАТЬ ТРЕБОВАНИЯ ТЕСТОВ**.
*   **Reasoning:** Работающие тесты важнее эстетики в тестовой инфраструктуре.

**Agent-Created Tests Must Run**
*   **Context:** Я добавляю новые тесты.
*   **Protocol:** Всегда запускать созданные мной тесты до ответа пользователю; добиваться green.
*   **Reasoning:** Пользователь ожидает подтвержденный результат и зеленый тестовый статус.

**Translation Mocking**
*   **Context:** `react-i18next` тесты.
*   **Protocol:** Мокать `t` функцию так, чтобы она возвращала ключ или интерполировала параметры, если они переданы.
*   **Reasoning:** Тесты часто проверяют наличие конкретного текста, который зависит от переданных переменных.

### 🔄 React & State Management Protocols

**useEffect Safety**
*   **Context:** Dependency arrays.
*   **Protocol:** **НИКОГДА** не использовать вычисляемые объекты/массивы в deps. Конвертировать ID массивов в строки (`ids.join(',')`) или использовать `useMemo`.
*   **Reasoning:** Бесконечные циклы ре-рендеринга из-за нестабильных ссылок.

**State Transition Integrity**
*   **Context:** Отслеживание изменений стейта (например, открытие таймера).
*   **Protocol:** Использовать `useRef` для хранения предыдущего значения и сравнивать с текущим внутри эффекта.
*   **Reasoning:** Эффекты запускаются чаще, чем кажется. Ref гарантирует реакцию только на *изменение*.

**Hook Import Verification**
*   **Context:** Добавление `useMemo`/`useCallback`.
*   **Protocol:** После добавления хука — **ЯВНО** проверить секцию импортов.
*   **Reasoning:** Runtime crash (`React.useMemo is not a function`) — частая ошибка при рефакторинге.

**Protocol 151: Online-First, Offline-Cache Strategy**
*   **Context:** Shared queries with persistent local cache (IndexedDB) and eventually consistent backend (Firestore).
*   **Concept:** Приоритет актуальности данных при наличии сети над скоростью первоначальной отрисовки из кэша. Система не доверяет локальному кэшу в онлайн-режиме до подтверждения от сервера, предотвращая отображение устаревших (stale) состояний, но мгновенно переключается на кэш при потере связи, обеспечивая непрерывность работы.
*   **Protocol:** 
    1.  **Fetching:** Use `useServerFirstQuery` wrapper to hide cached data when online until fresh server data arrives. Reveal internal cache only when offline or if a fetch fails.
    2.  **Implementation:** Use a **Hybrid Ref/State** pattern in wrappers. Use `useRef` for immediate "serverFetched" status (needed for tests and synchronous logic) and `useState` (render trigger) for declarative UI reactivity to external cache updates (`dataUpdatedAt`).
    3.  **Mutations/Updates:** Always use: `await cancelQueries(key)` → `setQueryData(key, updater)` → `invalidateQueries({ queryKey: key, refetchType: 'none' })`.
*   **Reasoning:** Background refetches in eventually consistent systems often return stale data before a server update propagates, causing "disappear-reappear" flickers. This protocol ensures local UI integrity during the consistency window while maintaining durable offline support via marking queries as "success" for IndexedDB persistence without triggering an immediate destructive refetch.

### 🎨 UI/UX Design System Standards

**Modal Auto-Grow with Scoped Scroll**
*   **Context:** Модальные формы, где textarea должна расти до лимита и скроллиться только она.
*   **Protocol:** Делать фиксированные header/meta/footer + textarea; считать max-height textarea как `90vh - header - meta - footer - padding`; авто-растягивать textarea до лимита; включать scroll **только** внутри textarea после достижения лимита.
*   **Reasoning:** Убирает вложенные скроллы и предотвращает UI скачки, сохраняя ожидаемый UX (скроллится только целевой блок).

**Multi-line Truncation**
*   **Context:** Текст в списках/карточках (особенно с иконками).
*   **Protocol:** Использовать: `line-clamp-X` + `break-words` + `flex-1` (или `min-w-0`). **ИЗБЕГАТЬ** `truncate` (только для 1 строки).
*   **Reasoning:** `truncate` ломает верстку если текст длиннее одной строки, скрывая важный контекст.

**Stable DOM Structure**
*   **Context:** Conditional rendering (Empty vs Loaded states).
*   **Protocol:** Поддерживать одинаковый корневой тег (обычно `div`) и структуру оберток для обоих состояний.
*   **Reasoning:** Предотвращает Layout Shifts и упрощает CSS селекторы/тесты.

**Input Interaction Consistency**
*   **Context:** Интерактивные элементы (теги, ссылки).
*   **Protocol:** Любой кликабельный инпут должен поддерживать: Click + Keyboard (Enter).
*   **Reasoning:** Accessibility (a11y) requirement.

**Card Actions Hierarchy**
*   **Context:** Длинные списки или контент.
*   **Protocol:** Кнопки действий (Edit/Delete) размещать в **Header**, а не внизу.
*   **Reasoning:** Пользователь не должен скроллить 10к слов чтобы найти кнопку редактирования.

**Tooltip Overflow Safety**
*   **Context:** Tooltip/Popover внутри карточек и контейнеров.
*   **Protocol:** Не использовать `overflow-hidden` на контейнерах, где tooltip выходит за границы. Альтернатива — рендер в portal.
*   **Reasoning:** Иначе tooltip визуально обрезается и теряет информативность.

### 📆 Calendar Module Protocols

**View vs Selection Separation**
*   **Context:** Навигация календаря.
*   **Protocol:** Разделять `viewedMonth` (что видим) и `selectedDate` (что выбрали). Передавать `viewedMonth` в дочерние списки.
*   **Reasoning:** Пользователь может смотреть события января, выбрав дату в декабре. Списки должны показывать январь.

**Series Integration Consistency**
*   **Context:** Вторичные представления (Календарь, Агенда).
*   **Protocol:** Наследовать визуальные паттерны (цвета серий, бейджи) из Dashboard. Использовать `useSeries`.
*   **Reasoning:** Пользователь должен узнавать серию проповеди мгновенно, вне зависимости от экрана.

### 🌍 Localization (i18n) Protocols

**Native Pluralization Rule**
*   **Context:** Next.js + i18next engine.
*   **Protocol:** Использовать суффиксы `_one`, `_few`, `_many`, `_other`. **ЗАПРЕЩЕНО** использовать ICU синтаксис `{{count, plural...}}` внутри строки.
*   **Reasoning:** ICU формат часто вызывает ошибки парсинга/гидратации в текущем стеке.

**Transactional Updates**
*   **Context:** Добавление/изменение ключей.
*   **Protocol:** `grep` ключа → Обновление **ВСЕХ ТРЕХ** файлов (`en`, `ru`, `uk`) в одном коммите.
*   **Reasoning:** CI тесты покрытия переводов упадут, если пропустить язык.

**Export Output Localization**
*   **Context:** Экспорт документов (Word/PDF/TXT) и экспортные UI-элементы (кнопки, тултипы, aria labels).
*   **Protocol:** Все текстовые элементы экспорта должны идти через i18n ключи, а дата форматироваться по локали пользователя. Запрещено хардкодить язык в экспортируемых документах или экспортных UI-ярлыках.
*   **Reasoning:** Экспорт — часть пользовательского интерфейса; локаль не должна ломать читаемость и ожидания пользователя.

### 🔧 Developer Experience Protocols

**Dynamic Debug Logging**
*   **Context:** Отладка в production с пользовательским контролем.
*   **Protocol:** Используй `debugLog()` из `@/utils/debugMode` вместо прямого `console.log`. Логирование включается/выключается через настройки пользователя (Debug Mode Toggle).
*   **Reasoning:** Позволяет пользователям включать подробное логирование для troubleshooting без засорения production консоли. Сохраняет performance когда отключено.

### 🧭 Architecture & Navigation Protocols

**Next.js 15 Async Params**
*   **Context:** Динамические роуты.
*   **Protocol:** Всегда `await params` перед использованием. Тип: `Promise<{ id: string }>`.
*   **Reasoning:** Требование Next.js 15. Синхронный доступ вызывает ворнинги/ошибки.

### 🤖 AI Integration Protocols

**Structured Output Enforcement**
*   **Context:** Генерация данных (мысли, теги).
*   **Protocol:** Использовать только `zodResponseFormat` + `beta.chat.completions.parse()`.
*   **Reasoning:** Regex/JSON parsing из текста ненадежны. Zod гарантирует схему.

**Scripture Reference Handling**
*   **Context:** Парсинг библейских ссылок.
*   **Protocol:** Запрашивать названия книг **НА АНГЛИЙСКОМ** в промптах.
*   **Reasoning:** Наш `referenceParser.ts` работает с английскими названиями для унификации.

**UI Refactoring Preservation**
*   **Context:** Рефакторинг UI компонентов с DOM-сенситивными тестами.
*   **Protocol:** Сохраняй ключевые классы/DOM структуру и проверяй логические секции в обоих режимах.
*   **Reasoning:** Предотвращает поломку UI и тестов при рефакторинге фокус-мода.


**Test Coverage Verification**
*   **Context:** Проверка что изменения покрыты тестами.
*   **Protocol:** Добавляй таргетированные тесты для новых DOM структур/классов и проверяй покрытие измененных строк.
*   **Reasoning:** Зеленые тесты могут не покрывать логику; явные assertions гарантируют выполнение.

**Mock Override Strategy**
*   **Context:** Переопределение shared моков в тестах.
*   **Protocol:** Используй `mockReturnValue` или reset внутри теста для полного переопределения beforeEach мока.
*   **Reasoning:** Гарантирует использование intended данных, а не дефолтного fallback.

**UI Label Duplication Handling**
*   **Context:** Тесты с повторяющимися лейблами в UI.
*   **Protocol:** Используй `getAllByText` или специфические селекторы когда UI дублирует лейблы.
*   **Reasoning:** Тесты перестают предполагать уникальность и соответствуют rendered DOM.

**Type-Safe Test Fixtures**
*   **Context:** TypeScript тесты с неполными моками.
*   **Protocol:** Трактуй test fixtures как first-class types — обновляй моки вместе с изменениями модели.
*   **Reasoning:** Tests являются частью TS программы; соблюдение контрактов модели убирает структурные ошибки.

**Export Order Alignment**
*   **Context:** Согласование порядка экспорта с UI порядком.
*   **Protocol:** Когда UI порядок определяется `ThoughtsBySection`, экспорт должен использовать тот же источник порядка.
*   **Reasoning:** Предотвращает расхождения между UI и экспортированными данными.

**Helper Extraction Audit**
*   **Context:** Рефакторинг с извлечением helper функций.
*   **Protocol:** После извлечения хелперов проверяй downstream использование и добавляй таргетированные тесты для новых путей.
*   **Reasoning:** Рефакторинг сохраняет поведение, новые тесты ловят пропущенные handoff между outputs.

---

## 📋 Memory Management Rules

### Pipeline Processing

1. **New lessons** → записывать в Lessons (Inbox) СРАЗУ
2. **3+ похожих lessons** → группировать в Short-Term для осмысления
3. **Extracted principle** → переместить в Long-Term как Протокол
4. **Processed lessons** → архивировать или удалять

### Session Logs

- **Single source:** Весь прогресс/исследования/решения идут в `.sessions/SESSION_[date]-[name].md`
- **Session State:** Не используется в MEMORY.md

### Session Start Checklist

- [ ] **Review Protocols:** Прочитать Long-Term Memory (инструкции к проекту)
- [ ] **Check Inbox:** Есть ли необработанные уроки?
- [ ] **Load Session Log:** Открыть актуальный `.sessions/SESSION_[date]-[name].md`

### Session End Checklist

- [ ] **Capture Lessons:** Были ли решены неочевидные проблемы? → Inbox
- [ ] **Update Session Log:** Записать текущий прогресс и решения в `.sessions/SESSION_[date]-[name].md`
- [ ] **Commit:** Сохранить изменения MEMORY.md

---

## 🏗️ Project Architecture Quick Reference

**Key Directories:**
- `app/components/navigation/` - DashboardNav, Breadcrumbs, navConfig
- `app/components/skeletons/` - Loading UI placeholders (Grid/Focus modes)
- `locales/{en,ru,uk}/translation.json` - All UI strings
- `config/schemas/zod/` - AI structured output schemas
- `api/clients/` - AI integration clients
- `app/(pages)/(private)/` - Auth-protected pages via `ProtectedRoute` layout
- `app/(pages)/share/` - Public share pages (no auth)
- `app/api/share/` - Public API endpoints (no auth, must sanitize output)

**Workspaces:**
- `/dashboard` - Sermons list (main workspace)
- `/series` - Series management
- `/studies` - Bible notes workspace
- `/groups` - Groups workspace (preview)
- `/settings` - User settings

**Sermon Structure Architecture:**
- `app/(pages)/(private)/sermons/[id]/structure/hooks/` - Feature-specific hooks (e.g., `useSermonActions`, `usePersistence`)
- `app/(pages)/(private)/sermons/[id]/structure/utils/` - Pure logic (e.g., `findOutlinePoint`, `buildItemForUI`)
- `app/(pages)/(private)/sermons/[id]/structure/page.tsx` - Main page orchestrator

- `app/(pages)/(private)/studies/constants.ts` - Shared study note constants and width utilities

**Key Patterns:**
- Tests: `npm run test` (NOT `npx jest` directly)
- Colors: Use `@/utils/themeColors`, never hardcode
- Auto-resize: Use `react-textarea-autosize` for growing textareas with `minRows`/`maxRows`
- Modal Width: Use `getNoteModalWidth` helper for dynamic max-width based on content
- Debug Logging: Use `debugLog()` from `@/utils/debugMode` instead of `console.log` for user-controllable debugging
- Audio Generation Workflow: Sequential optimization in `api/sermons/[id]/audio/optimize/route.ts` using "tail context" for coherent transitions. Final TTS generation (parallel) in `api/sermons/[id]/audio/generate/route.ts`.
- Structural Logic: Use `tagUtils.ts` (canonical IDs) and `sermonSorting.ts` (hierarchical order: Manual > Outline > Tags) for any logic involving sermon sections.
- Reliable Persistence: Use the pattern `await cancelQueries` -> `setQueryData` -> `invalidateQueries({ refetchType: 'none' })` to ensure IndexedDB sync without flickering. Combine with `useServerFirstQuery` (Hybrid Ref/State pattern) to strictly prioritize server data while online.
- Comments: English only in code
