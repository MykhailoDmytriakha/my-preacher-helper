# Local bug-fix acceptance

Branch: `codex/bugs-local-fixes`. Local commits only. Merge, push and production verification require the owner's separate instruction. Removal from this branch's BUGS.md means locally verified, not deployed.

Main synchronization: before each new bug and final acceptance, fetch origin and inspect committed updates in local main and origin/main. Integrate them at a clean boundary with a separate local merge and verify compatibility. Keep uncommitted files in the original checkout untouched. A merge intake consumes that boundary's pinned snapshot; finish one bug before taking another snapshot, rather than recursively fetching after each intake while main moves.

Main intake `5732d57d` (2026-10-15): both local fixes were retained. The merged state passed 798 Jest suites / 8234 tests (3 suites / 17 tests skipped), full TypeScript, ESLint (0 errors / 29 inherited warnings) and production build. Localhost checks covered section-dialog Escape/focus/scroll lock, James 1:22 opening in the Bible and returning to the plan, and both care headers at 390/1280px. Screenshots were visually inspected. Production acceptance remains pending.

## BUG-20261012-plan-section-view-outside-react

Stage: locally verified and independently reviewed; production verification pending.

The read-only section dialog is now owned by React through `PlanSectionDialog` and `createPortal`. It reuses `useModalLayer` and `useFocusTrap`. The menu owns its selected section and restores focus to its trigger. Markdown, section colors and the 896px maximum width remain.

Red proof on base `e817fcc882cfa8da85dd877b0e63d328cc5593d0`: two behavioral regressions in `frontend/__tests__/components/plan/ViewPlanMenu.test.tsx` failed because Escape and owner unmount left the section heading in the DOM; five existing tests passed. The same regressions now pass. The menu, shared modal-layer and plan-header suites passed 30 tests; menu, locale architecture and translation coverage passed another targeted run of 17 tests.

Removed obsolete manual body cleanup from the test fixture: React now removes its portal. Coverage includes Escape, owner unmount, backdrop, background lock, focus containment/restoration, repeated opening, Markdown, empty sections and existing menu actions.

Browser acceptance used the actual localhost app at port 3047, an existing test account and an existing QA sermon's manual plan. Before the fix Escape left the window open and background scrolling unlocked. After the fix Escape closes only the window; Tab stays inside; wheel does not move the background; backdrop and close button dismiss it. Repeated opening and an empty introduction passed. The dialog also opened and closed on an already loaded plan without network; connection was restored in a finally block.

Screenshots were visually inspected at 1280x1267, 390x844 and 834x1112. Content, close control and panel fit; the 390px panel has no horizontal overflow. These are Chromium viewport checks, not physical-device acceptance.

Independent review found no material implementation issue. Its one documentation mismatch was corrected and rechecked against unchanged source hashes.

Gates: full test:fast passed 796 suites / 8223 tests; 3 suites / 17 tests skipped. TypeScript passed; full ESLint passed with 0 errors and 29 inherited warnings. The first full run exposed an English close-label fallback; it was replaced by an existing translated fallback, then the targeted and full gates passed.

Local evidence is retained under `.cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/`: red/green logs, screenshots, browser measurements and source hashes. The case is ignored by Git; this manifest, regression tests and commit message retain the durable trace.

### Mechanism coverage

| Place | Result | Reason |
|---|---|---|
| ViewPlanMenu and shared header consumers | Fixed in this branch | The one manually created modal/root is React-owned; header integration tests pass. |
| Existing modal, scroll and focus hooks | Reused | No second implementation of shared behavior. |
| Clipboard/download temporary DOM | Unaffected | No React roots; temporary service elements are removed. |
| visualEffects.ts blink overlay | Unaffected | Timed noninteractive feedback, removed after blinking or cancellation. |
| Server and offline writers | Unaffected | This dialog is read-only; no new data-writing path. |

### Production acceptance after authorized merge

1. Confirm that the deployed revision contains this fix.
2. Use an authorized test account and a test sermon with populated and empty plan sections.
3. Open sections from the manual and thought-based plan headers. Verify Markdown, colors, content and repeated opening.
4. Verify close button, Escape, backdrop, Tab containment, focus restoration and background wheel lock. Escape must keep the route.
5. Check phone, tablet and desktop widths; repeat on an already loaded plan without network and restore the connection.
6. Record deployed revision, browser, screenshots and outcomes. Production acceptance stays pending until these checks actually run.

## BUG-20261013-care-headers-cut-on-phone

Stage: locally verified and independently reviewed; production verification pending.

Both populated care lists squeezed their title into one row with the header actions. At 390px the council title had 163px for 177px of text; the service-order title had 0px for 257px. `truncate` hid the words. `CareSectionHeader` now owns this shared presentation rule: a readable title, actions below it on narrow screens, wrapping when needed, and the existing row on wider screens. Icons, typography, colors, buttons and handlers remain.

The real-browser regression is `frontend/test-utils/assertCareHeaderLayout.ts`. Load a populated list after its interface language resolves, then evaluate its exported function in the page. It throws if the title is clipped or outside the viewport, or an action is clipped, outside the viewport or overlaps the heading. This DOM geometry check is executed in Chromium, not jsdom. The same function failed on both original headers before the implementation change and passed afterward on both routes at 320, 390, 640, 834 and 1280px.

The new header's semantic/action tests and existing council/service-order page suites passed 34 tests. Browser checks also covered entering and leaving reorder mode, plus opening and cancelling the new-council form. No council was created and no list order was changed. The primary agent visually inspected before/after 390px screenshots and the service-order view at 320, 640 and 1280px, including reorder mode. There were no browser console errors during these checks. These are Chromium viewport checks, not physical-device acceptance.

Mechanism coverage: the two affected list headers use the shared component. Care home/detail headings do not use the failing fixed-title/action row. The conduct screen's compact user-authored title is a different interaction. Server, offline and data writers are unaffected by this presentation-only change. No labels or translation keys changed.

Gates: targeted Jest passed 3 suites / 34 tests. Full ESLint passed with 0 errors and 29 inherited warnings. Full Jest passed 797 suites / 8225 tests; 3 suites / 17 tests skipped. `npm run compile` and the production build passed, including route type generation and the build TypeScript check. Independent review found no material issues and repeated the 34 targeted tests.

Local evidence is retained in the same ignored case artifact directory: `care-headers-red.json`, `care-headers-browser-green.json`, screenshots and `care-headers-verification.json`. The committed browser assertion, tests, manifest and bug-ID commit retain the durable trace.

### Production acceptance after authorized merge

1. Confirm that the deployed revision contains this fix.
2. Open populated `/care/council` and `/care/orders` using an authorized test account in Russian.
3. Check 320, 390, 640, 834 and 1280px: full readable title and buttons, no overlap or horizontal page overflow. At 320px wrapping is expected.
4. Enter and leave reorder mode without moving an item. Open and cancel the new-council form without submitting it.
5. Check English/Ukrainian labels, empty-list states, and light/dark styles; use a phone/tablet where available.
6. Record deployed revision, browser, screenshots and outcomes. Keep production acceptance pending until these checks run.

## BUG-20261012-dates-in-browser-locale

Stage: locally verified and independently reviewed; production acceptance pending.

The interface language now controls numeric dates, timestamps and month names in the affected displays. `formatDateForLocale` and `formatDateTimeForLocale` extend the existing `utils/dateFormatter.ts`, normalize language through `resolveAppLocale`, reuse its date parser and preserve caller options. A missing/unknown language resolves to English instead of the browser default. ISO calendar dates keep their local calendar day; timestamps retain local time and seconds. Invalid metadata dates render blank. Existing fixed-format `formatDate` / `formatDateOnly` contracts remain unchanged.

On base `f13ccf21`, five real component regressions failed on rendered text: prayer, study, series and share-link dates showed `1/15/2026` in Russian, and a group meeting showed `Jan 15, 2026`. Those assertions pass after the fix and exercise language changes without remounting. The separate formatter/settings tests cover all three locales, regional codes, fallback, options, invalid values, calendar days, timestamps and the visible build label.

A negative control temporarily ignored language in the shared formatter: 9 of the 16 new tests failed for the original formatting reason; 7 unaffected cases passed. The source was restored byte-for-byte and all 16 tests passed again. Existing prayer, group, series and share-page behavior suites also passed.

| Affected display | Automated evidence | Localhost evidence |
|---|---|---|
| Prayer cards | `dateLocaleScreens.test.tsx`, existing card suite | Russian card before/after; browser language remained en-US |
| Prayer detail and updates | Existing page suites; formatter timestamp tests | en/uk/ru switched through normal menu; three dated updates retained time/seconds and stayed readable on an already loaded offline screen |
| Study cards | `dateLocaleScreens.test.tsx` | Collapsed/expanded older QA note, both date labels |
| Study-note metadata | Shared formatter tests | Existing note: creation date in the side panel |
| Share-link list | `dateLocaleScreens.test.tsx`, existing page suite | Existing links: numeric creation dates |
| Share-note window | Shared formatter option tests | Existing link: localized day/month and unchanged share controls |
| Group cards | `dateLocaleScreens.test.tsx`, existing card suite; browser geometry assertion | Localized month and complete date at 320/390/640/834/1280px |
| Series start date | `dateLocaleScreens.test.tsx` | Both existing detail screens opened; neither has a startDate, so that conditional label was not observed live |
| Build timestamp in Settings | `ShowVersionToggle.dateLocale.test.tsx` mounts the real component with a build-time fixture | Not observed live: this dev server has no configured build timestamp |
| Legacy recovery dates | Canonical locale fallback; existing `LegacyQueryRecovery.test.tsx` | No archived-copy fixture was forced into live storage; this fallback was not observed live |

The geometry check `frontend/test-utils/assertGroupMeetingDatesReadable.ts` caught a consequence during visual acceptance: a Russian date needed 89px in a 78px cell. The date span now wraps inside the existing group-card grid. The same browser check failed before that adjustment and passed at all five widths afterward. The primary agent visually inspected final phone and desktop screenshots; complete day/month/year remain visible. There is no new data-writing path.

The mechanism audit includes all default-locale Date/Intl calls. The two server feedback-email timestamps are developer diagnostics and stay unchanged. Other date displays already pass the app language (dashboard, admin, usage labels), or have an explicit English fallback. Word-count number formatting and diagnostic timezone inspection are outside this date-display class.

Gates: 20 final targeted tests passed. On the final code, full Jest passed 801 suites / 8250 tests (3 suites / 17 tests skipped), full TypeScript and ESLint passed (0 errors / 29 inherited warnings), and production build passed including route types and its TypeScript check. Independent review found no material issues, repeated the 16 new tests and checked the final date-wrapping adjustment and screenshots.

Evidence is retained in the ignored case artifact directory: `dates-locale-red.log`, `dates-locale-mutation.log`, `dates-group-layout-red.json`, browser measurements/screenshots and `dates-locale-verification.json`. The regression tests, browser assertion, this manifest and the bug-ID commit retain the durable trace. Language was restored to Russian; no content was edited and no share link was created/deleted. Offline mode was restored in a finally block. Browser checks used Chromium at 390px and 1280px, plus the five-width group-date matrix; these are not physical-device acceptance.

### Production acceptance after authorized merge

1. Confirm the deployed revision contains this fix; use an authorized test account with the browser language different from the app language.
2. In prayer list/detail, change app language en → uk → ru without reloading. Verify date format, answered date and update timestamps, including hours/seconds. Restore the language.
3. Check an older study card collapsed/expanded, note metadata, an existing share-link list and its share window. Preserve their content and links.
4. Check dated and undated groups at 320/390/640/834/1280px: complete day/month/year, no clipping, unchanged meeting selection and start controls.
5. Use a test series with startDate, an enabled deployed build timestamp, and a safe pre-existing archived-copy fixture where available. Verify these three labels explicitly; they had the local live-fixture limits listed above.
6. Repeat on an already loaded screen offline, restore connectivity, and record the deployed revision, screenshots and outcomes. Production acceptance remains pending until executed.

## BUG-20261013-refused-thoughts-notice-shows-raw-data

Stage: locally verified and independently reviewed; production acceptance pending.

Readable refused drafts now use the same labels as the document screen for known status, type and other choices. `utils/storedFieldValue.ts` owns this display rule by collection and schema path. It does not translate an arbitrary matching word: a title, paragraph, plan cell or unknown choice stays verbatim. It produces a display copy, never a storage update. The banner compares raw values first, then labels scalar fields, changed-item words and structured fallbacks. A language change refreshes its local listing without waiting for the five-second poll.

The same formatter covers legacy-copy differences, their copied device text and readable content when no comparison is available. Raw details and JSON downloads retain the original data. The new series-kind labels complete an existing screen lookup; the type field name now uses the shared field-label mechanism.

On base `f0ff3427`, three behavioral component regressions failed before production edits: scalar group status, a changed block's status/type, and legacy-copy status differences. Review then found a missing legacy plan-mode mapping; a fourth consumer regression failed on raw manual/ai before that mapping, then passed. Utility tests use all three real locale files and check known screen choices, nested values, authors' words, unknown values and unchanged inputs.

| Mechanism consumer | Coverage and boundary |
|---|---|
| Banner scalar values and nested items | Component regressions; actual localhost refused group status, copy and resolution flow |
| Legacy differences, copied device text and readable fallback | Mounted recovery suite and shared formatter; no artificial legacy archive was injected into live storage |
| Schema choice paths | Groups, series, prayers, study notes/materials, councils, sermon dates/goals, plan mode, scratch section, narration source and settings |
| Raw evidence and generated metadata | Raw JSON/details/download retain identifiers. Generated audio-fragment sectionId/kind/role and provider/model identifiers remain diagnostic values |
| Server, offline journal, data writers and resolution rules | Unchanged; only the two client presentation consumers use the formatter |

Localhost acceptance used the existing test account, Russian UI and an en-US Chromium browser. A targeted window.fetch stub refused exactly one QA group's status change without forwarding it to the API. On the unchanged implementation the groups-list notice showed the raw active value. Afterward it showed the localized label, survived reload, and changed en to uk to ru through the normal menu in 118/147/109 ms observations. The copied text matched the Russian notice. The already loaded notice retained its words offline; connectivity was restored in a finally block.

The primary agent visually inspected before and final 390/1280px screenshots. Browser geometry also passed at 390/834/1280px: all notice text and controls fit. There were no application console errors. Taking the server version removed only the synthetic refused draft; after reload the QA group was again a draft and no notice returned. The language was restored to Russian and the fetch override was gone. These are Chromium viewport checks, not physical-device acceptance.

Gates: full Jest passed 802 suites / 8317 tests (3 suites / 17 tests skipped), targeted 121 tests passed, translations passed 8 tests, TypeScript passed, and ESLint passed with 0 errors and 29 inherited warnings. One full Jest run force-exited a worker at teardown while exiting 0; the targeted suites repeated with --detectOpenHandles and ended normally. The cause of that one full-run warning was not isolated. A production build is not a per-bug gate for this client-only display change; the complete branch build remains required at final acceptance.

Evidence is retained under the ignored case artifact directory as refused-values logs, screenshots, measurements, source hashes and verification JSON. This manifest, tests and the bug-ID commit retain the durable Git trace.

### Production acceptance after authorized merge

1. Confirm the deployed revision contains the fix; use an authorized QA account and a disposable test document.
2. Reproduce a controlled refused status change with delivery intercepted before it reaches the database. Leave its screen and check the notice against the status label on the document screen.
3. Switch en to uk to ru, copy the draft, reload, and repeat on an already loaded screen offline. Restore language and connectivity.
4. Check a changed group block and a safe pre-existing legacy copy with status/plan-mode differences; check readable labels and original raw details separately.
5. Check 390/834/1280px. Take the stored version of the synthetic draft, reload and verify that only that draft was cleared and test content stayed intact.
6. Record deployed revision, screenshots and outcomes. Production verification remains pending until these steps run.

## BUG-20261013-screen-draft-notice-doubles-on-its-screen

Stage: locally verified and independently reviewed; production acceptance pending.

A screen that already holds an answered request now takes over its refusal/conflict message without waiting for the five-second recovery poll. The engine publishes a stable immutable snapshot of those resources. Its existing async answerHeldOpen check and the reactive snapshot share one answeredEditorResources rule. Editor updates/initialization, close, journal transitions and owner retirement publish changes; an unchanged resource set keeps the same snapshot and does not notify React during typing.

The shared React facade exposes useOpenDocumentAnswers through useSyncExternalStore. EngineConflictBanner uses it together with the existing document-route check. A matching URL alone does not hide the only message while the editor is absent or still opening. Leaving the document or closing its answering editor returns the global notice. One-shot/form rules, resolution actions, data writers, stored work and the offline route resolver remain.

Before production edits, two component regressions failed on base d99a4af3: opening the answering editor after navigation and closing it without a journal update. Both use a sixty-second poll and require the handoff before that poll; the route-before-editor condition also asserts that the waiting notice stays visible. The tests pass after the fix. Engine tests additionally check immutable snapshots, no redundant notifications while typing or while another holder opens/closes, and clearing multiple holders across an owner switch.

The first implementation failed two existing engine tests during owner retirement: publishing after one close inspected a different old-owner controller after its generation became inactive. The final implementation detaches the complete registry before changing owner/generation and closes the detached entries, retaining their cleanup and unwritten-work handling. Existing and new owner/dispose tests pass. Independent review checked this correction.

| Mechanism | Coverage |
|---|---|
| Shared global notice for every engine collection | Component regressions on sermons; actual localhost group handoff and return |
| Engine open/state/close/journal/owner lifecycle | Existing engine/React suites and new engineOpenAnswers suite |
| Document DataSyncStatus and offline route | Existing presentation retained; loaded offline screen keeps its answer |
| One-shot/form notices and other documents | Existing banner regression suite; route plus resource guard retained |
| Server, persisted journal, data writers and cross-device ordering | Unchanged; snapshot publication reads local in-memory facts only |

