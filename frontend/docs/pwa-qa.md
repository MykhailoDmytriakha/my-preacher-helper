# PWA QA record — 2026-09-04

Branch: `codex/pwa-installability`. Local work only; no commit, push or deployment.
Status: implementation and currently feasible QA complete under the owner's
updated “test as far as possible” scope. Cross-platform acceptance remains
**conditional**; the limitations and failed supplemental checks below are not passes.

## Automated gates

Root command: `npm run test:coverage && npm run lint:full`.
Latest result: 529 suites / 4875 tests passed; TypeScript and unused-code checks
passed; ESLint has zero errors and 71 existing warnings. Global line coverage is
90.71%. The complete root gate and a fresh production build were repeated on
September 4 after all three additional editor tests were in place. The build
included the same 529 suites / 4875 tests, TypeScript and Next.js production output.

Scope: staged + unstaged changes, including new files. Direct manifest tests cover
the complete identity, icon declarations and shared colors, and decode the actual
PNG files to verify dimensions, opacity and maskable safe-circle placement.

| Runtime file | Baseline lines | Final lines | Verification |
| --- | ---: | ---: | --- |
| `app/manifest.ts` (new) | 0% | 100% | Dedicated manifest suite |
| `app/utils/themeColors.ts` | 100% | 100% | Shared PWA token assertion |
| `useManualConspectus.ts` | 92.76% | 92.76% | Unused destructuring removed; existing suite |
| `OutlineBoard.tsx` | 78.59% | 86.70% | Dead helpers removed; added sub-point create/edit/confirmed-delete tests |
| `ScratchPanel.tsx` | 92.20% | 92.22% | Dead declarations removed; existing suite |
| `app/layout.tsx` | Existing coverage exclusion | Existing exclusion unchanged | Production HTML metadata and native installation |

The editor cleanup was separately approved. A later pre-test OutlineBoard run
measured 77.95%, so the final result uses additional direct tests rather than a
favorable earlier 80.09% run. The new icon exporter is a development script, not
app runtime; generated assets have direct decoding tests.

Latest logs: `/tmp/mph-pwa-coverage-morning.log`,
`/tmp/mph-pwa-lint-morning.log`, `/tmp/mph-pwa-build-v3.log`.
The prior floor-verification logs remain available; the final table above uses
the fresh morning run, not a selectively chosen earlier result.

## Live checks

| Environment / scenario | Result |
| --- | --- |
| Chromium 152.0.7977.77 manifest and installability | Zero protocol-reported errors; one linked manifest, correct Apple metadata and viewport |
| Chrome macOS installation | Native Install flow completed; separate My Preacher Helper OS window; actual window reports standalone display mode |
| Desktop offline write and cold page open | Passed in an isolated authenticated browser context with network blocked; new note rendered after closing and reopening the page |
| Offline negative control | Uncached health request failed; independent server read still lacked the pending note |
| Desktop reconnect | Server accepted the note; page time origin unchanged, so reconnect did not force a reload |
| Fresh uncached offline context | Network error, as expected; offline cannot download the app for the first time |
| Update from `pwaqa01` to `pwaqa02` | Unsaved input remained intact while the newer build became available; after explicit save and reload all three notes remained. Loaded client chunk `4899-a5270cb45d0a1ad5.js` contains v2, not v1 |
| Actual update button, `pwaqa02` → `pwaqa03` | Passed September 4: served an isolated new build on the same origin, called the real service-worker update check, observed a genuine controller change and visible update button. No synthetic event, mocked health response or forced activation was used. Unsaved draft and page time origin remained unchanged. Explicit save reached server revision 5; clicking the visible button reloaded the page, retained the note and removed the update offer. The loaded chunk `6584-d73e4058252c6370.js` contains v3, not v2 |
| iPhone 17 Pro / iOS 26.1 Simulator installation | Safari Share → Add to Home Screen, Open as Web App enabled; named icon and native app-switcher entry verified |
| iOS installed-app login and production cold launch | Passed. Separate installed-app login required; existing authorized test account used. App closed through the native app switcher, then launched from its icon into production with session retained |
| iOS reading synchronized notes | All three desktop QA notes visible in the installed production app |
| iOS app-server outage cold launch | Passed: stopped local port 3101, confirmed connection refusal, closed the app, launched its icon, dashboard rendered. Server restored afterward |
| iOS native text entry and saved-note process restart | Passed for the exact uppercase QA title after selecting the English software keyboard and pacing idb key events. Scoped server read confirmed `PWA-QA-20260904`; after terminating `com.apple.webapp` and launching the confirmed Home Screen icon, the session and note title remained present |
| Android 16 / API 36.1, Chrome 152.0.7977.75 | First-run Terms no longer displayed when resumed; agent did not accept them. Authorized test login completed through existing dev UI, then production restored |
| Android manifest/installability | No manifest or installability errors. Native menu offered Install separately from Create shortcut; selected Install and confirmed My Preacher Helper |
| Android installation outcome | Not installed: Google Play log says `WebAPK service unknown_account`; package list and `chrome://webapks` contain no installed QA app. Requires owner to configure Google Play account |
| Android full network-offline write | Passed in Chrome on the actual emulator: Wi-Fi and mobile data both disabled, local app server stopped, `navigator.onLine === false`, uncached health fetch failed; QA note rendered locally while server still had only three notes |
| Android process cold restart offline | Passed: force-stopped Chrome, reopened the QA deep link while both networks remained off; note restored and uncached health fetch still failed |
| Android reconnect | Passed: both networks restored to their original enabled state, health 200, exact note accepted on server at scratch revision 4, `performance.timeOrigin` unchanged (`1788508674015.6`). This is browser data proof, not an installed-app launch claim |
| Android Firefox 155.0.1 alternative | Installed Mozilla's official signed arm64 APK without a Google account. The local app offered Add to Home screen, created an icon, and reopened in `org.mozilla.fenix.HomeActivity` with the URL bar visible: **shortcut only**, not a standalone PWA pass |
| Firefox installation positive control | The same browser offered **Add app to Home screen** for Microsoft's public HTTPS PWAMP demo. That demo was not installed. This proves the browser distinguishes the two flows; it does not isolate why our local HTTP origin was offered only a shortcut |
| Supplemental desktop WebKit 26.0 / 390px mobile viewport | Authenticated QA sermon loaded; offline note rendered locally while an independent server read remained at five notes/revision 5. The uncached health request failed offline. This is a separate desktop engine, **not** the iOS Simulator |
| Supplemental WebKit offline cold page | Not validated: `page.goto` returned `WebKit encountered an internal error`. The same error reproduced in an independent minimal service-worker app without this project's code or Firebase |
| Supplemental WebKit reconnect | Failed in the automation run: `navigator.onLine` returned true, but uncached health timed out and the test marker did not reach the server during 120 seconds. A final screenshot request reported `Target crashed`. The minimal control restored health 200, so the reconnect failure is **not** explained by that control; root cause and native-iOS applicability remain unknown |

