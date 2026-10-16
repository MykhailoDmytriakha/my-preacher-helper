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

A separate resize defect discovered during visual review remains open as `BUG-20261016-verse-window-resize-loses-passage-position`: an already-open window can lose its scroll position when width changes. Fresh390px opening is verified; this fix does not claim rotation acceptance.

Evidence: local CrossChapter case artifacts, source snapshot, original/final tracker records, unit/browser RED/GREEN, accepted gate logs and verification manifest. Browser profiles and controlled data are explicitly identified; no production deployment occurred.

### Production acceptance after authorized merge

1. Confirm deployed revision and use an authorized disposable test note. Enter the three original cross-chapter ranges, edit one in the picker, save/reload and continue on another device. Verify actual server persistence of endChapter and no unintended metadata/text change.
2. Open Isaiah52:13-53:12 from the note: correct URL,15highlighted verses ending53:12; verify Genesis1:1-2:3 and John3:16-4:2 similarly. In a test plan and meeting block, open the complete range and verse window.
3. Check same-chapter verse/range, whole chapter/range and existing old references; switch Bible and check a mapped partial span across chapters. Ensure no old stored reference silently changes meaning.
4. Publish/read only an owner-approved test share link: exact span visible, private reference snippet absent. If testing AI, compare raw note with v4 output for lost endpoints, widened spans or invented references; record provider/model/version and cost. Do not equate schema success with extraction quality.
5. Warm the deployed note/Bible, test stable offline opening and reload, restore connection, verify queued edits receive real ACKs. Check phone/tablet/desktop and physical-device input. Keep the separate resize defect visible until its own fix.
6. Record deployed revision, screenshots, outcomes and cleanup of disposable test records. Production remains pending until this is actually done.
