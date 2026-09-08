# Codebase simplification — working review guide

The owner requested closure at 21:49 PDT after a substantial implementation pass. The packets below are complete or have an explicitly dated verification checkpoint; this is not a claim that every area of the repository has been refactored. Design choices and local commits were delegated. Nothing has been pushed or deployed.

## Verified packets

| Area | Simpler mechanism | Preserved behavior | Evidence |
|---|---|---|---|
| Settings | All six settings share one row and one native Switch; TXT export uses that Switch too | Owner checks, persistence paths, acceptance/refusal handling, version details and local debug preference | FeatureToggle contracts, GroupsFeatureToggle, DebugModeToggle, Switch tests; desktop/mobile screenshots |
| Series forms | One values model, payload conversion, field set and color selector for create/edit | Exact normalized payload, initial sermons, queued vs remote acceptance, refusal keeps draft, stale-write handoff, untouched refresh vs dirty draft | SeriesModal.contract passed nine scenarios before extraction; same scenarios plus additional error cases after |
| Entity dialogs | Shared FormDialog, FormActions and field styling for series, groups and all three prayer dialogs | Caller retains submission/dismissal and disabled states; group bootstrap/date data untouched; prayer answer skip stays distinct from cancellation | FormDialog/FormField direct tests, existing entity contracts; real long-draft regression checks and light/dark/mobile/desktop screenshots |
| Text dictation | One useTextDictation controller for thought creation, thought editing and prayer updates | Same endpoint, retained audio on ordinary failure, same-blob retry, global usage-cap reporting, current-draft append; caller-specific whitespace/empty-error presentation | Six behavioral contracts passed before and after; direct hook 100% lines/branches/functions; actual desktop/mobile form inspection |
| Scratch board | Separate note-card UI and pure placement/outline model; one outline clone, canonical sections and placement type; remove unused card/section props and duplicate Apply guard | Fresh IDs only for consumed scratch nodes, additive notes, remote/draft identity, capture/apply locks, delete confirmation and undo | 41 focused tests; direct model/card coverage; real draft collapse/reopen |
| Test renderer | Native React roots and portals; cleanup unmounts before deleting manual fixtures | Provider context, draft identity, nested dialogs, actual body placement | Dedicated red/green portal regressions; entire test suite |

## Design choices

- Settings now group debug and version with the four feature toggles. The earlier screenshot named `settings-before-desktop.png` shows the preceding partial pilot, not the original pre-task UI.
- Series creation and editing use the same rich markdown description editor. The existing markdown storage format remains unchanged; creation gains the same formatting controls as editing.
- Series modal headings state the operation directly. The long workspace marketing description no longer becomes the form heading.
- Form dialogs occupy the mobile viewport with a single scrollable body. Desktop keeps a centered, bounded panel. Implicit backdrop/escape dismissal was not added.
- Group creation keeps its emerald accent and date picker. Series retains its blue accent and eight existing color presets.

## Test replacement crosswalk

The two former series suites contained 627 lines. Their useful contracts now live in `SeriesModal.contract.test.tsx` and the direct shared-component tests:

| Former requirement | Remaining proof |
|---|---|
| Initial field values and preset colors | Parameterized create/edit initial-values case |
| Custom color button/icon | Actual '+' text, open/confirm/cancel flow, retained custom value in submitted payload |
| Color selection styling | Selected preset plus controlled `aria-pressed` state and payload |
| Cancel | No submission and one close callback |
| Initial sermons | Hint visibility and exact initial ID list in create payload |
| Title, description, topic, status updates | Exact normalized payload for both modes |
| Refused edit | Deferred refusal settled before all field/state assertions; now covers create too |
| Offline acceptance | Both modes close on queued acceptance without waiting for delivery |
| Custom gradient | Removed invalid CSS assertion; actual appearance inspected in browser screenshots |
| Background refresh | Added untouched refresh / dirty draft preservation contract |
| Transient failure / stale write | Added local error clearing and handoff-to-parent distinction |