Localhost before: one QA group status command was intercepted and refused without forwarding it to the API. After leaving the group and following Open and decide, the global banner and document status overlapped for 1603.8 ms. The primary agent inspected the original screenshot.

After: repeated list/document navigation at 390/834/1280px kept exactly one message on every sampled animation frame, including the loading interval when the global notice still owned the answer. A first phrase-only counter was insufficient because the global heading can change; the final observation counts the actual global notice and document status independently. The primary agent visually inspected final 390/1280px screenshots. The loaded document also kept its answer offline, with connectivity restored in a finally block. These are Chromium viewport checks, not physical-device acceptance.

Cleanup took the server version of the synthetic refusal and reloaded: group status was draft, with no refusal or global notice. The recovery list still offered a copy; its content was not judged for deletion in this bug. Recovery filtering remains separately tracked in BUG-20261006-recovery-list-offers-resolved-and-live-drafts. No application console errors were observed.

Gates: full npm run test with coverage passed 803 suites / 8322 tests (3 suites / 17 tests skipped), exiting 0 in 314.13 seconds. Global statements/lines coverage was 93.92%, branches 83.81%, functions 87.68%. TypeScript and ESLint passed (0 errors, 29 inherited warnings); targeted 4 suites / 145 tests passed, including the final test-harness getter-preservation adjustment. The whole-branch production build remains required at final acceptance.

Local evidence lives in the ignored case artifact directory: one-notice red/green logs, screenshots, frame timeline, source hashes and verification JSON. This manifest, regression tests and bug-ID commit retain the durable Git trace.

### Production acceptance after authorized merge

1. Confirm the deployed revision contains the fix and use an authorized QA account with a disposable test document.
2. Intercept/refuse a test status/text change before it reaches the database; leave the document and verify the global notice and way back.
3. Follow Open and decide. Record animation frames through editor loading: the global message stays until the screen owns the answer, then the document shows it once. Repeat returning to the list.
4. Check 390/834/1280px and the sermon route as well as a group. A matching route without an opened answering editor must keep the notice; an unrelated document must not suppress it.
5. Repeat on a warmed offline route where available and on an already loaded screen; restore the connection. Verify actions still resolve the same draft and preserve later typing.
6. Clear only the synthetic refusal using the server version, reload, verify original test content, and record deployed revision/screenshots/outcomes. Keep production acceptance pending until these checks run.


## BUG-20261013-preach-date-delete-no-screen

Stage: locally verified and independently reviewed; production verification pending.

The existing date-history component was never mounted on a screen. The sermon page now shows **Preaching dates** below its header in all three modes. Both month and agenda calendar cards already open that page. Each date retains its existing edit/delete controls and the delete confirmation form. No new writer, endpoint, queue or date-removal rule was introduced.

`EnginePreachDateList` reuses the page's document editor through `useDataDocument`. The sermon header remains the single document-level sync status; the pinned date form still owns its separate action status. Standalone history keeps its read-only fallback. Dates and the preached flag continue to save together through the existing form, targeted by stable row ID.

Two new real-page behavior tests were red on base `c788d933`: neither could find a date-delete control. They now verify confirmed deletion of one date with its sibling and sermon preserved, and cancellation with no transport write. Additional tests verify one page editor and retention of the sermon with `isPreached=false` when its last preached date is removed. The isolated mode-transition suite stubs the history like its other child modules because it stubs the document provider; real-engine page integration remains covered separately.

During browser integration at 320px, the previously unreachable row's planned-label text overlapped the actions by 14.18px. Date/status and metadata rows now wrap, keeping dates and badges intact. The same browser measurement reports zero overlap at 320, 390, 834 and 1280px. Screenshots were personally inspected at phone, tablet and desktop widths, including the delete confirmation.

| Scenario | Automated evidence | Localhost evidence |
|---|---|---|
| Reach history from the sermon page | `pages/sermonDetail.test.tsx`, real engine | All three modes show one history; both calendar month/agenda links reach it. |
| Cancel deletion | Real-page test and existing list tests | Both dates retained; zero command responses before and after Cancel. |
| Confirm one date | Real-page test and existing pinned-form tests | Server ACK revision 4 retained the sibling's notes/title/verse; reload retained the result. |
| Delete the last date | `components/EnginePreachDateModal.test.tsx` | Server ACK retained the sermon with empty dates and a false preached flag. |
| Offline deletion | Existing engine form durability/replay tests | Loaded screen accepted deletion offline; reconnect/reopen delivered it at revision 6 exactly once. |
| Hard reload offline | Not accepted here | Dev route reload failed with `net::ERR_FAILED`. Recheck the production SW as part of the existing offline-navigation/cache bugs. |

The temporary test sermon `2e1110ca-1b46-4d91-a64c-a2c44e233ca2` was deleted after acceptance; the server acknowledged its tombstone and the list contained no matching link. Existing owner content was not removed. A diagnostic unauthenticated fetch returned 401; this was a probe without the app auth header, not an app failure. Offline network errors belong to the explicit network test. No physical-device or production acceptance is claimed.

Gates: final targeted 5 suites / 87 tests passed; translations 8 tests passed; full TypeScript passed; ESLint passed with 0 errors and 29 inherited warnings. Full tests passed 803 suites / 8326 tests (3 suites / 17 tests skipped), followed by a successful production build including route type generation and build TypeScript validation. No worker teardown warning occurred in this final run. Independent review found no high-confidence issues and repeated the four real-engine suites (63 tests) after the layout and last-date checks.

Mechanism audit: the sermon page was the missing owner; the month/agenda cards share its link. The unused history was integrated without a nested provider. `EnginePreachDateModal` / `preachDateForm` and the shared facade/server protocol remain the canonical action; existing tests cover remote edits, missing row IDs, sibling preservation, read-only storage fallback and durable replay. No separate server/offline implementation was added.

Local evidence: the ignored case artifact directory holds `date-removal-record.md`, `date-removal-red.log`, `date-removal-targeted.log`, browser responses/geometry/screenshots, gate logs and the final verification record. The new tests, this manifest and the bug-ID local commit retain the durable trace.

### Production acceptance after authorized merge

1. Confirm that the deployed revision contains this fix. Use an authorized test account and a disposable sermon with at least two dates, distinct church/audience details and notes.
2. Open that sermon from both calendar views. Verify the same date history in prep, classic and scratch modes, with only one document sync notice.
3. Cancel one date deletion; all data must stay. Then confirm it; only the chosen date must disappear. Reload and verify the sibling's notes and sermon content.
4. Delete the last preached date; the sermon must remain, with no remaining preached status. Check month/agenda entries and analytics.
5. On an already loaded screen, delete a disposable date offline and reconnect. Verify one delivery, no resurrection and sibling preservation. Verify full offline reload separately on the deployed service worker; do not inherit the dev acceptance limitation as success.
6. Inspect phone/tablet/desktop sizes, all three languages and a physical device where available. Remove the disposable fixture and record deployed revision, server outcomes and screenshots.


## BUG-20261004-study-built-sermons-old-title

Stage: locally verified and independently reviewed; production acceptance pending.

The note page and its **Sermons built on this note** block now derive reverse links from `useSermonsDataCollection`. They share the existing engine collection instead of fetching a separate legacy React Query list. `Sermon.sourceNoteIds` remains the relationship owner. Reading starts only when both an owner and an existing note ID are available.

The live baseline used a disposable sermon linked to an existing QA note. Offline, the sermon's own heading changed from **QA linked name before 2026-10-15** to **QA linked name after 2026-10-15**, but the note's link retained the old name. After the change, repeating the same path with **QA linked name verified 2026-10-15** showed that new name immediately on both screens without network. Reconnection acknowledged the rename (revision 4).

Three real-engine regressions were red before the implementation: an offline rename kept the old name; a new reader with an empty React Query cache returned no stored linked sermon; and a legacy list read still ran beside the shared engine collection. All three are green. Existing derivation tests now use the real engine and still verify exact source-note filtering and no read for a new note.

| # | Criterion | Automated evidence | Browser evidence |
|---|---|---|---|
| 1 | Current locally submitted title | `useSermonNoteLinks.engineRead.test.tsx`, offline rename red to green | Original offline path repeated; both screens showed the new name. |
| 2 | Stored list survives a new reader without network | Same suite, engine reopen with empty React Query cache red to green | A fresh page showed the stored linked sermon before a list request. A data-request blocker was installed but intercepted zero requests before the row appeared; this is cache-first evidence, not an observed network-failure test. |
| 3 | Shared collection, no separate legacy fetch | Same suite: one collection read across three consumers and zero `getSermons` calls | Response observer saw incremental sermon changes and the acknowledged rename/deletion. Billed Firestore reads were not measured. |

Read-cost scope: the old path invoked an owner-wide SDK/server-first sermon list in addition to engine readers. The new consumer shares the existing collection entry and its normal head/change tracking. The regression measures I/O requests through the real collection logic, with I/O replaced by the harness. It does not establish a daily bill or a new per-hour estimate. No private poller or cache mirror was added.

The primary agent personally inspected before/after desktop screenshots and the final 390px properties drawer. The title remained readable, with the same link and metadata presentation. At 834px the saved drawer screenshot captured only its upper content; it is not evidence of a visually inspected linked-title row. These are Chromium viewport checks, not physical-device acceptance. Complete cold application startup without network remains a separate service-worker acceptance item; this fix does not claim to settle it.

The test sermon `79d5cd2b-d4e5-4d4c-8d39-0ecb07f37a75` was deleted after verification (server ACK revision 5, tombstone true). Returning to the existing note showed zero linked sermons and its original title/content. Network and request routing were restored. Intentional offline network errors are part of the recorded test.

Mechanism audit: both reverse-side consumers call the same hook and are fixed together; the shared engine facade, cache, projection and protocol are reused. The forward `useStudyNoteDirectory` reads another collection and has authoritative-missing rules; its behavior is not established or changed by this reverse-sermon-reader replacement. Source-note writes and compatibility-cache publication keep their existing contract.

Gates: targeted 2 suites / 30 tests passed; full Jest 804 suites / 8329 tests passed (3 suites / 17 tests skipped); full TypeScript and ESLint passed (0 errors / 29 inherited warnings). Independent review found no high-confidence issue and repeated all 30 targeted tests. No route/config/server component or UI copy changed, so a per-bug production build/translation run was not required. The final whole-branch build remains a goal gate.

Local evidence: the ignored case artifacts contain `note-sermon-names-record.md`, red/green/full/type/lint logs, `note-sermon-names-browser.json`, screenshots and the final verification record. The committed tests, manifest and bug-ID commit retain the durable trace.

### Production acceptance after authorized merge

1. Verify the deployed revision. With an authorized test account, link a disposable sermon to a test note and load both screens.
2. Rename the sermon offline and return to the note through its normal source-note link. The note must show the locally saved new name immediately. Reconnect and verify one acknowledged rename.
3. Reopen the note with cached data and no network. Verify the list and title; record full cold-start/SW behavior separately. Check a second device after the first change arrives.
4. Observe collection/head/change requests with both note-page consumers mounted. Verify sharing and absence of the old owner-wide query; compare real read usage only with authorized telemetry and comparable activity.
5. Check the phone properties drawer and desktop sidebar, follow the sermon link, then delete the disposable sermon and verify the reverse link disappears. Record screenshots and server outcomes; remove the fixture.

## BUG-20261015-manual-form-does-not-update-recency

Stage: locally verified and independently reviewed; production acceptance pending.

Manual forms saved content without changing root `updatedAt`, leaving recently
edited documents in their old list position. `stampAcceptedResource` now derives
recency for every changed live effect in the existing transaction. Primary ACK,
related accepted copies, stored resources and subsequent reads agree. One server
ISO time is used per transaction attempt: acceptance time, not the UI action time
or exact database commit time. It never decides whose content wins.

Receipt replay returns before planning/writing; no-op and bookkeeping-only edits
retain prior recency. Tombstones remain without authored fields. Refused, blocked
and failed commits do not change the resource. Firestore operation budgets stay
unchanged (including5reads/7writes for a two-document relation).

Resource-document rebase owns root `rev`/`updatedAt`; generic value merge stays
ordinary, including standalone and nested authored fields named `updatedAt`. A
pending creation keeps its local timestamp until a server copy exists; revision
metadata still comes only from the server. A client timestamp can provisionally
fill missing legacy metadata while validating the candidate; accepted writes
replace it with server recency, and timestamp-only no-ops preserve the prior value.
Creation identity remains immutable under the existing validator.

Regression evidence: the original six regressions failed before the fix. Additional
review found and reproduced the generic-value boundary (one red test), then missing
legacy metadata and pending-create metadata (two red tests). All are green. The
no-op control explicitly requires ACK for a stale-before, identical-after content
edit and checks that timestamp-only writes leave legacy revision unchanged. Final
focused checks passed306 tests across8 suites; independent clean-context review
passed460 across13 suites at final acceptance, including the React facade, manual forms, plan trees
and `mergeOutline`. External Claude review was owner-authorized; its source-only
claims were checked against code and behavioral regressions.

Final full Jest with coverage passed804suites/8344tests (3suites/17tests skipped).
Coverage: statements/lines93.43%, branches80.81%, functions87.69%; repository
thresholds passed. Production build passed through `build-production.js`, including
route type generation, Next build and build TypeScript. Full ESLint passed with
0errors/29inherited warnings; both last-added test files also passed targeted ESLint.
The build script is the repository's production-build step; Jest with coverage ran
as its own complete gate rather than repeating the package's prebuild Jest command.

Initial live evidence used a disposable sermon on localhost3047. Before the fix,
creation and manual preaching-date Save returned revisions1/2 without`updatedAt`.
Afterward, a city edit returned revision3 with server time; an offline edit reached
revision4 after reconnect and survived reopening/reload. Separate authenticated
reads matched ACK5 and the built-app ACK6 in content, metadata and timestamp. The
primary agent inspected tablet834x1112 and phone390x844 screenshots: saved value
visible, close/Cancel/Save reachable, no horizontal overflow. The fixture was
deleted through normal UI with an exact-ID guard (ACK7deleted=true). No production
or physical-device acceptance is claimed; hard-offline startup was not exercised.
The final built-app pass after all refinements used a new disposable sermon:
createACK1, manualdateSaveACK2, offlineSave/reconnectACK3 and separateHTTP200reads
with matching metadata/content/timestamps. Online reload and form reopening kept
the offline city. Final834x1112and390x844 screenshots were personally inspected;
controls fit and no horizontal overflow. Cleanup returned ACK4deleted=true,
the own fixture disappeared and network connectivity was restored.


Evidence remains in the ignored case artifact directory: `recency-verification.json`,
red/green logs, source hashes, source-only review outputs, screenshots and
`recency-browser.json`, `recency-stored-read.json`, `recency-build-browser.json`
and final `recency-final-browser.json`.
The implementation, regression tests, this manifest and bug-ID commit preserve
the Git trace. Existing records are not backfilled. Expected offline network
errors and dev/HMR warnings occurred; no clean-console claim is made.

### Production acceptance after authorized merge

1. Confirm the deployed revision and use only disposable test records.
2. Change a group meeting's date/place; verify list recency, and identical accepted
   `updatedAt` in ACK and a subsequent document read.
3. Add/edit a preaching date through the ordinary sermon window, reload, and
   confirm details and timestamp. Preserve real sermons and other records.
4. Save an already loaded form offline, reconnect and confirm retained content
   and one accepted result. Keep automated replay/no-op/write-budget evidence.
5. Verify title autosave, an undelivered creation and a two-document relation.
   Remove only own fixtures; record revision, timestamps, screenshots and results.
   Production acceptance stays pending until these checks actually run.

## BUG-20261003-group-meeting-date-saved-while-typing / BUG-20261003-group-meeting-clear-drops-place

Stage: locally verified, independently reviewed and accepted; local commit `f7a3427b`. QA fixture deleted. Production acceptance pending.

The meeting header now uses one durable `useDataForm` stage through `useGroupMeetingEditor`. Date, place and audience share one 750ms autosave. A partial or impossible new date stays on the device and can be explicitly recovered after leaving; completing or clearing it submits the combined fields. Navigation and pagehide flush the last ready edit. An already-invoked manual Save may finish after its parent closes, within the same owner/generation; new post-close actions remain refused.

`editFirstGroupMeeting` changes only the requested field and preserves meeting identity, creation metadata, notes, outcomes and sibling meetings. An empty date means an existing undated meeting. Details can be prepared before choosing a day. Creation uses the same meeting edit helper and refuses incomplete dates on submission. Read-only content names the empty date. `groupMeetingDay` is the shared reader for group cards, calendar entries, range selection and dashboard scheduling; incomplete/impossible legacy values no longer become another calendar day.

Server admission accepts an empty or finished date and permits an unchanged legacy date when another field changes. Independent review caught the corresponding UI gap: a saved legacy date had blocked place/audience autosave. Five behavioral regressions first failed on blocked detail saving or unwanted normalization, then passed. UI admission compares exact meeting id/raw date with `initialData` (saved predecessor or baseline), so a newly typed or recovered partial date does not become eligible just because it is visible in the stage. Existing unchanged raw values remain intact.

Behavioral red/green evidence includes clearing without losing metadata/siblings, partial/impossible typing, server admission, shared readers, a Save finishing across route close, pagehide before React publishes dirty state, batched date/detail typing, and legacy detail-only edits. An isolated mutation replaced the original saved date with the current editable stage: the recovery regression failed after it admitted `2026-0` and place `Draft hall`. The canonical hook hash stayed unchanged. Early mapper/module-resolution attempts are harness failures and are excluded from this proof.

