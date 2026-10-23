when: layout bug · badge clipped · button cut off · overflow-hidden cuts button · -top-1 -right-1 · negative offset clipped · tooltip cut off · tooltip off screen · 1px gap on mobile · subpixel seam · buttons overflow on phone · horizontal scroll on iPhone SE · action bar overflows · controls overlap text · controls overlap banner · toggle covers first row · row jumps on hover · hover jitter · edit/delete rail · sub-point controls past card edge · numbers shift width · timer text jumps · tabular-nums · recorder timer unreadable · layout shifts when data loads · empty vs loaded state · wide table sprawls · colgroup · nav wraps in fixed header · tabs wrap · line-clamp hides scripture · вёрстка поехала · обрезана кнопка · бейдж обрезан · горизонтальная прокрутка на iPhone · кнопки вылезают на телефоне · строка прыгает при наведении · цифры таймера прыгают · таблица расползается · вкладки переносятся · hover buttons show on every card · hovering the parent reveals all children · group-hover fires for all cards · nested group · кнопки при наведении у всех карточек · наведение на пункт раскрывает все мысли · sticky panel slides up · sticky minimap pushed up · position sticky containing block · липкая панель уезжает вверх · миникарта уехала под шапку · light line between highlighted rows · seam between lit rows · notched highlight edges · box-shadow ring seam · шов между подсвеченными строками · края подсветки неровные · minimap frame clipped · minimap frame runs off · first chapter label missing on the map · рамка миникарты обрезана · на миникарте не видно главу 1 · list pinned to the bottom cuts its head · justify-content flex-end overflow · список у строки обрезан сверху · не долистать до начала

# Fix clipped or misaligned layout

Find the symptom below. Most cases are one of three causes: an `overflow-hidden` ancestor cutting something that sticks out, a control whose geometry changes with its state, or a row with no rule for narrow screens.

## Clipped

- A badge or button placed with negative offsets (`absolute -top-1 -right-1`, like the pause/cancel buttons of `FocusRecorderButton`) is cut → an ancestor flex/grid container has `overflow-hidden`. Remove it; text truncation belongs on the text element itself (`truncate` + `min-w-0`).
- Tooltip cut off or off screen → `.howto/show-a-tooltip.md`.
- A list that sits down at its input (a phone sheet with the line above the keyboard) shows only its tail when it grows: the heading and the best match are cut off above and no scroll reaches them → the scroll box has `justify-content: flex-end`, which overflows upward, past the scroll start. Keep the scroll box a plain column and push one inner block down with `margin-top: auto`: a short list still sits at the input, a long one starts at its head (found on the Bible opening board, 2026-10-21).
- Full Scripture text cut by `line-clamp` → where the text is the content (plan header, `PlanPageHeader.tsx`), show all of it with `whitespace-pre-line` and let the container scroll; `line-clamp-*` is for card previews.

