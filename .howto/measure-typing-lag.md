when: typing lags · search is slow · input freezes · field lags on first letters · keystroke latency · measure UI responsiveness · many notes · long list re-render · useDeferredValue · rAF does not fire · hidden tab · Event Timing empty · seed test data without writing · поиск тормозит · поле ввода подвисает · задержка при наборе · замер отзывчивости · много заметок · tap lags · tool tap slow · stroke lags · iPad sluggish · animation feels stiff · style recalculation · UpdateLayoutTree · :has invalidation · WebKit performance · Playwright frames · задержка нажатия · тугая анимация · кнопка отвечает с задержкой · iPad тормозит

# Measure typing lag on a real screen

Found while fixing BUG-20260809-studies-search-lag (2026-09-30). The symptom only shows at volume, and the owner's volume is on production, where an agent does not sign in.

## Get the volume without writing to the database

2026-10-15: the studies collection now reads through `useStudyNotesEngine` /
`useDataCollection`. The React Query seeding steps below describe the historical
pre-engine harness, not the current studies read path. Do not seed engine
checkpoints/outbox rows to imitate volume. Current local reacceptance used23real
test-account notes, the existing scheduling regression and the owner's accepted
typing observation; it did not repeat the old400-note benchmark.

Dev and production share one Firestore project, so creating hundreds of test notes pollutes the real database. Seed the page's own React Query cache instead:

1. Find the QueryClient through React's fiber tree — walk up from any DOM node to a fiber whose `memoizedProps.client` has `setQueryData`.
2. Read the real key (`qc.getQueryCache().findAll()`), copy one real item as a template, and `setQueryData(key, syntheticItems)`.
3. When you are done, `invalidateQueries` on that key and check that the real count is back — the persisted cache would otherwise keep the synthetic items.

## Pick an instrument that works in the automation browser

The Chrome automation window is usually reported as hidden (`document.visibilityState === 'hidden'`):

- `requestAnimationFrame` never fires, so frame-gap samplers read zero; a `screenshot` action does render one frame, so layout that is re-measured in rAF (e.g. `useWindowFittedPanel`) updates only after a screenshot — take one before reading such values (2026-10-03, the group page side panel);
- `PerformanceObserver({ type: 'event' })` records nothing for text inserted by the `type` action.
- A script that `await`s a frame does not end when the tool gives up on it ("Runtime.evaluate timed out"): it waits, and the next `screenshot` frame resumes it — on whatever page is open by then. A loop of `scrollTo(...)` + frame waits once finished there and left the next book scrolled to its very end, which read as an app bug (2026-10-13, the Bible reader; the page sat at exactly `scrollHeight - innerHeight`). Measure with synchronous reads (`getBoundingClientRect` forces layout) or `setTimeout`, never with frame waits, and reload the page after a timed-out script.

What works: a capture listener on `input` that posts a `MessageChannel` message and times its arrival. The message runs after the event's synchronous work, so the gap is how long that keystroke held the main thread — exactly what freezes the field. Work that React defers (`useDeferredValue`, transitions) runs later and is not counted, which is the point. Type one letter per `type` action with a pause between them, and click the field again after any big re-render — a click queued behind a render does not focus it.

## Read the numbers honestly

A dev build is several times slower than production: compare before and after in the same build, and say so. Prove the other side too — the list must still update after the letters (count, highlights).

## Guard it in a test

`fireEvent` runs inside `act()`, which flushes deferred renders too, so it cannot tell a responsive field from a frozen one. Dispatch the event without `act` (`IS_REACT_ACT_ENVIRONMENT = false`, native value setter, `dispatchEvent(new Event('input', { bubbles: true }))`), then assert that the field shows the letter while the list has not been drawn for it yet — see `app/(pages)/(private)/studies/__tests__/searchResponsiveness.test.tsx`.

## Reproduce a native field that drops letters

A controlled-field timing failure can disappear when Playwright waits for every
key acknowledgement. For BUG-20261002-live-text-field-drops-letter-at-machine-speed,
use an owned disposable group, open its first block and focus `#step-notes`.
Send CDP `Input.dispatchKeyEvent` events with `type: 'char'`, `text` and
`unmodifiedText`, pacing sends by4or6ms. Keep each returned promise in an array
and await them together after the sequence; do not await each acknowledgement.
Compare the complete expected string, not only its length, with the exported
`frontend/test-utils/assertLiveTextRetained.ts` assertion in the page. Count
native input events separately and capture fresh `pageerror` events per attempt.

Use the same sequence/build mode and a plain temporary textarea as a control.
Record actual input gaps, build ID and failed as well as successful attempts.
The baseline failure is intermittent: several passing attempts do not establish
a fix. A rollback A/B check is useful; keep original source and result artifacts
before restoring the candidate. Run browser timing checks after CPU-heavy gates
finish, and verify the served build after every rebuild.