A former icon assertion accidentally matched the header close icon. Portal-related tests also depended on a fake DOM wrapper and one leaked closed dialog; they now check actual body containment and close timing. No runtime expectation was changed merely to satisfy a mock.

## Validation checkpoints

2026-09-07 18:11 PDT: root `npm run test:coverage && npm run lint:full` passed, 569 suites / 5358 tests, 91.10% lines (106886/117326). No lint/type/unused errors; one pre-existing study-detail complexity warning. New shared runtime components all report 100% line coverage. This checkpoint does not prove live Firestore semantics, physical-device behavior or production deployment.

Live candidate: development server with PWA disabled, authenticated existing test account. A mobile series draft retained both its title and actual rich-editor text through custom color confirmation. No horizontal overflow; the submit action remained reachable after scrolling. The draft was cancelled without creating a series. Dark-mode verification was completed in the 19:05 dialog checkpoint below.

2026-09-07 18:30 PDT: the scratch packet passed root `npm run test:coverage && npm run lint:full`: 571 suites / 5368 tests, 90.88% aggregate lines. The extracted card and model have 100% line coverage; ScratchPanel has 90.67%. Aggregate coverage also varies in untouched modules across full runs, so that percentage is not used as functional equivalence proof. Existing behavior assertions all passed. The page now has 1040 lines versus 1523; the reduction includes actual duplicate/dead rules, not just moved code.

In the authenticated browser, the existing DnD stand retained a two-line manual draft through Escape/reopen, restored focus, and reported textarea clientHeight = scrollHeight = 56 with no horizontal overflow. The draft was cleared without submission. Before/after desktop screenshots show unchanged layout. This fixture had no scratch pool cards; direct card tests exercise editing, focus retention, placement keyboard actions, read-only state and drag preview.

2026-09-07 18:49 PDT: dictation packet passed root coverage and lint/type/unused: 573 suites / 5381 tests, 90.94% aggregate lines. Six new cross-form behavior cases passed on the old implementations before consolidation. The first lint/type pass found a Testing Library test option mistakenly copied from Playwright; it was removed, and both full gates reran green. Direct hook coverage is 100% in all dimensions. Component-level focused coverage: create thought97.32%, edit thought92.72%, prayer update97.79% before adding the recorder-error case. One shared 71-line controller replaces 233 deleted lines with 57 caller-specific lines.

Live forms: actual rich editor accepted text, enabled Save, and retained the dictation control. Create draft cleared/cancelled; edit existing test thought opened and cancelled; no thought/prayer writes or paid transcription requests. A 390px prayer update inspection revealed an existing long-text overflow bug (BUG-20260907-prayer-update-overflow); it is recorded for the dialog packet, not concealed by the successful dictation tests.

2026-09-07 19:05 PDT: prayer dialog packet passed both full root gates: 573 suites / 5383 tests, 91.11% lines. No new lint warning. One form shell now handles series/group and prayer layouts, names, optional backdrop dismissal, and close locks. Shared actions preserve independent validation/saving/cancel locks. Dead error state removed from prayer create/answer; data-write/recovery behavior unchanged. Shared auto-sized fields no longer offer a conflicting manual resize grip.

**BUG-20260907-prayer-update-overflow — locally fixed and verified.** Before: a 30-line update placed Submit at y1076–1112 on a390×844 viewport; answer at y1072–1108; prayer edit at y1153–1189, with document height844 and no usable scroll region. After: all three scroll to Submit at y779–823. The same local test account and QA prayer were used; drafts were cleared/restored then cancelled. Status remained active and updates remained empty. Series/group/prayer dark screenshots inspected; theme restored to System. Browser console has font-preload warnings only. This proves desktop-browser viewport behavior, not a physical keyboard/device claim.

## Saved visual evidence

Files are under `output/playwright/refactoring/` (local artifacts):

