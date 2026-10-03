when: Safari only · iPad bug · iOS bug · WebKit · reproduce on Safari · iPad simulator · iOS simulator · xcrun simctl · back-forward cache · bfcache · pagehide persisted · IndexedDB stuck · storage silent · Память устройства не отвечает · воспроизвести на Safari · симулятор iPad · только на айпаде · только в Safari · замороженная страница

# Test on WebKit (Safari, iPad) without a device

Chrome is not a proxy for Safari: the 45-minute IndexedDB silence of 2026-10-02 does not happen in Chrome at all. Prove Safari behaviour on WebKit itself — the iPad simulator first (it runs iPadOS Safari's own WebKit), Safari on this Mac second.

## How

- Lab: `tools/webkit-lab/`. `node tools/webkit-lab/server.js` serves self-driving pages on `http://localhost:8765` and appends every page's report to `tools/webkit-lab/log.ndjson` (pages report with `sendBeacon`, which survives a page that is leaving). `tools/webkit-lab/build.sh` builds the app's real `utils/deviceStorage.ts` for `c.html`.
- Open a scenario without touching the screen: `open -a Safari "<url>"` (macOS Safari) and `xcrun simctl openurl booted "<url>"` (simulator; it prints "Operation timed out" yet opens the page). Boot first: `xcrun simctl boot <iPad udid>; open -a Simulator`; read the screen with `xcrun simctl io booted screenshot <file>`.
- Scenarios (`a.html?mode=…&next=…&run=<unique id>`; one database per run id): `mode=spin` keeps a transaction in flight while the page leaves; `loop` is a realistic stream of read-then-write transactions; `burst` issues writes at once; `control` has none. `next=b` measures a raw write, `next=c` runs the app's storage layer, `next=d` probes a version-change worker. `e.html?run=…` is an "old tab" holding an idle connection. Params `nostore=1`, `unload=1`, `lock=1` try to keep the page out of the back-forward cache (none works on Safari 26).
- Read results: `grep '"<run id>"' tools/webkit-lab/log.ndjson`.
- Touch gestures of the real app: `node tools/webkit-lab/gestures.js` (Playwright WebKit from the root `node_modules/playwright-core`, dev server on :3000). It fakes an installed iPad (`navigator.standalone`, `maxTouchPoints`), signs in as the test user, and prints where the page surface stands mid-swipe and mid-pull. Desktop WebKit refuses `new Touch()` ("Illegal constructor"), so it dispatches plain `Event('touchstart' …)` with `touches`/`changedTouches` defined on it — enough for the app's listeners, not for Safari's own system gestures.

## Why

- 2026-10-03: a page Safari freezes into the back-forward cache mid-transaction (a continuation from a request callback, i.e. any read-then-write) holds the store until Safari evicts it — 60.7 s on macOS Safari 26.5, >160 s on iPadOS 26.1, 45 min on the owner's iPad. A version-change request from a throwaway worker makes Safari evict it at once; that is the cure in `utils/deviceStorage.ts` (WebKit only: on Chrome 154 a terminated worker's blocked request stays queued and stalls later opens). Measured with this lab; details in `BUG-20260927-engine-open-hangs-on-silent-device-storage`.
- 2026-10-03: WebKit's Navigation API does not count entries the router adds with `pushState` — `navigation.entries().length` stays 1 and `canGoBack` false even after a real click (Playwright WebKit 2248, `node` probe on `b.html`). Never gate back navigation on `navigation.canGoBack`; it would switch the iPad's swipe back off entirely. `history.length > 1` plus "did history move" (popstate / pagehide) is what works.
- The simulator runtime may lag the device (iOS 26.1 here vs 26.6.1 on the iPad): say which you measured.

See also: `.howto/debug-on-ipad.md` · `.howto/read-owner-documents.md`