Final targeted verification passed 11 suites / 376 tests. TypeScript, translation coverage (8 tests), full ESLint (0 errors / 29 inherited warnings), a final test/hook lint check and production build passed. Build ID: `42rcN95sbJJ2no7qnHmYZ`. Full coverage passed805 suites /8385tests;3suites /17tests skipped (883.388s). Coverage:92.77%statements/lines,79.48%branches,87.76%functions; repository thresholds passed. The final strengthened recovery test and hook passed their final lint/type checks. Independent review matched all23source hashes and repeated11suites /376tests without material findings.

Localhost used the actual built application at port3047, the existing test account and one disposable QA group in the real backend. Before the fix, revision3 stored `2026-0`; revision4 removed the meeting and its details. After restoration/integration, explicit draft recovery retained raw date/place with no POST; completing sent revision17, clearing retained the same meeting in18, and offline combined date/place arrived together in19. On the final production build, partial+place sent no command; completing and the following place edit produced one ACK20. Clear+immediate calendar opening produced ACK21 with the same meeting id, empty date and retained place/audience; reload retained them. A sequential second tab's ACK22 was adopted by the clean first form. A hard-offline reload of this already-viewed route through the active service worker opened in2033ms and retained the values; network was restored and the second tab closed.

The primary agent personally inspected final screenshots at320,390 and834px. Date placeholder and editable place/audience are visible, with no horizontal page overflow. Existing single-line text inputs scroll their own long text. These are Chromium viewport checks. Meeting notes and siblings are covered in real-engine page tests, not this live one-meeting fixture. Legacy malformed-date detail saving is covered in the real-engine page suite without injecting invalid data through a backend bypass. An offline reload is not physical PWA fresh-launch proof.

Evidence: ignored case artifacts `group-dates-verification.json`, original reports/class audit, red/green logs, built/restored browser JSON and final screenshots. This manifest, committed regression tests and bug-ID commit retain the durable trace after local tracker removal. Only the disposable QA group was deleted through its explicit confirmation: ACK23 and authenticated GET both show a tombstone, value null and no list card. Manual recovery sources were not purged through internal storage APIs. The temporary authorization capture was removed; A fresh independent hand accepted item10.1 after verifying evidence/source hashes and repeating4focused suites /135tests.

### Production acceptance after authorized merge

1. Confirm the deployed revision contains these fixes and the shared accepted-recency prerequisite.
2. Create an authorized disposable group with a date, place, audience and meeting notes; record its meeting id and a sibling where supported.
3. Type partial/impossible dates, blur and leave. Confirm no invalid command; explicitly recover the raw date/details, then complete the day.
4. Change the date and place rapidly; verify one accepted combined save, correct recent-work placement and persistence after reload.
5. Clear the day, immediately open the calendar or leave. Verify the same meeting id, notes, place, audience and sibling; the group says no date and has no dated calendar entry.
6. Repeat loaded editing offline/reconnect, a cached-route reload and sequential devices. Check320/390/834 widths and existing legacy values without rewriting them.
7. Delete only the disposable QA group, confirm its tombstone, restore network/tabs/settings and record deployed revision, results and screenshots. Production acceptance remains pending until this runs.

## Main intake2a4d3a9b

Committed main changes for settings archive comparison and recovery refresh/confirmation were integrated after the clean GroupDates commit. Code merged without conflicts; the tracker retained the new late-server-copy report and all local closures. The shared accepted-recency and date-stage rules remain intact. Independent compatibility review found no issue.

The merged state passed805 Jest suites /8390tests (3suites /17tests skipped), full ESLint (0errors /29inherited warnings), TypeScript and production build `OjdRj2-43Cv-xyTEr_3tN`. Browser smoke confirmed that exact build, editable group header fields and Settings; the primary inspected the390px Settings capture with no page overflow. No content/preferences were edited. One existing tab navigation stalled; a fresh same-context tab loaded Settings, without clearing data/cache. The server answered the same request in2ms. No live archived-copy fixture was forced; its detailed behavior is covered by component/storage tests. Production/physical-device acceptance is pending.

BUG-20261015-settings-copy-never-matches-server was already handled by main commitd4d0a0c2. BUG-20261015-late-server-copy-keeps-echo-banner remains active: the bounded refresh still lacks a subscription. The local merge commit follows independent case acceptance.


## BUG-20261006-fence-readers-miss-long-and-quoted-fences

Stage: locally verified and independently reviewed. Production acceptance pending.

Code boundaries now come from the same CommonMark/GFM parser as MarkdownDisplay. The shared `markdownCode` reader masks original code ranges for preview/measurements and supplies source-line indexes to all five scanners: Markdown outline, plan heading normalization, note sections, cut heading grounding and plan-reference paragraph replacement. Quote/list termination, long backtick/tilde fences, indented blocks and exact inline delimiters follow that parser. Preview keeps inline-code text; word/paragraph measurement excludes it. The lightweight `codeFenceFor` writer remains unchanged. The existing installed parser and type packages are now direct pinned dependencies; no shared node_modules or environment file was changed.

The class sweep also found meaningful indentation removed by note-section `.trim()`. Section preparation now trims boundary blank lines only, keeping indented code as code in its text and measurement. Independent review caught parser logical line indexes diverging from LF-split source lines with mixed CR/LF. Mapping source offsets to those exact consumer lines fixes that regression without rewriting line endings. Direct regressions cover all five consumers. Empty GFM test stubs were removed so source-reader tests run the actual parser plugin.

Original behavior tests failed13/44; the plan-reference reader failed2/9; section indentation failed1/23; the review's mixed-ending example failed2 targeted assertions. Final focused verification passed10 suites/157tests. Full Jest passed806suites/8424tests (3suites/17tests skipped,141.679s). Full lint passed0errors/29inherited warnings; TypeScript and the production build passed. Build ID:`kEaeN5RqyBAIArJmpHgIQ`. Independent review verified the correction and repeated the server-heading and plan-reference suites:35tests passed, with no remaining material finding. The first broad run overlapped ongoing test additions and reported the intentionally added indentation failure; final broad and focused gates supersede it.

Browser verification used localhost3047, the actual built app, existing test account and one own disposable note/share link. The original editor paste measured4words/3paragraphs and exposed `Inside code` in its link description. The built result, after server ACK3 and reload, measured2words/2paragraphs and described `Before. After`. A complex pasted example retained quote/code text, excluded hidden headings, showed only `Visible` in the outline, measured4words/3paragraphs and described `Before. After. Visible. Prose`. No sermon or paid AI call was created. The primary personally inspected390x844 and834x1112 captures: readable counts and reachable buttons, no horizontal page overflow. A cached-route hard-offline reload through the active service worker opened and showed the correct count in1654ms; network was restored. These are Chromium checks, not physical PWA acceptance.

Cleanup used the note's ordinary Delete confirmation with exact URL/title/resource guards. ACK4 and an independent authenticated read show deleted=true/value=null; no list card remained and the public note API returned404. One browser tab remains online. Expected offline request errors occurred; no page exception was captured. Only owned fixtures were changed. A separate editor paste observation (a code-only list item becomes an empty bullet plus an outside code block) was recorded as BUG-20261015-list-code-paste-loses-container for recheck; editor paste logic was not changed here.

Evidence remains in the ignored current case: `fence-readers-verification.json`, red/green logs, source hashes, independent review, browser JSON and personally inspected screenshots. The committed tests, this manifest and bug-ID commit preserve the durable trace after local tracker removal.

### Production acceptance after authorized merge

1. Confirm the deployed revision and create only an authorized disposable note.
2. Paste prose around a four-backtick block containing triple backticks and a fake heading; save and reload.
3. Open Create sermon without submitting it: confirm only prose contributes to words/paragraphs and expected scratch count. Keep the code block intact in the note.
4. Create the disposable share link; inspect its metadata and image preview for prose only. Repeat with quoted/list/tilde blocks and a genuine heading after the code; verify outline and prose remain.
5. Check390/834widths, repeat a loaded route offline/reconnect, and verify normal prose/inline-code behavior. Repeat on physical devices when available.
6. Delete only the disposable note/link, confirm their removal, restore network/tabs and record the deployed version, results and screenshots. Production acceptance remains pending until this actually runs.

## BUG-20261015-list-code-paste-loses-container

Stage: locally verified and independently reviewed; production acceptance pending.

A code-only list item pasted correctly but its required empty first paragraph was written as a blank boundary line. After save/reload, CommonMark ended the item and placed its code outside the list. Initial Markdown loading also needed that leading paragraph to fit the editor schema. The shared `MarkdownListItem` now supplies it in the Markdown DOM hook and omits only that placeholder during serialization. The first real block starts on the marker line; a first horizontal rule uses underscores to avoid becoming an outside thematic break. Native list schema, commands and editable paragraph remain.

The first isolated item-parser implementation lost inherited rich-HTML marks. Independent review reproduced this and the final fix leaves native HTML parsing in its original context. Schema-derived Markdown preparation and serialization live together in one extension used by every RichMarkdownEditor. StarterKit's list item is replaced by that derived extension; its already installed, deduplicated 3.20.0 package is now a pinned direct dependency. No shared node_modules or environment file was changed. Server, offline storage and display readers keep their existing string contract. Ambiguous previously flattened Markdown is not automatically reattached to a list.

Before production edits, structural regressions failed10/16. The final tests reject the abandoned isolated parser in three native bold/italic/strike comparisons, plus the normal-whitespace control. An early equality-only test missed the original structure loss; an early raw-HTML test had root-position assumptions. Those attempts are retained as diagnostic history, not accepted red evidence. Final focused checks passed4suites/84tests, including32list tests, ordinary serialization, repeated saves, nested/quoted blocks, rule syntax, long fences and native indent/outdent/split. Native HTML paste controls passed without an additional plugin.

Full Jest passed807suites/8456tests (3suites/17tests skipped,177.839s). Full TypeScript, production build `a--3uNrrFP_WmbX2-tYQg` and ESLint passed (0errors/29inherited warnings); the final changed files also passed targeted lint. Independent review found the mark regression, reviewed its correction and repeated focused tests; fresh acceptance checks the final evidence and hashes.

Browser acceptance used the actual built localhost3047 app, an existing test account and one disposable note. Plain-text paste produced ACK3 and retained code inside its item after reload. A source clipboard with both plain and HTML flavours produced ACK4 and retained long code fences, a quoted item, nested code/rule and all three marks. Native rich HTML produced ACK5 with bold, italic and strike retained through saving/reload. A loaded offline edit reached ACK8 after reconnect; a separate authenticated read matched its content/revision, and reload retained it. A cached-route offline reload opened in1431ms with the same content and no recovery banner. A sequential second tab read the exact saved Markdown and sent0commands during observation. This is Chromium evidence, not physical-device/PWA fresh-launch acceptance.

The primary personally inspected390x844 and834x1112 screenshots. Code remains indented within its item, text/controls fit and there is no horizontal page overflow. The editor's required empty leading paragraph remains editable. One earlier immediate offline paste/Done/reload happened before autosave; it offered the complete text as a recoverable draft, which was explicitly restored and acknowledged. That attempt is not proof of automatic pending-write replay. Expected offline request errors occurred; no clean-console claim is made.

Only the own note was removed through its normal confirmation with exact title/URL/resource guards: ACK9 and a separate read both report deleted=true/value=null; no card remains. Network is restored and one tab remains. Evidence is retained in the ignored case as `paste-list-verification.json`, browser JSON, red/green logs, review, source hashes and personally inspected screenshots. This manifest, implementation, tests and bug-ID commit preserve the Git trace.

### Production acceptance after authorized merge

1. Confirm the deployed revision and create only an authorized disposable note.
2. Paste a code-only bullet/ordered item, save and reload; code must remain inside that item.
3. Repeat with nested/quoted lists, headings, horizontal rules and long fences. Check the ordinary list and indent/outdent/split controls.
4. Paste Markdown source carrying an HTML flavour, then native rich HTML with bold/italic/strike. Save/reload and confirm content and formatting.
5. Check390/834widths, loaded offline editing/reconnect, cached reload and a sequential device/tab. Record immediate-departure draft recovery separately from accepted-write replay.
6. Delete only the disposable fixture, verify its tombstone, restore network/tabs and record deployed revision/results/screenshots. Production acceptance remains pending until executed.

## BUG-20260809-studies-search-lag

Stage: administrative local closure of an existing fix; production recheck pending.

The existing fix `ecb597904009565ded9b634728ac85ceac70fe69` is an ancestor of this branch. The field updates immediately; `useDeferredValue` and memoized cards defer filtering/snippets/highlighting. Results advertise catching up and bulk expansion waits. Queries already require every word across the shared search text in any order. Stable empty share-link data preserves the card memo. No production code was changed in this verification.

The owner accepted typing responsiveness on2026-10-15, describing about100ms as acceptable; that is a subjective observation with no recorded device/revision. Current existing regressions passed4suites/59tests: input scheduling, multiword order, clear/reset, bulk expansion, card highlighting and stable share-link lists. No new red test is claimed for this administrative closure; historical red/green and the original400-note dev benchmark are in the original report. Their exact old benchmark was not replayed.

On built localhost3047 revision`9852b00e`, build`a--3uNrrFP_WmbX2-tYQg`,23existing test-account notes were read without content writes. `SYNC QA` and extra-space variants found the same two notes with separate highlights. No-match, Escape, clear button, expand/collapse all and note/back navigation passed. Seven typed characters produced MessageChannel main-thread gaps2.4-21ms; this is the present23-note sample, not the owner's volume or a before/after comparison. A cached offline reload opened in900ms and retained the query/results; subsequent offline no-match/reordered queries passed. One initial wait used h3 while cards use h4; its timeout was a harness error, corrected with heading-role checks.

The primary inspected390/834/1280px screenshots: readable search/results and controls, no horizontal page overflow. Search was cleared;23cards and0highlights remain, one tab is online and0data-engine commands were observed. No fixtures or preferences were created/changed. Expected offline network errors occurred; no clean-console or physical-device acceptance is claimed.

Evidence is retained in the ignored case: `study-search-verification.json`, original record, focused log, browser JSON and screenshots. The source is unchanged from the immediately preceding fully verified commit (807suites/8456tests, types/lint/build passed); those global gates were not needlessly rerun for documentation-only changes. Fresh acceptance verifies the existing source, evidence and focused tests.

### Production acceptance after authorized merge

1. Confirm the deployed revision; preserve existing notes and language/settings.
2. Search nonadjacent/reversed words, mixed case and extra spaces; verify complete matches, separate highlights, no-match and clear/Escape.
3. Verify expand/collapse all after results settle, and search retention on note/back navigation.
4. Repeat on the owner's existing volume at phone/tablet/desktop widths and on an already viewed list offline; restore connectivity and clear the query.
5. Record revision, dataset size, input measurements/screenshots and results. Historical owner acceptance and local checks do not substitute for this production recheck.

## BUG-20261002-live-text-field-drops-letter-at-machine-speed

Stage: locally verified and independently reviewed; production acceptance pending.

The shared text buffer now reconciles document echoes in a layout effect rather than leaving that mirror in passive state work between native input events. Pending-echo and refusal guards remain: unacknowledged words stay visible, and a clean focused field still follows the document. The change is confined to this hook; there is no new persistence path or queue. The browser A/B supports the scheduling intervention for the reproduced workload. The exact React-internal sequence behind error185 remains unproved; its depth guard alone does not establish an application loop or an engine publication interval.

The committed browser regression is `frontend/test-utils/assertLiveTextRetained.ts`: compare the complete expected string after real native input. Before the production edit,350input events retained349characters and the assertion failed at index339, with React185. A temporary plain textarea retained350/350 at the same cadence. The rollback A/B build `u-DdTlzqHiPOY2F3SSlJK` restored the passive mirror: six attempts passed before a4ms paced sequence retained347/350 and produced three fresh185errors. This is intermittent, so passing attempts are retained alongside failures. The first layout build passed eight350-character runs at4/6ms without page errors. React effect tags were checked to identify the served mirror phase; they are not performance counters.

Final actual-browser acceptance used production build `KvDxMdgl5jd97bfEu-2QV` on localhost3047, the existing test account and one disposable group. Twelve350-character native sequences at alternating4/6ms all matched exactly; measured mean input gaps were4.31-6.52ms. The one-line step title retained200/200; ordinary rich block text also persisted. ACK13 plus a separate authenticated read and reload retained the exact native string and rich text. Offline typing remained after a cached-route reload through the service worker in1897ms; reconnect produced ACK14, a matching independent read and matching online reload. A sequential second tab produced ACK15; the first clean field adopted its text while focused. No fresh page exception was captured in this final run. Expected offline request errors occurred; this is not a clean-console claim.

The primary personally inspected390x844,834x1112 and1280x1000 screenshots. The leader notes and controls remain readable, with no horizontal page overflow; the textarea retains all four lines after resizing. These are Chromium viewport checks, not physical-device/IME or PWA fresh-launch acceptance. The owner's earlier human-speed pass remains valid as an observation without a recorded device/revision. Only the own group was deleted through the normal confirmation with exact route/title/generation guards: ACK16 and an independent read show a tombstone/value null, with no card remaining. Network is restored, the second tab is closed and temporary authorization capture is removed. Historical own recovery copies were not purged through storage internals.

One earlier local build omitted the build-time `NEXT_PUBLIC_API_BASE=''` override, so health probes targeted3000 while engine commands used relative3047 URLs. Its reconnect observation is excluded as a harness error; the final same-origin build and network checks supersede it. A cleanup guard also initially used a Testing Library method unavailable in Playwright; no deletion ran on that failed call, and the corrected guard passed. These attempts remain in the case evidence.