The shared buffer reconciles document echoes in a layout effect so the mirror
does not leave passive state work between native input events. Preserve its
pending-echo/refusal guards; focused fields must still adopt the next document
value once their own words are acknowledged. Existing delayed-echo, refusal and
other-device tests are required controls. The recorded React185 errors identify
a depth guard, not the exact component that scheduled each update; do not infer
an application loop or an engine publication interval from that number alone.
Keep the separate rich-editor update-loop report open until its own route is
reproduced and checked. After testing, verify saved content, reload/offline
behavior and textarea resizing, then delete only the owned fixture through the
normal UI and restore network/tabs.

For an isolated localhost port, set `NEXT_PUBLIC_API_BASE=''` on the **build**
command as well as on `next start`. Public variables are compiled into browser
code; setting only the start environment does not change the health-probe URL.
The default local env can point at3000 while the isolated engine requests use
relative URLs on3047, making writes work but reconnection look broken. Confirm
actual health request URLs before attributing that result to application code.

## Taps and strokes: frames on both engines, production build

Found while fixing the Bible marks (2026-10-16: the owner's iPad felt every tool tap and stroke stiff). The automation tab cannot show it: hidden, it draws no frames, and its numbers can be invented by the hidden state itself (a highlight change "cost" 130–290 ms there and 0 ms in a real Chrome).

- **Stand:** `tools/webkit-lab/marks-responsiveness.js` — Playwright WebKit (the iPad's engine) or the installed Google Chrome (`ENGINE=chrome`, `chromium.launch({ channel: 'chrome' })`), signed in as the test user, a 1180×820 window; it times a tap from `click()` to the second `requestAnimationFrame`, and counts frames during and after a stroke. Copy its pattern for another screen.
- **Production build, not the dev server.** The dev server handling each request took up to 466 % CPU on this Mac and made WebKit's frames 100–150 ms — a regression that was not there. Build a copy (`project_build_gate_isolated_copy` in memory: `git ls-files -co --exclude-standard -z frontend | rsync --from0 --files-from=-`, copy `.env.local`, symlink `node_modules`), with `NEXT_PUBLIC_ENABLE_TEST_LOGIN=true` (the test sign-in, `utils/testLogin.ts`), and `next start -p 3100`. Keep the "before" build running beside the "after" one and measure them back to back.
- **Split a slow tap into parts before changing code:** apply one change at a time in the page (`classList.add`, an attribute, a highlight) and time to the second frame — the marks' 529 ms was `touch-action` on the text, 316 ms its `cursor`, the rest free.
- **Find what restyles the page in Chrome:** `browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking'] })` around one tap. A large `UpdateLayoutTree` plus `StyleRecalcInvalidationTracking … Affected by :has()` and a shell subtree invalidation identifies broad pane-layout queries. The canonical replacement is `useWorkspacePanes` with explicit shell/workspace flags (`.howto/keep-a-pane-scrolling-on-ipad.md`); changing only reader queries leaves the study queries active, and direct-child `:has()` variants still invalidated the shell in the observed Chromium. Compare exact event counts before/after, pin a visible tab/locale/build, and keep the same sheet warm. Blink's element count includes style elements/pseudos; do not equate it with native DOM nodes or treat tracing cost as an uninstrumented user latency. Mounted/hidden palettes remain their existing local behavior.
- **A probe that repeats strokes changes its own stand:** a stroke over words already that colour erases them, so a second run over the same words leaves nothing to paint. Give each run its own chapter.
- **Keep the reading anchor before a deferred size changes CSS:** `useTextScaleValue('selected')` captures the current verse while the chosen size is pending; the default applied value restores it in a layout effect after reflow (`BibleBookReader`). Capturing from the applied notification itself can keep the verse native scroll anchoring moved to. A cancelled unapplied choice drops its anchor so a later deliberate scroll stays current. On an iOS pinned page, scrolling the document cannot move the fixed body: use `scrollPinnedPageBy` from `useScrollLock` to adjust its visible offset and its eventual unlock offset together. Apply this only to the page surface; a wide reader pane still scrolls normally. The same reader presentation keeper follows canonical ribbon counts, visibility and main/all mode: late cross-reference chips can add a line to the previous verse and make native anchoring save that verse on reload. Keep text-first loading; restore from the current place, never from the initial route after later scrolling. Publish the logical chapter/verse when the explicit jump succeeds; the browser can deliver its scroll event after the next paint, leaving the old chapter label briefly visible if publication waits for that event.
- **A custom property changed on `<html>` restyles every element** (WebKit, 2026-10-16): `--text-scale` 1 → 1.1 cost 270 ms of style and 33 ms of layout in Isaiah, and even an unused variable cost 276 ms. Two thirds of it is Tailwind's `*, ::before, ::after` rule giving every element 51 `--tw-*` variables. Never write such a change per input step: let the control preview it and apply on rest or release (`TextScaleControls.tsx`), and let the control paint before the page takes it (`TextScaleProvider` applies a frame later).
- **Something in the WebKit of an iPad you cannot drive:** the iPad simulator's Safari takes WebDriver (`safaridriver -p 4723`, capabilities `platformName: iOS`, `safari:useSimulator: true`, `safari:deviceUDID`), but its touch actions give `touchstart`/`touchend` and NO `click` — iOS makes the click from a gesture these do not pass through. Real taps there need System Events clicks on the Simulator window, which macOS blocks until the terminal is allowed to control the computer.
