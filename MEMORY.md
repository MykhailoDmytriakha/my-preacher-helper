# Project Memory (Project Operating Manual)

> **Pipeline:** Lessons (raw) → Short-Term (analysis) → Long-Term (protocols). Read this first on every session start.

---

## 🧠 Principles (Context Engineering)

### 🗺️ Architecture Map
*   **Structure:** `app/` (Next.js 15 App Router) | `api/` (Server Actions/Routes) | `utils/` (Pure Logic).
*   **State Hierarchy:** React Query (Server/Async) > URL Params (Nav/Bookmarks) > Zustand (Global Client) > Context (DI).
*   **Data Flow:** Firestore → IndexedDB (Offline) → React Query (Memory Cache) → UI.
*   **AI Stack:** OpenAI (`gpt-4o`, `gpt-4o-mini`, `tts-1`) | Zod Schema Validation (Strict) | Client-side Streaming.

### 📐 Coding Conventions
*   **Headless UI Mocking:** Always mock `@headlessui/react` in JSDOM unit tests to prevent focus-management and ref errors. Ensure mocks match the exact import style (named vs default) of the version being used.
*   **Destructive Action Flow:** When replacing immediate actions with confirmation modals, update all related unit tests to simulate the full modal lifecycle: click trigger → verify modal open → click confirm → verify callback.
*   **Zod Boundaries:** Use `zod` for ALL external data (API, AI, Forms). Types must match Zod schemas.
*   **i18n:** `i18next` + `useTranslation`. Every new `t('key')` call **must** be added to all three locale files (`en/ru/uk`) in the same change — no exceptions. `defaultValue` is only an emergency fallback, never a substitute for a proper translation. Use `_one`/`_other` keys, NOT ICU plural syntax.
*   **Testing:** `jest` + `RTL`. Test Behavior, not Implementation. Mock modules with explicit factories. `data-testid` for anchors. **Sequence-Aware Mocking** for AI chains.
*   **Coverage:** **100% test coverage** on new/modified lines (diff). Overall ≥80%. Run `npm run test:coverage && npm run lint:full`.
*   **Optimistic Sync:** Apply local state immediately, keep transient sync metadata (`pending`/`error`) separate from domain entities, always provide rollback + retry.
*   **Colors:** Use tokens from `@/utils/themeColors`. Never hardcode.
*   **Hooks:** Rules of Hooks Absolute. Complexity > 20 → Extract to Custom Hook.
*   **Normalization:** Always transform external metadata to canonical lowercase before matching.
*   **File Structure:** Vertical Slices (Feature Folder) > Horizontal Layers.
*   **Batch Pattern:** Favor single "full-state" API request over parallel "partial-state" when backend state is interconnected.
*   **Debug Logging:** `debugLog` is frontend-only. Backend must not use it.
*   **AI Telemetry:** Structured AI calls go through `callWithStructuredOutput`, emit telemetry as non-blocking side effects.
*   **Rich Editor:** TipTap headless + `tiptap-markdown` for WYSIWYG. Mock `RichMarkdownEditor` with `<textarea>` in Jest.
*   **Entity-Series Sync:** `entity.seriesId` and `series.items[]` are separate stores. Any write to `seriesId` must pair with `seriesRepository.addXxxToSeries()`.
*   **API Verification:** Always verify exact shape of API responses in frontend handlers.
*   **Tabular Alignment:** Use `tabular-nums` + `font-mono` for numeric counters to prevent layout shifts.
*   **Ideal Storage (TRIZ+IFR):** If a resource (images) is only needed for transient context (email), avoid duplicating it in persistent storage (Firestore). Leverage existing systems (inbox) to solve storage needs without bloating the core database.
*   **Mobile Modal Scrollability:** Long modals on mobile must be full-screen (`absolute inset-0`) with a single `overflow-y-auto` container to prevent "trapped scrolling" and ensure all content is accessible. Avoid `max-h-X` with internal scroll for mobile.
*   **SSR-Safe Viewport Detection:** Use `typeof window !== 'undefined'` check when initializing state from `window.innerWidth` to prevent hydration mismatches and SSR crashes.

