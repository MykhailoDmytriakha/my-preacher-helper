# Project Memory (Project Operating Manual)

> Recipes — how to do an operation, what an error means — live in `.howto/`, one per file, found by `grep -ril "<words>" .howto/`. This file keeps principles, conventions, feature invariants and the code map.

> **Pipeline:** Lessons (raw) → Short-Term (analysis) → Long-Term (protocols). Read this first on every session start.

---

## 🧠 Principles (Context Engineering)

### 🗺️ Architecture Map
*   **Structure:** `app/` (Next.js 15 App Router) | `api/` (Server Actions/Routes) | `utils/` (Pure Logic).
*   **State Ownership:** DataEngine owns migrated user documents, durable drafts and delivery. React Query retains legacy and unrelated request state; URL params own navigation, Context owns dependency injection.
*   **Data Flow:** UI → DataEngine public facade → durable local intent → authenticated command processor → Firestore/feed → the same facade. Read-only fallback can show server/memory content while device storage is unavailable.
*   **AI Stack:** structured calls through `callWithStructuredOutput` with Zod schemas; providers and models come from the tier catalog, not from this line — `.howto/call-ai-with-structured-output.md`, `.howto/gate-and-meter-an-ai-call.md`.

### 🧭 Canonical Mechanisms — LOOK HERE BEFORE WRITING YOUR OWN
> Every row of the former table is now the core of a recipe in `.howto/`: find the operation there (the Elephant block of `CLAUDE.md` says how) and read the code it names before you write your own rule. The data engine is in `main`: its public contract is `frontend/app/data-engine/README.md`, per-collection state is in `docs/architecture/data-engine-migration-log.md` — check the collection before choosing the engine or a legacy path.

### 📐 Coding Conventions
*   **Testing:** `jest` + `RTL`. Test Behavior, not Implementation. Mock modules with explicit factories. `data-testid` for anchors. **Sequence-Aware Mocking** for AI chains.
*   **Optimistic Sync:** Apply local state immediately, keep transient sync metadata (`pending`/`error`) separate from domain entities, always provide rollback + retry.
*   **Hooks:** Rules of Hooks Absolute. Complexity > 20 → Extract to Custom Hook.
*   **Normalization:** Always transform external metadata to canonical lowercase before matching.
*   **File Structure:** Vertical Slices (Feature Folder) > Horizontal Layers.
*   **Batch Pattern:** Favor single "full-state" API request over parallel "partial-state" when backend state is interconnected.
*   **API Verification:** Always verify exact shape of API responses in frontend handlers.
*   **Ideal Storage (TRIZ+IFR):** If a resource (images) is only needed for transient context (email), avoid duplicating it in persistent storage (Firestore). Leverage existing systems (inbox) to solve storage needs without bloating the core database.

### ⚖️ Domain Axioms
*   **User Control:** Heavy AI actions require explicit buttons, not auto-magic.
*   **Session-Log:** One Chat = One Session Log = Single Source of Truth.

### ⛔ Anti-Patterns

Moved to `.howto/` — each rule now lives in the recipe of its operation: `grep -ril "<words>" .howto/`.

---

## 🆕 Lessons (Inbox) — Extracted Principles

> One-line principles. History in git blame. Newest first.

### 2026-08-17 The Rule You Are About To Invent Is Probably Already In `utils/` — Grep Before You Reason
**Problem:** Adding "this sermon was built on that note" took SEVEN adversarial review rounds, and almost every finding after the second was the same defect wearing a new face: hand-rolled rules for "which copy is fresher", "may this write result replace what is on screen", "is this cached list authoritative". Each hand-rolled version was fixed, the fix broke something else, and the loop only ended when the owner asked the obvious question — is there already a standard approach in the code? There was. `frontend/app/utils/readFreshness.ts` answers exactly that question, per AGGREGATE (`serverCopyIsNewer` refuses replacement when the local copy leads in any aggregate — which is precisely what two review rounds demanded), and `useSermon.ts` already carried the written lesson that a list copy and a detail copy cannot be compared at all because they differ in completeness (`BUG-20260815-list-copy-hides-scratch`, measured live: four scratch notes on the server, one on screen, for ever). The freshness layer also already had the rule that it NEVER swaps what is on screen — so the "helpful" silent refetch invented during round 6 was not just unnecessary, it was against the design.
**Solution:** Before writing any rule about freshness, merging, publishing a write, offline behaviour or entity links, find the operation's recipe in `. Then express the feature in that vocabulary: the link writer now asks `serverCopyIsNewer` the same question every read asks, publishes a PATCH instead of an entity, and leaves "the server has something you do not" to the existing banner. The hook lost its own rules and got shorter; three tests that locked bespoke behaviour were replaced by tests that lock the shared behaviour.
**Principle:** A second implementation of a cross-cutting rule is worse than none: both look right, only one gets fixed, and the drift reads as a foreign edit. Ten minutes of grepping `utils/` outranks any amount of careful reasoning about a problem this repository has already paid to solve.

### 2026-07-14 Admin Cascades Need Downstream Ownership Closure
**Problem:** Authenticating and owner-checking a root resource is not enough when an Admin-SDK cascade follows user-controlled reference IDs; forged references can turn deletion of an owned parent into writes against another user's documents.
**Solution:** Authenticate before input/DB work, owner-check the root, and restrict every downstream query/batch/update to documents whose stored owner equals the verified token uid; thread that same uid explicitly into AI metering and model resolution.
**Principle:** Authorization closure must cover the full write graph, not only the route's primary resource.

### 2026-07-13 Cross-Provider TTS Prices Need Explicit Normalization
**Problem:** Text, transcription, and speech providers bill in incompatible units; presenting a token/audio rate as a character rate can make a precise-looking admin comparison materially misleading.
**Solution:** Keep exact provider rates in their native units, normalize TTS to the product's chosen comparison unit only when needed, mark every normalized value as an estimate, and document the source and assumption beside the canonical catalog.
**Principle:** A cross-provider price label must distinguish quoted rates from derived normalization; precision in formatting is not precision in evidence.