Gates on the final source: six focused suites/42tests passed, covering delayed echoes, blur, refused words, older refusals, creation fields, rich-editor synchronization, tree titles and council integration. Full Jest passed807suites/8456tests (3suites/17tests skipped,398.243s); full lint passed0errors/29inherited warnings. Full TypeScript and the final production build passed. Bounded independent source review found no high-confidence defect; fresh acceptance verifies the evidence and repeats focused tests before local commit.

| Mechanism consumer | Coverage and boundary |
| --- | --- |
| LiveTextInput / LiveTextArea in groups, group preflight and councils | All use the corrected mirror; original leader-note and one-line browser regression plus shared echo/refusal and council tests. Existing screens do not add a second buffer. |
| CreateGroupView title/description and exegetical TreeNode title | Same hook; existing component tests passed. Their exact routes were not replayed live in this unit. |
| RichMarkdownEditor | Same corrected buffer; existing external-sync/refusal tests and own group rich-text save/reload passed. The distinct new-note route transition reported in BUG-20261013-note-editor-update-loop remains open. |
| Server, engine and offline storage | Existing public engine hooks remain. Exact native-string persistence, offline/reconnect and sequential-tab adoption were checked; no writer changed. |

Evidence remains in the ignored case: `live-typing-verification.json`, original report, red/rollback/layout/final browser JSON, runner/assertion source, focused/full gate logs, source review and personally inspected screenshots. This committed assertion, implementation, recipe, manifest and bug-ID commit preserve the durable trace after local tracker removal.

### Production acceptance after authorized merge

1. Confirm the deployed revision contains this hook change. Create only an authorized disposable group, open its first block and the Leader notes field.
2. Repeat the exact native350-character sequences at4/6ms and normal human typing; compare complete strings and record fresh exceptions. Keep the plain-textarea control and failed attempts. Check the one-line title, rich content and ordinary paste/IME on available physical devices.
3. Wait for accepted saves; verify exact content after reload. Repeat loaded offline editing, cached reload/reconnect and a sequential device/tab; a clean focused field must adopt the later acknowledged text.
4. Check390/834/1280widths and textarea resizing. Record physical-device/PWA evidence separately from browser viewport checks. Do not infer closure of the separate new-note update-loop report.
5. Delete only the owned fixture through confirmation, verify its tombstone, restore network/tabs and record deployed revision/results/screenshots. Production acceptance remains pending until executed.

## Main intake ef3c85fa

At clean local revision `ed8bcf62`, committed main/origin updates `277b1493`, `366f7dc9` and `ef3c85fa` were imported. The original checkout's uncommitted Bible work was left untouched. Two conflicts in LegacyQueryRecovery and its README required a compatibility resolution: keep main's new per-change review UI, preserve app-locale fallback for dates, and retain the accepted-recency contract and historical timestamp wording. The new review reads choices through the existing `storedFieldValue` rule. Its optional keyed-list reader context carries the containing field, so a template's status is named correctly while an authored title such as `draft` stays verbatim. Raw comparisons, hidden-value detection and copy/server decision identity remain on their existing paths.

Two earlier label tests were adapted to main's new open-review/copy-change controls; a nested-template label/control was added. Before the display adapter, these three assertions failed on missing labels while39others passed. Afterward six focused suites/142tests passed. An initial command used a nonexistent Jest config path and is excluded from regression evidence. Bounded independent review found no high-confidence compatibility issue and confirmed the resolved merge index. The original local fixes remain; this intake adds the modal-focus report from main without closing other tracker entries.

The staged merged source passed809Jest suites/8492tests (3suites/17tests skipped,158.151s), full lint (0errors/27inherited warnings), full TypeScript and same-origin production build `9_R15iIAxPrwQ3o1QOL7B`. Actual localhost3047 smoke opened Settings and2526verse rows in Psalms. The minimap scrolled700px while reading text stayed at41px; pressing the map then moved reading text to6809.5px. The primary personally inspected the1280px Bible and390px Settings captures: readable content/controls and no horizontal page overflow. A cached Settings reload offline through the service worker opened in1376ms; network was restored. No data-engine commands, fixtures or preference changes were made, and no page exception was captured; expected offline request errors and ordinary console warnings occurred, so no clean-console claim is made. One tab remains online.

No previous-version archive review was observed live in this test account, so that conditional UI and the preserved labels are verified by component/reader tests, not claimed as live browser acceptance. Production and physical-device acceptance remain pending. Evidence is retained as ignored `main-sync3-verification.json`, red/green/full logs, conflict snapshots, source review, browser JSON and personally inspected screenshots. The local merge commit follows fresh independent evidence acceptance. After authorized publication, confirm the deployed revision and repeat Settings, minimap scroll/press, archive review labels/explicit removal, saved-text and recency controls using only owned fixtures; restore network/tabs and record results.

## Main intake e1fd81d1

At clean local revision `f2e12357`, the next committed main/origin snapshot brought `97c18fec` documentation and `e1fd81d1` Bible cross references. The merge has no conflicts. Incoming non-locale files match the pinned commit exactly; the three locale JSON files retain both branches. The typing buffer, previous-copy display adapter, accepted recency and group-meeting editor remain unchanged. No unpublished work from the original checkout was imported.

Eight focused suites/141tests passed, including real reference-set files, versification, reader behavior, minimap, modal layers and the retained text/recovery controls. Full Jest passed811suites/8513tests (3suites/17tests skipped,148.814s); full lint passed0errors/27inherited warnings. Full TypeScript and same-origin production build `tCTJTJMb6AY00Om7dIedc` passed. No new production logic was written for this intake.

Built localhost3047 showed eight main references beside Ruth1:1 and eight entries in the window. Opening the window and previewing Genesis12:10 left the reading scroll at41px; Open navigated to that passage and browser Back returned to Ruth. Escape restored focus to the reference chip. The primary personally inspected1280px and390px captures: readable reference labels/text, reachable close control, no horizontal overflow; the phone window scrolls its longer list. Reference preferences remained null/default, no data-engine command or page exception was captured, network is restored and one tab remains. Reading navigation naturally updates its reading history; no account content or preference control was edited. Ordinary warnings and expected offline request errors occurred, so there is no clean-console claim.

The first offline reload showed current-build Bible text but no reference chip within7000ms. After reconnect, a matching Ruth set was found somewhere in CacheStorage; the specific new cache and worker transition before that first attempt were not captured. This failure is retained as `BUG-20261016-first-crossrefs-offline-reload-misses-chips` in recheck, with a link to the existing service-worker version-edge report. Its cause is not claimed. An online reload restored the chip; after explicitly confirming the Ruth set in the new `bible-crossrefs` cache, a second offline reload opened eight references/eight entries in1378ms. The passing repeat does not erase the first observation or establish its fix.

Evidence remains as ignored `main-sync4-verification.json`, focused/full logs, browser JSON and personally inspected screenshots. Fresh acceptance verifies the pinned merge and retained recheck before a local merge commit. Production/physical-device proof remains pending. After authorized publication, confirm the revision, repeat chip/list/preview/open/back and focus at phone/desktop widths, test offline both after a stable cache and while updating from the previous worker, retain failures, restore network/tabs/preferences and record exact outcomes. Do not close the new recheck from this integration smoke.


## Main intake eebdc093

At clean local revision `d04ee69b`, the already discovered main snapshot brought `41ad8e64`, `7eb08b9c` and `eebdc093`: desktop reader panes, touch-routing follow-ups, delayed reference navigation after closing its window, passage-end corrections and the version2 reference set. This pinned merge has no conflicts. Incoming files match main exactly, including removal of the66old-version source assets; existing cache entries were not purged. Six key local mechanisms/tracker files remain byte-identical to the local parent. The next upstream check follows the next bug commit, rather than recursively replacing a just-verified snapshot.

Nine focused suites/188tests passed, including the complete versioned reference set, reader, minimap, page gestures, modal layers and retained local input/recovery controls. Full Jest passed811suites/8517tests (3suites/17tests skipped,126.558s), full lint passed0errors/27inherited warnings, and full TypeScript/production build `MJMWwIRaxzeevgwuezFqb` passed. No new production source was authored for this intake.

Actual built localhost3047 at1280px kept the page at0 while the text pane scrolled5to605px; scrolling the map82to582px kept text at605px. Pressing the map moved text to5914px and kept the page still. Ruth1:1 showed eight references/eight entries; preview/open navigated to Genesis12:10 only after its window closed, and browser Back returned to Ruth. Escape restored chip focus. With version2 Ruth explicitly present in the dedicated cache before disconnecting, an offline reload opened eight entries in1377ms on the same build. This stable-cache pass does not close the prior first-update offline recheck. The primary inspected desktop panes and the390px reference window: readable content/controls and no horizontal page overflow. No data-engine commands or page exceptions were observed, preferences remained null/default, network is restored and one tab remains; ordinary reading history changes and expected offline network errors are separate.

The real-iPad momentum and window-unpinning defects cannot be accepted through desktop wheel/viewport checks. Their device acceptance remains pending along with production. Evidence is retained as ignored `main-sync5-verification.json`, focused/full logs, browser JSON and personally inspected screenshots. Fresh acceptance verifies this merge before its local commit. After authorized publication, confirm revision, repeat the desktop pane/map and reference flow, check stable-cache offline and previous-worker transition, and separately verify inertial handoff/jump-after-close on physical iPad; retain the first-offline recheck until its own diagnosis.

## BUG-20261015-modal-focus-not-held

Stage: locally verified and independently reviewed; fresh acceptance precedes the local commit. Production and physical-device acceptance remain pending.

The shared modal layer now owns initial focus, one Tab/Shift+Tab ring and return focus. It follows delayed portal attachment without resetting a stable panel during typing; inactive mounted panels remove their modal marker so page gestures resume. A small React-independent registry shares stack identity with the existing public helpers. Available controls, negative tabindex, named radio groups and empty/busy panels are handled in one focus utility. Explicit autofocus, editor-owned Tab and surviving menu-button return targets retain their meaning. Closing a lower layer cannot steal focus or strand a higher layer's eventual return target. Computed overlay z-index orders simultaneous layers, with opening order for ties; this is not a general CSS stacking-context solver.

The old modal-specific Tab handlers and generic focus-lifecycle copies were removed. In addition to FormDialog and existing direct consumers, the class audit found and connected the date calendar, floating text settings, note mobile sheet and admin user drawer. The note sheet keeps its initial panel focus, source-note selection keeps search focus, time pickers keep their confirm control and sermon preparation keeps phase-specific focus. Headless UI dialogs keep their own trap: the shared handlers yield when focus belongs to an external modal. An actual-library integration and both simultaneous sibling orders pass. There are no server, storage-protocol or content-save changes.

Before source edits, built localhost Groups > New group kept focus on its opener; all five Tabs reached background controls and Escape did not restore the opener. Nine of ten initial behavioral regressions failed. A temporary rollback of nine tracked production files later made ten of twelve expanded tests fail, and restored every edited file byte-for-byte. Additional same-commit nesting, radio-group, external-dialog, four legacy-consumer and inactive-marker failures were reproduced before their corrections. Harness failures and intermediate regressions remain in case logs; they are not counted as behavioral red proof.

Final frozen-source gates: full Jest passed812suites/8539tests (3suites/17tests skipped,128.257s), lint passed0errors/27inherited warnings, full TypeScript passed and production build `UgYXLvf7zz24F61o9gPfc` passed (build19.51s, build typecheck12.58s). The final consolidated focus/consumer/gesture selection passed8suites/143tests (4.065s), including17shared focus cases. Earlier broader35-suite/385-test coverage and full pre-final runs are retained as trials; the final full suite includes every latest control. All22changed frontend files remained byte-identical from the pre-gate snapshot through browser acceptance.

In the actual production-build browser, Group focus entered immediately and stayed inside for20forward/20reverse Tabs; Escape restored the opener without changing page scroll. Its nested calendar retained18forward/18reverse Tabs; Escape closed only the calendar and restored its trigger. Bible references retained18Tabs and restored their chip. Text settings retained18forward/18reverse Tabs and kept100% unchanged. The note mobile sheet retained20forward/20reverse Tabs, started on its panel and restored its header trigger. Closed panels left0modal markers and released the root scroll lock. A cached offline Groups reload opened the same build in1856ms, retained12Tabs inside and restored focus on close; connectivity was restored.

The primary personally compared the1280px before/after views and inspected390/834px screenshots: the existing layout and controls remain readable, no horizontal page overflow, and focus outlines identify the current control. These are Chromium viewport/native-key checks, not physical iPad or screen-reader acceptance. One tab remains online,0data-engine commands and0page exceptions were observed. Expected offline console/request errors occurred; no clean-console claim. Ordinary reading history may change, but no content inputs, saves or fixture creation ran. The optional live new-sermon text-entry confirmation scenario was rejected by automatic approval review because input could persist as a draft; it was neither executed nor retried. Safe-cancel confirmation, actual Headless UI interop and admin drawer have component-test proof in this unit, not live admin/draft-entry acceptance.

Evidence remains in the ignored case: `modal-focus-verification.json`, original tracker record, class inventory, red/green/negative-control and full-gate logs, browser JSON and personally inspected screenshots. Fresh acceptance verifies the final source/artifact hashes and repeats focused tests before commit.

### Production acceptance after authorized merge

1. Confirm the deployed revision. On desktop with a keyboard open Groups > New group without typing: verify focus entry, repeated Tab/Shift+Tab, Escape, return to its trigger and unchanged page scroll.
2. Open its calendar. Verify both Tab boundaries, date-navigation arrows, Escape closing only the calendar and focus returning to the calendar trigger. Close the empty form without saving.
3. Check Bible references, text settings and a note's mobile properties sheet. Keep text settings unchanged and do not edit note content. Verify close/restore and absence of stale modal markers or page locks.
4. In a naturally available confirmation or diagnostic dialog, verify foreground keyboard ownership and safe Cancel focus. An authorized admin can check the existing user drawer without submitting changes. Do not manufacture quota failures or alter real data to reach these screens.
5. Repeat a previously cached route offline, restore network, then check physical iPad scroll/gesture behavior and external keyboard plus screen reader as separate acceptance. Record revision, widths, cache preconditions and the actual results.

## BUG-20261015-late-server-copy-keeps-echo-banner

Stage: locally verified and independently source-reviewed; fresh evidence acceptance precedes the local commit. Production and physical-device acceptance remain pending.

The previous-version copy notice now observes changed, durably accepted snapshots at the shared IndexedDB adapter used by document and collection readers. Owner/resource-only notifications rerun the existing exact-echo retirement and comparison, including already-present comparisons; no extra network reader, polling queue, restoration or content writer was added. Visible/focus return rereads the shared cache after sequential work in another tab. Unchanged, stale, invalid and failed writes do not notify; UI listener failures cannot fail a committed cache write. Cleanup cannot remove a newer subscription set. Existing person-authored equality and id+raw removal guards remain, and changed server fingerprints invalidate earlier per-change choices.

Before edits, actual build UgYXLvf7zz24F61o9gPfc accepted a synthetic note into its real collection cache after virtual130s, while the open review still said it was unread. Three behavioral UI tests failed. With original production files temporarily restored, all six expanded UI regressions failed; edited source was restored byte-for-byte. A later cleanup-edge test also failed before its correction. Final57focused tests pass; full Jest passed812suites/8549tests (3suites/17tests skipped,127.816s), lint0errors/27inherited warnings, full TypeScript and same-origin production build3DrhGfangpyx4-2Ibp3jr passed (build16.69s). Four frontend files remained identical from the final source freeze through browser acceptance. Earlier runs during source changes, selector/cursor mistakes and the malformed first server-start command remain as excluded trials.

Actual browser acceptance used isolated contexts cloned from the existing local test login, synthetic local archives/read responses and blocked non-read requests. After130s, native Groups-to-Studies navigation loaded an exact echo and retired its notice within303ms for the whole transition. A differing copy instead showed both words and retained them after online reload and a service-worker-controlled offline reload (1391ms). The latter aborted network routes as well as setting offline. Another actual tab accepted revision2 into shared IndexedDB; after returning, native focus refreshed the first tab's still-open comparison and preserved archived words. Initial forced focus emulation kept both pages active and emitted no return event: that timeout is retained. Disabling focus emulation in both disposable pages produced one native focus event; no synthetic return event was dispatched. Visibility return also has component-test proof, rather than a native hidden-tab claim.

The primary personally inspected the1280px exact-echo result and difference views at1280/834/390px: readable text and reachable controls without horizontal page overflow. Final fixture pages reported0page exceptions and0content mutation attempts. The original baseline with serviceWorkers:block had a registration harness error, retained separately. All fixture contexts were destroyed; the original app remains one online1280px Groups tab with the expected new build,0dialogs,0engine commands and0page exceptions during its smoke. No synthetic fixture entered its storage or the real server. This is controlled local browser evidence, not a production or physical-device claim. Evidence remains in ignored late-copy-verification.json, source/class records, all red/green/trial logs, browser JSON and inspected screenshots.

### Production acceptance after authorized merge

1. Confirm the deployed revision. On a test profile with an owned previous-version copy, keep its server record unread for longer than two minutes, then open the relevant collection/document through normal navigation. Verify an exact echo disappears immediately after the accepted read.
2. Repeat with different archived words: show both versions, retain the archive after closing/reopening and reload, and verify a changed server comparison requires a fresh decision. Missing/unreadable/tombstoned baselines must not discard words.
3. Repeat a loaded copy offline, restore connectivity, then read a later owned change in another tab and return normally. Record the browser's actual focus/visibility events and verify the comparison updates without another content write.
4. Check phone/tablet/desktop layouts and available physical PWA devices separately. Retain all failed attempts and cache preconditions, close disposable contexts, restore network, and delete only explicitly owned fixtures through the normal flow. Production acceptance remains pending until executed.


## BUG-20261003-structure-board-cards-narrow-on-ipad

