when: press and hold · long press · long tap · hold to open · useLongPress · a tap does one thing, a hold another · contextmenu on long press · iOS callout · text selected under the finger · hold opens and the text underneath reacts · долгое нажатие · удержание · нажал и держишь · длинный тап · удерживайте — откроется сразу

# Press and hold one button

One button, two actions: a press (tap, click, Enter, Space) does the next step, a hold of half a second does the long action. The rule lives in `frontend/app/hooks/useLongPress.ts`; a button spreads its `handlers` and draws its `state`. First use: the Bible, 2026-10-23 — a book or a chapter pressed goes one step on, held opens at once, in the reader's windows and on the Bible page's list of books alike (`frontend/app/components/bible/BiblePicker.tsx`: `NumberTile`, `BookChip`, `BookOnList`; one set of steps, `PlaceSteps`).

## How

- `const { state, handlers } = useLongPress({ onPress, onLongPress })`, spread `{...handlers}` on a `<button>`. Without `onLongPress` it is an ordinary button: only `onClick`.
- Give the button `select-none touch-manipulation [-webkit-touch-callout:none]` (`HOLDABLE` in `BiblePicker.tsx`): no text selection, no Safari callout, no double-tap zoom delay.
- Show the hold: `state` is `idle` · `holding` · `armed`. The picker fills the button from the bottom over `LONG_PRESS_MS` (`HoldFill`), its text turning white as the fill passes.
- Tell people the hold exists where it works: one quiet line under the grid («Удерживайте главу — откроется сразу»), and in «Как искать». A hold is a shortcut, never the only door: everything it does is reachable by presses (verse 1 opens the chapter from its start), so the keyboard and a person who never heard of it lose nothing.

## Traps

- **The long action runs on the lift, not while the finger is down.** Opened under a held finger, the window vanishes and the finger rests on the text that came: iOS starts a selection there, and the end of the touch can land on a link or a mark. Lifting first leaves nothing under the finger, and a filled button can still be given up by sliding off.
- **The click that follows the lift is not a press.** `useLongPress` ignores a click for 400 ms after a hold; a later click is a press again.
- **A finger that moves is scrolling.** More than 10 px cancels, and so do `pointercancel` (the browser took the touch for a scroll) and `pointerleave`.
- **A press given up is no press.** A mouse still clicks where it is lifted: held, moved 15 px and released, the old hook opened the verses (Codex review, 2026-10-23). After a move away or a leave the click is ignored; a touch leaves its button after the lift and before the click, so only a press still held is given up by leaving.
- **The system's own long press**: Android's menu and the right mouse button come as `contextmenu` — prevented on the button; a right button press starts no hold.
- **jsdom has no `PointerEvent`.** `fireEvent.pointerDown` drops `clientX` and `pointerType`; tests send a `MouseEvent` under the pointer's name with `pointerType` defined on it (`app/hooks/__tests__/useLongPress.test.tsx`, `__tests__/components/bible/BibleBookReader.test.tsx` `hold`).
- **Live, a touch is a touch.** Playwright's `tap()` has no hold; Chrome's touch events make the pointer events the app hears: `Input.dispatchTouchEvent` touchStart → wait → touchEnd through a CDP session (`.cases/2026-10-12-block-diagram` 5.7, `hold-live.cjs`).
- **Wide is not «can hover».** An iPad is wide and has only a finger: a line that says «point at a number» shows only under `(hover: hover)` (`VerseStep`), as `utils/pointerHover.ts` keeps hover for what can hover.

## Why

- 2026-10-23: the owner chose it for choosing a verse — «нажал — следующий шаг, нажал и держишь — открывается сразу; и справочку добавить».
