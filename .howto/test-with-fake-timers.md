when: jest.useFakeTimers · fake timers · debounce in tests · debounced auto-save test · autosave never fires in test · advanceTimersByTime · advanceTimersByTimeAsync · timers leak between tests · useRealTimers · clearTimeout cleanup coverage · pending timer cancelled on unmount · Date.now in tests · Date.now returns 2023 · setSystemTime · user-event hangs with fake timers · doNotFake · фейковые таймеры · тест дебаунса · дебаунс · автосохранение не срабатывает в тесте · промотать время · таймеры протекают между тестами · подменить дату

# Test timers (debounce, auto-save) with fake timers

Turn fake timers on in `beforeEach` and off with `jest.useRealTimers()` in `afterEach`. Cause the change, then advance the clock past the delay inside `act`, then assert. The model is `frontend/app/(pages)/(private)/studies/[id]/__tests__/useNoteAutoSave.test.tsx` against the 1500 ms debounce in `frontend/app/(pages)/(private)/studies/[id]/useNoteAutoSave.ts`.

## How

- Always pair `jest.useFakeTimers()` with `jest.useRealTimers()` in `afterEach`. Without the restore, fake timers stay on for the rest of the file (72 of the 75 suites that fake timers restore them).
- Debounced save: change the value — `fireEvent.change(input, …)` in a component, `rerender` with new props in a hook — then `await act(async () => { jest.advanceTimersByTime(debounceMs + margin); })`, then assert the save. Don't rely on a save at mount: the hooks skip empty content (`if (!title.trim() && !content.trim() && …) return` in `useNoteAutoSave.ts`), so rendering and waiting proves nothing.
- Cancelled save: change the value, `unmount()` before advancing, then advance and assert the save was not called. This is the only way to exercise the `clearTimeout` cleanup while its timer is still pending.
- Promises that settle after the timer: advance inside `await act(async () => …)` or use `jest.advanceTimersByTimeAsync`. Tests here that await promises under fake timers use `jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] })` (`frontend/__tests__/hooks/useClipboard.test.ts`).
- `waitFor` and `findBy` advance fake timers themselves (Testing Library detects Jest's). user-event does not: `userEvent.setup()` waits on a real `setTimeout` and hangs under fake timers unless given `advanceTimers: jest.advanceTimersByTime`. The repo uses `fireEvent` with fake timers.
- Clock: the setup freezes `Date.now` at 2023-01-01. `jest.useFakeTimers()` swaps in a fake clock that starts at today's wall-clock time and moves with `advanceTimersByTime`; `useRealTimers()` goes back to the frozen 2023 value. For date-dependent assertions, pin the time with `jest.setSystemTime(new Date(…))`.

## Why

- 2026-03-01: debounced-save tests that counted on a save at mount broke once the save guards were added.

See also: `.howto/test-async-ui.md` · `.howto/run-jest-tests.md`