- `settings-before-desktop.png`, `settings-after-desktop.png`, `settings-after-mobile.png`.
- `series-create-before-desktop.png`, `series-create-after-desktop.png`.
- `series-create-before-mobile.png`, `series-create-after-mobile.png`, `series-create-after-mobile-actions.png`.
- `group-create-before-desktop.png`, `group-create-after-desktop.png`.
- `color-picker-mobile-inspection.png`.
- `scratch-before-desktop.png`, `scratch-after-desktop.png`.
- `thought-create-after-desktop.png`, `thought-edit-after-desktop.png`, `thought-edit-after-mobile.png`, `prayer-update-after-mobile.png`.
- `prayer-update-long-before-mobile.png`, `prayer-update-long-after-mobile.png` show the actual overflow regression.
- `prayer-update-unified-mobile.png`, `prayer-update-after-dark-desktop.png`.
- `prayer-edit-before-mobile.png`, `prayer-edit-after-mobile.png`, `prayer-answer-before-mobile.png`, `prayer-answer-after-mobile.png`.
- `series-create-after-dark-desktop.png`, `series-create-after-dark-mobile.png`, `group-create-after-dark-desktop.png`, `group-create-after-dark-mobile.png`.

Series/group before shots were captured from the still-unchanged respective components before their edits. An isolated archive of original `814461fd` was also booted, but its separate-origin authentication remained loading; it was not used as proof of an authenticated before/after comparison.

## Remaining work

Export content/model, shared thought fields, Column, and OutlineBoard have now been handled in the packets below. Remaining scope: wider server/AI client decomposition, other large pages (including study detail), additional dialog families, and further test consolidation after mapping their real contracts. Existing product bugs in BUGS.md remain unless explicitly closed by these commits. In particular, physical-device behavior, paid AI quality, offline multi-device convergence, and keyboard scratch dragging are not certified by this pass.

## Clipboard consolidation — verified local checkpoint

Plain and rich clipboard operations share one feedback lifecycle. Their transports retain the intentional difference: ordinary modern clipboard rejection is an error; formatted plan copy may use a selection fallback. The fallback always removes temporary DOM. Referral, diagnostic reports, TXT, brainstorm, study notes, thought menus and outbox copy now reach the same plain-copy owner.

The former duplicate clipboard suite is replaced by one hook contract and direct transport tests. Initial state, pending state, callbacks, default/custom duration, reset, empty content, modern rejection and fallback success/failure remain covered; additional cases exercise overlapping attempts and unmount. The old test claiming fallback after modern rejection did not actually call the modern API because another test left it undefined. The replacement checks both the rejection and the absence of a fallback.

Negative controls: the frozen original hook fails 9/10 final lifecycle cases; original rich-copy cleanup fails both new fallback cases; original formatted-feedback hook fails all three new reset/unmount/same-event duplicate cases. These are defects corrected alongside consolidation, not claims that every old behavior was correct. No document write, conflict decision or queued draft format changes.


Clipboard checkpoint: **575 suites / 5407 tests**, **91.14% aggregate lines**, root coverage + lint/types/unused green. The shared hook and selection transport have direct contract tests; caller scope regressions also run with the real hook. All modified runtime files meet the 80% line floor. V8 aggregate reports vary with mixed mocked/real-hook suites; an isolated direct run verifies every hook line, including the empty-text branch.

Actual local browser proof: referral URL equals the displayed link; TXT copy equals all 80 preview characters; formatted plan provides both HTML and plain text; diagnostics copy equals all 17086 report characters. Saved images under `output/playwright/refactoring`: `referral-copy-after-desktop.png`, `export-text-before-desktop.png`, `export-text-before-mobile.png`, `plan-copy-after-mobile.png`, `diagnostics-copy-after-mobile.png`. The export images are the baseline for the next visual consolidation. Browser viewport checks are not physical-device or deployment proof.

