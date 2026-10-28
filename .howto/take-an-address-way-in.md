when: page scrolls back to a section · scrolls back after save · jumps to the section again · ?section= · ?focus= · ?prepStep= · deep link scrolls again · scrollIntoView runs again · effect depends on sermon · remove a query parameter quietly · history.replaceState · addressWithout · useWayInOnce · проматывает обратно к секции · прыгает к вступлению после сохранения · параметр в адресе · убрать параметр без моргания

# Take an address's way in — once

An address parameter that names where to go — `?section=` on the plan, `?q=&focus=&updateId=` on a prayer, `?prepStep=` on a sermon — is a WAY IN: the page brings that place into sight on arrival, and never again because its data changed. The effect that scrolls usually has to wait for the data (the section's element exists only once the sermon is there), so it depends on it — and then every save, every answer from the server, ran it again: the plan went back to «Вступление» after «Сохранить» (BUG-20261027-plan-scrolls-back-to-section, the owner, 2026-10-27).

## How

- `useWayInOnce()` (`frontend/app/hooks/useWayInOnce.ts`): the effect asks `arriving(key)` before it scrolls — `key` is the page and the parameter (`${sermonId}:${section}`), null when the address names none — and calls `take(key)` when it has brought the place into sight. Naming another target, or none, lets the last one go, so Introduction → Main → back to Introduction before Main's scroll came is a new arrival there.
- Hold the hook above anything that mounts the screen anew: the plan's copy giving way to its editor (`key={onCopy ? 'copy' : 'editor'}`) is not a new arrival — the latch lives in `EnginePlanPage` and is passed down.
- The effect cancels its frame and timer on cleanup: an address that moves on within the wait lets the old scroll go.
- Take it where the scroll happens, not where it is scheduled: a timer the effect's cleanup clears must not leave the way in taken without having arrived.
- What the arrival lights for a moment (a prayer's ring) leaves on its own clock, not on the effect's cleanup: once the way in is taken the effect does nothing more, and a ring whose removal it cleared would stay forever.
- To take the parameter out of the address without a navigation (nothing moves, nothing blinks): `addressWithout(window.location.href, name)` (`frontend/app/utils/urlUtils.ts`) and `window.history.replaceState(null, '', path)` — pass NO state of your own: the App Router keeps its own and reads the new address into `useSearchParams`; its state passed back (`__NA`) makes it skip the sync, and a later `router.replace` built from `useSearchParams` brings the parameter back. The plan does it on the green «Сохранить» (`saveSermonPointHere`).

## Traps

- Testing it: render with the parameter, wait for the first `scrollIntoView`, then give the page its data again as a new object (`harness.remote(…)` on the plan, a new `mockUsePrayerDetail` value and `rerender` on a prayer, a moved active step on a sermon) — the count must stay 1. A mocked card that drops its `ref` (`PrepStepCard` in `SermonPage.modeTransitions.test.tsx`) leaves nothing to scroll to: pass the ref through.
