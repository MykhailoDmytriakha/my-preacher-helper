when: time wheel · time picker · preset changes itself · section time changes after switching tabs · useTimeWheel · delayed scroll callback · snap · колёса времени · пресет меняется сам · смена части меняет минуты

# Keep a time-wheel choice stable

`frontend/app/hooks/useTimeWheel.ts` owns position, selection and snap lifecycle for the three wheels in both time pickers. A scroll reports its rounded bounded value immediately. The150ms timer only aligns the wheel; it must never report a new selected value later.

## How

- Keep one synchronous local value owner. `CustomTimePicker` owns hours/minutes/seconds; `SectionTimePicker` owns phaseDurations and derives the visible parts for the active phase.
- Pass the displayed value, maximum23or59, selection callback and optional scope into `useTimeWheel`. Reuse its ref and onScroll. A section passes activePhase as scope, so switching to another phase cancels the old snap even when the two values are equal.
- An explicit preset calls each wheel's align(newPart), including when the preset equals the current value. This cancels any old snap and stops the old visual motion before applying the chosen state.
- The hook aligns external choices with behavior instant. Existing CSS scroll-smooth means auto can still animate. Native user movement retains its gesture/inertia; the controlled React update caused by that movement does not start another programmatic alignment.
- Pending snap work is cancelled on unmount. Confirm reads local state immediately; never wait for a debounce to discover what the person selected. Modal/Enter/Escape ownership stays with the existing shared layer.

## Verification

Run `__tests__/components/timePickerSelection.test.tsx` plus `timePickerEnter.test.tsx` and timer integration/persistence suites from frontend. Preserve the later preset, same-value preset, immediate wheel confirmation, later manual selection and section ownership controls. A mocked scroll test does not prove native inertia: repeat2/15/5 via section presets and5/15/30 via custom presets in compiled Chromium, then move a native wheel and confirm, cancel/reopen and Escape. Check phone and wide viewports. Keep physical-device/PWA and production proof separate.

## Why

The former per-render150ms handlers read live DOM after a smooth programmatic move. Those callbacks overwrote a later explicit choice, sometimes in another phase. BUG-20261018-section-picker-fast-tabs reproduced in both pickers. Increasing the delay cannot establish action order; disabling scroll removes a useful input path. One shared rule prevents the copies diverging.

Browser semantics: [MDN scrollTo](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTo). Do not rely on newer promise-returning scrolling or scrollend support for this operation.
