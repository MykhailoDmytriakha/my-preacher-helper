# Codebase simplification — working review guide

This is an ongoing implementation, not a claim that every area is complete. The owner delegated design choices and authorized local commits, with one integrated review at the end. Nothing has been pushed or deployed.

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

Export content model/rendering and duplicate contracts, shared thought fields, Column/OutlineBoard boundaries, wider codebase review and final integrated verification. This document will be updated as those packets are validated.

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
