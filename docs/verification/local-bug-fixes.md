# Local bug-fix acceptance

Branch: `codex/bugs-local-fixes`. Local commits only. Merge, push and production verification require the owner's separate instruction. Removal from this branch's BUGS.md means locally verified, not deployed.

Main synchronization: before each new bug and final acceptance, fetch origin and inspect committed updates in local main and origin/main. Integrate them at a clean boundary with a separate local merge and verify compatibility. Keep uncommitted files in the original checkout untouched.

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
