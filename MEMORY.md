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
*   **Coverage:** **3-Rule Protocol** on every code change: **Rule 1** — 100% of changed lines covered & explicitly asserted (always mandatory). **Rule 2** — file baseline < 80% → raise to ≥80%. **Rule 3** — file baseline ≥ 80% → raise by ≥+5pp. Run `npm run test:coverage && npm run lint:full` from root until both green.
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
*   **In-Tree Modal Render:** Never render a modal directly inside-tree without `createPortal`. Even with `z-50`, ancestor stacking contexts (nav, cards, dropdowns) will sit on top. Always use `createPortal(content, document.body)` + `mounted` state guard for SSR. In tests, mock `createPortal: (node) => node`.

---

## 🆕 Lessons (Inbox) — Extracted Principles

> One-line principles. History in git blame. Newest first.

- **2026-03-15 Modals Without createPortal Are Invisible Z-Index Bombs:** Any modal that renders inside-tree (not via `createPortal`) is subject to its ancestor's stacking context — even with `z-50`. On mobile viewports, parent stacking contexts (nav, card containers, floating buttons) will render on top. Fix: always use `createPortal(content, document.body)` with a `mounted` state guard for SSR safety, consistent with the project standard (14 of 16 modals already use this pattern). In tests, mock `react-dom` with `createPortal: (node) => node`.