### ⚖️ Domain Axioms
*   **Offline-First:** UX never blocks on network. Read from Cache immediately. `networkMode: 'offlineFirst'`.
*   **Sermon Integrity:** Outline (Structure) is source of truth for ordering. Logic: Outline → Structure → Tags.
*   **User Control:** Heavy AI actions require explicit buttons, not auto-magic.
*   **Session-Log:** One Chat = One Session Log = Single Source of Truth.

### ⛔ Anti-Patterns
*   **Implicit AI Parsing:** Never parse AI text with Regex. Use JSON Mode / Structured Output.
*   **Conditional Hooks:** Never return early before hook definitions.
*   **Stale Cache:** Never rely on `setQueryData` alone; always pair with `invalidateQueries` or `cancelQueries`.
*   **Console Log:** Never `console.log` in prod; use `debugLog()`.
*   **Interactive Nesting:** Never nest buttons/links inside labels or other interactive containers.
*   **CSS-Unity Hack:** Never use `overflow-hidden` + shared `border-radius` to fake unity. Use slot props (`splitLeft`, `renderHeader`).
*   **Negative-Offset Clip:** Never place `overflow-hidden` on a flex/grid container that hosts components with absolute-positioned children using negative offsets (`-top-1`, `-left-1`, `-right-1`). Those offsets extend outside the component's own bounds and will be clipped.
*   **Mobile Nested Scroll:** Avoid `overflow-y-auto` on small sub-containers inside mobile modals; let the main modal container scroll the whole page to prevent "touch-trapping."
*   **useState Prop Snapshot:** Never rely solely on `useState(prop)` for data that arrives after mount. Pair with `useEffect` + dirty-ref guard.

---

## 🆕 Lessons (Inbox) — Extracted Principles

> One-line principles. History in git blame. Newest first.