### 2026-07-13 Client Heartbeats Need A User-Scoped Local Reservation
**Problem:** An auth-ready callback may run again in the same browser, and a device may sign in as more than one user; a global or post-write throttle can suppress the wrong user or race into duplicate writes.
**Solution:** Scope the localStorage key by uid, store the epoch synchronously before launching the best-effort merge write, and treat storage/write failures as non-blocking because the timestamp is low-stakes metadata.
**Principle:** For client-supplied activity heartbeats, reserve a user-scoped device window before the async write and never make authorization depend on the signal.

### 2026-07-13 Config Editors Must Not Save From Unverified Fallback State
**Problem:** A settings form can initialize with safe catalog fallbacks while its GET is pending; if the GET fails and Save becomes available, an administrator may mistake fallback values for stored state and overwrite valid configuration.
**Solution:** Keep fallback values render-safe, but gate editing and saving on a successful server read; validate each stored value against the canonical catalog and use fallbacks only for effective runtime resolution.
**Principle:** Safe runtime fallback is not verified administrative state—never enable a config write until the current server state has loaded successfully.

### 2026-07-13 Multilingual STT Locks Need Per-Language Evidence And Current Product-Version Checks
**Problem:** Aggregate multilingual WER and a provider's generic language list can hide a weak lower-resource language, while a locked model name or cached hourly price can become stale after a new model release or pricing split.
**Solution:** For each production language, triangulate a public per-language benchmark with provider support documentation, keep dataset-specific WERs separate, price the actual batch/streaming mode, and check whether a current successor changes the decision.
**Principle:** A multilingual STT choice is validated per language, dataset, endpoint mode, and exact model version—not by one aggregate WER or family-level support claim.

### 2026-07-13 Multilingual TTS Support Is Not Native-Language Quality
**Problem:** Provider marketing, auto-detection, and global English-only leaderboards can make an unsupported or weak Ukrainian path look production-ready; Azure's Ukrainian Neural voices can also be mistakenly attributed to MAI-Voice-2.
**Solution:** Verify the exact model's locale/voice list and current price in first-party docs, keep provider-level voices separate from model-level support, and require a blind native-speaker sermon test when no language-specific MOS panel exists.
**Principle:** Select TTS per language from exact-model evidence; never infer native quality from multilingual generation, a provider-wide locale, or an English leaderboard.

### 2026-07-13 Privilege Forms Must Bind Prefilled State To One Identity
**Problem:** An admin could select a privileged user, replace only the target UID, and submit the first user's prefilled tier, role, promotion, and usage to the second user; prefilled promotion timestamps could also be rewritten at lower `datetime-local` precision without an intentional promotion edit.
**Solution:** When a manual identity diverges from the selected identity, clear every prefilled entitlement field; track promotion edits with an explicit dirty flag so unchanged prefilled values never enter the patch.
**Principle:** In privilege-mutating forms, identity and prefilled state are one atomic context, and prefilled values are not dirty values.

### 2026-07-12 Referral Rewards Need One Transactional Idempotency Anchor
**Problem:** Referral attribution is user-supplied, but its reward mutates a promotion and concurrent/replayed claims can otherwise pay more than once.
**Solution:** Establish eligibility only from revoked-token-checked Firebase identity and Admin Auth metadata, deny client writes to both attribution and promotion, then transactionally read the invitee's `referredBy` marker and inviter promotion before atomically writing both.
**Principle:** Couple every privilege-granting reward to a server-trusted eligibility proof and a transactionally enforced, single-use idempotency marker.

### 2026-07-13 Reward Ledgers Must Be Atomic Projections Of The Grant
**Problem:** A referral audit/statistics record written after the reward transaction can be missing, duplicated, or disagree with the promotion that was actually granted.
**Solution:** Write `referralEvents/{inviteeUid}` inside the same transaction and only after the existing `referredBy` gate passes, copy tier/end directly from the computed promotion, and deny all client access to the ledger.
**Principle:** A security-relevant reward ledger is an atomic, server-only projection of the grant—not an independent side effect or a second source of promotion logic.