ShareLinksPanel now stores only the selected token; it no longer recreates a timer or success state after the common hook settles. A separate red/green case verifies that an older accepted copy cannot republish success after a newer rejected one. Hidden share windows, updated cards and dismissed/reopened thought menus invalidate obsolete feedback. Canonical writeRecovery's stateless copy adapter retains its existing unavailable-API contract.


## Export dialogs and loading — local production proof

TXT/PDF share a presentation-only ExportDialog and a preview lifecycle hook. The existing FormDialog and FormButton own their common appearance. Preview requests from a previous builder/opening cannot replace the current result or hide it with a late error. A supplied TXT preview takes precedence over an earlier pending builder. PDF canvas completion from a previous opening cannot publish feedback into the new window.

TXT uses the shared download transport and the advertised `.txt` / `.md` extensions. Audio format downloads and concatenated audio reuse that transport; object URLs are released after the download starts, including exceptional click cleanup. Player URLs retain their separate playback lifetime.

Word and PDF libraries load only when their export action is used. Word blocks duplicate requests while preparing and re-enables after failure. The application does not enable the currently unavailable PDF feature. Existing output formats and Word payloads remain intact.

Comparable production builds (same builder, installed dependencies and environment; before is frozen commit `11b8a3c2`):

| Route | Before First Load JS | After First Load JS |
|---|---:|---:|
| Sermon list | 932 kB | 664 kB |
| Sermon detail | 1.29 MB | 1.02 MB |
| Plan | 1.11 MB | 839 kB |
| Manual plan | 1.10 MB | 835 kB |
| Structure | 1.14 MB | 877 kB |
| Dashboard control | 489 kB | 489 kB |