- A scrolling minimap's frame runs off the bottom of its box near the end of a long book, or the first chapter's label is cut at the top → the map was scrolled by the page's scroll share, which leaves out the frame's height and everything on the page that is not text (the book's end, the room below). Scroll the map by the frame itself: share = frame top ÷ (map − frame), offset = share × (map − box) — the frame stays inside by construction, as an editor's minimap (`minimapOffset` and `frameOnMap` in `frontend/app/components/bible/minimapLayout.ts`; a chapter's first verse takes in its label, the frame ends with the map). BUG-20261015-minimap-frame-clipped-at-book-end.

## Overlapping

- An absolute control (✕, menu) collides with a banner under it → don't float it; put it into the header's flex row with a negative margin, so it keeps the corner and still pushes the content down (`ThoughtHeader` in `frontend/app/components/ThoughtCard.tsx`: `flex-shrink-0 -mt-1.5 -mr-1.5`).
- A phone-only toggle floated over content covers the first data row → reserve or offset its space (`Column.tsx` focus mode: `md:hidden absolute top-4 left-4` button, container `pt-20 md:p-6`). Verify with bounding-box overlap checks, not screenshots alone.
- A hover edit/delete rail covers multi-line text or sticks to the first line → give the text a stable right padding (`pr-12` / `pr-20`) and centre the rail vertically (`absolute top-1/2 -translate-y-1/2`), as the outline-point rows in `frontend/app/components/Column.tsx`.
- A card with an absolute action column is shorter than its control stack → the bottom action falls onto the next card; reserve a minimum height for the full stack.
- Nested sub-point controls sit past the card's visual edge → give the list its own right inset and max width, and keep the actions in a fixed-width slot (`frontend/app/components/column/SubPointList.tsx`: `mr-4 max-w-[calc(100%-2.75rem)]`, actions `w-10 flex-shrink-0`).

## Jumping

- A row changes size on hover and flickers → hover-only controls must not change padding, wrapping, truncation or height. Take them out of flow (an absolute rail) and reveal them with opacity only (`opacity-0 group-hover:opacity-100`, plus `group-focus-within` for the keyboard). Otherwise the row shrinks, loses hover, grows back, and repeats.
- Hovering a container reveals the hover buttons of every card inside it → an unnamed `group-hover:` fires on hover of ANY ancestor with `group`, and a card inside a card makes two. Name the group the control belongs to: `group/card` on the card and `group-hover/card:` on its buttons (`SortableItem.tsx`; the tooltip button is `group/tip`). Guard: `frontend/__tests__/components/structureHoverScope.test.tsx` fails when an unnamed `group-hover:` sits under two `group` ancestors; the same count run in the browser console finds it on any page.
- Counters and timers shift width as digits change → `tabular-nums` + `font-mono` (the timer in `FlatRecorderButton`).
- A compact control that reveals more buttons in place (recorder pause/cancel/finish) → one fixed outer width plus fixed slots (`FlatRecorderButton`: `w-[190px]`, timer `w-[3.1rem]`, actions `w-[34px]`). `min`/`max` widths plus `truncate` on the timer made an active recording unreadable.
- The page jumps when data arrives → keep the same root element structure for empty, loading and loaded states; swap only what is inside.
- A sticky side panel slides up under the nav near the end of the page → it can travel only inside its parent's CONTENT box: space added below the parent, or as the parent's own padding, ends the parent early and pushes the panel up. Add the space inside, as a sibling's margin (the Bible minimap: the room under a book is the text card's `margin-bottom`, `BibleBookReader.tsx` `fitRoom`; a spacer below the row and the row's `padding-bottom` both pushed the minimap 326 px up, live 2026-10-15).

## Overflowing on phones

- Page action bars ("View plan" + "Preach"): `flex flex-wrap` on the container and `w-full sm:w-auto` on the children (`SermonHeader.tsx`). `flex gap-2` alone overflows narrow phones such as the iPhone SE. Tab rows in page flow the same: wrap with `gap`, not `flex-nowrap` + horizontal scroll.
- The primary nav inside a fixed-height header never wraps: items `shrink-0` + `whitespace-nowrap`, primary destinations kept apart from secondary actions, `aria-label` when labels collapse to icons (`DashboardNav.tsx` switches to icon-only by measurement, with a hidden-scrollbar horizontal scroll as the fallback).
- A wide table: `table-fixed` + a percentage `<colgroup>` for the desktop rhythm, a readable minimum width (`min-w-[64rem]`) so dates, badges and gauges survive, inside an `overflow-auto` wrapper (users table in `frontend/app/(pages)/(private)/admin/page.tsx`).
- A 1 px seam between pieces moved by percentage transforms on phones → overlap them by 1 px with `calc(…)`, or move in whole pixels (`ModeToggle` slides its indicator by a measured `px` offset).
- A light line between highlighted rows, or notched edges where they meet → a background plus a `box-shadow` ring meet at the row's edge, which stands on a fractional pixel, and the two edges, smoothed separately, do not cover it together; each row's own `rounded-*` notches the block. Draw the highlight as one layer under the text (`before:absolute before:-inset-1.5 before:-z-10` on a `relative` row, the container `isolate` so the layer stays above its background) and round only the block's first and last row by their lit neighbours (`[[data-arrival]+&]:before:rounded-t-none`, `[&:has(+[data-arrival])]:before:rounded-b-none`) — `ARRIVAL_CLASSES` in `BibleBookReader.tsx`.

## Why

- 2026-02-01: percentage transforms left subpixel gaps on phones; mobile tabs overflowed until they wrapped.
- 2026-02-27: a header's `overflow-hidden` cut 4 px off the `FocusRecorderButton` pause/cancel buttons.
- 2026-03-16: the sermon action bar scrolled sideways on an iPhone SE.
- 2026-04-25: hover rails that changed row geometry put the pointer into a jitter loop.
- 2026-10-04: hovering a plan point showed edit and move on every thought of the point: the thought card and the point card were both unnamed `group`.
- 2026-05-01: the recorder timer truncated mid-recording; the desktop nav wrapped inside its fixed-height header.
- 2026-07-13: the admin users table sprawled unevenly on wide screens and crushed its badges on narrow ones.

See also: `.howto/show-a-tooltip.md` · `.howto/lay-out-cards-and-rows.md`
