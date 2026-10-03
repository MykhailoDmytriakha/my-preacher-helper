when: debug on iPad · test on iPad · reproduce an iPad bug · iPad PWA · home screen app · installed app · Web Inspector · inspect iPad · Safari Develop menu · iPad console · iPad IndexedDB · only on the iPad · owner's iPad · technical details · feedback report · отладка на iPad · проверить на iPad · воспроизвести баг на iPad · только на айпаде · приложение на экране Домой · веб-инспектор · консоль на iPad · отчёт из отзыва

# Debug and test on iPad

The owner works on an iPad in the installed app (Safari, added to the Home Screen). What breaks there often does not break in Chrome or in a Safari tab: the installed app has its own storage, no pull-to-refresh, system swipe-back from the left edge, and Safari freezes pages into the back-forward cache. Reproduce on WebKit, never conclude from Chrome.

## How — three levels, cheapest first

1. **Read what the owner's iPad already told us.** Every in-app feedback (Feedback button) emails the owner a report with `--- technical details (attached by the app) ---`: `runningVersion`, `route`, `environment` (`standalone: true` = installed app, `userAgent`, `viewport`, `online`, `serviceWorker`), `storage.silent` and the last 80 events of 24 h (`route`, `visibility`, `offline`/`online`, `pagehide` with `persisted`, `boot`, `storage-silent`/`storage-answered`/`storage-release`, `gesture` …). The mail is in the owner's Gmail (account u/1), subject «New Feedback (bug) from Preacher Helper». Read it with the owner's permission through the browser; build the timeline (event `at` is epoch ms; local time = PDT) before touching code. The owner's first and last report bracket how long a problem lasted.
2. **Reproduce on WebKit without the device** — `.howto/test-on-webkit.md`: the iPad simulator (Xcode → `xcrun simctl boot …`, `open -a Simulator`, `xcrun simctl openurl booted <url>`, screenshots with `xcrun simctl io booted screenshot`) runs iPadOS Safari's own WebKit and reaches this Mac's `localhost`; `tools/webkit-lab` drives self-running scenarios and logs through `sendBeacon`. Name the runtime you measured: the simulator may lag the device (iOS 26.1 here vs 26.6.1 on the owner's iPad). To test the installed-app mode, add the page to the Home Screen inside the simulator by hand (Share → Add to Home Screen).
2b. **Reproduce on the real iPad without waiting for the bug.** The lab server listens on every interface, so the iPad on the same Wi-Fi reaches it at `http://<Mac LAN IP>:8765` (`ipconfig getifaddr en0`; the macOS firewall was off). The owner types `<IP>:8765/ipad.html` in Safari: it freezes a page mid-transaction and runs the app's storage layer with the cure (`ipad.html?before` — a raw write without it); results land in `tools/webkit-lab/log.ndjson`. Check the user agent before trusting a run: the iPad reports `Version/26.6.1`, the Mac's Safari `26.5.2` — a link clicked in the terminal opens on the Mac. 2026-10-03: two iPad runs released the frozen page in 6.3 s.
3. **Inspect the real iPad live** (the owner's hands): on the iPad, Settings → Apps → Safari → Advanced → **Web Inspector** on; on the Mac, Safari → Settings → Advanced → **Show features for web developers**; connect the iPad by cable (or pair once, then «Connect via Network»). Safari's **Develop** menu → the iPad's name lists its Safari tabs and Home Screen apps; pick the app to get the console, network, and Storage → IndexedDB (`preacher-data-engine-*`) of the installed app. Remote automation (Develop → Allow Remote Automation, and on the device Settings → Safari → Advanced → Remote Automation) is what `safaridriver` needs to drive it.

## Before trusting a device test

- Make sure the device runs the build you mean: Settings in the app → «Показывать версию» shows the commit; the service worker may serve the previous bundle once after a deploy — close and reopen the app, then check the commit again.
- A scenario that depends on sleep, network loss or the back-forward cache has to be performed, not described: lock the iPad, airplane mode, wake, then navigate — the order matters.
- Never clear the app's site data on the owner's device to "start clean": it signs him out (Firebase Auth lives there).

## Why

- 2026-10-02/03: three owner reports from the iPad (19:46, 19:48, 20:31) carried the whole story — wake after 94 min, offline, a full page load, `pagehide persisted:true`, silence for 45 min 52 s — and the cure was proven in the simulator and macOS Safari before anyone touched the iPad (`BUG-20260927-engine-open-hangs-on-silent-device-storage`).
- Installed-app specifics confirmed by sources: Home Screen apps keep the system swipe-back and cannot disable it; pull-to-refresh does not exist there (ionic-framework#22299, w3c/manifest#1041).

See also: `.howto/test-on-webkit.md` · `.howto/read-owner-documents.md`
