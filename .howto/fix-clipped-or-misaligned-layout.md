when: layout bug · badge clipped · button cut off · overflow-hidden cuts button · -top-1 -right-1 · negative offset clipped · tooltip cut off · tooltip off screen · 1px gap on mobile · subpixel seam · buttons overflow on phone · horizontal scroll on iPhone SE · action bar overflows · controls overlap text · controls overlap banner · toggle covers first row · row jumps on hover · hover jitter · edit/delete rail · sub-point controls past card edge · numbers shift width · timer text jumps · tabular-nums · recorder timer unreadable · layout shifts when data loads · empty vs loaded state · wide table sprawls · colgroup · nav wraps in fixed header · tabs wrap · line-clamp hides scripture · вёрстка поехала · обрезана кнопка · бейдж обрезан · горизонтальная прокрутка на iPhone · кнопки вылезают на телефоне · строка прыгает при наведении · цифры таймера прыгают · таблица расползается · вкладки переносятся

# Fix clipped or misaligned layout

Find the symptom below. Most cases are one of three causes: an `overflow-hidden` ancestor cutting something that sticks out, a control whose geometry changes with its state, or a row with no rule for narrow screens.

## Clipped

- A badge or button placed with negative offsets (`absolute -top-1 -right-1`, like the pause/cancel buttons of `FocusRecorderButton`) is cut → an ancestor flex/grid container has `overflow-hidden`. Remove it; text truncation belongs on the text element itself (`truncate` + `min-w-0`).
- Tooltip cut off or off screen → `.howto/show-a-tooltip.md`.
- Full Scripture text cut by `line-clamp` → where the text is the content (plan header, `PlanPageHeader.tsx`), show all of it with `whitespace-pre-line` and let the container scroll; `line-clamp-*` is for card previews.

## Overlapping

- An absolute control (✕, menu) collides with a banner under it → don't float it; put it into the header's flex row with a negative margin, so it keeps the corner and still pushes the content down (`ThoughtHeader` in `frontend/app/components/ThoughtCard.tsx`: `flex-shrink-0 -mt-1.5 -mr-1.5`).
- A phone-only toggle floated over content covers the first data row → reserve or offset its space (`Column.tsx` focus mode: `md:hidden absolute top-4 left-4` button, container `pt-20 md:p-6`). Verify with bounding-box overlap checks, not screenshots alone.
- A hover edit/delete rail covers multi-line text or sticks to the first line → give the text a stable right padding (`pr-12` / `pr-20`) and centre the rail vertically (`absolute top-1/2 -translate-y-1/2`), as the outline-point rows in `frontend/app/components/Column.tsx`.
- A card with an absolute action column is shorter than its control stack → the bottom action falls onto the next card; reserve a minimum height for the full stack.
- Nested sub-point controls sit past the card's visual edge → give the list its own right inset and max width, and keep the actions in a fixed-width slot (`frontend/app/components/column/SubPointList.tsx`: `mr-4 max-w-[calc(100%-2.75rem)]`, actions `w-10 flex-shrink-0`).

## Jumping

- A row changes size on hover and flickers → hover-only controls must not change padding, wrapping, truncation or height. Take them out of flow (an absolute rail) and reveal them with opacity only (`opacity-0 group-hover:opacity-100`, plus `group-focus-within` for the keyboard). Otherwise the row shrinks, loses hover, grows back, and repeats.
- Counters and timers shift width as digits change → `tabular-nums` + `font-mono` (the timer in `FlatRecorderButton`).
- A compact control that reveals more buttons in place (recorder pause/cancel/finish) → one fixed outer width plus fixed slots (`FlatRecorderButton`: `w-[190px]`, timer `w-[3.1rem]`, actions `w-[34px]`). `min`/`max` widths plus `truncate` on the timer made an active recording unreadable.
- The page jumps when data arrives → keep the same root element structure for empty, loading and loaded states; swap only what is inside.

## Overflowing on phones

- Page action bars ("View plan" + "Preach"): `flex flex-wrap` on the container and `w-full sm:w-auto` on the children (`SermonHeader.tsx`). `flex gap-2` alone overflows narrow phones such as the iPhone SE. Tab rows in page flow the same: wrap with `gap`, not `flex-nowrap` + horizontal scroll.
- The primary nav inside a fixed-height header never wraps: items `shrink-0` + `whitespace-nowrap`, primary destinations kept apart from secondary actions, `aria-label` when labels collapse to icons (`DashboardNav.tsx` switches to icon-only by measurement, with a hidden-scrollbar horizontal scroll as the fallback).
- A wide table: `table-fixed` + a percentage `<colgroup>` for the desktop rhythm, a readable minimum width (`min-w-[64rem]`) so dates, badges and gauges survive, inside an `overflow-auto` wrapper (users table in `frontend/app/(pages)/(private)/admin/page.tsx`).
- A 1 px seam between pieces moved by percentage transforms on phones → overlap them by 1 px with `calc(…)`, or move in whole pixels (`ModeToggle` slides its indicator by a measured `px` offset).

## Why

- 2026-02-01: percentage transforms left subpixel gaps on phones; mobile tabs overflowed until they wrapped.
- 2026-02-27: a header's `overflow-hidden` cut 4 px off the `FocusRecorderButton` pause/cancel buttons.
- 2026-03-16: the sermon action bar scrolled sideways on an iPhone SE.
- 2026-04-25: hover rails that changed row geometry put the pointer into a jitter loop.
- 2026-05-01: the recorder timer truncated mid-recording; the desktop nav wrapped inside its fixed-height header.
- 2026-07-13: the admin users table sprawled unevenly on wide screens and crushed its badges on narrow ones.

See also: `.howto/show-a-tooltip.md` · `.howto/lay-out-cards-and-rows.md`