- **2026-02-27 Absolute-Offset Clip:** When a component renders control buttons with `absolute -top-1 -left/right-1` (e.g. FocusRecorderButton Pause/Cancel), any ancestor `overflow-hidden` clips those -4px overflows. Fix: remove `overflow-hidden` from the flex header container; text truncation is already covered by `truncate` + `min-w-0` on the inner text element.
- **2026-02-27 Plan Actions Split:** For plan generate/save flows, keep fetch code in `planApi.ts`, orchestration/toasts in `usePlanActions`, and page-local state mutations in callbacks; this preserves behavior while making API and error paths unit-testable.
- **2026-02-27 Deterministic Section Markdown:** Section outline markdown must be built from ordered outline IDs + content map (ID-based), not heading text splice/replacement; otherwise duplicate titles cause accidental cross-point overwrites.
- **2026-02-27 Outline Lookup Semantics:** When replacing repeated `some/find` scans with memoized lookup maps, preserve original section precedence (`introduction -> main -> conclusion`) for duplicate IDs and lock this with dedicated util tests.
- **2026-02-27 Copy UX Unification:** When the same copy-to-clipboard flow exists in multiple views, centralize status/timer/toast behavior in a hook and keep button/icon/ARIA rendering in a dedicated component to eliminate state-drift bugs between modes.
- **2026-02-27 Global CSS Dedup by Variant:** When one page has repeated `style jsx global` blocks across view modes, extract a shared style component with explicit `variant` flags for mode-specific extras to prevent style drift while preserving behavior.
- **2026-02-27 Import Grouping After Extraction:** When moving page-local constants/types to sibling files, keep explicit blank lines between alias imports (`@/...`) and relative imports (`./...`), and between value/type imports, or `import/order` will fail in lint gate.
- **2026-02-27 Headless UI v2 Mocking:** Always mock `@headlessui/react` in JSDOM tests to avoid ref-forwarding and focus-trap errors; ensure mocks include `DialogPanel`, `DialogBackdrop`, and use named exports where appropriate.
- **2026-02-27 ConfirmModal vs window.confirm:** When replacing `window.confirm()` with a custom `ConfirmModal`, always remove the `window.confirm()` from the parent handler too — otherwise both fire sequentially: custom modal confirms, then system dialog appears.
- **2026-02-26 Device-Specific Default State:** Initialize collapsible states based on `window.innerWidth < 640` (SSR-safe) to optimize initial vertical space for sermon outlines on mobile.
- **2026-02-26 Mobile Modal Full-Screen:** UI modals with internal scrolling behave poorly on mobile browser viewports. Solution: Use `absolute inset-0` + `overflow-y-auto` on the main container for full-screen scrolling.
- **2026-02-26 Outline Point Deletion Logic:** When a parent structural element (outline point) is deleted, do not cascade delete its children (thoughts). Unassign them (`outlinePointId: undefined`) to preserve user data.
- **2026-02-26 JSX Modal Rooting:** Modals should be hoisted to the container boundary (like `Column.tsx`) instead of being duplicated in mapped items (`SermonPointPlaceholder`). Use ID callbacks (`onDeletePoint(id)`) to trigger them.
- **2026-02-26 Feedback Image Strategy (TRIZ+IFR):** To avoid Firestore bloat with Base64 images, send them via email only and store only `imageCount` in DB. Inbox acts as the Ideal Final Result for persistent visual context.
- **2026-02-26 URL Migration (/dashboard→/sermons):** Grep all hardcoded refs first → move content to new URL → redirect old URL → update tests last. Always preserve old URL as redirect.
- **2026-02-25 TipTap Headless:** For WYSIWYG with raw Markdown storage, TipTap headless + `tiptap-markdown` gives 100% symmetric MD serialization. Avoid "Notion clone" wrappers (Novel).
- **2026-02-25 TipTap Jest Mock:** Always mock WYSIWYG editors (`RichMarkdownEditor`) with `<textarea>` in Jest — JSDOM can't handle `contenteditable`.
- **2026-02-25 Series Dual-Store Bug:** Setting `entity.seriesId` is metadata only. Must also call `seriesRepository.addXxxToSeries()` — series list is driven by `series.items[]`, not by querying entities.
- **2026-02-24 Sibling Typography:** When UI sections act as visual peers, explicitly copy typography classes across different semantic tags (`h2` vs `div`).
- **2026-02-24 Modal Stale Cache:** `useState(prop)` initializes once. If prop arrives late (React Query refetch), pair with `useEffect` + dirty-ref to sync.
- **2026-02-24 Grid Card Footer Alignment:** Wrap main content in `flex-1` to push footer to bottom across dynamic-height cards.
- **2026-02-24 Headless UI in Jest:** Mock `ConfirmModal` (Headless UI) in tests — JSDOM can't handle transition measurements.
- **2026-02-24 Toggle Switch Pattern:** `w-11` rail + `border-2 border-transparent` + `h-5 w-5` thumb + `translate-x-5/translate-x-0`. Headless UI canonical.
- **2026-02-24 Smart Back Nav:** `router.back()` when `history.length > 1`, else `router.push(fallback)`. Via `BackLink.tsx`.
- **2026-02-24 Beta Feature Toggle:** 5-step: `models.ts` → `userSettings.service.ts` → `useUserSettings.ts` → `*Toggle.tsx` → `settings/page.tsx`.
- **2026-02-24 Dynamic Color Tinting:** Light: inline `rgba(r,g,b,0.07)`. Dark: overlay `div` with `opacity-0 dark:opacity-100` — Tailwind `dark:` can't apply to dynamic inline styles.
- **2026-02-24 TRIZ Split Button:** CSS wrapping fakes unity. True split-button: component that owns state renders both parts via `splitLeft` slot prop → single DOM tree.
- **2026-02-23 React Query Optimistic Sync:** Use `cancelQueries` + `refetchType: 'none'` for persistence without refetch flicker. Never include `isFetching` in loading state for skeletons.
- **2026-02-23 TRIZ UI Simplification:** When list item > 3 actions, migrate destructive/contextual functions to detail view or ⋯ menu.
- **2026-02-23 nuqs Mock Pattern:** Mock URL state libraries with internal `React.useState`, not static globals — aligns with React reconciliation.
- **2026-02-23 Translation Duplicate Keys:** Duplicate keys in locale JSON produce syntax errors at webpack parse time; enforce uniqueness.
- **2026-02-23 AI Conditional Fields:** AI should fill empty fields, not overwrite user content. Tests must clear fields before asserting auto-population.
- **2026-02-23 Cognitive Complexity:** Extract state/effects into custom hooks when complexity > 20.
- **2026-02-23 Global Breadcrumbs:** Audit global layout before adding page-level navigation — avoid duplication.
- **2026-02-23 Separation in Space:** Use existing safe zones (sticky header) for controls instead of floating layers that risk collision.
- **2026-02-16 API Contract Mismatch:** Frontend must check `polishedText || originalText` — never assume a single key name.
- **2026-02-16 Button in Label:** Never nest interactive elements inside `<label>` — breaks event propagation.
- **2026-02-14 Tree Hierarchy Utils:** Separate tree traversal (search) from structural transformation (mutation) for portability and testability.
- **2026-02-14 High-Latency Auto-Save:** For complex model sync, debounce 15s+ with "Saving..." indicator and opt-out toggle.
- **2026-02-14 JSDOM Crypto Mock:** Use `Object.defineProperty(global, 'crypto', ...)` — bypasses read-only assignment guard.
- **2026-02-11 Dashboard Optimistic Flow:** Separate domain entities from sync metadata. Every optimistic write needs rollback + user-visible recovery.
- **2026-02-10 Calendar Date Drift:** Normalize preach dates to `YYYY-MM-DD`. Drive markers/list/analytics from one shared event map.
- **2026-02-06 Prompt Telemetry:** Modular `promptBuilder` + centralized `aiTelemetry` at `callWithStructuredOutput` join point. Non-blocking Firestore writes.
- **2026-02-03 Jest Fake Timers:** Always restore with `jest.useRealTimers()` in `afterEach`.
- **2026-02-02 Book Parsing:** Fuzzy prefix match only for short tokens (≤4 chars) + require chapter number to avoid false positives.
- **2026-02-02 Scripture Line Clamp:** Remove `line-clamp`; use `whitespace-pre-line` + container scroll for full text.
- **2026-02-01 PDF Forensics:** Validate export type (raster vs text) with `pdfimages`/`pdftotext` before changing rendering logic.
- **2026-02-01 Duplicate Audio Prevention:** Single "full-state" API request when `sections === 'all'` — prevents fan-out duplication.
- **2026-02-01 Cognitive Complexity Fix:** Extract Logic → Custom Hook, Rendering → Sub-component, nested ternaries → Content component with early returns.
- **2026-02-01 Hierarchical Sorting:** Resolve order by: Manual Structure > Outline Points order > Tag-based orphans.
- **2026-02-01 Tag Normalization:** Add all camelCase variants to alias map + enforce lowercasing.
- **2026-02-01 Sequence-Aware Mocking:** Use `mockResolvedValueOnce` chains + `toHaveBeenNthCalledWith` for AI chain testing.
- **2026-02-01 Jest Transform Fix:** When build system fights new file recognition, merge into known-good test file.
- **2026-02-01 Safe Global Mocking:** `Object.defineProperty(navigator, 'clipboard', ...)` for read-only browser APIs.
- **2026-02-01 Context-Aware Audio:** Sequential processing with tail context (~1000 chars) for coherent AI speech. Coherence requires state.
- **2026-02-01 Skeleton Coverage:** Don't mock visual-only components — give them `data-testid` and let them render.
- **2026-02-01 Subpixel Seams:** For percentage-based transforms, 1px overlap (`calc`) masks mobile subpixel gaps.
- **2026-02-01 Tab Wrapping:** Mobile tabs: `flex-wrap` + `gap` over `flex-nowrap` + scroll.
- **2026-02-01 Equal Button Width:** `flex-1 basis-0 min-w-[64px]` for buttons with varying labels.
- **2026-02-01 Feature Gating Consistency:** Feature availability must use same source of truth as its UI indicator.
- **2026-02-01 Export i18n:** All export UI + document strings through i18n + locale-aware dates. Safe fallbacks for tests.
- **2026-02-01 Tooltip Clipping:** Containers with tooltips need `overflow-visible` or portal rendering.
- **2026-02-01 Named Export Mocks:** Jest mocks must mirror module export shape (named vs default) or React renders `undefined`.
- **2026-01-31 Structured Data over Localized Strings:** Never use UI-facing localized strings as data extraction anchors. Use typed data objects.
- **2026-01-31 Unified Props:** When component used in multiple contexts, synchronize data through explicit unified props.
- **2026-01-31 CORS Test Env:** Tests relying on `process.env` must set/clear in beforeEach and restore in afterEach.
- **2026-01-31 Skeleton ≠ Empty State:** Skeleton = waiting (loading). Empty State = terminal result. Never conflate.
- **2026-01-31 Conditional Return Placement:** All early returns (skeleton/loading/error) after ALL hook definitions.
- **2026-01-31 URL State Persistence:** For filters/tabs persisting across navigation, use URL params over `useState`.
- **2026-01-31 Next.js Nav Mocks:** Mock `useRouter` (push/replace) + `useSearchParams` (get method) for URL-driven tests.
- **2026-01-30 Server-First Race Fix:** Derive "server-fetched" from `isSuccess && data` defensively, not just imperative `useRef` flags.
- **2026-01-30 Simplified Utility Mocks:** When partial mocks cause ReferenceErrors, use full explicit mock objects over `requireActual`.
- **2026-01-30 Parallel Mock Consumption:** Parallel requests consume N mocks FIFO — mock N responses for each batch before next sequential step.
- **2026-01-26 Hybrid Ref/State:** `useRef` for immediate status (tests, sync logic) + `useState` trigger for declarative UI reactivity to `dataUpdatedAt`.
- **2026-01-26 Cancel+Invalidate Pattern:** `cancelQueries` → `setQueryData` → `invalidateQueries({ refetchType: 'none' })` prevents flicker in eventually consistent environments.
- **2026-01-26 Canonical Structural Tags:** Use canonical IDs (`intro`, `main`, `conclusion`) in logic. Localized strings only for display.
- **2026-01-26 Structure-Driven Order:** `structure` array of IDs is primary ordering truth. Never re-sort by individual `position` fields.
- **2026-01-26 Sidebar Consistency:** Maintain consistent functional ordering (icons → badge) across view modes.
- **2026-01-25 One Chat = One Session Log:** If duplicates appear, merge immediately.
- **2026-01-21 Shared Observer Masking:** Derive "server-fetched" from `dataUpdatedAt`, not just local `queryFn` execution.
- **2026-01-21 Coverage Test Fixes:** Re-query DOM after state updates. Align mock typings with real signatures.
- **2026-01-18 Multi-Key Invalidation:** When updating shared data across components with different query keys, invalidate ALL relevant keys.
- **2026-01-18 Cache Desync Pattern:** `setQueryData` + `invalidateQueries` across all optimistic locations. Applied to 6 locations app-wide.
- **2026-01-18 Focus Mode Jumping:** Global `refetchOnMount: 'always'` causes excessive refetches. Check global data config first when debugging UI jumping.
- **2026-01-17 Tooltip Boundary Detection:** For scrollable containers, use `getBoundingClientRect()` + automatic repositioning (above→below, left→right).
- **2026-01-17 Offline Query Guard:** Use `networkMode: 'offlineFirst'` instead of `enabled: false` offline — preserves cache access.
- **2026-01-17 Debug Logging:** `debugLog()` from `@/utils/debugMode` with user toggle in settings.
- **2026-01-16 Workbox Timeout:** Set `networkTimeoutSeconds: 1` for fast offline fallback.
- **2026-01-15 Offline Structure:** Offline pages must read from persisted React Query cache, not short-circuit on offline status.
- **2026-01-15 QueryClientProvider in Tests:** Any component using React Query hooks requires `QueryClientProvider` in test wrapper.
- **2026-01-15 Workbox ESLint:** Add `public/workbox-*.js` to ESLint ignores.
- **2026-01-15 lcov.info:** Trust `frontend/coverage/lcov.info` for per-file line coverage verification.
- **2026-01-15 DnD Coverage Ceiling:** Accept unreachable branches (~95%) rather than forcing invalid inputs for 100%.
- **2026-01-14 Analytics Refactor:** Extract pure logic into utilities, keep UI thin, validate with tests + real-world parity.
- **2026-01-14 Refresh Must Match Data Source:** Refresh actions must update the same data source the UI section renders.
- **2026-01-12 Async UI Testing:** `fireEvent.change` for reliable input. `await screen.findBy*` over `waitFor(() => getBy*)`.
- **2026-01-11 JSDOM window override:** `Object.defineProperty(global, 'window', ...)` for SSR branch coverage.
- **2026-01-11 CSS Grid Alignment:** Fixed widths for metadata columns, single `1fr` for flexible content.
- **2026-01-11 i18n Mount Timing:** Use `waitFor` + `getAllByText` for labels that render after mount.
- **2026-01-11 Conditional Visual States:** Test both true/false branches with className assertions via ARIA labels.
- **2026-01-11 Threshold Ordering:** Multi-threshold triggers: evaluate from most restrictive (largest) to least.
- **2026-01-11 exhaustive-deps Fix:** Functional update `setState(prev => ...)` to read state without dependency.
- **2026-01-11 Decoupling Complex Logic:** Extract stateful interactions → custom hooks, pure logic → utilities. Verify with targeted tests.
- **2026-01-07 AudioRecorder Test Timing:** Wait for state-driven DOM before keyboard assertions. `as unknown as MediaQueryList` for partial Web API mocks.
- **2026-01-11 Dynamic UI Class Tests:** Re-query inside `waitFor` + `data-testid` anchors for dynamic class assertions.
- **2026-02-01 Mocking next/server:** Mock `NextRequest`/`NextResponse` in Jest for Route Handler tests.
- **2026-02-01 toBeEnabled Before Click:** Always `waitFor(() => expect(btn).toBeEnabled())` before clicking async-dependent buttons.
- **2026-02-02 Coverage Blind Spots:** High project-wide coverage hides zero-coverage cliffs in specific files. Enforce ≥80% per file.
- **2026-02-02 Test Rendered Reality:** With i18n mocks returning fallbacks, assert against rendered text, not translation keys.