Authentication was bootstrapped with the existing development-only test-login
button. Production was then served at the same origin. The test button is absent
from the production landing. No new account or authentication mechanism was added.

## Remaining acceptance work

- Android actual installation and icon/standalone launch remain blocked on Google
  Play account setup. Repeat the offline flow through the installed icon after that;
  the equivalent Chrome-on-emulator data scenario has passed.
- iOS **full network-offline** write, restart and reconnect. App-server outage is
  not full offline: Firestore could still reach the internet during that check.
- Native iOS text injection is usable with a selected English keyboard and paced
  uppercase input. Fast input, Russian-layout key mapping and autocorrection
  caused harness errors; direct accessibility value-setting did not work. This
  does not complete the separate full network-offline acceptance scenario.
- A read-only check of macOS Safari found its Develop menu disabled, so its native
  remote-inspection alternative also needs owner-authorized setup. No Safari
  settings were changed.
- Physical Android/iOS devices and Google OAuth have not been validated. The
  actual update-button interaction is now verified. No production rollout occurred.
- Reproduce the supplemental WebKit reconnect failure in a supported native
  inspection/network setup before attributing it to the application or changing
  the existing storage/service-worker logic. No baseline A/B established a PWA
  regression, and no native iOS full-offline pass is claimed.

On September 4 the owner explicitly amended the goal to test as far as possible.
The available local testing pass is therefore complete with these documented
gaps; this is not unconditional production/device acceptance.

## Test data and local environment

Only the existing authorized test account was used. Disposable sermon
`e7ed02af-91f0-48b4-b1c1-2c77bfa87f4e`, titled `PWA QA verified 2026-09-03`, contains
five QA scratch notes. Server revision `scratch: 5` was verified directly for
that exact document. It was not deleted. An earlier failed localhost:3000 attempt
left a separate optimistic-only local item; it is not evidence of a server write.

The later idb input check created one additional study-note fixture through the
normal auto-saving UI: `dd5783c7-cb98-417d-ba39-196853a58db6`, created at
`2026-09-04T08:16:50.402Z`. Its initially garbled title was confirmed by an independent
server read, then corrected through the normal iOS UI to `PWA-QA-20260904` and
verified again on the server. It was not deleted. The initial intent
was an unsaved input probe, but this form auto-saves; do not describe it as a
cancelled, unpersisted draft.