- **2026-07-05 Scratch Full-Array Writers Must Share One Queue:** When `sermon.scratch` is persisted as a full array, every writer that can change it must serialize through the same current-state mutation queue. Apply/fold actions should pass consumed ids, not a click-time remaining-array snapshot, and rollback should restore only the mutation's consumed ids when newer scratch mutations exist.
- **2026-07-05 Scratch Voice Recovery Must Gate Apply At Receipt And Commit:** For scratch voice capture, store the blob before any lock decision, keep a parent-owned recovery URL because the recorder can unmount in board view, check Apply both before transcription and immediately before `addScratchNote`, and if Apply is active surface recovery retry instead of adding into the full-scratch Apply write.
- **2026-07-05 Scratch Voice Completion Must Outlive Apply Locks:** Lock the start of new scratch mutations during Apply, but never lock the save of an already-started voice transcription result; otherwise the async result can be silently dropped. Disable Apply while voice transcription is processing to prevent the window, and keep the completion path data-preserving if a lock still flips.
- **2026-07-05 Scratch Apply Rollback Must Compare Against The Optimistic Scratch Payload:** When Apply optimistically removes consumed scratch notes, an online failure rollback should restore `previousScratch` only if the current scratch still matches the Apply-time `remainingScratch`; comparing current scratch to the pre-Apply array falsely treats Apply's own optimistic projection as a user mutation, while unguarded restore can clobber newer scratch edits.
- **2026-07-05 Scratch Compose Scope Must Cross The Client/Server Boundary:** If the UI excludes already placed scratch notes before AI compose, send that exact id set to the route and filter the server-side prompt input to the same set; client-only validation catches drift but does not prevent the AI from seeing and returning out-of-scope ids.
- **2026-07-05 Scratch Apply Needs One Optimistic Outline+Scratch Projection:** For scratch-note workflows where notes are folded into an outline, Apply must compute `finalOutline` and `remainingScratch` together, update the local sermon immediately, and persist both fields in one Firestore document update; placement overlays should not clear an active AI proposal because both layers are Apply-time inputs.
- **2026-07-05 Optional Shared DnD Layers Need A Placed-Item Data Contract:** When adding an optional pool/placement layer to a load-bearing shared DnD component, keep the public pool contract precise (for example, unplaced items only), but make placed-item rendering resilient through an internal cache or parent lookup; gate every render and drag branch so classic consumers execute none of the optional path.
- **2026-05-29 Free TTS Options Fall Into Three Non-Equivalent Buckets:** Recurring free cloud quota (Gemini TTS, Cartesia, ElevenLabs, Azure/Google Cloud/AWS) is easy to integrate but capped or lower-quality; one-time credits (Deepgram, cloud signup credits) are good for trials but not sustainable; local/open-weight TTS (Kokoro, Chatterbox, Fish Audio S2 Pro) is the only "unlimited free" path, but shifts cost to hosting, GPU/CPU performance, ops, and license review.
- **2026-05-22 Autosave Retry Must Use The Status Pipeline Without Weakening Flush Semantics:** When adding sticky autosave errors, keep existing direct `flushSave` rejection behavior for route handoffs, and expose retry through the autosave primitive so `error -> saving -> saved` status transitions are observable by UI.
- **2026-05-22 Study View/Edit Route Splits Need Shortcut Symmetry Tests:** When replacing an in-page edit toggle with separate view/edit routes, assert both button and keyboard handoffs preserve search params, and assert the editor awaits `flushSave()` before navigation so route transitions cannot race pending saves.
- **2026-05-22 Code Review Skills Need Explicit Reviewer Lanes:** A multi-agent review skill should preserve high-confidence findings first, but define separate reviewer lanes (defects, instructions, architecture/invariants, simplicity, tests, and conditional error/type/performance/security lenses) so "multiple senior reviewers" produce distinct evidence instead of duplicate generic review.
- **2026-05-22 Draft Hooks Should Keep Route Handoffs Outside The Reusable Core:** When extracting page-owned autosave/draft logic, keep `window.history` and route-state synchronization in the page while the hook exposes created note state through domain metadata; otherwise future route variants inherit stale URL assumptions.
- **2026-05-22 Review Fixes Need Interaction-Path Assertions:** When a refactor changes helper selection inside search/snippet/filter/copy paths, tests must cover the actual interaction path, not just the lower-level helper or passive render, otherwise the regression can return through the caller seam.
- **2026-05-22 Title-Bearing Study Surfaces Need Root-Body Projection:** When a study UI already renders `note.title` as the visible root, cards/focus/copy snippets must use a structural `root.text/media + children` body projection instead of full `nodeTreeToMarkdown(rootNode)`; keep full tree serialization for sync/search/AI/share paths.
- **2026-05-20 Node Editor Actions Need Selection/Edit Separation:** In node editors, focus/selection should expose structural actions while textarea editing remains a separate state; otherwise discoverability depends on users accidentally entering text-edit mode.
- **2026-05-20 Node-Tree Autosave Must Diff Canonical Tree Text:** When `rootNode` is the source of truth and the server derives legacy `content`, page autosave must compare/send `nodeTreeToMarkdown(rootNode)` or ignore stale local `content`; otherwise cache updates with derived content can cause repeated saves and stale AI/copy flows.
- **2026-05-20 Node-Tree Split Idempotency Needs Two Gates:** Markdown-heading splitting must guard both UI flushes (blur/edit-exit) and reducer application history per node; otherwise duplicate dispatches or repeated old drafts can prepend duplicate child nodes.
- **2026-05-20 RootNode Voice Input Must Mutate The Tree:** When a study note has `rootNode`, voice transcription must append a `ContentNode` child and use derived markdown for AI/copy, not write stale legacy `content` that the server will discard.
- **2026-05-20 UI Node Conversion Must Preserve Legacy Snapshots:** If a UI button converts `StudyNote.content` to `rootNode`, the server must capture `legacyContent` during the no-tree → tree transition; preserving snapshots only in admin migrations makes user-triggered conversion irreversible.
- **2026-05-20 Node-Tree DnD Must Share Reducer Invariants:** For tree drag-and-drop, keep projection/UI local to the editor but route the final mutation through a reducer action that rejects root, self-parent, and descendant-parent moves; attach dnd-kit listeners only to the drag handle so row focus and textarea selection stay intact.
- **2026-05-20 Node-Tree Insert Reducers Need Caller-Generated IDs:** For deterministic reducer tests and keyboard-driven inserts, pass pre-generated node IDs in insert actions and keep serialization through `selectTree` as the autosave boundary.
- **2026-05-19 Detailed Plan Mode Means Source-Rich Expansion, Not Just More Lines:** For `plan_point_content`, Detailed should preserve more explicit Bible references, short source-provided text fragments, examples, and transition logic from the input thoughts; it must not invent theology or references, and it should be version-bumped when this contract changes.
- **2026-05-19 Subpoint Lists in Focus Sidebars Need Semantic List Elements:** When rendering nested subpoint lists in specialized focus mode sidebars, always use semantic list elements (`ul` and `li`) styled with accessible contrast classes to ensure correct screen reader navigation, DOM traversal, and theme compliance.
- **2026-05-19 Keep Empty List Containers Compact:** Empty drop targets or input triggers should collapse down completely and fade-in only when active or hovered. This saves vertical space without sacrificing usability.
- **2026-05-10 Dashboard Quick Actions Need Shared Visual Grammar:** When sibling quick actions differ behaviorally (`button` opens modal, `a` navigates), centralize shared geometry/interaction classes and vary only semantic tone so the row reads as one control family.
- **2026-05-10 Dashboard Quick Actions Must Match Target Create Flow:** Do not make every dashboard create action a plain link or a modal by default; mirror the target workspace contract: modal when creation needs upfront fields and a created id for redirect, direct editor route when the workspace creates through `/new`.
- **2026-05-08 Lint Warnings Are Delivery Issues:** Even when `npm run lint:full` exits 0, ESLint warnings for unused code, duplicate literals, or cognitive complexity should be cleaned before delivery because they hide real maintainability debt and can mask later CI hardening.
- **2026-05-07 Busy Recorder States Need Object Labels:** Compact recorder busy states must show what is happening to the recording (for example, “Processing recording”) instead of reusing a countdown like `1:30`; timer-only busy labels are ambiguous once the user is no longer actively recording.
- **2026-05-07 Recorder Controls Need Semantic Color Separation:** In a compact active recorder, reserve green for the finish/check action, keep pause as amber, make cancel a soft destructive tint, and avoid repeating the same danger color on both cancel and finish or users cannot parse the action hierarchy quickly.
- **2026-05-01 Export Toggles Need End-To-End Option Contracts:** When a shared export modal passes options such as `type`, every page-specific export callback must preserve and honor that second argument; otherwise segmented controls can update visually while still returning stale/default content.
- **2026-05-01 Subpoint-Scoped Audio Needs End-To-End Destination Metadata:** A recorder placed inside a sub-point must persist both `outlinePointId` and `subPointId` through UI helper, service FormData, API creation, and immediate UI projection; visual placement alone is not enough.
- **2026-05-01 Repeated Visual Concepts Need Renderer-Wide Audits:** If a visual bug appears on "subpoints", audit every renderer of that concept (sidebar summary, detail list, plan view, selector) before calling the UI fixed; shared data does not imply shared component styling.
- **2026-04-28 Dashboard Rows Need Honest Affordances:** Dashboard overview rows should be full-row links with consistent hover/focus treatment; remove inert menus/buttons instead of showing controls that imply unavailable actions.
- **2026-04-28 Dashboard Study Notes Need Retrieval Cues:** Dashboard note summaries should show scripture references and topical tags, not internal note/question counts; users choose the next click by remembered passage/theme, not by row statistics.
- **2026-04-28 Dashboard Reclaim Pattern:** Since `/dashboard` currently redirects to `/sermons`, a new dashboard should be designed as an overview/work-queue surface while preserving `/sermons` as the dedicated sermon list; avoid collapsing specialized workspace logic into one overloaded page.
- **2026-04-28 Default Dashboard Localization Gate:** When promoting a prototype dashboard to the default private route, replace static sample copy with real hook-derived data and add a full `en/ru/uk` translation parity test in the same change; otherwise the default page silently becomes an English-only mock.
- **2026-04-26 Generation Controls Should Name The User-Visible Effect:** If a selector mainly changes output size/density, label it as volume (`Short/Medium/Detailed`) instead of internal methodology (`memory/narrative/exegetical`). The prompt contract must use the same semantics, otherwise the UI is clear but generation remains misleading.
- **2026-04-26 AI Sermon Plans Are Preacher Cue Sheets:** Plan-point generation should preserve the preacher's recall handles, contrast phrases, compact Bible references, and explicit internal lists as a sparse cue sheet. Without sub-points, avoid creating `###` headings for every thought/detail; with sub-points, use `###` for sub-point headings and keep details concise underneath.
- **2026-04-26 AI Sermon Plans Need Semantic Moves, Not Thought Counts:** For generated preaching plans, the structural unit is the required semantic move, not the number of stored thoughts. If a thought contains an explicit numbered list or sermon roadmap, surface those items as required semantic moves in the prompt; otherwise the model can obey "one heading per thought" while losing the actual preaching route.
- **2026-04-25 Full Sermon Detail Fetches Are Not Metadata:** `/api/sermons/[id]` returns a full working document, not lightweight list metadata. Give it a separate client timeout category so slow local Firestore/detail hydration does not get misclassified as a 5s metadata timeout.
- **2026-04-25 Dictated Thought Prompts Must Treat Sermon Context As Non-Source:** For voice-to-thought generation, sermon title/verse/examples may guide understanding and tags, but `formattedText` must come from the transcription. Bible references are acceptable when anchored in an explicit dictated reference, quote, unmistakable paraphrase, or named Bible story/event; do not add the main sermon verse, thematic support citations, applications, or theological bridges from context alone.
- **2026-04-25 Search Card Detail Navigation Needs Field-Level Targets:** If a list card surfaces highlighted matches from multiple fields, encode the query plus the matched field/entity id into the detail URL and scroll to the rendered `<mark>`, not just the detail page or container.
- **2026-04-25 Sermon Detail Audio Level Removal Needs Caller-Level Monitoring Gate:** When removing mic-level bars from a specific page, pass `enableAudioLevelMonitoring={false}` at the page integration/bridge so both the visible strip and analyser loop are disabled without changing shared recorder surfaces.
- **2026-04-19 Compact Recorder Variants Must Skip Hidden Audio Analysis:** If a mobile/mini recorder does not surface mic-level feedback, disable `AudioContext` + `AnalyserNode` setup and the animation-frame loop entirely. Hiding the level strip alone preserves battery/CPU cost with zero user value.
- **2026-04-14 Behavior Fixes Must Retire Stale Error-UI Tests:** When a modal moves from “close/reset on failure” to “stay open and preserve data,” legacy tests often still assert nonexistent inline error text or close-on-failure behavior. Update those tests to hit a valid submit path and assert the new persistence contract instead.
- **2026-04-14 Sub-Point Flows Need Both Visual Drop Lanes And State Preservation:** If thoughts can be assigned into sub-points, the drop target must expose a visible internal lane that expands on hover, and any manual-create/save path must carry `subPointId` all the way into the UI replacement item. Otherwise drag feels aimless and saved thoughts visually jump back to the parent outline point.
- **2026-04-14 Between-SubPoint Drops Need Explicit Gap Targets:** When an outline point interleaves sibling sub-points, leftover whitespace in the parent container is not a usable drop affordance. Render dedicated droppable gap slots between render groups and compute the dropped direct thought's position from neighboring entry positions, or users will be physically unable to place thoughts between sub-points.
- **2026-04-10 Dense Hierarchy Must Read From Containers, Not Card Labels:** On structure boards, direct items should stay visually clean and only exception items may get a tiny chip. If users need to read `Parent / Child` inside every card to understand nesting, move the signal to the group container with an inset lane, visible bounds, and consistent indentation.
- **2026-03-28 Read-Only Sibling Surfaces Must Preserve Core Actions:** If the same entity can be viewed in list cards, focus overlays, and dedicated detail pages, keep core read-only actions like copy/share parity across those surfaces. Otherwise navigation path alone changes available capability and creates false "missing feature" bugs.
- **2026-03-19 Selector Modal Mutations Need Row-Level Pending Feedback:** If clicking a row inside a selector modal triggers async mutations, do not leave the list visually static. Lock the modal, keep the chosen row visible, and show a spinner plus explicit action label on that row until the mutation finishes; otherwise users interpret the click as lost.
- **2026-03-18 Structure Focus AI Sort Is Column-Wide, Not Point-Local:** On `/sermons/[id]/structure`, the AI sort button appears only in focus mode, but it still sorts the full section column (up to 25 non-local thoughts), not just the currently visible outline subgroup. Keep runtime copy, warning text, and tests aligned with that contract.
- **2026-03-18 Binary Card State Should Prefer One Stateful Control Plus Surface Tone:** For simple locked/unlocked states on cards, do not duplicate state with both a badge and a separate action button. Let the toggle itself carry the state (icon + `aria-pressed`) and reinforce it with a subtle surface change, not blanket opacity that hurts readability.
- **2026-03-18 Search Matches Must Be Visible In-Card:** If list search indexes secondary fields like updates or notes, the result card must surface a highlighted snippet from the matching field. Otherwise the filter is technically correct but visually non-explainable to the user.
- **2026-03-18 Loading Buttons Must Keep Explicit Labels:** For async form submits, never replace the primary CTA text with bare `...`. Keep a real localized label (optionally with a spinner) and reserve button width, otherwise users perceive the button text as disappearing and the control feels broken.
- **2026-03-18 Contextual Sort Menus Must Match the Active Slice:** If a list is filtered to a subset that cannot meaningfully support a sort field (for example, active prayers have no `answeredAt`), hide that sort option and clamp/reset stale sort state when the slice changes. Otherwise the UI remains technically functional but becomes logically false.