---

## 💎 Long-Term Memory (Operating Protocols)

> Format: **Name:** instruction. *(reason)*

### 📝 Debugging
- **Debug Logging:** Use `debugLog()` from `@/utils/debugMode`, never `console.log`. Auto-replace any `console.log` found.

### 🔧 Code Quality
- **String Duplication:** 3+ identical strings → extract to constant. *(sonarjs/no-duplicate-string)*
- **Cognitive Complexity > 20:** JSX → extract sub-components. Logic → map/object lookups over nested ternaries.
- **Prop Cleanup:** Interface → Destructuring → Usage (grep) → Tests. Remove orphaned props cascadingly.
- **Post-Lint Test Run:** After ESLint auto-fixes, IMMEDIATELY run tests. *(auto-fixes can break logic)*

### 🧪 Testing
- **Jest Mock Hoisting:** `jest.mock()` uses ONLY string literals. Variables inside factory or use `doMock`. *(ReferenceError at hoist time)*
- **Named Export Fidelity:** Mock must export same symbol shape (named vs default) as real module. *(undefined component otherwise)*
- **Browser API Simulation:** For missing JSDOM APIs (`matchMedia`, `ResizeObserver`, `clipboard`) create full mocks with stub methods. Test fallbacks.
- **Framework > Aesthetics:** Jest/RTL requirements win over "clean code" in test infrastructure.
- **Types-Only Exclusion:** Exclude types-only modules from `collectCoverageFrom`. Add back if file gains runtime logic.
- **Agent Tests Must Run:** Always run created tests and achieve green before responding.
- **Translation Mock:** `t` function must return key or interpolate params if passed.

