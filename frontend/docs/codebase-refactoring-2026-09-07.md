# Codebase simplification — working review guide

This is an ongoing implementation, not a claim that every area is complete. The owner delegated design choices and authorized local commits, with one integrated review at the end. Nothing has been pushed or deployed.

## Verified packets

| Area | Simpler mechanism | Preserved behavior | Evidence |
|---|---|---|---|
| Settings | All six settings share one row and one native Switch; TXT export uses that Switch too | Owner checks, persistence paths, acceptance/refusal handling, version details and local debug preference | FeatureToggle contracts, GroupsFeatureToggle, DebugModeToggle, Switch tests; desktop/mobile screenshots |
| Series forms | One values model, payload conversion, field set and color selector for create/edit | Exact normalized payload, initial sermons, queued vs remote acceptance, refusal keeps draft, stale-write handoff, untouched refresh vs dirty draft | SeriesModal.contract passed nine scenarios before extraction; same scenarios plus additional error cases after |
| Entity dialogs | Shared FormDialog, FormActions and field styling for series and group creation | Caller retains submission and dismissal; group bootstrap/date data untouched | FormDialog/FormField direct tests, existing group contracts, browser form interaction |
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

Live candidate: development server with PWA disabled, authenticated existing test account. A mobile series draft retained both its title and actual rich-editor text through custom color confirmation. No horizontal overflow; the submit action remained reachable after scrolling. The draft was cancelled without creating a series. Dark-mode verification for the newly unified forms is still pending.

## Saved visual evidence

Files are under `output/playwright/refactoring/` (local artifacts):

- `settings-before-desktop.png`, `settings-after-desktop.png`, `settings-after-mobile.png`.
- `series-create-before-desktop.png`, `series-create-after-desktop.png`.
- `series-create-before-mobile.png`, `series-create-after-mobile.png`, `series-create-after-mobile-actions.png`.
- `group-create-before-desktop.png`, `group-create-after-desktop.png`.
- `color-picker-mobile-inspection.png`.

Series/group before shots were captured from the still-unchanged respective components before their edits. An isolated archive of original `814461fd` was also booted, but its separate-origin authentication remained loading; it was not used as proof of an authenticated before/after comparison.

## Remaining work

Large-component boundaries (ScratchPanel/Column/OutlineBoard), clipboard consumers and duplicate tests, export presentation, final integrated visual review, production build and final full gates. This document will be updated as those packets are validated.