These are Next.js bundle-report sizes, not measured mobile latency. Lazy external imports follow the [Next.js 15 documentation](https://nextjs.org/docs/15/app/guides/lazy-loading).

Actual authenticated production browser: `export.txt` contains all 80 preview characters exactly; `export.md` contains the expected heading, quoted scripture and numbered thought. Word downloads `sermon-plan-dnd-stand.docx`; ZIP/XML inspection confirms sermon title, scripture, outline title and the actual plan note. No application writes or paid AI calls. TXT format/type/tag controls and light/dark desktop/mobile layouts were exercised. Theme restored to System. PDF is covered by component tests, not claimed as a live enabled feature.

Artifacts: `export-text-before-desktop.png`, `export-text-before-mobile.png`, `export-text-after-desktop.png`, `export-markdown-after-mobile.png`, `export-text-after-dark-desktop.png`, `export-text-after-dark-mobile.png`, `export-after.txt`, `export-after.md`, `export-after.docx` under `output/playwright/refactoring/`. Desktop dark screenshot was recaptured after transitions settled.

Regression evidence: all nine new preview/download cases failed against the original implementations and pass after changes. Direct export subset: 54 tests, 97.19% lines, 86.36% functions; first narrow coverage run was below the global function floor until the real close/reopen ownership contract was added. Full root gates are recorded at the checkpoint below.

Export checkpoint 2026-09-07 20:15 PDT: root coverage and lint/type/unused gates passed, **579 suites / 5432 tests**, **91.16% aggregate lines**. One pre-existing study-detail complexity warning remains.


## Export document model and contract replacement

`exportContent.ts` is now a small translation/API adapter. `exportContentModel.ts` organizes language-independent sections/blocks using the canonical visual-order owner. `exportContentRenderer.ts` owns the shared header, numbered thought hierarchy and saved-plan rendering. Removed repeated headers, dead debug paths, redundant partitions and re-sorting already ordered outline thoughts. The final implementation is220runtime lines versus723before. The initial compact renderer still had excessive branching; separate thought/outline/loose renderers now pass the complexity check without warnings.

A frozen copy of the original implementation and a deterministic matrix remain in ignored `frontend/output/refactoring-proof/`. Sixteen input fixtures × seven scopes × two content types × two formats × tag/metadata switches = **1792 exact string comparisons**, all equal before/after, with frozen inputs. They cover missing outlines/structure, ordering, subpoints, loose/multi-tag content, multiline text, blank metadata and plan/draft fallback. This is a migration experiment, not another permanent duplicate suite.

Both old export suites (701lines) are replaced by one public contract plus direct model/renderer/language seams and a shared fixture. The12public behavior cases also passed against the frozen original implementation. Crosswalk:

| Former contract | Replacement owner |
|---|---|
| Plain/Markdown, metadata/tags flags | Public format/header/tag cases |
| Empty sermon/empty text/no outline/blank verse | Explicit empty-output assertions and optional-scripture cases |
| Multiple translated aliases | Actual canonical utility; asserts each section and author's tag text |
| Explicit structure order, reversed order, orphan priority | Parameterized direct model cases |
| Position/subpoint visual interleave | Exact model block order plus both rendered formats |
| Continuous N/N.M numbering and focused reset | Public hierarchy and main/mainPart cases |
| Loose and multi-tag headings | Model block-kind and public text cases |
| Missing/invalid legacy tags and dates | Retained-text compatibility case |
| Saved plan, Markdown and missing-plan message | Public plan cases; adds saved-over-draft precedence |
| Multiline scripture with blank lines | Shared header contract for both content types/formats |

The former tag-normalization test only asserted Other Thoughts appeared. Its replacement checks all four sections with real normalization. The old large suite mocked canonical tag normalization and repeated identical empty-structure inputs; those duplicate/proxy checks were removed.

BUG-20260907-export-language: four original cases failed because module-load translations never refreshed. Translations now resolve per export. Live RU→EN→RU without reload changed only generated labels, preserving the author's Russian text. `export-model-after.txt` matches the prior production `export-after.txt` byte-for-byte. Screenshot `export-language-english-after.png` was inspected.

A separate dev-environment problem was found while checking this packet: an existing service worker served a private-layout module without FORM_COLORS alongside a new page module containing it. Bypassing only the worker through DevTools resolved the error without code/data changes. The local-worker lifecycle is tracked separately as BUG-20260907-dev-export-palette; this packet's live checks explicitly used that temporary bypass.

Export-model checkpoint2026-09-07 20:37 PDT: **581suites /5445tests**, **91.09%aggregate lines**, full rootcoverage+lint/types/unused passed. Facade/model/renderer100%lines; model95.16%branches, renderer98.38%branches. A temporary parity-proof import-formatting issue was corrected before rerunning the entire gate. No new lint warnings.


## Thought editor fields and dialogs

CreateThoughtModal and EditThoughtModal now share FormDialog/FormActions, ThoughtTextHeader and ThoughtTagsField. OutlinePointOptions is the common ordered point/subpoint list for the card selector and ThoughtOutlineField. The edit field owns only dropdown state; the editor retains its draft and recoverable-write acceptance/refusal ownership. Creation still offers its existing point-only native select; editing retains point/subpoint pairs and section filtering. Exact create-tag filtering and normalized edit-tag filtering remain caller policies.

CreateThoughtModal shrank from 374 to 232 lines; EditThoughtModal from 577 to 175. The unused 374-line AddThoughtManual and its sole legacy test were removed after a repository-wide consumer search: only two stale mocks remained, which were also deleted. Its different offline policy was not moved into the active editor. The real sermon-page entry mounts CreateThoughtModal.

Test crosswalk: active create/edit suites retain input, whitespace, tags, outline IDs, unchanged/read-only gates, pending submission, immediate/late refusal and draft handoff. The shared dictation contracts retain retries and quota boundaries. Two checks tied to obsolete modal CSS containers were replaced by actual viewport/scroll evidence and existing FormDialog contracts. Backdrop dismissal now locates the real dialog's backdrop. The recorder mock uses type=button, matching the real recorder inside a form. Six keyboard/pointer contracts plus direct field tests cover the new seams. Four keyboard cases failed on the original editors; pointer payload cases passed before and after.

BUG-20260907-thought-tag-keyboard: canonical Chip replaces pointer-only div controls. Live Enter adds a tag, Space removes it, and the unchanged draft's Save remains disabled. All available tags have tabIndex=0. Native option buttons do not submit their enclosing form.

Actual authenticated browser: edit a draft, choose an existing subpoint, enter 30 lines, scroll to both actions, then cancel. On 390×844 the Save rectangle is y=779..823, the single dialog scroll body is 838px high with 2474px content, and there is no horizontal overflow. Existing thought data remains unchanged. Creation, editing, desktop/mobile and light/dark screenshots were inspected. Artifacts: thought-fields-after-desktop.png, thought-fields-long-after-mobile.png, thought-fields-after-dark-desktop.png, thought-fields-after-dark-mobile.png, thought-create-unified-desktop.png, thought-create-unified-mobile.png in output/playwright/refactoring.

Direct validation: 68 tests across 9 suites; editor/selector files 97.83–100% lines. All four new components have direct seams; isolated OutlinePointOptions coverage is 100% lines /94.11% branches (mixed mocked/real suites distort the combined V8 result). No paid dictation or application writes were made in the browser.

Local environment follow-up, BUG-20260907-dev-export-palette: only the existing http://127.0.0.1:3100/sw.js registration was unregistered, with no CacheStorage/IndexedDB clearing. CDP bypass was then disabled and the page reloaded normally: controller=null, registrations=0, TXT and thought dialogs open correctly, authentication and data retained. No palette fallback or production worker policy was changed. This closes the local mixed-bundle incident, not the separately tracked production Firestore worker issue.

Thought-fields checkpoint 2026-09-07 21:01 PDT: **585 suites /5446 tests**, **91.13% aggregate lines**, full root coverage + lint/types/unused green. All seven changed/new editor runtime files have 100% file-wide lines in the full run. Only the pre-existing study-page complexity warning remains.

## Structure columns: shared item rendering, point cards and lanes

Column now coordinates the section/focus layout and its existing outline/write hook. OutlinePointCard owns the local point UI; ThoughtLanes owns nested/empty/gap targets; columnItemModel builds the point membership index once per items change. Four copies of SortableItem wiring become one renderer, and both normal/focus point calls use one shared prop factory with their mode-specific operations explicit. Existing DnD target IDs/data, AI-review handlers, record targets and write acceptance remain unchanged.

Column shrank from 2032 to 1075 lines. The whole runtime packet also removes repeated code rather than merely moving lines. Membership/lock lookup no longer filters the entire column for every point: a single pass creates groups, preserving order, identity, mixed lock states and legacy orphan links. The existing AI-sort policy receives the already scoped items. No new persisted index or alternate lock policy.

Behavior corrections found during the refactor:

- BUG-20260907-column-render-mutates-outline: the original JSX sorted the parent's subPoints array in place. Frozen-input rendering failed before and passes after. The lane already uses the canonical immutable ordering utility; the redundant sort is gone. The adjacent SubPointList and mini-outline also reuse that utility. OutlineBoard's existing copy-sort was not mutating its input.
- BUG-20260907-column-collapse-body: the old collapse control only hid the normal-mode subpoint editor; the thought lane always remained. Two new normal/focus cases failed before. The body now collapses and expands; while collapsed, the visible card owns the same point drop target and hidden subpoints are unmounted. Direct tests verify the registered target contains the visible heading.
- BUG-20260907-column-mobile-actions: at390px two rightmost actions exceeded their header edge by9.67/12.41px. Headers now wrap their action group; each header's scrollWidth equals clientWidth326px and every action is within bounds. Subpoint title/190px recorder wrap independently when the column is narrow. Desktop headers remain56px high and fit their379px width.

Validation: 61 targeted tests include the retained Column suites, actual subpoint editor, recorder integration and new model/lane/card seams. The focused coverage run gives Column95.25%, card92.9%, lanes99.09%, index100%, SubPointList82.18% lines; its restricted aggregate function threshold is not met, so the full project gate is required and is recorded separately. No threshold was lowered.

Actual browser: normal/focus, desktop/mobile, light/dark; title draft changed then Escape restored its original text. Pointer drag over the collapsed point shows one thought and the target highlight; Escape restores zero point thoughts and the sole original thought under Review. A raw whole-page text comparison during cancellation differed because the drag announcement/overlay changed; the settled item identities, texts and membership were checked explicitly. No drag was committed or persisted. Expanded focus before/after screenshots match dimensions with only94–96 materially different pixels, mostly the dev indicator; this comparison predates the deliberate responsive wrap adjustment.

Screenshots under output/playwright/refactoring: column-before-desktop.png, column-focus-before-desktop.png, column-focus-before-mobile.png, column-focus-after-desktop.png, column-focus-after-mobile.png, column-mobile-detail-after.png, column-responsive-after-mobile.png, column-after-dark-desktop.png, column-after-dark-mobile.png, column-collapsed-drag-preview.png. Theme restored System. Browser checks are not physical-device evidence.

Column checkpoint2026-09-07 21:22 PDT: **588suites /5457tests**, **91%aggregate lines**, full rootcoverage+lint/types/unusedgreen. Changedruntime file-wide lines: Column96.93%, pointcard96.96%, lanes99.69%, itemindex100%, SubPointList89.05%. The existing study-page complexity warning remains.


## Remove disconnected drag-and-drop tests and their unused implementation

The active structure page calls useStructureDnd; a full source/reference search found no runtime consumer of utils/dnd-handlers.ts. Two old suites imported that 151-line alternate implementation; a third 498-line suite defined its own handlers, including a simplified drag-end branch and expect(true). The three suites total939lines/20cases and are removed with the unused implementation. Their historical README named a nonexistent page/test and now points to real owners.

Crosswalk to the retained actual hook tests:

| Former claim | Actual protection |
|---|---|
| Cross-container move and before-target placement | Existing moving-between-containers, exact reordered IDs/persisted order; new preview before-last case |
| Container inference without data | Existing infer destination, container-ID fallback and end fallback cases |
| Null target, missing source, invalid destination, self target | New parameterized real preview contracts; existing end no-target/no-op/invalid-container cases |
| Same-container reorder | Existing real reorder persistence and two-card live-preview commit cases |
| Required tag updates/clearing | Existing section-change payload and ambiguous-additional-drop payload cases |
| Repeated preview without duplicates | New real ref/state coalescing case and existing skip-duplicate/adjacent group cases |
| Hover makes no backend calls | New assertions on the actual hook's imported write services, not an isolated function with no service imports |
| Dummy DOM spacer becomes ambiguous | Obsolete implementation detail: actual spacer is not registered as a droppable; the registered ambiguous-additional-drop target has retained payload coverage |
| No-error / expect(true) branches | Removed empty assertions; actual no-op state and no-write expectations remain |

Seven new preview contracts run against the unmodified current hook, using actual React state and a controlled animation-frame queue. Cancellation is verified both before and after preview paint, preserving IDs, positions, refs and active state. Three isolated negative controls were detected: network write during hover3failures, missing cancel restoration2failures, duplicated source item1failure. Temporary mutant/proof files were removed in finally; the application hook was never changed. The real hook suites pass53tests. Pointer-hover/cancel proof on the live page is recorded in the Column section above.

DnD cleanup checkpoint2026-09-07 21:31 PDT: **586suites /5444tests**, **91.05%aggregate lines**, rootcoverage+lint/types/unusedgreen. The first full run passed tests but TypeScript rejected a deliberately partial drag-event fixture; its boundary assertion was corrected and the entire gate rerun. Twenty disconnected cases removed, seven actual-hook cases added; active application behavior unchanged.


## Outline board: completed local refactor

OutlineBoard shrank from1768 to1064lines. The editor now delegates structural move decisions to outlineBoardModel, gesture/collision/overlay state to useOutlineBoardDrag, and pool/placed-note rendering to ScratchNoteLayer. Shared BoardDragPrimitives keep the same draggable/droppable registration rules. outlineBoardNotes builds a single-pass container index while preserving caller pool order, Map iteration order, note identity and legacy orphan placements. The existing outlineDnd, boardDnd and scratchPlacementRemap remain the canonical rules; persistence still belongs to the caller.

BUG-20260907-board-subgap-placement: dropping a subpoint onto a card previously remapped its attached scratch note, while dropping into that card's subpoint gap did not. Follow-up effects now derive from the actual before/after relationship, so both targets update the note's parent address. The regression test failed on the original implementation and passes after. Point nesting with children, promotion, cross-section movement, read-only, invalid targets and no-op drops retain their contracts.

New direct tests cover all new runtime modules. Live-DOM collision tests check deepest nested targets, stationary-pointer cache identity, scroll invalidation, reset between gestures, inner-card measurement, hidden-original preservation, a single physical destination slot, atomic move callbacks and clipped-overlay handle positioning. These complement the retained board tests; they do not replace actual browser verification.

Actual browser proof used one temporary QA scratch note in the existing test account. Full text and controls fit at1280px and390px; the mobile card had clientWidth=scrollWidth324px and no document overflow. A real pointer drag showed the correct point destination; Escape returned the original card to the pool without losing its text. A completed drop moved the card into the point. Placement remains a draft until Apply, as before: reload returns it to the pool. Apply was not pressed. The QA note was deleted through the confirmation dialog and a subsequent reload confirmed zero scratch notes and no QA text. Existing point/subpoint content was left intact.

Screenshots in output/playwright/refactoring: outline-board-note-drag-desktop.png, outline-board-qa-desktop.png, outline-board-qa-mobile.png, outline-board-after-desktop.png. The QA-card shots deliberately show the temporary verification text. The after shot is after cleanup. Existing keyboard-drag issue BUG-20260905-scratch-keyboard-drag-lifts-offscreen remains open; this packet does not claim to fix it.

## Integrated acceptance route

Use the local candidate and the normal account; review can be done as one walkthrough:

1. Settings: check all six toggles in their common group.
2. Series create/edit and group creation: shared spacing, fields, scrolling and actions.
3. Thought create/edit: text, tags, outline selection, mobile long draft and cancellation.
4. Prayer update/edit/answer: reachable actions with long text, light/dark appearance.
5. Structure page: normal/focus mode, collapse/expand, action wrapping, pointer drag/cancel.
6. Scratch mode: pool, manual capture, note card and plan editing.
7. Export: TXT/Markdown preview and download, Word download; language labels follow the current UI language.

Saved screenshots document inspected states, not a claim that every viewport and every feature combination was exhaustively tested. Full-suite results and production-build outcome are recorded below.

Closing root gate2026-09-07 21:52 PDT: **590/590suites, 5469/5469tests, 91.24%aggregate lines**; coverage, ESLint, TypeScript and unused checks exit0. No thresholds weakened. Final full-run line coverage: OutlineBoard81.65%, gesture hook98.07%, structural model100%, note index100%, drag primitives100%, scratch layer100%. One existing study-detail cognitive-complexity warning remains. Full-run file percentages differ from focused runs; the named behavior contracts and red/green failures are the equivalence evidence. Final production build subsequently passed (route type generation, separate strict TypeScript validation and Next.js build;40static pages generated). The build script intentionally delegates type checking to its parallel strict process; it was not skipped. Lint had already passed in the root gate. The final structure route is876kB First Load JS, with sermon detail1.02MB, list664kB and plan839kB.