- **2026-03-13 Cross-Note Review Lanes Need Their Own Scope And Unit Language:** When a workspace shows both note-level review cards and branch-level review lanes, do not derive lanes from the already metadata-filtered note list, and do not reuse the same labels for both surfaces. Notes and branches are different units; the UI must preserve that distinction in both scope and wording.
- **2026-03-13 Collapsed Review Surfaces Must Expose A Recovery Path:** If a semantic review lane shows only the first N items, the hidden remainder needs an explicit “show all” path in the same surface. A badge with a larger total but no local expansion path is a broken workflow promise.
- **2026-03-13 Branch-Level Review Surfaces Should Derive From Existing Branch-State, Not New Storage:** Once note-level metadata summaries and branch deep links already exist, the next high-leverage retrieval layer is often cross-note branch review queues derived from `notes + companion branch-state`. Do not invent a second persistence model just to surface actionable branches in the workspace.
- **2026-03-13 Cross-Note Metadata Lenses Must Survive Detail Navigation:** Once workspace retrieval gains semantic filters, the detail page cannot keep paginating with an older tag/book/search-only filter seam. Prev/next navigation must inherit the same metadata lens or the semantic stack feels fake the moment the user drills into a note.
- **2026-03-13 Companion Batch Queries Need Mutation-Side Invalidation:** If workspace semantics depend on a batch companion-state query, detail-page writes to a single note’s companion state must invalidate that batch query key after success. Otherwise the workspace shows “ghost metadata” and loses trust even when persistence is correct.
- **2026-03-13 Active Session Logs Need Explicit Write Targets Before Compaction:** For a still-active source-of-truth session, prefer strict write-target rules (dedicated appendices/inboxes, canonical sections owned by Codex) over compaction. Do not compact the active main session unless the user explicitly wants that tradeoff after seeing the risk.
- **2026-03-13 Branch Semantics Belong In Companion Metadata, Not Markdown:** Once branch identity and deterministic remap exist, richer meaning layers such as semantic labels should persist in companion branch-state and hydrate back onto the parsed outline. This preserves clean markdown while letting branch-level semantics grow without reopening the canonical content model.
- **2026-03-13 Controlled Branch Metadata Must Store Canonical Enum Values, Not Localized Labels:** Branch kind/status should persist as stable canonical values (`evidence`, `confirmed`) and only translate at render time. Storing localized strings in metadata or markdown makes filtering, testing, and cross-locale behavior fragile.
- **2026-03-13 Metadata Fields Need Retrieval Surfaces Before More Fields:** In knowledge tools, the next high-leverage step after proving a metadata seam is usually filter/search/summary exposure across views, not adding another isolated field. More fields without retrieval leverage produce hidden richness and low workflow value.
- **2026-03-13 Cross-Note Metadata Should Stay Derived From Companion Branch-State:** When lifting branch metadata into workspace retrieval, do not denormalize it into `StudyNote.content` or mutate the canonical note model. Batch-read companion branch-state, derive note-level summaries, and feed filters/cards/search from those summaries. This preserves markdown-first truth while unlocking cross-note retrieval.
- **2026-03-13 Synthesis Surfaces Should Reuse Retrieval Seams, Not Invent New Persistence:** Once cross-note metadata retrieval exists, add higher-order UX like review cards and top-label shortcuts by deriving from the same summary map. Do not create a second storage layer just to make workspace-level synthesis feel richer.
- **2026-03-12 Pending Editor Commands Beat Raw Markdown Surgery For Cursor-Aware Insertions:** When the canonical model is still markdown but the user expects insertion at the live cursor, do not rewrite the raw markdown string in page state. Send a tokenized pending insertion command into the rich editor and let the editor insert at its actual current selection.
- **2026-03-12 Internal Branch Links Can Stay Pure Markdown:** If the note model is markdown-first, internal branch navigation does not require a custom link syntax. Standard markdown links targeting `#branch=<branchId>` can stay plain text while the page layer intercepts them and resolves the target through companion branch identity.
- **2026-03-12 Preserve Early Branch-State Mutations During Async Bootstrap:** If companion branch-state loads asynchronously, early local identity actions (deep-link reveal, lazy branch-ID creation, fold/unfold) must not be overwritten by the eventual load response. Track pre-load local mutations explicitly and let them win for that bootstrap cycle.
- **2026-03-12 Editor-Local Node IDs Are Not Durable Without Round-Trip Support:** A rich-text editor can keep stable node IDs within a session, but if canonical persistence is markdown and the app regularly rebuilds the editor document via `setContent(markdown)`, those node IDs are not a cross-session identity seam. Treat them as ephemeral unless the serialization layer can rehydrate them back into the document.
- **2026-03-11 Selection-Bridge Tests Must Use Semantic Occurrence Indexes:** When testing heading-first editor bridges, a mock cannot use the flat heading array index as `occurrenceIndex`; nested headings change flat order. Compute occurrence among same `headingLevel + headingText` matches or the page-side branch remap will appear broken even when the real bridge contract is correct.
- **2026-03-11 Prefer Structural Lookup Over Path-Key Arithmetic:** While branch identity still uses positional path keys, any logic about sibling relationships or parent adoption should query the current outline tree structurally instead of deriving neighbors by string arithmetic. That keeps the seam stable as the system moves toward true branch IDs.
- **2026-03-11 Heading-First Promote/Demote Is a Subtree Cascade:** In a heading-first outline, promoting or demoting a branch is never a one-line heading edit. Shift every heading marker inside `sourceRange.startOffset .. subtreeEndOffset` together, otherwise parent/child ownership silently breaks.
- **2026-03-11 One Normalization Contract Per Outline Mutation:** If heading-first outline edits can both move branches and create branches, route them through the same markdown boundary-normalization contract. Separate mutation seams for move vs insert quickly diverge and create formatting drift inside the same note model.
- **2026-03-11 Markdown Fence Closure Must Track Length:** For heading-aware markdown parsers, fenced code blocks cannot be tracked by fence character alone. Closing a fence requires the same marker type and a length at least as long as the opener; otherwise headings inside long-fence code blocks are falsely promoted into structure.
- **2026-03-11 Derived Path Keys vs Reorder State:** If outline branch identity is derived from runtime path keys (`1`, `1.2`, `2.1`), any subtree reorder invalidates key-based fold/selection state. Until stable branch IDs exist, clear or recompute that UI state after moves instead of reusing stale keys.
- **2026-03-11 Heading-First Subtree Swaps Need Separator Normalization:** When swapping sibling heading-based subtrees by raw markdown offsets, do not assume the moved slice carries its own inter-branch blank line. Normalize separators between swapped slices or headings can concatenate into invalid-looking text (`body## Next`).
- **2026-03-10 Reversible Outline Shortcuts:** In outline editing, structural hotkeys must be reversible. If `Body -> H1` happens on `Tab`, then `H1 -> Body` must happen on `Shift-Tab`; otherwise the user gets trapped in a structural state that only the dropdown can undo.
- **2026-03-10 Normalized Outline Depth Parity:** If edit mode and read/preview mode both visualize a heading-first tree, their branch indentation must normalize against the note’s base heading level, not the absolute markdown heading number; otherwise mode switching creates false structural drift.
- **2026-03-10 Tab Must Stay In Outline Flow:** In outliner editing, `Tab` on body text must not fall through to browser focus navigation. Provide an in-editor fallback transition such as `Body -> H1`, then let subsequent `Tab / Shift-Tab` manage branch depth.
- **2026-03-10 ProseMirror Node Decoration Ranges:** `Decoration.node()` must use the node’s outer boundaries (`offset .. offset + nodeSize`), not inner-content positions. If the range is shifted inward, class-based visual layers silently fail even when the higher-level logic is correct.
- **2026-03-10 Outline Depth as View Layer:** In heading-first outliner editing, make branch depth visible with a view-only decoration layer for the whole branch body, not just the heading node; pure CSS on `h1..h6` cannot correctly scope body indentation between headings, and pseudo-indentation must not leak into markdown content.
- **2026-03-10 Vision Flow Visibility:** In `vision-architecture-flow`, stage order must be visible to the user, not only recorded in the session. Announce the current stage, avoid silent stage skipping, mark downstream conclusions as working hypotheses until discussed, and rollback to the last jointly understood stage if the user says the flow ran ahead.
- **2026-03-10 Planning Stage Before Implementation:** In `vision-architecture-flow`, architecture freeze must not jump directly into implementation. Insert a visible `Planning` stage after `Prototype / Pilot` and before `Implementation` so the route, next work packages, and near-term execution slice are recorded in the session and can survive context compression or restoration.
- **2026-03-10 TipTap Markdown Direction:** For new TipTap v3 markdown work, prefer evaluating the official `@tiptap/markdown` extension over community `tiptap-markdown`, especially if custom markdown tokenizers or long-term maintenance matter; the community package README now recommends the official extension.
- **2026-03-10 Heading-First Branch Parsing:** In structured markdown note views, stop a branch body at the next heading of any level, not the next sibling heading. Child sections are separate branches; otherwise parent branches duplicate descendant content. For compatibility, the parser may tolerate legacy `H1` roots even if the canonical note model prefers `H2+`.
- **2026-03-10 Relative Structure Controls:** For long structured notes, absolute heading pickers alone are ergonomically wrong. Keep exact heading selection available, but add local relative actions (`branch at current level`, `child branch`, `promote`) and keep the toolbar sticky so users can manipulate structure near the cursor instead of travelling through the document.
- **2026-03-10 TipTap Toolbar Reactivity:** A TipTap toolbar cannot rely on the editor instance alone if button states must follow cursor position. Subscribe the toolbar with `useEditorState` (or equivalent) so block type and active marks/headings update on every selection change instead of freezing after the first render.
- **2026-03-05 DnD placeholder spacing:** In `@hello-pangea/dnd` lists, avoid sibling spacing utilities like `space-y-*` around draggable rows. `provided.placeholder` participates in that spacing and can cause a late end-of-drop snap; keep spacing inside a position-invariant draggable wrapper instead.
- **2026-03-05 Mobile overlay controls:** Absolute-positioned mobile toggle buttons inside content containers must reserve or offset nearby content; otherwise the control can visually overlap the first real data row. Verify this with bounding-box overlap checks, not screenshots alone.
- **2026-03-05 Codex browser QA boundary:** Separate global Codex readiness from repo mutation. Install browser skills into `~/.codex/skills` and enable `js_repl` in `~/.codex/config.toml`, but do not add workspace `playwright` dependencies to the app repo unless the next session actually needs the interactive skill’s local import path.
- **2026-03-05 Codex curated-vs-installed skills:** A Codex skill being present in the curated catalog is not enough to use it in-session; it must also be installed into `~/.codex/skills`, and `playwright-interactive` additionally requires `js_repl = true` plus a fresh Codex session before it becomes callable.
- **2026-03-05 Shared UI AI-friendly refactor:** When a shared component becomes a mixed-responsibility hub, keep the public import stable and extract a feature-local folder with `types`, `constants`, pure `utils`, state hooks, leaf components, and a local README so humans and AI agents both get smaller, explicit edit surfaces without breaking callers.
- **2026-03-03 Firebase transaction shared repository methods:** Cannot easily reuse single-document repository methods (which call `docRef.update()`) inside of a Firestore transaction. Transactions must manually construct the `docRef`, perform `transaction.update(docRef, { ...data, updatedAt: FieldValue.serverTimestamp() })`, bypassing the repository helper wrapper because Transactions require operations to be executed on the `transaction` object itself to maintain atomic locks.
- **2026-03-03 Firebase testing serverTimestamp mock:** Tests mocking `firebaseAdminConfig` will throw `TypeError: _firebaseAdminConfig.FieldValue.serverTimestamp is not a function` when APIs use backend server timestamps unless you explicitly mock `serverTimestamp: () => 'mocked-server-timestamp'` on `FieldValue` in `firebaseAdminConfig` test setups.
- **2026-03-01 AI Diff UX (TRIZ+IFR):** When showing AI confirmation modals, always compute and show a diff (kept/added/removed) rather than just the final AI state. Users need context to understand what changes. Minimal implementation: compare arrays before rendering, color-code `+added` green and ~~removed~~ red.
- **2026-03-01 Debounced Save Test Pattern:** For debounced auto-save hooks, always use `jest.useFakeTimers()` + `fireEvent.change(input, ...)` + `jest.advanceTimersByTime(debounceMs)`. Tests relying on mount-time side effects break when save guards (`!title.trim() && !content...`) exist.
- **2026-02-28 Rich Text Consistency:** When adding rich text support to features like 'studies' or 'notes', leverage the existing 'RichMarkdownEditor' (based on TipTap) to ensure consistency with other modules like sermon 'thoughts'. This avoids fragmenting the editor logic and maintains a unified user experience across the application.
- **2026-03-01 Audio Recorder Timer Source of Truth:** Post-recording 5-second dictation countdown is centralized in `frontend/app/utils/audioRecorderConfig.ts` as `GRACE_PERIOD_SECONDS` with env override `NEXT_PUBLIC_AUDIO_GRACE_PERIOD`; UI recorders and server duration validation all depend on that shared config.
- **2026-02-28 Telemetry-First AI Cost Optimization:** For AI-heavy flows, verify real prompt/completion usage before swapping providers; in this project `thought@v3` already cut total tokens by 38.9% vs `thought@v1`, and once rewrite rides a budget model, transcription becomes the dominant cost driver, so biggest savings come from routing, prompt shrinkage, and fallback escalation instead of a one-model-for-all swap.
- **2026-02-28 Parent Projection Owns Optimistic Truth:** When migrating a page from bespoke optimistic helpers to a shared persisted journal, route child save intents through one parent callback, project the optimistic entities back into every consumer view, and remove duplicate child-to-parent local update contracts; otherwise reconciliation splits and the page keeps two conflicting truths.
- **2026-02-28 i18n Status Labels:** For shared status badges like "Saved", prefer long-lived common translation keys (`common.saved`) over narrower feature-scoped keys when either text is equivalent; this reduces raw-key leakage for clients with stale locale caches and keeps fallback behavior consistent across surfaces.
- **2026-02-28 Optimistic Mutation Ordering:** In local-first flows, every in-flight update needs a per-entity version guard, and same-tick lookup helpers backed by refs must update those refs synchronously inside the state transition; otherwise older acks/errors or immediate follow-up actions silently overwrite newer user intent.
- **2026-02-27 Shared Optimistic Contract Enforcement:** Once a UI flow has a reusable optimistic orchestrator, remove component-level direct service fallbacks and make the shared callback required; optional fallbacks preserve server-first islands and double the test matrix.
- **2026-02-27 Empty-Input TRIZ+IFR Solution:** Map empty saves to "Cancel" for new items and "Delete" for existing ones in the frontend; this prevents invalid state persistence and avoids server-side validation 500s while fulfilling user intent.
- **2026-02-27 StepByStepWizard Stream Error Path:** In `StepByStepWizard`, NDJSON stream `error` events thrown through the `onError` callback are swallowed by `processStream`'s parser `catch` and logged via `console.error`; test that path through logging assertions, not by expecting a rendered error banner.
- **2026-02-27 StepByStepWizard Completion Event:** In `StepByStepWizard` tests, `download_complete` alone is insufficient for success-state coverage; emit at least one prior `audio_chunk` event because the component synthesizes the final downloadable URL from accumulated chunk data.
- **2026-02-27**: In Jest mock factories, avoid generic type arguments on locally required `React.useState`; the mocked `React` binding is untyped and can fail `tsc --noEmit`. In stateful `renderHook` harnesses, explicitly annotate `React.useState<Record<string, Item[]>>` when the hook expects a broad record shape.
- **2026-02-27 Streaming Route Test Polyfills:** In this Next/JSDOM stack, route handlers that instantiate `ReadableStream` and use `TextEncoder`/`TextDecoder` should be tested with local polyfills assigned before requiring the route module; otherwise the route can fail before the stream starts and produce misleading 500s.
- **2026-02-27 JSDOM Document Fallback Branches:** Do not force `typeof document === 'undefined'` branches in normal JSDOM tests by temporarily replacing `global.document`; it can destabilize jsdom's event loop. Prefer covering real browser branches and accept the non-browser fallback unless you have a dedicated non-DOM test environment.
- **2026-02-27 Dead Schema Layer Proof:** If legacy `config/schemas/*.schema.ts` files have zero inbound references outside their own dead barrel, compile passes after deletion, and fresh coverage shows only `config/schemas/zod/*`, treat the plain schema layer as migrated dead code and delete it instead of excluding it from coverage or writing tests for it.
- **2026-02-27 Zero-Coverage Triage Order:** Do not treat every `0%` file as an exclusion candidate. First separate framework entrypoints (`page.tsx`, `route.ts`) from ordinary modules, then prove inbound reachability. Ordinary modules with zero live consumers should be deleted; type-only modules should be excluded from coverage; live runtime modules should stay and be tested.
- **2026-02-27 Jest Setup Mock Escape Hatch:** If `jest.setup.js` globally mocks the same module you now need to test directly, load the subject with `jest.unmock()` + `jest.requireActual()` and mock only its dependencies with `jest.doMock()` inside the test; otherwise you can accidentally assert against the setup mock instead of the real implementation.
- **2026-02-27 Jest Coverage Exclusion Mechanics:** In this Next/Jest stack, the clean solution is config-only: use targeted `collectCoverageFrom` and `coveragePathIgnorePatterns`, and enable `json-summary` so `coverage-summary.json` is fresh; avoid `/* istanbul ignore file */` unless a verified edge case still leaks through after a real rerun.
- **2026-02-27 Commit-Range Diff Coverage Audit:** Even when `npm run test:coverage` and `npm run lint:full` are green, verify merged refactor stacks with `git diff -U0 <start>^..HEAD` against `coverage/lcov.info` to detect uncovered changed lines hidden by overall file coverage.
- **2026-02-27 Debounce Cleanup Coverage:** To cover `clearTimeout` cleanup branches in hooks, trigger the debounced event and unmount before timer flush; unmount after timer completion can leave cleanup lines unexecuted in coverage.
- **2026-02-27 Tailwind Dynamic-Class Hardening:** If section styles are composed with runtime fragments like `dark:${token}` / `text-${token}` / `border-${token}`, replace with explicit static class maps per section (intro/main/conclusion) and assert those exact classes in integration tests; this prevents Tailwind purge misses and dark-mode regressions.
- **2026-02-27 Absolute-Offset Clip:** When a component renders control buttons with `absolute -top-1 -left/right-1` (e.g. FocusRecorderButton Pause/Cancel), any ancestor `overflow-hidden` clips those -4px overflows. Fix: remove `overflow-hidden` from the flex header container; text truncation is already covered by `truncate` + `min-w-0` on the inner text element.
- **2026-02-27 Plan View Decomposition:** For large page-level UI files, extract mode-specific views (`main/overlay/immersive/preaching`) into separate files and keep page file as orchestration; use feature-local context inside the largest view to remove deep prop chains while preserving external behavior/testids.
- **2026-02-27 Paired-Card Height Hook:** When equal-height behavior is needed for paired columns, move ref registration + resize debounce + pair/all sync into one hook and apply viewport guards in both `syncAll` and `syncPair` so mobile always stays `height:auto`.
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
- **Optimistic Thought Sync:** Project optimistic thought entities over server thoughts, but sanitize local `local-thought-*` ids out of structure payloads before persisting. Server ack must reconcile against the latest local structure, not the stale mutation-start snapshot.
- **Debounced Thought Saves:** If a thought save is delayed/debounced (drag/drop, AI-sort, outline reassignment), emit `pending/error/success` sync state when scheduling the save and keep a retryable latest payload. Otherwise those flows silently bypass the optimistic mutation model.
- **Legacy Offline Migration:** When unifying old local-persistence flows into a generic optimistic store, preserve a migration read path for legacy persisted records. Dropping old unsynced data during a refactor breaks the offline contract.

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
- **Coverage Honesty:** For strict coverage workflows, exclude types-only contracts from `collectCoverageFrom` and cover IndexedDB branches with isolated module imports plus `idb-keyval` mocks instead of warping runtime code to satisfy the metric.
- **Browser-Heavy Component Refactor:** For client components that mix browser APIs and UI (`MediaRecorder`, timers, responsive listeners, keyboard shortcuts), keep the public entry import stable and split into `types` + `constants` + presentational leaves + lifecycle hook + module `README`. *(small, explicit seams make AI edits safer without breaking caller contracts)*
- **Shared Component Public Seams:** When refactoring a large shared component behind a new internal folder, preserve any root-level named exports that tests or downstream code import (for example modal exports from the root entry). Stable default import alone is not enough if the named export is part of the real public seam.

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
- Coverage Rule: when a refactor adds a types-only contract under `frontend/app/**`, extend `frontend/jest.config.ts` exclusions in the same change so strict diff coverage does not count non-runtime files.
- Coverage Rule: for extracted browser hooks, add direct hook tests for modern `matchMedia`, legacy listeners, resize fallback, and timer/cleanup seams instead of relying only on parent component tests; React effect cleanup can make duplicated teardown branches dead, so remove redundant branches rather than chasing artificial coverage.
- Coverage Ratchet Protocol: run strict coverage discovery only after implementation is complete. First cover the modified runtime lines in the final diff; if a changed runtime file is still below `80%`, add more tests until the whole file reaches `>=80%`. This keeps coverage compounding upward instead of stopping at bare diff coverage.
- Coverage Scope Protocol: resolve and state the scope before running the strict coverage pass. Default to staged + unstaged only when the user does not narrow it; if the user says `staged` or points to a path/package, restrict discovery accordingly and report that scope explicitly.
- Coverage New-File Protocol: every new runtime file in scope needs a direct suite tied to that file or its exact public seam. Incidental coverage through a parent component is not enough, even if the file already sits above `80%`.
- Outline Point Unassignment (JSON.stringify Null vs Undefined): When unassigning or clearing fields in optimistic entities or payloads sent over the wire, **always explicitly pass `null`** instead of `undefined`. `JSON.stringify` drops `undefined` properties completely, which means the backend won't receive the "clear" instruction and will skip the field update resulting in the bug where unassignment does nothing.
- Large Outline Workspace Modes: For long structured notes, a permanent split-pane is a false compromise. Keep `editor-only`, `split`, and `preview-only` as view-layer lenses over the same markdown seam, so the user can temporarily give the full screen to writing or to structure management without changing content storage.
- Full-Width Preview Audit: When a “preview-only” or “focus” mode still feels cramped, inspect inner layout rails as well as outer pane width. Secondary navigator columns, sticky sidebars, or reserved grid tracks can silently keep the main content narrow even after the outer container is widened.
- Editor-Native Structural Scope: When a markdown outliner already has a proven preview-assisted rewrite seam, the safest first editor-native slice is not subtree movement but current-branch creation via a cursor-selection bridge. Reuse the canonical rewrite helpers from the page/domain layer; do not invent a second structural mutation engine inside TipTap before stable branch identity exists.
- Companion Branch-State Initialization Gate: In a markdown-first note editor, companion branch metadata may load before the note content is initialized. Fetching early is fine, but identity remap/sync/persist must wait until the real note content is loaded; otherwise the system can reconcile the companion state against an empty outline and silently wipe valid branch records.
- Identity Slice 1 Scope: The first persisted branch-identity layer should solve fold-state survival only. Use a separate note-detail companion document, assign lazy opaque `branchId` values only when a branch first needs remembered state, and keep path keys as positional coordinates rather than persisted identity.
- Rename-Tolerant Branch Remap: For markdown branch identity, title-sensitive signatures are not enough. Keep exact/title-aware matching first, but add later fallback passes that use content-only subtree hashes (body + children, no title) so a `branchId` can survive heading renames without immediately jumping to embedded IDs or block JSON.
- Markdown Link Titles Are The Lowest-Cost Relation Layer: When a markdown-first note system already has stable internal `#branch=<id>` links, the first relation-semantics slice should prefer standard markdown link titles (for example `[Branch](#branch=id "supports")`) over a new storage format. This adds human-readable relation meaning, stays CommonMark-friendly, renders cleanly, and keeps canonical note content untouched.
- Backlinks Should Be Derived, Not Persisted: In a markdown-first branch system, reverse references should be computed from existing branch-link markdown plus hydrated branch identity, not stored as a second source of truth. Persist the forward link once; derive the reverse graph view from it.
- First Branch Metadata Overlays Should Live In Companion State: When a markdown-first outline grows its first semantic overlay layer (for example branch color/coding), store that metadata in the companion branch-state record and hydrate it back into the parsed outline for rendering. Do not leak presentation semantics into canonical markdown just to make the UI easy.
- Do Not Mix Identity-Proof And Metadata-Proof In One Integration Claim: For companion branch metadata, page-level tests should distinguish between “can this action create branch identity lazily?” and “can this metadata persist on an already remembered branch?”. If both contracts are tested at once, failures become ambiguous and debugging slows down.
- Review Scope Must Be Declared Explicitly: When many files remain staged across multiple landed slices, a peer-review prompt must say whether it is `slice-scoped` or `full staged diff scoped`. If that is not explicit, reviewers and users will reasonably assume different scopes and trust in the review signal drops.
- Do Not Use Positional Hints As Write-Path Identity Authority: `lastKnownKey`-style hints are acceptable for diagnostics or soft recovery, but not as the decisive source of truth when writing new branch metadata. If the current branch is not identity-hydrated, generate or remap identity safely; do not attach new metadata through an old positional key guess.
- Hash-Driven Branch Activation Must Gate On Content Readiness Explicitly: If deep-link activation depends on both branch-state hydration and note content initialization, guard the effect on both directly. Relying on indirect callback re-instantiation to “eventually re-fire” works until a memoization change silently breaks the recovery path.
- For Live TipTap / ProseMirror Tests In JSDOM, Mock Geometry At Both Element And Range Layers: Focus/scroll commands can fail on `getClientRects` / `getBoundingClientRect` even when the editor logic is correct. To verify real editor insertion/selections in Jest, polyfill geometry on both `Element.prototype` and `Range.prototype` instead of downgrading back to shallow mocks.