### 🔄 React & State
- **useEffect Deps:** NEVER use computed objects/arrays. Convert to `.join(',')` or `useMemo`. *(infinite render loops)*
- **State Transitions:** Use `useRef` for previous value, compare in effect to react only on change.
- **Hook Import Check:** After adding `useMemo`/`useCallback`, verify import section. *(runtime crash otherwise)*
- **Online-First Protocol (151):** `useServerFirstQuery` hides cached data online until fresh fetch. Hybrid Ref/State: `useRef` for immediate status + `useState` for UI reactivity via `dataUpdatedAt`. Mutations: `cancelQueries` → `setQueryData` → `invalidateQueries({ refetchType: 'none' })`. *(prevents stale-data flicker in eventually consistent systems while maintaining offline support)*

### 🎨 UI/UX
- **Modal Auto-Grow:** Fixed header/meta/footer + textarea. `max-height: 90vh - fixed parts`. Scroll inside textarea only.
- **Multi-line Truncation:** `line-clamp-X` + `break-words` + `flex-1`/`min-w-0`. Avoid `truncate` (single-line only).
- **Stable DOM:** Same root tag structure for Empty vs Loaded states. *(prevents layout shifts)*
- **Input Consistency:** Every clickable input must support Click + Keyboard (Enter). *(a11y)*
- **Card Actions:** Edit/Delete in Header, not footer. *(user shouldn't scroll to find actions)*
- **Tooltip Safety:** No `overflow-hidden` on tooltip containers. Use portal if needed.

### 📆 Calendar
- **View vs Selection:** Separate `viewedMonth` (what we see) from `selectedDate` (what was clicked). Pass `viewedMonth` to children.
- **Single Date Pipeline:** Normalize to `YYYY-MM-DD` at API boundary. Build month-view/list/analytics from one `eventsByDate` pipeline.
- **Series Consistency:** Inherit visual patterns (series colors, badges) from Dashboard via `useSeries`.
- **Book Parsing:** Fuzzy prefix only for short tokens (≤4 chars) + require chapter number.

### 🌍 i18n
- **Pluralization:** `_one`/`_few`/`_many`/`_other` suffixes. NO ICU syntax.
- **Transactional Updates:** `grep` key → update ALL THREE locale files (en/ru/uk) in one commit.
- **Export Strings:** All export UI + document text through i18n + locale-aware dates. No hardcoded language.

### 🧭 Architecture
- **Next.js 15 Params:** Always `await params` before use. Type: `Promise<{ id: string }>`.

### 🤖 AI Integration
- **Structured Output:** Only `zodResponseFormat` + `beta.chat.completions.parse()`. No regex/JSON parsing from text.
- **Prompt Blueprints:** Build system/user prompt as blueprint from named blocks (`blockId`, `category`, `source`, `hash`, `length`).
- **Telemetry Sidecar:** Write to Firestore async (best-effort). Errors must not affect AI response path.
- **Scripture References:** Request book names IN ENGLISH in prompts. *(referenceParser.ts uses English)*
- **UI Refactor Safety:** Preserve key classes/DOM structure. Check logical sections in both modes.
- **Test Coverage:** Add targeted tests for new DOM structures. Green tests ≠ covered logic.
- **Mock Override:** Use `mockReturnValue` or reset inside test to fully override `beforeEach` mock.
- **Label Duplicates:** Use `getAllByText` or specific selectors when UI duplicates labels.
- **Type-Safe Fixtures:** Treat test fixtures as first-class types — update mocks with model changes.
- **Export Order:** Use same ordering source (`ThoughtsBySection`) for export as for UI.
- **Helper Extraction Audit:** After extraction, audit downstream usage + add targeted tests for new paths.

---

## 📋 Memory Management Rules

1. New lesson → Lessons Inbox immediately
2. 3+ similar lessons → group, extract principle → Long-Term Protocol
3. Processed lessons → archive or delete
4. Session logs: `.sessions/SESSION_[date]-[name].md` — single source per chat
5. **Session Start:** Read Long-Term Memory → Check Inbox → Load Session Log
6. **Session End:** Capture lessons → Update Session Log → Commit

---

## 🏗️ Project Architecture Quick Reference

**Key Directories:**
- `app/components/navigation/` — DashboardNav, Breadcrumbs, navConfig
- `app/components/skeletons/` — Loading UI placeholders
- `app/hooks/useDashboardOptimisticSermons.ts` — Optimistic mutation orchestrator
- `app/models/dashboardOptimistic.ts` — Sync-state types (`pending`/`error`)
- `locales/{en,ru,uk}/translation.json` — All UI strings
- `config/schemas/zod/` — AI structured output schemas
- `api/clients/` — AI integration clients
- `app/(pages)/(private)/` — Auth-protected pages
- `app/(pages)/share/` — Public share pages (no auth)
- `app/api/share/` — Public API endpoints (sanitize output)

**Workspaces:** `/sermons` (main) | `/series` | `/studies` | `/groups` (preview) | `/settings`

**Sermon Structure:**
- `sermons/[id]/structure/hooks/` — `useSermonActions`, `usePersistence`
- `sermons/[id]/structure/utils/` — `findOutlinePoint`, `buildItemForUI`
- `app/components/sermon/SermonOutline.tsx` — Collapsible outline with `isMobile` default state.
- `sermons/[id]/structure/page.tsx` — Main orchestrator

**Studies:** `studies/constants.ts` (widths) | `studies/[id]/page.tsx` (editor) | `hooks/useFilteredNotes.ts`

**Key Patterns:**
- Tests: `npm run test` (NOT `npx jest`)
- Colors: `@/utils/themeColors`, never hardcode
- Auto-resize: `react-textarea-autosize` with `minRows`/`maxRows`
- Modal Width: `getNoteModalWidth` helper
- Debug: `debugLog()` from `@/utils/debugMode`
- Audio: Sequential optimization with tail context → unified batch from client → parallel TTS
- AI Analytics: `promptBuilder.ts` → `structuredOutput.ts` (join point) → `aiTelemetry.ts` (Firestore sidecar)
- Structural Logic: `tagUtils.ts` (canonical IDs) + `sermonSorting.ts` (Manual > Outline > Tags)
- Persistence: `cancelQueries` → `setQueryData` → `invalidateQueries({ refetchType: 'none' })` + `useServerFirstQuery`
- Calendar: Date-only `YYYY-MM-DD` → one normalized pipeline
- Dashboard Optimistic: `useDashboardOptimisticSermons` + `SermonCard.tsx` retry/dismiss
- Comments: English only in code
- Beta Toggles: `models.ts` → `userSettings.service.ts` → `useUserSettings.ts` → `*Toggle.tsx` → `settings/page.tsx`
- Mobile Detection: `typeof window !== 'undefined' && window.innerWidth < 640` (Tailwind `sm` boundary).
- Dynamic Color Tinting: Light = inline `rgba()`, Dark = overlay div with `opacity-0 dark:opacity-100`
- Back Nav: `BackLink.tsx` with `router.back()` + fallback
- Toggle Switch: `w-11` rail, `h-5 w-5` thumb, `translate-x-5/translate-x-0`, Headless UI spec