Stage: locally verified and independently source-reviewed; fresh evidence acceptance precedes the local commit. Production, owner visual acceptance and physical-iPad acceptance remain pending.

One shared CSS width policy now chooses how many full thought columns fit the actual container. Editable/read-only section boards, ambiguous thoughts and the loading skeleton use auto-fit tracks of at least24rem, capped at100% for narrower containers. The existing layout helper remains a compatibility facade; focus and explicit vertical views retain their flex paths. The ambiguous footer spans the available grid instead of forcing three implicit columns. Buttons, content, colors, drag order and data writers are unchanged. The class audit was written in BUGS before source changes and retained in the ignored final tracker record.

Before production edits, the real built localhost board at820x1180 gave each thought paragraph60.664px twice. Its actual browser regression requiring192px and no page overflow failed. A reversible browser-only CSS probe changed60.664to570to60.664px and was removed. The same regression on final build DCy91KhayUViSzHZw002M passes at570px. This is actual browser geometry red-to-green; jsdom only verifies the nearest layout/focus/drag contracts and cannot prove CSS widths.

All six changed frontend files remained byte-identical from the source freeze through gates and browser acceptance. Six focused suites/62tests pass. Full Jest passed812suites/8549tests (3suites/17tests skipped,127.06s); lint0errors/27inherited warnings, full TypeScript and production build pass (build18.97s, build typecheck3.89s). No runtime viewport state, server rule or save protocol was added.

Actual settled browser widths320/390/768/820/834/1024/1180/1280/1440/1920 had0horizontal page overflow. At820px one column gives570px text; at1180px two columns give360px; at1440px three columns give262px. Native vertical/horizontal and two-section/focus switches work; the original layout preference was restored to null and the URL restored. A controlled, previously cached service-worker offline reload opened the same build in1400ms with570px text and27paragraphs; network was restored. An existing second sermon with12ambiguous thoughts measured608px at820,419px at1180 and328px at1440; the footer spans the full grid at every width. Read-only and skeleton consumers have shared-source/component proof here, not a live silent-storage path. Drag/drop is covered by existing contract tests; no actual content move was made in the browser.

The primary personally compared the before820px view and after820/1180/1440/390px views, plus ambiguous820px: thought paragraphs are readable and existing controls/style are retained. The independent source review found no confirmed CSS, Tailwind, focus or drag regression. Actual browser results on the final build had0new page exceptions and0data-engine commands. The single historical React185 from a rapid old-build resize remains recorded as BUG-20261016-structure-resize-update-loop; a stable repeat is not proof of its repair. At320px nested card padding already squeezed a single column to86px before this grid fix; that separate mechanism remains BUG-20261016-structure-card-padding-squeezes-small-phones. No universal phone-readability claim is made.

The original tab is back online on Groups at1280px, with0dialogs, one context/page and QA listeners detached. A cleanup locator expecting an exact Groups heading timed out; the actual workspace has a longer heading and was verified by snapshot. Earlier skeleton-modal navigation and discarded post-crash measurements are retained as excluded trials. The initial work-button click was rejected by automatic review as potentially paid/writing; source evidence established that the exact handler only navigates to the structure route. The same action was then approved with that new evidence and no mutation attempts occurred. Evidence remains in ignored ipad-board-verification.json, red/green/browser JSON, logs, class record and inspected screenshots.

### Production acceptance after authorized merge

1. Confirm the deployed revision. Open Sermons > an existing sermon > the button opening its structure board. At portrait/landscape iPad and resizable desktop widths, inspect long thought text, existing actions, two/three-column transitions and page overflow.
2. Switch vertical/horizontal, two sections and one focused section, then restore the original preference. Check a sermon with existing ambiguous thoughts and its trailing drop area without moving real content. Check the read-only path when naturally available and loading consistency.
3. After caching the deployed route online, reload it offline and restore connectivity. Record build/cache preconditions. This stable-cache check does not close the separately recorded first-update offline problem.
4. Perform owner visual acceptance on the physical iPad, including normal touch actions and dragging on explicitly disposable data. Retain the separate320px padding and intermittent React185 records until their own fixes are proved.


## BUG-20261016-structure-card-padding-squeezes-small-phones

Stage: locally verified and independently source-reviewed; fresh evidence acceptance precedes the local commit. Production, owner visual acceptance and physical-phone/iPad acceptance remain pending.

Thought cards now keep their full text width on phones: the same action buttons appear below the content, retaining32px targets and existing handlers/disabled guards. At640px and above the established40px side rail,16pxgap and original spacing return. Three shared spacing constants live in the existing structureBoardLayout module; normal/focus columns, point/unassigned lanes, nested subpoints, ambiguous cards and read-only cards use the corresponding narrow insets. The focus view retains its80px top reservation. No content writer, document schema, resize state or duplicate mobile control was added.

Before source edits, actual existing QA-sermon buildDCy91KhayUViSzHZw002M on localhost3047 at320x1000 had27paragraphs with86pxminimum text width and210splits of ordinary4-to15-letter words. Focus had16paragraphs at70px. The real-browser regression requiring192px,0ordinary-word splits and0page overflow failed. A reversible CSS-only probe measured86to198to86px; the first intermediate animation sample is retained separately. The class table was written in BUGS before FIX and retained in the final tracker artifact. A jsdom CSS assertion cannot prove geometry: existing action, layout, subpoint grouping, hover-scope, read-only and DnD contracts provide the nearest deterministic controls, supplemented by the actual browser red/green.

On final build _8Y065GHALvpZrVK0COHk, the identical browser regression passes:27paragraphs,198pxminimum,0ordinary-word splits and0overflow. Focus gives198px instead of70. Settled widths320/390/639/640/768/820/1180/1440 all have0overflow; text widths are198/268/517/390/518/570/360/262px respectively. Tablet/desktop widths retain the previous layout. Settled native vertical/horizontal switches give914/360px at1180 and restore the original null preference. A second existing sermon has12ambiguous thoughts at220px on320, with full-width trailing drop area. A previously cached service-worker-controlled offline reload opens the same build in1400ms at198px; network is restored. This does not close a separate first-update cache issue.

Controlled actual-browser nested checks cloned the existing test login into disposable contexts, modified only one cloned owned snapshot/read response and blocked all non-read API calls. Editable nested text measures196px; all three available32x32pxbuttons are visible, below text and within their card. The read-only fixture keeps196px,23thought cards and0action rails; it exercises the real copy-for-reading renderer by leaving only that context's engine-state open pending. Both modes report0page exceptions and0API mutation attempts. They are actual app renderings on controlled data, not a natural device-storage failure or production claim. Initial cache-reuse/selector harness failures are retained; no original profile or server content changed, and every fixture context was destroyed.

Ten focused suites/77tests passed before import sorting; final full Jest passed812suites/8549tests (3suites/17tests skipped,128.435s). Final lint passed0errors/27inherited warnings, standalone full TypeScript passed and production build passed in17.17s (build typecheck4.09s). All six frontend files match the final pre-gate freeze through browser acceptance. An interrupted first test/build trial without a Jest summary is excluded. Independent source review found no confirmed responsive, Tailwind, focus-reservation, drag-preview or read-only regression; its source-only scope is recorded.

The primary personally inspected before/after320px thought text, after390/1440px, focus320px, editable/read-only nested320px and ambiguous320px. Words, grouping and existing controls are readable; the wide view retains its style. The original browser ends as one online1280px Groups page on the expected build,0dialogs,0newpage exceptions and0engine commands; QA listeners are detached. Expected offline/unauthenticated network-console errors occurred, so this is not a clean-console claim. Evidence remains in ignored phone-cards-verification.json, all raw/trial logs, scripts, source hashes, browser JSON and inspected screenshots.

| No. | Problem from the pre-FIX plan | Result | Deterministic controls | Actual browser |
|---|---|---|---|---|
|1|Side buttons consume narrow text width|Fixed: same buttons below text under640px|frontend/__tests__/components/SortableItem.test.tsx; full final suite includes it|Existing320px text198px,0word splits; controlled nested3visible32pxbuttons inside/below|
|2|Nested body/card padding consumes remaining width|Fixed through shared spacing; focus top reservation kept|frontend/__tests__/components/Column.layout.test.tsx; frontend/__tests__/pages/structureBoardReadOnly.test.tsx; layout/component coverage is indirect for CSS geometry|Normal/focus320px198px, ambiguous220px, all eight widths and stable offline|
|3|Subpoint insets narrow nested full thoughts|Fixed in editable and read-only paths|frontend/__tests__/components/ThoughtLanes.test.tsx; frontend/__tests__/pages/structureBoardReadOnly.test.tsx|Controlled actual nested196px in both modes; readonly0actions|

### Production acceptance after authorized merge

1. Confirm the deployed revision. Open Sermons > existing sermon > structure on a320px phone and a normal phone. Inspect a long thought inside a point: whole ordinary words, no page overflow, all available buttons below text without smaller targets. Do not save a content edit merely to inspect layout.
2. Check one focused section, vertical/horizontal views and a sermon with naturally existing ambiguous and nested thoughts. Check the copy-for-reading view when naturally available; preserve its lack of edit actions. Restore prior layout preferences.
3. Resize through639/640 and tablet/desktop widths, compare the previous wide appearance, and check drag preview/touch actions only with explicitly disposable data. Actual drag mutation and physical touch acceptance were not executed in this local unit.
4. Cache the deployed route online, reload it offline, restore network and record build/cache preconditions. Owner visual and physical-device acceptance remain separate; retain the intermittent React185 and first-update offline records until their own proof.


## BUG-20261015-cross-chapter-passage-misread

Stage: locally verified and source reviewed; fresh independent acceptance is recorded in the local case before commit. Owner, production and physical-device acceptance pending.

Exact verse spans now carry a distinct `endChapter` with `toVerse`. Old `toChapter` keeps its whole-chapter meaning; a leftover `toChapter` still does not turn an old verse into a new cross-chapter span. Old truncated records without their raw input are not guessed or rewritten. The existing sermon-from-note selection compatibility for old chapter ranges remains.

Complete punctuated range grammar prevents unfinished input from becoming a different passage. Shared numbering enumerates all chapters and preserves exact partial endpoints when moving between Bibles. Formatting, comparison/search, Bible URLs/arrivals, the verse window/picker, mapped cross references, engine validation, public DTO and strict AI processing retain the endpoint. Existing same-chapter numeric URLs remain valid; a cross-chapter end uses `to=53:12`. TTS speaks both chapter endpoints. The AI prompt family moves to v4; paired deterministic fixtures check preservation/cleaning, not live model quality.

| Boundary | Evidence and limit |
|---|---|
| Parser/display/prose/URL and numbering | Original three browser labels RED; six original behavioral test failures become green. Added incomplete/reversed/missing endpoint and legacy controls. Exact mappings do not widen into full chapters. |
| Server/offline/public/AI projections | Engine document validation retains coordinates, public DTO includes endChapter and excludes private snippets, mocked AI processing preserves/deduplicates exact spans. Local back/reload retains all three references. No real server-write ACK was attempted. |
| Bible and verse window | Actual localhost note quick input retains Isaiah52:13-53:12, Genesis1:1-2:3 and John3:16-4:2. Isaiah opens the exact URL and lights15verses online/offline, including reload without network. Actual plan overlay window lights the same15verses using a clearly isolated owned snapshot fixture. Desktop and fresh390px window/picker were personally viewed. |
| Legacy and adjacent behavior | Existing chapter/book/verse forms, old mixed shapes, numbered books, locale parsing, same-chapter links, normalizers, public privacy, reader navigation and window dismissal pass. No locale keys or unrelated data writers added. |

Final frozen frontend:28 changed files. Full Jest814passed suites/8581tests,3suites/17tests skipped,131.457s. ESLint0errors/27 inherited warnings. Standalone TypeScript and production build/type check passed. Browser build `NEuq5KmBrqE-Uka95vWvL`, build17.44s; no frontend byte changes between gates and browser proof. Primary note fixture blocked25write attempts and had0page exceptions, then was destroyed. Plan fixture had0write attempts and0page exceptions; original Groups page remains online with no dialogs.

A separate resize defect discovered during this visual review was recorded as `BUG-20261016-verse-window-resize-loses-passage-position`: an already-open window can lose its scroll position when width changes. Fresh390px opening was verified here; the dedicated resize fix and its acceptance are documented below.

Evidence: local CrossChapter case artifacts, source snapshot, original/final tracker records, unit/browser RED/GREEN, accepted gate logs and verification manifest. Browser profiles and controlled data are explicitly identified; no production deployment occurred.

### Production acceptance after authorized merge

1. Confirm deployed revision and use an authorized disposable test note. Enter the three original cross-chapter ranges, edit one in the picker, save/reload and continue on another device. Verify actual server persistence of endChapter and no unintended metadata/text change.
2. Open Isaiah52:13-53:12 from the note: correct URL,15highlighted verses ending53:12; verify Genesis1:1-2:3 and John3:16-4:2 similarly. In a test plan and meeting block, open the complete range and verse window.
3. Check same-chapter verse/range, whole chapter/range and existing old references; switch Bible and check a mapped partial span across chapters. Ensure no old stored reference silently changes meaning.
4. Publish/read only an owner-approved test share link: exact span visible, private reference snippet absent. If testing AI, compare raw note with v4 output for lost endpoints, widened spans or invented references; record provider/model/version and cost. Do not equate schema success with extraction quality.
5. Warm the deployed note/Bible, test stable offline opening and reload, restore connection, verify queued edits receive real ACKs. Check phone/tablet/desktop and physical-device input. Keep the separate resize defect visible until its own fix.
6. Record deployed revision, screenshots, outcomes and cleanup of disposable test records. Production remains pending until this is actually done.

## BUG-20261016-verse-window-resize-loses-passage-position

Stage: locally verified; fresh independent evidence acceptance precedes the local commit. Production, owner visual acceptance and physical-device/Safari acceptance remain pending.

VerseSheet keeps its scroll container's16px horizontal padding constant. A non-scrolling flex wrapper adds12px on desktop, preserving the existing16/28px text inset and full-width phone scroll target. The ref, tab stop, scroll handler, initial passage placement, explicit return action and timer inset measurement remain on their established paths. No new observer, resize effect, state, schema or data writer was added. All plan and group-conduct consumers use this shared component.

Before source changes, a real Chromium assertion on build NEuq5KmBrqE-Uka95vWvL failed: a1280→390 resize changed first visible verse52:12 to26:20 while all15correct passage rows remained highlighted.600→320 retained52:12; the main reader retained52:12/52:13 at1280/1000/390. Two disposable DOM probes isolated the responsive pane padding; they are diagnostic evidence, not final-build acceptance. The class audit was written in BUGS before FIX and retained in the final tracker artifact.

The identical browser assertion passes on build BnI1x42ZdhJHdPkAWb87D:1280→390→820→320→1280 retains52:12,15selected verses and0page overflow. After manual scrolling to54:1, narrowing preserves54:1; an offline resize also preserves54:1. The explicit return button restores the selected passage. This is actual browser geometry red-to-green. Existing component/reader/geometry tests supply adjacent contracts; jsdom does not prove line wrapping.

Actual preaching view with keepVisible timer passes1280/390/820, including a separate150% stored-text-scale profile. The timer remains above the dialog, the wrapper has no scrolling overflow, focus survives timer updates, PageDown scrolls the focused text, and Escape closes only the verse window. The primary personally viewed desktop/phone before and after plus phone preaching at100%/150%. No API write attempts or page exceptions occurred in these final fixtures; every cloned context was closed and the original Groups page remains online.

The sole changed frontend file stayed byte-identical from the gate source freeze through browser acceptance. Targeted3suites/62tests and full814suites/8581tests pass (3suites/17tests skipped,128.526s). Lint has0errors/27inherited warnings; standalone TypeScript and production build pass (build17.14s, build typecheck3.33s). Actual fixture HTML includes the expected build ID. Local case evidence includes the exact browser assertion, RED/GREEN results, class record, gate logs and verification manifest.

### Production acceptance after authorized merge

1. Confirm the deployed revision. Open an existing test plan, open a Bible passage and change width across640px in both directions; preserve the verse being read, correct highlighting and existing text insets.
2. Scroll to another chapter, rotate/resize, then use the explicit return button. Repeat with large text and with a preaching timer or group-conduct bars visible. Check keyboard focus/PageDown/Escape.
3. After loading the passage online, repeat resizing offline and restore connection. This checks already-loaded geometry; it does not establish cold offline navigation or service-worker update behavior.
4. Inspect and scroll on the physical iPad/phone and Safari. Desktop Chromium emulation does not prove their anchoring or touch momentum. Record owner acceptance, screenshots and deployed revision.


## Council carry-to-new and care offline access

Stage: locally verified, independently source-reviewed and accepted by a fresh agent against the exact manifest below; production verification is pending.

Locally closed: BUG-20261013-council-carry-to-new-gone, BUG-20261016-council-carry-success-before-capture,
BUG-20261016-care-offline-shell-routes-missing and BUG-20261016-offline-card-overflows-phone.

An unfinished topic creates an undated preparing council when none exists. Source mark and destination
content share one durable atomic capture, immutable retry identity and server transaction. The engine
pins displayed words and the proven predecessor before storage awaits; later/unrelated words stay
outside this action. Narrow source adoption, full-action discard and completion references reuse the
existing queue/checkpoint mechanisms. Success waits for local durable capture; failed capture keeps
words and shows an error. A new request range prevents older bundles preparing unsupported participants.

All six care screens are registered lazily in the offline shell. The shared route-ID hook retains its
existing default and supports nested care IDs explicitly. The generic card keeps long URLs within the
phone width. Lazy screens require their chunks to have been visited online.

