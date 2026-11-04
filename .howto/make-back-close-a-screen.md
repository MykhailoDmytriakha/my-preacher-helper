when: Back leaves the page instead of closing the screen · back opened the previous page · browser back closes window · swipe back · history step · pushState · popstate · screen over the page · назад ушёл со страницы · назад открыл Библию, а не разбор · кнопка назад браузера · свайп назад · окно поверх страницы · шаг в истории

# Make Back close a screen opened over the page

A full screen opened over a page (the analysis screen over Studies' list or the reader's text) is, to the person, a page: Back — the browser's button, a swipe — must close it and leave the page as it was, scroll included (the owner, 03.11: «нажал кнопку назад … открылась Библия, а не разбор»). A screen that only writes itself into the address in place (`replaceState`) adds no step, and Back leaves the whole page.

## How

- The step primitive: `frontend/app/utils/historyStep.ts` — `pushHistoryStep(url)` adds an entry marked with the step's id in `history.state` (Next's own fields copied, so the App Router keeps the page in place and restores it on Back); `historyStepHere()`; `takeHistoryStep(step)` goes back once, only when the current entry is that step.
- Push when the screen is **opened over the page**; push nothing when it is **arrived at by an address** (a link, a redirect, a reload) — Back then leaves for where the person came from. A reload of a pushed step keeps its mark: closing still takes it.
- Changes inside the screen (a mode, a new record given its id) are written in place, on the same step.
- The screen's own way back takes its step (`history.back()`), so Back afterwards goes where it went before the screen opened. Without a step, forget the address in place — only while the address still names this screen's record: a late close must never touch the page the person has moved on to.
- Listen to `popstate` in the screen: off its entry → close through the screen's own close (the analysis flushes there). The host listens too: Forward onto a step whose record it holds opens it again.
- Worked example: `components/bible/analysis/analysisAddress.ts` (`openAnalysisStep`, `leaveAnalysisAddress`) and `useAnalysisAddress.ts`, used by `AnalysisEditor`; hosts `studies/StudyAnalysisWindow.tsx`, `bible/analysis/ReaderAnalysis.tsx`. Tests: `__tests__/components/bible/analysisHistoryStep.test.tsx`.

## Traps

- **Tests that mount a screen settle after it.** Its step is taken a moment after unmount (`setTimeout`); left to the shared cleanup, that lands in the next test and moves its history (the build machine, 2026-11-04). End every such test file with `cleanup()` and two waits — one for the screen's own timer, one for the browser's move it starts (`frontend/__tests__/components/bible/analysisHistoryStep.test.tsx`). And a late cleanup never rewrites an entry carrying another screen's step (`leaveAnalysisAddress`).

- **React's strict check runs effects twice in `next dev`** (`reactStrictMode: true`): a step pushed in an effect and taken in its cleanup is pushed, taken, and the screen closes itself on the late `popstate`. Decide the step once (a ref) and take it a moment after the real unmount (`setTimeout` cleared by the remount). Jest does not run effects twice here (probe 03.11) — check it live in `next dev`.
- **The late close must check whose entry it is.** Caught by the test «gone a moment ago, leaves alone the entry the person has moved on to»: the delayed close forgot `analysis=` on the next screen's address.
- `history.back()` is asynchronous: two closes (the host's and the screen's unmount) must not go back twice — `takeHistoryStep` remembers the step it is taking until the next `popstate`.
- Next's patched `pushState` skips its own sync when the state carries `__NA`: the URL changes without `useSearchParams` moving. That is wanted here (nothing re-renders on open); read the address with `window.location`, not `useSearchParams`.

## History
- 2026-11-03 — the analysis screen made a step (case `2026-10-12-block-diagram`, item 13.3); live: open → Back → the list at scroll 400 → 400; «К списку» → Back → the Bible; Forward reopens; the reader's text stays.
