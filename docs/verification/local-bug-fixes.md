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