RED: original browser no-target refusal2/2; UI4failed/4passed; canonical atomic queue2failed for its
series-only restriction; server1failed/50passed; extra create-validation3failed/56passed; differential
HEAD shell/hook9failed/7passed. Invalid test-adapter/router fixtures are explicitly excluded. Same
regressions and neighboring mechanisms now pass191 tests in12 suites. Full frozen-source gates:
816 suites/8614 tests pass,3 suites/17 tests skipped; TypeScript pass; ESLint0errors26warnings;
production build17.92s, build dJUQjUjzCoDzZCmhM_UFI. Thirty-three frontend hashes match after gates/browser.

Real Chromium localhost3047 on cloned owned snapshots with synthetic content proves offline creation,
source reload, target navigation/reload, stable identity on reconnect, capture refusal, one/multiple
existing-target selection and all six care routes offline after warming their page types. API writes
were blocked: no actual live server ACK is claimed. Transactional transport/server tests prove both
writes, refusal atomicity and lost-ACK replay. Primary personally viewed desktop/phone/tablet and
before/after generic-card screenshots. Generic-card geometry passes320/390/820/1280. Browser contexts
were closed; original Groups tab stayed online. Physical device/Safari and owner acceptance remain pending.

An independent review found the close-before-adoption source projection leak; regression reproduced
and corrected it before final gates. Source/protocol/route reviews found no remaining high-confidence
issue in this scope. A separate existing-target offline projection defect remains open as
BUG-20261016-existing-council-carry-invisible-offline; this unit does not claim to fix it.

Local evidence: .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/council-carry-new-verification.json
SHA-256: 95b4e44b6f0143782ae647103e6ab323794c92bee234a0970c098f713d59f7da. The ignored case retains logs, scripts, snapshots and original records; this registry,
regression tests and commit carry the durable Git trace. Main was pinned eebdc093 at05:33 with0incoming.

### Production acceptance after separately authorized merge

1. Confirm deployed revision/build; use disposable owned council data. With no preparing council,
   carry one unfinished topic with summary, questions/answers/options and an old outcome. Exactly one
   undated preparing destination contains the words with fresh IDs and no outcome; source is marked.
2. Observe real ACK for both participants, reload and check on a second device. Retry an interrupted
   response and confirm one council/copy. Check source ordinary/later words remain intact.
3. Repeat offline after visiting the screen type; open/reload both source and destination, reconnect
   and verify actual delivery. Check one/multiple existing-target selection separately; the pending
   copy issue named above must be verified after its own follow-up fix.
4. Exercise controlled local capture refusal and proven terminal server failure on test data; no
   premature success, no partial effect, whole-action discard preserves words. Unknown delivery retries
   the same identity. Leaving immediately after invocation must not lose the action.
5. Visit all six care screens online, then open them through the offline shell, including nested
   council conduct/order IDs. Check an unknown long address at320/390/820/1280 and actual phone/tablet.
6. Record real production/browser/device outcomes. No push, merge, PR or deploy happened in this unit.


## Carry into an existing council while offline

Stage: locally verified, independently source-reviewed and accepted by a fresh agent against the exact manifest below. Both listed BUGS.md records are locally closed; production is pending.

Bugs: BUG-20261016-existing-council-carry-invisible-offline and BUG-20261016-existing-council-carry-content-unchecked.

The existing-destination hook now calls the same whole-action engine capture as creation. Both source and destination own durable participants. Destination pinning uses confirmed content and one proven saved chain, excluding unsent typing and refusing ambiguous/failed chains. Repeated carries use distinct stable copy IDs and preserve both predecessors. Source discard restores only its mark; destination discard reverses its append, retaining unrelated later words and keeping edited copied content recoverable through conflict. The shared server/client validator requires one matching copy, no old outcome and unchanged existing destination topics. Valid legacy commands keep their immutable delivery identity.

RED: atomic/hook3failed/14passed; server4failed/59passed; differential rollback1failed with the copy incorrectly retained. Final9suites280tests pass. Full816suites8630tests pass,3suites17tests skipped,131.562s. TypeScript0; ESLint0errors26baselinewarnings. Production build17.74s, buildtypecheck11.66s; buildID lUufxIG2wfmCDfjkwEsn1. All18frontend hashes stayed unchanged after final gates and browser.

Actual Chromium localhost3047 on cloned owned snapshots/synthetic topics: one existing destination and multiple-target chooser both capture2participants; source mark, old destination topic and copied topic survive offline navigation/reload; reconnect keeps IDs. Width390/820 has no horizontal overflow; primary inspected desktop1280 and phone/tablet screenshots including the copied words, question, answer and option. API writes were blocked: actual server ACK is covered by transaction/transport tests, not this browser run. All QA contexts closed; original Groups tab online. Recovery draft banner remains an already tracked separate issue. Physical devices/Safari/owner and production acceptance are pending.

Local manifest: .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/council-carry-existing-verification.json
SHA-256: 5f64d9b54a4d28a90710fcc6a2b4cfb699f8764cf69f1d05391a1f1ec01de58a. The ignored case keeps complete proof; this registry, regression tests and local commit keep the Git trace.

### Production acceptance after separately authorized merge

1. Confirm deployed revision/build. Use disposable owned councils: one held source with unfinished text, and one preparing destination with existing topics. Offline, carry once, open destination, reload: old topics plus exactly one matching copy remain; source is marked.
2. Repeat with several preparing councils: opening the chooser saves nothing, selection lands only in the chosen council. Carry two topics to the same destination and confirm distinct copies.
3. Restore connection and observe real ACK for both participants. Reload both, check on a second device and retry an interrupted reply: no duplicate and no lost destination words. Test a pending saved destination edit and unrelated later edits.
4. In a controlled test account, verify malformed copy/missing mark/dropped existing topic is refused atomically. Refuse a valid carry, discard the whole action and verify only its mark/copy are reversed. Words typed later, including inside the copy, remain available.
5. Inspect phone/tablet/Safari and obtain owner acceptance. Existing legacy single-source queued commands deliver compatibly; do not claim retroactive local participant ownership for them.


| Item | Result | Regression | Browser or manual evidence |
|---|---|---|---|
| 1. Both participants visible offline | Fixed | app/data-engine/__tests__/councilCarryAtomic.test.ts; app/hooks/__tests__/useCouncilDataDocument.test.tsx | Actual one/multiple-target carry, offline open/reload, reconnect IDs |
| 2. Existing and pending destination words | Preserved | councilCarryAtomic.test.ts: saved predecessor, unsent exclusion, sequential copies | Existing topic plus copied text visible at390/820 |
| 3. Whole-action discard | Scoped to own effects; later text recoverable | councilCarryAtomic.test.ts: refusal/discard, edited-copy conflict; old-rollback differential RED | Browser happy path inspected; negative rollback verified in real IndexedDB/transport tests, not live production |
| 4. Server matching copy and retained topics | Invalid commands refused atomically | __tests__/data-engine/serverRelations.test.ts:4RED to GREEN | Valid UI payload/path inspected; malformed-command refusal covered by server transaction tests |

## BUG-20261015-service-order-returns-to-old-copy

Stage: locally verified, source-reviewed and freshly accepted; production pending.

On a service-order detail screen, typing references in several pauses, finishing, opening a reference in the Bible and returning could temporarily show only the first partial reference. The page serializes saves. The engine had already captured a request durably but still awaited a shared preparation runner that could join or be upgraded to network delivery. Later saves stayed behind that response instead of becoming durable requests visible after navigation.

The seven common post-capture engine boundaries now schedule preparation with the existing owner-scoped background handler. They return after durable local capture. CommitQueue, delivery/CAS, explicit retry and server protocol remain. Capture failures still reject and background preparation failures remain visible/retryable. No service-order page cache or second queue was added. The same change covers one-shot membership, council carry, normal save/remove and manual resolution boundaries; each schedules only after durable capture and any required adoption.

Two engine regressions were RED before the fix: commit completion waited for ACK, and serialized one-shot edits had not all become durable. The same assertions are GREEN, including stable predecessor chains and explicit retry waiting for delivery. Timing-only neighboring assertions now wait for background observation; no behavior assertions were removed. Gates:62 suites/985 targeted tests and separately1 suite/29 conflict-banner tests; full816 suites/8632 tests,3 suites/17 tests skipped; TypeScript passes, lint0errors/26 inherited warnings, production build passes (build bqrqFxkFGCLohb1uMWH1c).

Actual localhost Chromium reproduced the partial-reference return twice on unchanged source and passed twice after the fix. Complete references are visible before the first ACK; offline reload keeps all three durable operation IDs and predecessor links. Controlled reconnect sends four attempts for three unique operations and retains final text after reload. Primary visually inspected390/820/1280px; no overflow, page errors or unexpected API writes occurred. Snapshots and edited words were synthetic in isolated contexts; all mutations were intercepted. These results do not claim a real server ACK or second-device delivery. Independent source review found no material issue.

The ignored case retains exact RED/GREEN logs, scripts, PNGs, source hashes and manifest under artifacts/service-order-pending-copy-*. Existing page death before local capture remains the separate accepted risk. After authorized merge/push/deploy, verify the deployed revision and repeat the Bible/back scenario under a delayed real response, offline reload/reconnect, real receipt and stable operation IDs, online reload and second-device visibility using authorized QA data. Restore QA data and record browser/device/screenshots. Owner and production acceptance remain pending.

Fresh acceptance verified v2 manifest SHA `06a677e88485e1108d7f3128e7f2a001744815c31cd4b255187e5d9bd057cfad`, all36 artifact/7 source hashes, repeated5 suites/139 tests and TypeScript, and individually inspected all three final PNGs. The earlier manifest and encoded script remain unchanged; the exact executed UTF8 input is retained separately and named by v2.

## BUG-20261013-note-editor-update-loop - bounded recheck

Stage: unresolved intermittent report; moved to Requires recheck, not fixed or removed. No application source changed.

On unchanged HEAD eaa1185b/build bqrqFxkFGCLohb1uMWH1c, five creation/input variants produced0 update-depth exceptions and retained exact words through permanent-ID adoption: rapid keyboard and native insertText before/after creation, plus paste-before-create. In three controlled-server variants one create and needed updates retained text after reload. Mutations were intercepted and receipts synthetic; actual server acceptance is not claimed. The initial unready attempt never adopted an ID and is excluded. Five variants give bounded coverage, not proof of absence.

Primary inspected390/820/1280px readback images with no overflow. Existing editor/buffer/autosave tests passed3 suites/33 tests. Phase27 full/type/lint/build logs describe unchanged app source and were not repeated. Historical Oct13/14 failures remain in BUGS.md. No cause or new RED-to-GREEN fix is claimed. Extension reconfiguration is a hypothesis only. Exact scripts/results/PNGs remain in ignored case artifacts/note-typing-*. Next reproduction should capture exact input, readiness/ID phase, full stack/build, dev with/without SW, IME and owner device. Production/physical acceptance remain unverified.

Fresh acceptance verified manifest SHA `416508abaf1eb2fc16f9d277138df329143a0764cf4aab8bab7f851cb9652350`, all15 artifact/8 source hashes, original report preservation, all three PNGs and repeated3 suites/33 tests. This accepts the bounded investigation only; the bug remains unresolved.

## BUG-20261013-legacy-preparation-drafts-unsurfaced

Stage: locally verified, independently source-reviewed and accepted against the exact frozen manifest; production pending.

On a sermon detail page, historical owner-scoped preparation drafts and older uid-less backups were retained in localStorage but invisible. LegacyPreparationRecovery now offers their full readable text, copy, exact original download and individually confirmed discard. One utility owns the exact keys, confirmed sermon ownership, preparation-only equality and raw-identity deletion guard. It reuses generic legacy discovery through the canonical public engine facade. No legacy draft automatically replaces preparation or enters the write queue.

Only a fresh successful server preparation-field match retires an echo. The optional fresh read runs through the existing engine transport with a new request query, preventing an older worker's exact-URL cache from answering that request. Owner, visibility and returned-resource checks stay; default consumers keep their previous URL/call shape. Missing/deleted/foreign/failed/offline answers retain originals. A replacement written during a pending request/question remains. Confirmed-version comparison coalesces cloned checkpoints so typing does not read the server on every keystroke.

RED:3 real sermon-page regressions,1 exact-URL cached-read regression,1 duplicate-read regression. GREEN:5 focused suites/80 tests, including the unchanged architecture boundary. Full818 suites/8662 tests,3 suites/17 tests skipped. TypeScript passes; ESLint0 errors/26 inherited warnings; production build nwIQeRdvzhU_Eizv0FOnI passes. The full gate caught an initial internal import and a direct re-export; the final public function passes without adding an exception.

Actual localhost Chromium: both historical formats visible with translated field labels; full words copied into an injected clipboard sink; two real downloads byte-identical; cancel retains, individual discard survives reload, foreign record stays and current confirmed preparation remains unchanged. Current-worker offline reload keeps both originals; a separate echo fixture retires only after a fresh successful read on reconnect. Two real tabs preserve/display a replacement written while the old discard question is open. Unsupported-serviceWorker-API variant is clean; Playwright's blocked-registration stub trial errors are excluded and documented. Selected successful read payloads and snapshot fields were synthetic QA fixtures through actual transport. Mutation attempts/page errors in final variants:0/0. This is not real production acceptance or an OS-clipboard claim.

Primary individually inspected final390/820/1280 PNGs at original resolution: both entries and controls fit, no page horizontal overflow. Disposable contexts closed and original groups tab online. Physical phone/tablet/Safari and owner acceptance remain pending.

Frozen manifest .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/legacy-prep-manifest.json SHA256 fe1f8b27825fe80bfe44ec64ecfe4b6c8266f7a41d187a8dfedd5cd4a40463f3 covers45 artifacts/16 sources. The ignored case preserves raw scripts, results, RED/GREEN logs, downloads and PNGs. Fresh acceptance result is recorded separately in the case.

After separately authorized publication: confirm deployed revision/worker; preserve preexisting local keys and use synthetic originals for an authorized QA sermon. Repeat preview/copy/exact download/cancel/individual discard/reload and fresh real-server equality retirement versus offline retention; verify no sermon write and unchanged current preparation, then restore QA keys. Check installed old-worker behavior and physical devices. No push, merge, deploy or production closure occurred here.

| Item | Result | Regression | Browser/manual |
|---|---|---|---|
| 1. Both old formats accessible | Fixed locally | legacyPreparationRecovery.test.ts and sermonDetail.test.tsx | Both full previews, clipboard sink and exact raw downloads |
| 2. Safe echo retirement | Fresh field comparison, retention on failed reads | transport.client.test.ts; LegacyPreparationRecovery.test.tsx | Failed read/offline retains; reconnect retires only matching copy |
| 3. Scoped discard and replacement | Exact owner/key/raw checks | utility/component tests | Cancel, individual delete, reload and two-tab replacement |
| 4. Existing preparation and responsive screen | Preserved | component/page regressions; confirmed-version repeat-read test | Persisted current field unchanged; primary390/820/1280 visual |

## BUG-20261003-audio-wizard-source-mode-mismatch and BUG-20261016-original-audio-adds-ai-words

Stage: locally verified, independently source-reviewed and accepted against the exact frozen manifest; production pending.

In Audio → Source, a failed Original preparation could leave saved AI words labelled Original and allow Google generation with those words. Preparing Original also replaced the only persisted AI copy, and even Original preparation requested AI transitions/quota.

A shared preparedAudioSources module now owns independently saved AI/Original sets, stable preparation identity, monotonic per-source revision, explicit prepared-section coverage, legacy promotion and replacement guards. Canonical engine and legacy transaction paths preserve the inactive source and latest unselected sections. Editors and generation name the exact shown source/version. Google accepts only Original, and incomplete section selection cannot create partial audio. Original preparation skips all AI calls and admission. Existing schemas/field labels accept the optional source maps without bulk migration.

The usePreparedSpeech controller separates authored text from source choice, waits and editor sessions. Switching and reopening reuse saved text; explicit preparation replaces selected sections and explains its consequences. Late responses merge newer durable sources but cannot relabel settings, replace newer errors, overwrite newer corrections or close another editor. Source selection remains local/read-only; legacy fields describe the last persisted/prepared/edited source. Existing HTTP calls stay at the wizard boundary; obsolete bulk-cache publishing and its ledger entry were removed, with no new boundary exemption. The existing audio recipe documents this rule.

RED13 → GREEN: original3 wizard cases unchanged; whole-document retention1; raw AI transition1; generation source/coverage4; raw quota3; retired409 UI1. Exact final full gate:820 suites/8700 tests passed,3 suites/17 tests skipped. Focused independent rerun:12 suites/219 tests including3 actual legacy transaction cases; final client/locale49; TypeScript passes; ESLint0 errors/26 inherited warnings. Production build nECgYuqXD9n93eLRwpUN- passes.

Actual localhost Chromium: original failure has no AI under Original and Generate stays disabled. Saved AI loads without preparation; Original preparation retains AI; a manual AI edit survives source round-trip and reload. OpenAI/Google generation requests carry the proper saved source/version/words. Offline source switching, explicit AI regeneration retaining Original, Google reuse without preparation and unprepared-section blocking pass. Main flow13/13, late-editor6/6 checks;0 page errors and0 unexpected mutations. Primary inspected final390x844,820x1100,1280x1100 and failure/late-editor PNGs individually at original resolution; no horizontal overflow. Disposable contexts closed, original groups tab online.

Browser preparation/edit results and collection-feed receipts were synthetic QA responses through real transport; generation was deliberately blocked before provider work. Persistence shown by this browser fixture is not a claim of real Firestore acceptance. Actual server transforms and both transaction paths run in tests. Physical-device, Safari/PWA, production and provider-audio acceptance remain pending.

Frozen manifest .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/audio-source-manifest.json SHA256 ca95419e92462e0ddfdbdff1d229d7c7433ff1986078b1a7113cc9b8b480e448 covers54 artifacts/26 sources. Fresh clean-context acceptance verified all80 entries and inspected the final PNGs; its verdict is recorded separately in the case. Excluded selector/path/mock/feed-fixture/copy trials remain available and labelled.