- **2026-03-13 Cross-Note Review Lanes Need Their Own Scope And Unit Language:** When a workspace shows both note-level review cards and branch-level review lanes, do not derive lanes from the already metadata-filtered note list, and do not reuse the same labels for both surfaces. Notes and branches are different units; the UI must preserve that distinction in both scope and wording.
- **2026-03-13 Collapsed Review Surfaces Must Expose A Recovery Path:** If a semantic review lane shows only the first N items, the hidden remainder needs an explicit “show all” path in the same surface. A badge with a larger total but no local expansion path is a broken workflow promise.
- **2026-03-13 Branch-Level Review Surfaces Should Derive From Existing Branch-State, Not New Storage:** Once note-level metadata summaries and branch deep links already exist, the next high-leverage retrieval layer is often cross-note branch review queues derived from `notes + companion branch-state`. Do not invent a second persistence model just to surface actionable branches in the workspace.
- **2026-03-13 Cross-Note Metadata Lenses Must Survive Detail Navigation:** Once workspace retrieval gains semantic filters, the detail page cannot keep paginating with an older tag/book/search-only filter seam. Prev/next navigation must inherit the same metadata lens or the semantic stack feels fake the moment the user drills into a note.
- **2026-03-13 Active Session Logs Need Explicit Write Targets Before Compaction:** For a still-active source-of-truth session, prefer strict write-target rules (dedicated appendices/inboxes, canonical sections owned by Codex) over compaction. Do not compact the active main session unless the user explicitly wants that tradeoff after seeing the risk.
- **2026-03-13 Branch Semantics Belong In Companion Metadata, Not Markdown:** Once branch identity and deterministic remap exist, richer meaning layers such as semantic labels should persist in companion branch-state and hydrate back onto the parsed outline. This preserves clean markdown while letting branch-level semantics grow without reopening the canonical content model.
- **2026-03-13 Controlled Branch Metadata Must Store Canonical Enum Values, Not Localized Labels:** Branch kind/status should persist as stable canonical values (`evidence`, `confirmed`) and only translate at render time. Storing localized strings in metadata or markdown makes filtering, testing, and cross-locale behavior fragile.
- **2026-03-13 Metadata Fields Need Retrieval Surfaces Before More Fields:** In knowledge tools, the next high-leverage step after proving a metadata seam is usually filter/search/summary exposure across views, not adding another isolated field. More fields without retrieval leverage produce hidden richness and low workflow value.
- **2026-03-13 Cross-Note Metadata Should Stay Derived From Companion Branch-State:** When lifting branch metadata into workspace retrieval, do not denormalize it into `StudyNote.content` or mutate the canonical note model. Batch-read companion branch-state, derive note-level summaries, and feed filters/cards/search from those summaries. This preserves markdown-first truth while unlocking cross-note retrieval.
- **2026-03-13 Synthesis Surfaces Should Reuse Retrieval Seams, Not Invent New Persistence:** Once cross-note metadata retrieval exists, add higher-order UX like review cards and top-label shortcuts by deriving from the same summary map. Do not create a second storage layer just to make workspace-level synthesis feel richer.
- **2026-03-12 Internal Branch Links Can Stay Pure Markdown:** If the note model is markdown-first, internal branch navigation does not require a custom link syntax. Standard markdown links targeting `#branch=<branchId>` can stay plain text while the page layer intercepts them and resolves the target through companion branch identity.
- **2026-03-12 Preserve Early Branch-State Mutations During Async Bootstrap:** If companion branch-state loads asynchronously, early local identity actions (deep-link reveal, lazy branch-ID creation, fold/unfold) must not be overwritten by the eventual load response. Track pre-load local mutations explicitly and let them win for that bootstrap cycle.
- **2026-03-11 Selection-Bridge Tests Must Use Semantic Occurrence Indexes:** When testing heading-first editor bridges, a mock cannot use the flat heading array index as `occurrenceIndex`; nested headings change flat order. Compute occurrence among same `headingLevel + headingText` matches or the page-side branch remap will appear broken even when the real bridge contract is correct.
- **2026-03-11 Prefer Structural Lookup Over Path-Key Arithmetic:** While branch identity still uses positional path keys, any logic about sibling relationships or parent adoption should query the current outline tree structurally instead of deriving neighbors by string arithmetic. That keeps the seam stable as the system moves toward true branch IDs.
- **2026-03-11 Heading-First Promote/Demote Is a Subtree Cascade:** In a heading-first outline, promoting or demoting a branch is never a one-line heading edit. Shift every heading marker inside `sourceRange.startOffset .. subtreeEndOffset` together, otherwise parent/child ownership silently breaks.
- **2026-03-11 One Normalization Contract Per Outline Mutation:** If heading-first outline edits can both move branches and create branches, route them through the same markdown boundary-normalization contract. Separate mutation seams for move vs insert quickly diverge and create formatting drift inside the same note model.
- **2026-03-11 Derived Path Keys vs Reorder State:** If outline branch identity is derived from runtime path keys (`1`, `1.2`, `2.1`), any subtree reorder invalidates key-based fold/selection state. Until stable branch IDs exist, clear or recompute that UI state after moves instead of reusing stale keys.
- **2026-03-11 Heading-First Subtree Swaps Need Separator Normalization:** When swapping sibling heading-based subtrees by raw markdown offsets, do not assume the moved slice carries its own inter-branch blank line. Normalize separators between swapped slices or headings can concatenate into invalid-looking text (`body## Next`).
- **2026-03-10 Reversible Outline Shortcuts:** In outline editing, structural hotkeys must be reversible. If `Body -> H1` happens on `Tab`, then `H1 -> Body` must happen on `Shift-Tab`; otherwise the user gets trapped in a structural state that only the dropdown can undo.
- **2026-03-10 Normalized Outline Depth Parity:** If edit mode and read/preview mode both visualize a heading-first tree, their branch indentation must normalize against the note’s base heading level, not the absolute markdown heading number; otherwise mode switching creates false structural drift.
- **2026-03-10 Tab Must Stay In Outline Flow:** In outliner editing, `Tab` on body text must not fall through to browser focus navigation. Provide an in-editor fallback transition such as `Body -> H1`, then let subsequent `Tab / Shift-Tab` manage branch depth.
- **2026-03-10 Outline Depth as View Layer:** In heading-first outliner editing, make branch depth visible with a view-only decoration layer for the whole branch body, not just the heading node; pure CSS on `h1..h6` cannot correctly scope body indentation between headings, and pseudo-indentation must not leak into markdown content.
- **2026-03-10 Vision Flow Visibility:** In `vision-architecture-flow`, stage order must be visible to the user, not only recorded in the session. Announce the current stage, avoid silent stage skipping, mark downstream conclusions as working hypotheses until discussed, and rollback to the last jointly understood stage if the user says the flow ran ahead.
- **2026-03-10 Planning Stage Before Implementation:** In `vision-architecture-flow`, architecture freeze must not jump directly into implementation. Insert a visible `Planning` stage after `Prototype / Pilot` and before `Implementation` so the route, next work packages, and near-term execution slice are recorded in the session and can survive context compression or restoration.
- **2026-03-10 Heading-First Branch Parsing:** In structured markdown note views, stop a branch body at the next heading of any level, not the next sibling heading. Child sections are separate branches; otherwise parent branches duplicate descendant content. For compatibility, the parser may tolerate legacy `H1` roots even if the canonical note model prefers `H2+`.
- **2026-03-10 Relative Structure Controls:** For long structured notes, absolute heading pickers alone are ergonomically wrong. Keep exact heading selection available, but add local relative actions (`branch at current level`, `child branch`, `promote`) and keep the toolbar sticky so users can manipulate structure near the cursor instead of travelling through the document.
- **2026-03-05 Shared UI AI-friendly refactor:** When a shared component becomes a mixed-responsibility hub, keep the public import stable and extract a feature-local folder with `types`, `constants`, pure `utils`, state hooks, leaf components, and a local README so humans and AI agents both get smaller, explicit edit surfaces without breaking callers.
- **2026-03-01 AI Diff UX (TRIZ+IFR):** When showing AI confirmation modals, always compute and show a diff (kept/added/removed) rather than just the final AI state. Users need context to understand what changes. Minimal implementation: compare arrays before rendering, color-code `+added` green and ~~removed~~ red.
- **2026-02-28 Parent Projection Owns Optimistic Truth:** When migrating a page from bespoke optimistic helpers to a shared persisted journal, route child save intents through one parent callback, project the optimistic entities back into every consumer view, and remove duplicate child-to-parent local update contracts; otherwise reconciliation splits and the page keeps two conflicting truths.
- **2026-02-28 Optimistic Mutation Ordering:** In local-first flows, every in-flight update needs a per-entity version guard, and same-tick lookup helpers backed by refs must update those refs synchronously inside the state transition; otherwise older acks/errors or immediate follow-up actions silently overwrite newer user intent.
- **2026-02-27 Shared Optimistic Contract Enforcement:** Once a UI flow has a reusable optimistic orchestrator, remove component-level direct service fallbacks and make the shared callback required; optional fallbacks preserve server-first islands and double the test matrix.
- **2026-02-27 Empty-Input TRIZ+IFR Solution:** Map empty saves to "Cancel" for new items and "Delete" for existing ones in the frontend; this prevents invalid state persistence and avoids server-side validation 500s while fulfilling user intent.
- **2026-02-27 Plan View Decomposition:** For large page-level UI files, extract mode-specific views (`main/overlay/immersive/preaching`) into separate files and keep page file as orchestration; use feature-local context inside the largest view to remove deep prop chains while preserving external behavior/testids.
- **2026-02-27 Plan Actions Split:** For plan generate/save flows, keep fetch code in `planApi.ts`, orchestration/toasts in `usePlanActions`, and page-local state mutations in callbacks; this preserves behavior while making API and error paths unit-testable.
- **2026-02-27 Deterministic Section Markdown:** Section outline markdown must be built from ordered outline IDs + content map (ID-based), not heading text splice/replacement; otherwise duplicate titles cause accidental cross-point overwrites.
- **2026-02-27 Outline Lookup Semantics:** When replacing repeated `some/find` scans with memoized lookup maps, preserve original section precedence (`introduction -> main -> conclusion`) for duplicate IDs and lock this with dedicated util tests.
- **2026-02-27 Copy UX Unification:** When the same copy-to-clipboard flow exists in multiple views, centralize status/timer/toast behavior in a hook and keep button/icon/ARIA rendering in a dedicated component to eliminate state-drift bugs between modes.
- **2026-02-27 Global CSS Dedup by Variant:** When one page has repeated `style jsx global` blocks across view modes, extract a shared style component with explicit `variant` flags for mode-specific extras to prevent style drift while preserving behavior.
- **2026-02-26 Outline Point Deletion Logic:** When a parent structural element (outline point) is deleted, do not cascade delete its children (thoughts). Unassign them (`outlinePointId: undefined`) to preserve user data.
- **2026-02-26 Feedback Image Strategy (TRIZ+IFR):** To avoid Firestore bloat with Base64 images, send them via email only and store only `imageCount` in DB. Inbox acts as the Ideal Final Result for persistent visual context.
- **2026-02-24 Sibling Typography:** When UI sections act as visual peers, explicitly copy typography classes across different semantic tags (`h2` vs `div`).
- **2026-02-23 TRIZ UI Simplification:** When list item > 3 actions, migrate destructive/contextual functions to detail view or ⋯ menu.
- **2026-02-23 AI Conditional Fields:** AI should fill empty fields, not overwrite user content. Tests must clear fields before asserting auto-population.
- **2026-02-23 Separation in Space:** Use existing safe zones (sticky header) for controls instead of floating layers that risk collision.
- **2026-02-16 API Contract Mismatch:** Frontend must check `polishedText || originalText` — never assume a single key name.
- **2026-02-14 Tree Hierarchy Utils:** Separate tree traversal (search) from structural transformation (mutation) for portability and testability.
- **2026-02-14 High-Latency Auto-Save:** For complex model sync, debounce 15s+ with "Saving..." indicator and opt-out toggle.
- **2026-02-11 Dashboard Optimistic Flow:** Separate domain entities from sync metadata. Every optimistic write needs rollback + user-visible recovery.
- **2026-02-01 Duplicate Audio Prevention:** Single "full-state" API request when `sections === 'all'` — prevents fan-out duplication.
- **2026-02-01 Feature Gating Consistency:** Feature availability must use same source of truth as its UI indicator.
- **2026-01-31 Structured Data over Localized Strings:** Never use UI-facing localized strings as data extraction anchors. Use typed data objects.
- **2026-01-31 Unified Props:** When component used in multiple contexts, synchronize data through explicit unified props.
- **2026-01-31 Skeleton ≠ Empty State:** Skeleton = waiting (loading). Empty State = terminal result. Never conflate.
- **2026-01-31 URL State Persistence:** For filters/tabs persisting across navigation, use URL params over `useState`.
- **2026-01-26 Canonical Structural Tags:** Use canonical IDs (`intro`, `main`, `conclusion`) in logic. Localized strings only for display.
- **2026-01-26 Sidebar Consistency:** Maintain consistent functional ordering (icons → badge) across view modes.
- **2026-01-25 One Chat = One Session Log:** If duplicates appear, merge immediately.
- **2026-01-14 Analytics Refactor:** Extract pure logic into utilities, keep UI thin, validate with tests + real-world parity.
- **2026-01-14 Refresh Must Match Data Source:** Refresh actions must update the same data source the UI section renders.
- **2026-01-11 Threshold Ordering:** Multi-threshold triggers: evaluate from most restrictive (largest) to least.
- **2026-01-11 Decoupling Complex Logic:** Extract stateful interactions → custom hooks, pure logic → utilities. Verify with targeted tests.