Local idb setup: `/opt/homebrew/bin/idb` now points to Homebrew idb-cli 1.5.2;
idb-companion is also 1.5.2. The old failing client launcher is preserved at
`/opt/homebrew/bin/idb.pre-pwa-20260904-0115`. Only the exact official idb formulae
were trusted. The initial metapackage attempt stopped on a ca-certificates link
conflict; the successful targeted installs retained Python 3.14.3, OpenSSL 3.6.2
and SQLite 3.51.3. No Xcode update or simulator reset was performed.

The mobile server uses port 3101 and desktop QA uses 3100. The local build override
`NEXT_PUBLIC_API_BASE=''` keeps API requests same-origin without modifying any
environment file. Temporary development build output was moved out of the repo
to `/tmp/mph-pwa-auth-artifacts.DrZeez/build`; Next's generated tsconfig mutation
was restored. No user's site data or caches were cleared.

Android evidence: `/tmp/mph-pwa-android-dashboard.png`,
`/tmp/mph-pwa-android-offline-write.png`, `/tmp/mph-pwa-android-offline-cold.png`.
The cold-open screenshot was visually inspected: test notes and editing controls
rendered, with 411px viewport and 411px document width (no horizontal overflow).
The emulator's Google Play log at 00:52:43 names attempted package
`org.chromium.webapk.ab0e61f62887f24e6_v2` and then `unknown_account`; no security
verification was disabled and no alternative wrapper APK was substituted.

## September 4 environment additions and update evidence

Firefox APK: official Mozilla release 155.0.1, package `org.mozilla.firefox`,
versionCode `2016182530`, arm64-v8a. Android apksigner verified the signature before
installation. APK SHA-256:
`c0dcf28dc5abf68094a4c7e53496939c91939331483ab8c073193620e7310775`.
Official source and installation guidance:
[Mozilla release directory](https://ftp.mozilla.org/pub/fenix/releases/155.0.1/android/fenix-155.0.1-android-arm64-v8a/),
[Mozilla Android installation help](https://support.mozilla.org/en-US/kb/install-firefox-your-phone-or-tablet).
No Google account, sync setup, TLS bypass or signature-check bypass was used.

The v3 production build was made in `/tmp/mph-pwa-update-qa.rdTGCd` to avoid
rewriting service-worker assets underneath the running v2 server. Desktop port
3100 now serves that v3 build; mobile port 3101 remains v2. `registration.update()`
installed the worker first; activation took about five minutes, not immediately.
The actual `controllerchange` timestamp was `1788539185114`; the unsaved page
time origin stayed `1788538658008.6`. Only the explicit update-button click changed
it to `1788539548138.8`. A visible desktop button and a hidden mobile-layout copy
were distinguished before clicking.

New evidence: `/tmp/mph-pwa-firefox-icon-launch.png` (visible URL bar),
`/tmp/mph-pwa-ios-cold-saved-note.png` (installed app and persisted QA title).
During native navigation, a stale transition screenshot led to opening Calendar
instead of the app. Its location and notification requests were denied; no access
was granted. Subsequent navigation used fresh Springboard accessibility identities.

## Supplemental WebKit diagnostics and limits

Playwright's WebKit build 2248 / engine 26.0 and its FFmpeg dependency were
installed in the existing local Playwright cache. The authorized test session was
transferred from the Android QA tab in memory only; no token-bearing storage-state
file was created and no new account was registered.

The marker `PWA-WEBKIT-OFFLINE-20260904` was visible in temporary browser contexts
but was not server-accepted during the tests. Those contexts were closed. Do not
count this marker as a sixth saved QA note, as a passing cold-start test, or as
proof of durable preservation after the automation process exits.

Two independent minimal controls (navigation-only worker and all-request worker)
both reproduced the offline new-page internal error. Both restored ordinary
requests to HTTP 200 after reconnect. Thus the controls narrow the cold-open
diagnosis, but do **not** clear the app's separate reconnect failure.

Logs and temporary reproduction scripts:
`/tmp/mph-pwa-webkit-qa.cjs`, `/tmp/mph-pwa-webkit-qa.log`,
`/tmp/mph-pwa-webkit-reconnect-qa.log`,
`/tmp/mph-pwa-webkit-reconnect-extended.log`,
`/tmp/mph-webkit-offline-control.cjs`, `/tmp/mph-webkit-offline-control.log`,
`/tmp/mph-webkit-offline-all-requests-control.log`.
The first harness attempt assumed Russian labels while the fresh WebKit context
used English; the corrected run used the actual localized controls. That first
locator timeout was a harness issue, not an application failure.

An upstream [WebKit automation issue](https://github.com/microsoft/playwright/issues/42273)
describes a service-worker/CacheStorage reload hang on macOS WebKit 26.0. It is a
diagnostic lead only, not proof that this run has the same cause. No production
workaround, service-worker removal or weakened security setting was introduced.
