when: tooltip · show a hint on hover · export button label cut off · help bubble · Tooltip component · tooltip cut off · tooltip clipped by overflow-hidden · tooltip off screen · tooltip inside scroll container · tooltip will not close on second click · tooltip closes when moving the mouse to it · click-to-pin tooltip · link inside tooltip · role="tooltip" · aria-describedby · getBoundingClientRect · flip above or below · подсказка · всплывающая подсказка · подсказка при наведении · тултип · подсказка обрезана · подсказка не закрывается · закрепить подсказку · ссылка в подсказке

# Show a tooltip

Wrap the trigger in `Tooltip` from `frontend/app/components/ui/Tooltip.tsx`: `<Tooltip content={…}><button …/></Tooltip>`. It opens on hover after a delay (`hoverDelay`, 500 ms by default), at once on keyboard focus, pins on click or tap, and keeps itself on screen.

## How

- Placement: the panel is `position: fixed`, measured with `getBoundingClientRect()` against the trigger — above when it fits, otherwise below; clamped horizontally 12 px from the screen edges; re-measured on resize and on any scroll (a capture listener, so scrolling inner containers counts too). Being fixed, it is not cut by an `overflow-hidden` or scrolling ancestor.
- Open/closed is an explicit override state, `clickMode: 'none' | 'open' | 'closed'`, on top of hover and focus. Hover and focus count only while it is `none`; a click toggles `open` / `closed`; Escape, a pointer-down outside and a click inside the panel set `closed` until the next deliberate interaction. Hover/focus alone cannot close a click-opened tooltip, because the trigger keeps focus after the second click.
- Leaving the trigger closes the panel only after `POINTER_BRIDGE_MS` (160 ms), so the pointer can cross the gap into the panel and use a link there; coming back cancels the close.
- It puts `aria-describedby` on the child while open and `role="tooltip"` on the panel — pass one element as the child.
- Action buttons keep instant CSS hover labels instead (the export buttons, `TooltipStyles`): on them a click is the action, and `Tooltip` would pin itself on it. The edge rule is still one: `clampTooltipCentre` (`frontend/app/utils/tooltipPlacement.ts`), used by `Tooltip` and by `keepTooltipOnScreen` on the labels' hover — it slides a label through `--tooltip-shift` while the arrow keeps pointing at the button, and places it again if its text changes while hovered.
- A hand-made popover positioned `absolute` inside a scroll container must measure itself: `OutlinePointGuidanceTooltip` in `frontend/app/components/SermonGuidanceTooltips.tsx` finds the nearest `.overflow-y-auto`, compares the rects, and flips above→below and left→right.
- An `absolute` tooltip is clipped by any `overflow-hidden` ancestor below its positioned parent. Remove that overflow, or render the panel `fixed` / through a portal.

## Traps

- A `fixed` panel is placed against the viewport only while no ancestor has a `transform` or `filter` (for example a card with `hover:-translate-y-[1px]`); inside one, portal the panel to `document.body`.

## Why

- 2026-10-05: on a phone the reason on the disabled audio button ("Недостаточно оставшегося AI-использования.") ran off the right edge — the export labels were centred and never wrapped. Fixed through the shared edge rule rather than a second copy of `Tooltip`'s math.

- 2026-01-17: tooltips inside scrollable containers ran out of the visible area until they measured and flipped.
- 2026-02-01: containers with `overflow-hidden` cut tooltips off.
- 2026-07-13: a click-toggled tooltip derived visibility from hover/focus only, so the second click could not close it.
- The 8 px gap between trigger and panel fired `pointerleave` and shut the tooltip, so nothing inside one was reachable by mouse; a click on a link inside the panel bubbled to the trigger and pinned it over the next page (comments in `Tooltip.tsx`).

See also: `.howto/fix-clipped-or-misaligned-layout.md` · `.howto/fix-a-click-that-misfires.md`