---

## 💎 Long-Term Memory (Operating Protocols)

> Format: **Name:** instruction. *(reason)*

### 📝 Debugging

Moved to `.howto/` — each rule now lives in the recipe of its operation: `grep -ril "<words>" .howto/`.

### 🔧 Code Quality
- **Post-Lint Test Run:** After ESLint auto-fixes, IMMEDIATELY run tests. *(auto-fixes can break logic)*

### 🧪 Testing
- **Framework > Aesthetics:** Jest/RTL requirements win over "clean code" in test infrastructure.
- **Agent Tests Must Run:** Always run created tests and achieve green before responding.

### 🔄 React & State
- **State Transitions:** Use `useRef` for previous value, compare in effect to react only on change.
- **Hook Import Check:** After adding `useMemo`/`useCallback`, verify import section. *(runtime crash otherwise)*

### 🎨 UI/UX
- **Input Consistency:** Every clickable input must support Click + Keyboard (Enter). *(a11y)*
- **Card Actions:** Edit/Delete in Header, not footer. *(user shouldn't scroll to find actions)*

### 📆 Calendar

Moved to `.howto/` — each rule now lives in the recipe of its operation: `grep -ril "<words>" .howto/`.

### 🌍 i18n

Moved to `.howto/` — each rule now lives in the recipe of its operation: `grep -ril "<words>" .howto/`.

### 🧭 Architecture
- **Optimistic Thought Sync:** Project optimistic thought entities over server thoughts, but sanitize local `local-thought-*` ids out of structure payloads before persisting. Server ack must reconcile against the latest local structure, not the stale mutation-start snapshot.
- **Debounced Thought Saves:** If a thought save is delayed/debounced (drag/drop, AI-sort, outline reassignment), emit `pending/error/success` sync state when scheduling the save and keep a retryable latest payload. Otherwise those flows silently bypass the optimistic mutation model.

### 🤖 AI Integration
- **UI Refactor Safety:** Preserve key classes/DOM structure. Check logical sections in both modes.
- **Test Coverage:** Add targeted tests for new DOM structures. Green tests ≠ covered logic.
- **Feature Surface Verification:** A wired state path is not the feature. If a component imports an interaction surface like `SubPointList` but never renders it, backend logic and hook tests can still pass while the user-facing feature is effectively absent. Add a DOM-level assertion for the control itself and verify it manually in the real screen.
- **Type-Safe Fixtures:** Treat test fixtures as first-class types — update mocks with model changes.
- **Helper Extraction Audit:** After extraction, audit downstream usage + add targeted tests for new paths.
- **Browser-Heavy Component Refactor:** For client components that mix browser APIs and UI (`MediaRecorder`, timers, responsive listeners, keyboard shortcuts), keep the public entry import stable and split into `types` + `constants` + presentational leaves + lifecycle hook + module `README`. *(small, explicit seams make AI edits safer without breaking caller contracts)*
- **Shared Component Public Seams:** When refactoring a large shared component behind a new internal folder, preserve any root-level named exports that tests or downstream code import (for example modal exports from the root entry). Stable default import alone is not enough if the named export is part of the real public seam.
- **Hierarchy Metadata UI:** On dense work surfaces like structure boards, hierarchy/location state should render as compact breadcrumb or chip metadata at scan time, not as a full secondary info panel. The goal is explicitness without adding another visual block that competes with the thought content.

---

## 📋 Memory Management Rules

1. New reusable knowledge → follow «Память» in `CLAUDE.md` §3: a recipe (how to do X, what error Y means) goes to `.howto/`; a principle, convention, feature invariant or code-map fact goes to the Lessons Inbox here.
2. 3+ related principles → consolidate them into one maintained principle or convention.
3. Remove a processed inbox entry only after its still-valid knowledge lives in its maintained place.
4. Work journal: the Elephant case (`el log`), not a file — the Elephant block in `CLAUDE.md`. Legacy `.sessions/` is an archive: read-only, nothing new goes there.
5. **Session Start:** Read Long-Term Memory → Check Inbox → `el` (where the case stands, what is next)
6. **Session End:** Capture lessons → `el` (Order says "State is behind" → `el readme set next "…"`) → Commit

---

## 🏗️ Project Architecture Quick Reference

**Key Directories:**
- `app/components/skeletons/` — Loading UI placeholders
- `app/hooks/useDashboardOptimisticSermons.ts` — Optimistic mutation orchestrator
- `app/models/dashboardOptimistic.ts` — Sync-state types (`pending`/`error`)
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
- Dashboard Optimistic: `useDashboardOptimisticSermons` + `SermonCard.tsx` retry/dismiss
- Comments: English only in code
- **2026-03-19 Test Coverage Stability:** The guard fixed the bug and tests were correctly expanded.
- **2026-07-12 Admin UI Boundary:** Admin UI visibility is only a convenience layer. Fetch `/api/admin/me` with `auth.currentUser.getIdToken()` for client gating, but keep every admin mutation behind `requireAdminEmail`; the client must receive only `{ admin: true }`, never the configured admin email.
- **2026-07-13 Admin Drawer Promotion Guard:** When a selected user already has a promotion, render the editor's segmented control as "Keep" and retain the values only as latent form state. Keep `promotionDirty` false until an explicit Set or Clear interaction, so an unrelated entitlement save cannot rewrite the promotion. Drawer autofocus must run only when opened, or controlled-input edits lose focus after every re-render.
- **2026-07-13 Usage Gauge Semantics:** For quota gauges, compute both width and health tone from `remaining / limit` (not `used / limit`): a fresh account is `100%` blue, `1–20%` remaining is amber, and `0%` is rose. Reuse one component across user and admin surfaces so the two views cannot drift into opposite semantics.
- **2026-09-04 Feature Vocabulary Is a Contract, Not Wording:** "Заметка/Note" is a TAKEN entity name in this app (Studies notes, `sermon.sourceNotes`, `notePanel`, `shareNotes`). Any other feature that calls its items "notes" makes users read it as that feature. The scratch screen (`?mode=raw`) drifted this way: "набросок" named the mode, "заметка" named the item. Rule: pull the item name to the mode name, sweep EVERY string in the namespace (dead keys included) in one pass, and when the other entity genuinely appears, spell it out in full ("заметка-напоминание"). Locale grep is not enough — shared components carry their own host's vocabulary onto the screen (`PointNote` labelled scratch cards and board points with `planEditor.note.*`); give such components a wording seam (`labels`) next to the styling seam they already have (`tone`), defaulting to the old wording so other hosts stay untouched. Read the rendered page as plain text to find the leaks a namespace grep cannot see. Journal: `.sessions/SESSION_2026-09-04-scratch-terminology.md`.
- **2026-09-14 A Growing Block Does Not Stand Above A Fixed One:** the sermon screen stacked thoughts (0..100+) above the source note (one item, 6 300 words). Judged at 0 and 3 thoughts it looked right; at 28 the note was five screens down and the link to it was gone. Rule: of two CONTENT blocks, the one that grows from data does not go above the one that does not and has to be read (chrome and bottom-pinned streams are exempt — a message list above its input is correct). Ordering alone only carries three of the four load corners; where BOTH sides are large no arrangement works, because the screen is finite and neither side is, and the lever changes from layout to what is SHOWN. Here it dissolved instead: scratch atoms now render INSIDE the note under the heading each was cut from (`ScratchNoteSource.heading`, already stored), so there are no longer two blocks competing — one document, with the work beside the part it belongs to. Atoms whose heading the note no longer has open the note rather than vanishing; ownership is the LINK, not a heading match. Canonical machinery reused, not rebuilt: `splitMarkdownSections` · `useMarkdownOutline` · `FoldableMarkdown` (gained optional `sectionBadge` / `sectionExtra`, both defaulted off) · `jumpToSection` moved beside the hook so the sermon screen and the study page share one implementation. Gotcha found by measurement, not by review: a control row placed above the first section kills `first:mt-0` and opens a 78px hole under the header. Components: `SourceNoteSection.tsx`, `ThoughtsEmptyState.tsx`. Commit `b76fb469`.
