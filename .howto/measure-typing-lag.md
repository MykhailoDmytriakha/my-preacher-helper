when: typing lags · search is slow · input freezes · field lags on first letters · keystroke latency · measure UI responsiveness · many notes · long list re-render · useDeferredValue · rAF does not fire · hidden tab · Event Timing empty · seed test data without writing · поиск тормозит · поле ввода подвисает · задержка при наборе · замер отзывчивости · много заметок · tap lags · tool tap slow · stroke lags · iPad sluggish · animation feels stiff · style recalculation · UpdateLayoutTree · :has invalidation · WebKit performance · Playwright frames · задержка нажатия · тугая анимация · кнопка отвечает с задержкой · iPad тормозит

# Measure typing lag on a real screen

Found while fixing BUG-20260809-studies-search-lag (2026-09-30). The symptom only shows at volume, and the owner's volume is on production, where an agent does not sign in.

## Get the volume without writing to the database

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

## Taps and strokes: frames on both engines, production build

Found while fixing the Bible marks (2026-10-16: the owner's iPad felt every tool tap and stroke stiff). The automation tab cannot show it: hidden, it draws no frames, and its numbers can be invented by the hidden state itself (a highlight change "cost" 130–290 ms there and 0 ms in a real Chrome).

- **Stand:** `tools/webkit-lab/marks-responsiveness.js` — Playwright WebKit (the iPad's engine) or the installed Google Chrome (`ENGINE=chrome`, `chromium.launch({ channel: 'chrome' })`), signed in as the test user, a 1180×820 window; it times a tap from `click()` to the second `requestAnimationFrame`, and counts frames during and after a stroke. Copy its pattern for another screen.
- **Production build, not the dev server.** The dev server handling each request took up to 466 % CPU on this Mac and made WebKit's frames 100–150 ms — a regression that was not there. Build a copy (`project_build_gate_isolated_copy` in memory: `git ls-files -co --exclude-standard -z frontend | rsync --from0 --files-from=-`, copy `.env.local`, symlink `node_modules`), with `NEXT_PUBLIC_ENABLE_TEST_LOGIN=true` (the test sign-in, `utils/testLogin.ts`), and `next start -p 3100`. Keep the "before" build running beside the "after" one and measure them back to back.
- **Split a slow tap into parts before changing code:** apply one change at a time in the page (`classList.add`, an attribute, a highlight) and time to the second frame — the marks' 529 ms was `touch-action` on the text, 316 ms its `cursor`, the rest free.
- **Find what restyles the page in Chrome:** `browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking'] })` around one tap; a long `UpdateLayoutTree` with `elementCount` near the whole document and `StyleRecalcInvalidationTracking … Affected by :has()` up to `HTML` means an element put into or taken out of the page under `#app-shell` (the shell's `:has([data-reader-panes])` rules, `globals.css`): toggle `hidden` instead of mounting.
- **A probe that repeats strokes changes its own stand:** a stroke over words already that colour erases them, so a second run over the same words leaves nothing to paint. Give each run its own chapter.
- **A custom property changed on `<html>` restyles every element** (WebKit, 2026-10-16): `--text-scale` 1 → 1.1 cost 270 ms of style and 33 ms of layout in Isaiah, and even an unused variable cost 276 ms. Two thirds of it is Tailwind's `*, ::before, ::after` rule giving every element 51 `--tw-*` variables. Never write such a change per input step: let the control preview it and apply on rest or release (`TextScaleControls.tsx`), and let the control paint before the page takes it (`TextScaleProvider` applies a frame later).
- **Something in the WebKit of an iPad you cannot drive:** the iPad simulator's Safari takes WebDriver (`safaridriver -p 4723`, capabilities `platformName: iOS`, `safari:useSimulator: true`, `safari:deviceUDID`), but its touch actions give `touchstart`/`touchend` and NO `click` — iOS makes the click from a gesture these do not pass through. Real taps there need System Events clicks on the Simulator window, which macOS blocks until the terminal is allowed to control the computer.