Two adjacent issues remain tracked separately: BUG-20261016-audio-result-after-leaving requires lifecycle reproduction; BUG-20261016-audio-editor-conflict-has-no-resolution needs an explicit comparison/apply path for a retained changed-version draft. This unit does not claim them fixed.

After separately authorized publication: confirm deployed revision/worker; preserve an authorized QA sermon's fields; repeat actual legacy AI promotion, no-AI Original preparation, manual AI correction, real-server reload and a second device. Confirm both persisted source sets and collection-feed receipt, explicit regeneration, selected empty/unprepared sections, stale editor/generation refusal with draft retained, slow/failed preparation and provider availability changes. Restore QA fields deliberately. Merge, push, deploy, paid provider calls and production closure were not performed here.

## BUG-20261016-audio-result-after-leaving

Stage: locally verified and independently source-reviewed; fresh exact-version acceptance is recorded separately in the case. Production pending.

Audio generation previously downloaded a late file after soft navigation back to the sermon list, and resume bytes were keyed without owner/sermon identity. A focused useAudioGenerationSession module now owns one mounted wizard's scope, distinct run identity, cancellation, completed-batch cache and visible generation state. Checkpoints fence authenticated headers, HTTP/stream awaits, batch accumulation, asynchronous WAV assembly and final URL/download. Queued state updates also require the exact run; an old error/finally cannot clear its replacement. Cancel returns immediately; unchanged-input retry in the same live context preserves completed batches. Usage-refresh failure no longer removes an already successful download.

Eight behavioral regressions fail on exact baseline2fb13f4e while41 old tests pass; all49 wizard tests pass after the fix, plus4 direct session tests. The single-suite RED command also emitted irrelevant global coverage threshold failures, explicitly excluded. Full gate:821 suites/8712 tests passed;3 suites/17 tests skipped. Types pass, ESLint0 errors/26 inherited warnings, production build Cj4J3YyG0iGaslBtIHggV passes. No API contract, canonical writer or ledger exception changed.

Actual localhost Chromium on the same controlled transport harness: soft Back remains in the same JS realm, returns to /sermons, aborts the request and changes unwanted downloads1 to0. A second flow cancels after batch0 while offset3 waits; retry offsets[0,3,3] preserve AAAA, reject lateBBBB and export AAAACCCC exactly once. Generate re-enables immediately and success retains Download Again. Final page errors/unexpected mutations0/0. Primary inspected final cancellation, list-after and390/820/1280 success PNGs individually at original resolution; no horizontal overflow. Disposable contexts closed, original groups tab online. A teardown/capture trial is retained separately.

These browser bytes and selected QA snapshot/read payloads are synthetic; no provider or database write was made. This proves lifecycle, file content assembly and visible behavior, not actual speech quality, billing/refunds, real provider cancellation, production, Safari or physical-device acceptance. Prepared authored sources retain their separate durable contract. The remaining changed-version speech editor resolution issue stays in BUGS.md.

Exact code and local evidence are frozen in .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/audio-lifetime-manifest.json. The source review, RED/GREEN/build logs, exact scripts/results/PNGs, class map and excluded trials are in audio-lifetime-* artifacts. No push, merge or deployment occurred.

After separate publication authorization: confirm deployed revision/worker and an authorized QA sermon, preserve its fields; start real audio then cancel/soft Back before completion, check no stray file/result, then retry within the same sermon and reopen a different sermon with identical words. Verify real complete audio, provider failure/retry, paid requests/usage and sequential account/device transitions. Cancellation cannot undo provider work already admitted. Restore QA fields deliberately.

| Item | Result | Regression | Browser/manual |
|---|---|---|---|
| 1. Old context publishes output | Run/scope retirement and abort | wizard lifetime cases; direct session ownership | Same-realm Back: unwanted downloads1→0, ERR_ABORTED |
| 2. Cancel/retry mixes bytes | Completed batches scoped to owner/sermon/body | wizard cancel/WAV/cross-context cases | offsets0,3,3; exact AAAACCCC; lateBBBB excluded |
| 3. Late UI/finally or usage refresh hides success | Exact run predicates and isolated usage refresh | direct replacement and wizard usage failure tests | Immediate cancel returns to preview; successful download UI visible |
| 4. Existing generation/source flow | Existing41 wizard cases retained |821-suite full gate, types/lint/build |390/820/1280 primary visual; provider/production pending |

## BUG-20261016-audio-editor-conflict-has-no-resolution

Stage: locally verified and independently source-reviewed; exact-version fresh acceptance is recorded separately in the case. Production pending.

In Sermon → Audio → Source → Edit Fragment, a refused correction previously kept the draft but repeated the opening version forever. The editor now displays the exact saved snapshot returned with the refusal and offers Save My Text or Use Saved Text. A focused AudioCorrectionConflict component owns the readback/selection UI; usePreparedSpeech captures the displayed candidate, editor session, source token and complete expected chunks across authentication and transport awaits. Re-prepared or changed layouts require an explicit target; another refusal retains both the draft and a still-valid chosen target. Missing sources offer copying without a write. The canonical HTTP writer and transactional server checks remain unchanged.

Every close route shares the existing discard question and blocks while saving. Taking stored text asks before replacing local words and updates the next save baseline only after acceptance. Ordinary network/auth errors remain visible. The live browser uncovered parent Escape ownership above the inline child; the editor now follows the existing body-portal recipe at z110 over its parent z100, with confirmation at z300. The shared modal registry remains unchanged.

Original baseline af361714: eight behavioral RED assertions (six real modal close/dirty exits plus two real-wizard resolution/target cases), preserving49 old wizard cases. A further nested-parent behavioral RED was obtained before its portal fix. A selected-target WIP RED and excluded path/mock/fixture trials are labelled separately. Final focused gate:6 suites/95 tests. Full gate:823 suites/8733 tests pass;3 suites/17 tests skipped. TypeScript passes; ESLint0 errors/26 inherited warnings. Production build blDKrcGymSlsQh4bCVNvf passes.

Actual localhost Chromium: held-save Escape/backdrop cannot close the editor; native Tab/Shift+Tab remain inside it. Displayed candidate/version/full text drive the next request. Same and moved target flows each pass23 checks, including controlled offline transport failure/reconnect, repeated refusal, exact intended-fragment correction, neighbor retention, exact clipboard sink contents, declined/accepted stored choice and the subsequent revision5 baseline. Clean repeats pass21 checks each; missing-source flow passes7 checks with no replacement action. Page errors/unexpected mutations0/0. Primary inspected final clean and network-failure comparison PNGs at390x844,820x1100,1280x1100, plus missing-source view, individually at original resolution; no horizontal overflow. Disposable contexts closed; original groups tab online, one context/one tab.

These are real UI/transport flows with synthetic selected QA snapshots and intercepted write receipts. Clipboard checks use an injected sink. No database write or provider call was made; this does not prove real Firestore persistence, provider speech, Safari/PWA, physical devices or production. The modal draft remains memory-only; close/discard protection does not promise reload recovery. The retained initial AFTER failure proves why the nested fix was needed.

Exact sources, class map, original record, RED/GREEN/build logs, scripts/results/PNGs, source review and excluded attempts are frozen in .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/audio-editor-manifest.json. The independently accepted prior audio-source/audio-lifetime evidence remains unchanged. No push, merge or deployment occurred.

After separate publication authorization: confirm revision/worker; preserve an authorized QA sermon's source sets; repeat actual slow correction with Escape/X/backdrop, real changed-source refusal, explicit keep/take and cancel, newly prepared target selection, repeated refusal, offline/reconnect and sequential device use. Check actual readback after reload, unchanged neighboring fragments and Original/AI sources. Restore QA fields deliberately; no paid speech generation is required for this editor check.

| Item | Result | Regression | Browser/manual |
|---|---|---|---|
| 1. Repeated opening-version refusal | Exact displayed candidate and explicit resolution | wizard, hook and target-layout tests | Same/moved targets, second refusal and exact expected payload |
| 2. Draft discarded by close or pending parent Escape | Shared discard/save guard and canonical foreground portal | real modal and nested parent regression | Pending Escape/backdrop; native Tab containment |
| 3. Taking stored text or missing target | Confirm replacement, update baseline, preserve missing-source draft | hook/modal integration cases | Cancel/take, exact copy sink, missing source with no write |
| 4. Existing source/generation behavior | Preserved; no server writer changes |49 previous wizard cases and full823-suite gate | Original source/neighbor retained; production/device acceptance pending |

## BUG-20261013-service-order-seed-two-devices

Stage: locally verified and independently source-reviewed; fresh exact-version acceptance is recorded separately in the case. Production pending.

In Heart Matters → Orders of Service → Seed Standard Set, two sequential device actions on an empty set with delayed delivery previously created20 rites, two per catalog key. The shared serviceOrderSeedIdentity utility now owns one URL-safe owner/catalog/deletion-cycle identity. The hook requires a complete server-fresh collection including tombstones and coalesces repeated calls. It keeps the public create capture and canonical outbox; the domain policy maps valid absent standard targets to an explicit service-order-seed action.

The existing server transaction checks authenticated owner/catalog uniqueness for both current seeds and older random-ID creates. A repeated same-target seed acknowledges the full stored document with metadata-only operation proof; authored title, steps, body, rank and recency remain. Another live target refuses without overwriting/merging/deleting it. A late seed cannot resurrect a tombstone; a new explicit seed uses a new identity. Custom rites and immutable catalog identity retain their previous behavior. No new writer, queue, claim collection, HTTP endpoint or boundary exemption was added. The existing engine recipe documents the rule.

Baseline552d6c8e yielded5 behavioral RED cases. Additional WIP REDs covered2 reserved-target collisions,1 architecture boundary,1 route-safe identity and1 rejected refresh. The real browser exposed encoded colon IDs at detail navigation and generic writeFailed for an HTTP503 list refresh; each received a regression before its narrow correction. Exact final focused gate:8 suites/112 tests plus architecture1 suite/4 tests. Full gate:826 suites/8752 tests pass;3 suites/17 tests skipped. TypeScript passes; ESLint0 errors/26 inherited warnings; production build jL-sap9sy0ZZL0MkFjkAX passes. Excluded setup/test-expectation corrections remain labelled and retained.

Actual localhost Chromium on two disposable cloned-device contexts:19/19 checks pass. Twenty independent seed captures converge to10 live rites, one per key. Authored remote-fixture title/body/rank survive late seeding and reload. Detail navigation, explicit delete, hard-offline disabled seeding, rejected-read message/no capture, reconnect and new-cycle reseeding pass; the old target stays deleted. Page errors/unexpected mutations0/0. Primary inspected exact390x844,820x1100,1280x1100, detail, offline and failed-read PNGs individually at original resolution; no horizontal overflow. Disposable contexts closed; the original groups tab remains online.

Browser collection/read payloads and command receipts are synthetic controlled QA responses; authored edits are fixture edits, not claims of UI editing or actual database acceptance. Separately, actual production processCommand/domain/protocol/planner/receipt code ran on isolated demo Firestore emulator127.0.0.1:8793, project demo-seed-orders, with only adminDb substituted. Eight checks pass: overlapping current seeds, one live rite, authored fields, receipt replay, concurrent old random-ID uniqueness, late-old-seed deletion, tombstone listing and deliberate new-cycle reseed. No production database access occurred. HTTP authentication and deployed index availability remain outside that proof. Firestore documents [serializable transactions](https://firebase.google.com/docs/firestore/transaction-data-contention) and [equality-query index merging](https://firebase.google.com/docs/firestore/query-data/index-overview); deployment-specific index configuration must still be checked.

Exact source/evidence hashes are frozen in .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/seed-orders-manifest.json. Source review, original report, class map, RED/GREEN/build logs, exact browser scripts/results/PNGs, emulator probe/results and excluded attempts are retained as seed-orders-* artifacts. Pre-existing authored duplicates are preserved; mixed shipped versions using different live target IDs may refuse visibly. A forged exhausted safe-integer cycle fails closed without target reuse. Production, Safari/PWA and physical devices remain pending. No push, merge or deployment occurred.

After separate publication authorization: confirm deployed revision/worker, authorized QA account and owner/catalog equality-query availability; preserve its rites. On actual sequential devices with delayed delivery, seed once, edit authored words/rank, then deliver the older seed and verify one set, unchanged words and actual receipt/reload. Explicitly delete a QA rite and reseed; ensure the old command stays deleted and a new live identity appears. Repeat failed/offline read and reconnect with no accidental creates, verify custom rites and older shipped command refusal without data loss. Restore QA data deliberately; do not delete pre-existing authored duplicates automatically.

| Item | Result | Regression | Browser/manual |
|---|---|---|---|
| 1. Independent random seed targets | Shared canonical cycle and complete freshness | useServiceOrdersEngine cases |20 captures →10 live rites; reload one per key |
| 2. Late seed replaces work or creates another target | Full authored-value ACK and transactional uniqueness | serviceOrderSeed + delivery + protocol cases | Authored fixture retained; actual emulator command/receipt checks |
| 3. Delete/reseed, route and failed reads | New explicit identity; safe route; refresh-only unavailable message | Identity and rejected-refresh RED→GREEN | Actual detail/delete, offline, HTTP503 and new-cycle flow |
| 4. Existing module/data boundaries | Public engine API and existing outbox; no exemption | Architecture4 and full826-suite gate | Six primary visual captures; production/device pending |

## BUG-20261003-one-click-delete-other-screens

Stage: locally verified; fresh exact-version acceptance is retained separately in the case. Production pending.

Authored text could previously disappear from one click on nested delete controls, from closing local Thought/Prayer forms, or from discarding a retained recovery/conflict copy. The existing useConfirm/ConfirmModal and useDiscardQuestion now guard those decisions before mutation/capture. A shared text-copy wording is translated in all three locales. FormDialog respects its backdrop opt-in in both layout branches. Async discard callbacks are awaited.

The repaired class includes council topics/questions/options, group flow plus its last template, service-order steps, custom tags, exegetical trees and children, and one/all key fragments. Local Thought, CreatePrayer and AddUpdate forms use one close guard for Cancel/X/Escape/backdrop and lock during pending save/transcription. Ordinary engine Group/Series closure retains its recoverable draft; those forms were not given a false-loss warning. Last-copy guards cover AI/manual orphan and recovered plan cells, study-note recovery and conflict, legacy outbox, DataSyncStatus, EngineConflictBanner, completed RecordingDraftBanner blobs, prayer core/status conflicts and plan-template conflicts. Existing explicit legacy recovery review remains unchanged. SaveConflictBanner stays presentational; canonical server/queue semantics are unchanged.

Questions are scoped to their shown owner/resource/session and candidate content. An obsolete question cannot discard replacement words. Orphan questions withdraw when their copy disappears; fragment questions retire on closure/scope change. Independent source review found missing exegetical owner binding; two behavioral RED cases reproduced it. The module now withdraws and checks its subject, and its parent uses owner/resource key and subject. Tree integration remains green, preserving new neighbors and new identities after an emptied plan.

Proof before production edits:42 behavioral RED cases and269 existing passes across18 suites. Additional genuine REDs cover5 Thought transcription exits,1 orphan lifetime,1 fragment lifetime,1 study conflict,3 prayer/template choices and2 exegetical owner/resource switches. Nested same-ID draft RED was observed in tool output without a standalone log and is not silently included in the baseline count. Final build runs the complete suite:827 suites/8835 tests pass,3 suites/17 tests skipped. TypeScript/build pass, ESLint0 errors/26 inherited warnings, translation coverage8 pass. Final production build l9tdD-R0khxfRzh7g6MLR was served on localhost3047.

Actual Chromium UI repeated the original tag, prayer-form, exegetical-parent and study-recovery paths. Tag questions and all four CreatePrayer exits pass at390/820/1280 widths, including safe initial focus, Escape and contained Tab. Eight additional Thought/Prayer-update exit cases pass. Five council/group/service-step cases retain text on Cancel and submit exactly one controlled matching update after Yes; step neighbors remain. Single/all key-fragment removal preserves the original thought. AI/manual plan recovery checks remove only the selected stored cell and survive reload. Study recovery passes hard-offline discard/reconnect. A real IndexedDB WAV blob survives Cancel and is removed only after Yes, remaining gone after reload. Actual global refused-update and open-group DataSync choices retain local words before Yes and settle without another write. Restored prayer core/status and template name/structure conflicts pass Cancel/Yes and reload; a backward QA collection feed correctly leaves the held template copy intact.

Browser reads/receipts are controlled synthetic QA responses in disposable cloned contexts; no production database/provider mutation occurred. The raw recording fixture is generated silence, not physical microphone proof. Primary inspected native settled screenshots of confirmation at all three widths, local editors, council/group/service-step results, AI/manual recovery, fragments, raw blob and sync/conflict choices. Browser scenario-specific errors/unexpected writes are0 in final accepted runs; excluded selector, timing, blocked-worker, route and fixture-version trials are preserved separately. Original browser context remains online. Dedicated local-browser exercise of the legacy outbox branch and unchanged Group/Series recovery is not claimed; their existing owner-bound mechanism is covered by focused tests/source review. Production, Safari/PWA and physical-device acceptance remain pending.

Source/evidence index, original/final tracker block, plan, class map, RED/GREEN/full-build logs, independent review, exact browser scripts/results/PNGs and excluded attempts are retained under .cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/delete-guard-*. Fresh acceptance checks the frozen manifest before/after. The separate recorder-capture lifecycle loss is queued as BUG-20261016-focus-recorder-lifetime-loses-source. A potential widening of canonical recovery cancellation during a late commit-list read is recorded for reproduction as BUG-20261016-recovery-discard-scope-can-expand; the UI question does not claim atomic settlement of unseen later work.

After separately authorized merge/push: confirm deployed revision and worker, preserve authorized QA records, repeat each original path using real API receipts, verify no command before Yes and no command after Cancel, exactly one confirmed effect and retained neighbors/cascades. Check every form exit/pending state, raw recording retry/download/retention, durable recovery across reload/offline/reconnect and a sequential device change while a question is open. Verify failed refresh retains the copy and a successful refresh discards only the reviewed copy. Restore QA data deliberately; do not remove pre-existing authored data.

| Plan item | Result | Regression | Browser/manual |
|---|---|---|---|
| 1. RED baseline and class inventory |42 genuine failures on unchanged baseline preserved |18 suites plus separately named WIP RED |Four original UI families captured before fixes |
| 2. Shared confirmation and local forms |Existing modules reused; backdrop/pending exits guarded |Modal, FormDialog and useConfirm suites |CreatePrayer three widths; eight Thought/update exits; primary visuals |
| 3. Last-copy recovery/conflict paths |Exact-copy checks, async ownership and refresh failure preservation |Plan/study/outbox/engine/prayer/template suites |AI/manual cells, study offline, raw blob, global/group and restored conflicts; legacy outbox browser not claimed |
| 4. Full affected class and scope changes |Nested deletes and obsolete-question withdrawal |Council/group/order/tag/tree/fragments and scope regressions |Five nested cases; tag/tree/fragments, Cancel/Yes/no early capture |
| 5. Gates/review/acceptance |Complete suite/build/types/lint/locales; independent owner finding resolved |827 suites/8835 pass; manifest reruns in fresh acceptance |Primary native PNG review; production/device pending |


## BUG-20261016-focus-recorder-lifetime-loses-source

Stage: locally verified; exact-version fresh acceptance and local commit are retained separately in the case. Production pending.

The shared useRecordingSession module owns one microphone attempt from permission acquisition through the final audio handoff. FocusRecorderButton and useAudioRecorderLifecycle reuse it: late grants from a retired attempt stop their own tracks, late denials/finalizers do not call a closed owner, and a cancelled request cannot replace or stop a newer capture. Pending permission has a visible Cancel in circular, flat and standard/mini controls. Cancellation unlocks the recorder and keeps the previous source.

Record Again retains the old blob and parent retry source until MediaRecorder.start succeeds; permission, construction and start failures preserve them. Retry consumes the stored source without destructive onClearError. Existing explicit capture cancellation/discard and successful replacement keep their cleanup. Thought-board, engine Thought and prayer-update owners block all four exits and programmatic submission during permission/capture/pause/finalization/transcription. An ordinary close asks before losing a failed raw take, even if no text changed; Save waits for retry or explicit discard of that take.

Exact negative control: the same five final regression paths on unchanged af9e35c0 yield29 genuine RED/86 positive passes/115 total; source/test hashes are retained. Four permission-cancel REDs on the interim construction are included in that29, not extra. Current focused acceptance:15 suites/230 tests, plus the remaining shared lifecycle suite12 tests. Final full build:828 suites/8864 tests pass,3 suites/17 tests skipped, TypeScript succeeds, ESLint0 errors/26 inherited warnings, production build1cV1hrc3PXzCEFfhO-tio succeeds. The first full diagnostic had one creation-test timeout and an obsolete retry-clear assertion; the assertion was adapted without removing its useful retry checks, isolated creation passed808ms, and the complete repeat is green. Cause of the first timeout is not established.

Primary localhost Chromium acceptance: Thought-board and prayer update at390/820/1280 each pass18 checks, engine Thought at1280 passes the same18, and Flat subpoint plus column mini popover each pass9 checks. Each full flow exercises permission Cancel, a newer capture before the old grant, pause/resume, deferred final data, failed transcription, declined close, rejected replacement permission, cancelled replacement, explicit source discard and retained manual text. Final page errors/unexpected writes0. Native PNGs were inspected at original resolution; the short prayer modal needs body scrolling to reach lower recovery actions, and actual scrolling/clicks pass.

Media devices/recorders, selected read fixtures and transcription refusals are controlled synthetic QA in disposable cloned contexts. Player/source retention is proved; real audio decoding/playback, physical microphone permission, provider calls, actual server text acceptance, Safari and installed PWA are not. Successful local contracts retain unit/full-suite coverage. Exact scripts/raw results/native captures, original record, source review/follow-up, failed trials and gates are recorder-lifetime-* artifacts under the local case. Unused legacy screenshot maps in raw helper results are explicitly excluded; the native-capture inventory gives actual files.

Completed-source persistence after leaving/reloading a page is separately reproduced and remains active as BUG-20261016-unfinished-recording-navigation-recovery. This fix does not claim recovery across navigation/account/resource changes or durable acceptance of dictated text. Source review found an unanswered-permission deadlock;4 RED cases reproduced it before initializing Cancel was added and independently re-reviewed.

After separately authorized publication, confirm deployed revision/worker and preserve authorized QA records. Repeat each microphone/exit/retry path with real device permission, denied replacement, final data, exact retained source and successful text acceptance; verify one request, no hidden stream, all useful saves, and explicit discard. Check Safari/PWA/physical devices independently and restore QA data. Production checklist is retained as recorder-lifetime-production-plan.md in the case.

| Plan item | Result | Regression | Browser/manual |
|---|---|---|---|
|1. Shared attempt lifetime | One module binds both implementations to mounted attempt | Focus/shared lifetime RED→GREEN | Late old grant released; newer capture retained |
|2. Replacement/retry source | Old blob survives start failures; retry does not clear it | Permission/construction/start and existing lifecycle suites | Rejected/cancelled replacement keeps player/source |
|3. Editor ownership | Three modal owners lock active capture and protect failed take | Thought, engine Thought, prayer-update regressions | Three widths, engine detail route, explicit discard/manual words |
|4. Gates and review | Full suite/types/lint/build; review deadlock fixed |828 suites/8864 pass;29 exact RED baseline | Native primary visual review, body-scroll actions |
|5. Sequential closure | Exact freeze/fresh acceptance/local commit then main intake | Manifest plus fresh acceptance retained separately | Production/device and navigation-recovery limits explicit |


## Main intake e408661c (2026-10-16)

At clean local93a27091, imported pinned main/origin e408661c (four commits): Bible marks/tools, common reader window, marks in another translation and the chronology tracker record. Main was read only; no primary checkout drafts were copied. Resolve BUGS by keeping our active-only list plus the one new chronology record. Resolve CrossReferenceSheet by keeping the new ReaderSheet and our cross-chapter versesHeldIn extraction; ReaderSheet delegates focus to canonical useModalLayer, removing duplicate local handling.

Combined state passes28 focused suites/513 tests, full831 suites/8899 tests (3 suites/17 tests skipped), demo-emulator rules306 checks, final types, lint0errors26 inherited warnings and production build ELBA8SNi9kXfHVBj0qv_2. Source review found no confirmed integration regression. Production localhost checks at390/820/1280 cover stored marks, five colours, whole other-translation preview, transition to that Bible,18 native Tab/ShiftTab steps in each reader window, Escape/return and no horizontal overflow. Prior Thought/prayer recorder flows each pass18 checks. Page errors and API mutations0 in final runs. Primary native original-resolution visual inspection completed; long windows use inner scrolling.

Marks/read receipts and microphone/transcription refusals are controlled fixtures in disposable cloned contexts. Real database mark writes, sequential devices, real microphone/provider, offline replay, Safari/PWA and production were not repeated for this integration. Forced Playwright service-worker blocking caused a library exception via the runner's undefined-returning registration stub; diagnostics are retained separately and do not establish a real-browser product bug. Exact evidence is main-intake-e408-* in the local case. Fresh exact acceptance and local merge commit are recorded separately. No RED claimed for ordinary main integration; existing chronology and recording-navigation bugs remain active.

After separately authorized publication, verify deployed revision/worker and engine rule rollout, then repeat the recorded production checklist with disposable authorized marks and actual recording; preserve existing data. No push or deployment occurred in this local intake.


## BUG-20261016-unfinished-recording-navigation-recovery

Stage: locally verified; exact-version fresh acceptance and local commit are recorded separately in the case. Production pending.

Leaving the page after failed dictation previously removed the only playable recording. Every completed source now enters the existing IndexedDB recording store before recognition, bound to its owner and original destination. Storage refusal retains the in-session source and stops recognition. Recovery uses the shared banner/hook, current-scope list fencing, explicit awaited deletion and tombstones. There is no automatic expiry or second audio queue. Pure scope/metadata helpers and shared owner/discard hooks keep consumers on one mechanism.

Recognition is not text acceptance. Cached transcript and stable source IDs prevent replay; exact submission snapshots release only accepted sources. Scratch/Engine Thought await their existing durable document update. Recorded thought creation uses the authenticated canonical writer and stable audio identity; accepted retry reuses the stored thought before provider work. Original outline destinations are retained and a missing/locked point is refused. Study notes persist all raw links separately from represented-text receipts; a new-note creation waits for capture and parking, and exact linked raw remains discoverable even when its move from new fails.

Baseline navigation failure is retained for Thought and Prayer. Behavioral RED controls cover storage/ownership, scope refresh, awaited discard and late publication, cache-write retry, acceptance snapshots, new-note carry including unrecognized source, creation during capture/parking, stable server identity and original outline target. Raw logs retain feature-contract absence and harness corrections separately; intermediate run totals are not added together. Final complete build:834 suites/8942 tests pass,3 suites/17 tests skipped; TypeScript passes, ESLint0 errors/25 inherited warnings. Production build1ZoP8I9UVFh_uIKdsu6D9 was served at localhost3047. No Firestore rule changed; the previous main-intake rule gate is not claimed as a new run.

Actual Chromium:26 accepted scenarios across390/820/1280 widths. Six original Thought/Prayer flows retain source through Settings navigation/reopening, play valid WAV and download byte-identical audio; failed retry keeps it. Three created-study flows recover cached text exactly once and return the microphone to idle. Three raw-only study flows retain access through persisted links and rejected retry. Two phone flows survive a hard-offline reload with an activated service worker. Twelve additional sermon/Scratch/Engine Thought/section/point/subpoint scenarios retain the original scoped source. Final scenarios have no page errors or unexpected application writes. Primary inspected representative original-resolution native captures, including all final study idle states and offline phone captures.

Proof uses controlled PCM WAV microphone/MediaRecorder, transcription refusals and selected read fixtures in disposable cloned contexts. Scope tests intercept provider URLs at every origin, including the compiled localhost3000 base. The first retired sermon/Scratch trial intercepted only3047 and may have reached the primary3000 server; no zero-side-effect claim is made for it. Its script/result and explicit limits are retained. A phone focus-column trial selected a point recorder and is excluded as a selector error. A genuine separate phone section popover clipping defect stays open as BUG-20261016-structure-recorder-popover-offscreen-on-phone; the wide equivalent passes. A normal timing trial did not reproduce active-recording creation and is labelled no-repro; deterministic timing RED tests establish that guard. Production database acceptance, paid provider, physical microphones, Safari/PWA and physical devices remain unverified.

The class closure matrix, source review/follow-up, original report, RED/GREEN/build logs, browser scripts/raw results/native captures, download SHA checks and excluded trials are recording-recovery-* artifacts in the local case. Exact source/evidence bytes are frozen in recording-recovery-manifest.json before a fresh second-hand acceptance. After separately authorized publication, follow recording-recovery-production-plan.md: verify deployed revision/worker, preserve authorized QA data, exercise real failed/retried dictation and successful durable text save, reload/offline restore, explicit discard and original target identity on sequential devices. Confirm no duplicate text/provider work on accepted replay. No push, merge into main or deployment is authorized in this phase.


## Main intake 7fc22561 and BUG-20261016-manual-save-parent-branches-on-hide (2026-10-16)

Stage: locally verified; fresh exact-version acceptance and local merge commit are recorded separately in the case. Production pending.

From clean559b2e81, import five committed main updates pinned at7fc22561: Bible marks use one engine form per book, smoother pointer preview, phone/Pencil controls and queued predecessor selection. Primary checkout source remains read-only; no drafts were copied. Resolve BUGS by keeping the local active-only list plus four genuinely new incoming records. Resolve the colliding engine-test insertion by retaining both local manual-save lifetime cases and the incoming rapid-save regression. Automatic reader/locales merges preserve the prior cross-chapter selection and common modal behavior.

Independent review found an introduced integration class: a direct parent Save excluded the same-generation manual request it had just adopted. The actual engine regression yielded two independent root requests. Including equality alone still picked the earlier manual request over a richer parent capture; a second actual engine regression delivered the last title as conflict. Both genuine REDs are retained. The final controller passes every pending candidate at the newest eligible parent generation, never later than the captured intent. The existing CommitQueue uses its already-read durable dependency graph to choose the descendant, validating identity/owner/resource/cancellation and refusing independent candidates. Existing single-predecessor/null/default callers retain behavior. Options are frozen before the same store read; no new queue, writer or read. Private helper extraction and an error constant remove the two introduced lint warnings.

Final focused engine/controller/queue/React contracts:4 suites/167 tests pass, including unchanged repeated Save, later title plus manual content, reverse storage order and missing/unrelated/independent candidate refusal without capture. Complete final build:835 suites/8963 tests pass,3 suites/17 tests skipped; TypeScript succeeds, lint0 errors/25 inherited warnings; production buildxyA1IvYz94uwFcCBRFvHm succeeds. Two intentionally interrupted full runs and the first-correction build are retained as superseded checkpoints. A failed path setup ran an empty test filter and is explicitly excluded from RED proof. No Firestore rule changed; no new emulator/rules run is claimed.

Actual final localhost Chromium:17 scenarios pass. At390/820/1280, stored marks, five-colour palette, whole other-translation preview,18 Tab/ShiftTab checks per reader window, Escape/opener and transition to that Bible pass with no horizontal overflow. Four actual mouse strokes without network produce four real IndexedDB requests in one chain on each width; the latest capture contains all four marks. This is local durable capture, not server ACK. Six Thought/Prayer flows retain playable audio after navigation; six study flows recover cached text once or retain raw-only links; two phone flows reopen after a hard-offline reload with an activated worker. Final page errors/unexpected API mutations0/0. Primary inspected original native PNGs across three widths, representative recovery, all three study idle states and both offline phone captures; long reader windows use ordinary inner scrolling.

Initial documents/read responses and WAV microphone/provider refusals are controlled fixtures in disposable cloned contexts, all-origin API guards remain, and the original groups tab stays online. The internal page-hide/direct-save race has deterministic actual-engine RED/GREEN proof and source reachability; a dedicated original UI timing reproduction is not claimed. Browser checks demonstrate related shared-save and visual behavior. Production database/provider acceptance, Safari/PWA installation, physical devices and actual Pencil latency remain pending. The four incoming engine/marks records and the separate phone recording popover defect stay active. Exact main-intake-7fc2-* evidence, native captures, source reviews, class closure and production plan are retained in the case; frozen manifest and fresh acceptance are separate. No push, merge into main or deployment occurred.


## BUG-20261016-structure-recorder-popover-offscreen-on-phone

Stage: locally verified; fresh exact-version acceptance and local commit are recorded separately in the case. Production pending.

Sermon -> Structure -> normal view -> section microphone previously placed Stop outside the phone. One shared usePanelPosition hook now caps and shifts anchored panels within the viewport intersected with clipping ancestor scrollports. It reuses the canonical centre clamp, preserves existing centered transforms through individual CSS translate, follows scroll/resize and every containing element's size, and restores styles/disconnects on cleanup. Column capture, Flat/Focus recovery and section/outline guidance share it; ordinary in-flow recovery is unchanged. No recording writer or source ownership changed.

Actual original-build Stop timed out outside the390px viewport before source edits. Four deterministic measured-component REDs cover left/right/narrow/resize placement. Browser follow-up found two genuine remaining cases: an ancestor width transition left the panel at x=-90/-290, and native narrow Focus images cropped the panel borders despite reachable controls. Each received a new behavioral RED then GREEN; the final component has9 tests. Style normalization, missing main-point fixture, early resize measurements and a typed test-event correction are retained as harness/typing work, not extra RED proof.

Final focused6 suites/66 tests pass. Complete final build:836 suites/8972 tests pass,3 suites/17 tests skipped; TypeScript passes; ESLint0 errors/25 inherited warnings; production build nKZocGnOQrbg751ugl6Vd succeeds. Source review plus ancestor/clipping follow-ups found no concrete introduced defect. Final runtime source remained unchanged through browser acceptance.

Actual localhost Chromium:12 recording flows at320/390/820/1280 pass pause/resume/ordinary Stop, both visible horizontal panel edges,48 reachable recovery actions, actual download and original scoped source after navigation. Twelve valid one-second PCM WAV files are byte-identical16044 bytes. Eight guidance scenarios/64 measurements pass horizontal opening, resize/restore and scroll without document overflow. Primary inspected8 original-resolution native captures across widths/renderers. Vertical guidance clipping remains open as BUG-20261016-outline-help-above-visible-area; those horizontal checks do not claim complete guidance usability.

Read/provider refusal and microphone/MediaRecorder are controlled fixtures in disposable cloned contexts. Expected settings heartbeats were fulfilled locally; final page errors/unexpected mutations0. Production/provider/database acceptance, physical microphone, Safari/PWA and physical-device proof remain pending. Exact recorder-panel-* scripts/results/logs/reviews/native assets, rejected earlier visuals, class closure and production plan are retained in the local case; frozen manifest and fresh acceptance are separate. After separately authorized publication, confirm revision/worker and repeat the same real-device controls, failed-recognition recovery/download, responsive transition and ordinary in-flow behavior with preserved QA data. No push, merge into main or deployment occurred.
