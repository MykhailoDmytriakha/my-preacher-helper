when: card layout · grid of cards · push card footer to the bottom · footers not aligned across cards · equal-width buttons · buttons of different widths · grid columns · metadata column · truncate several lines · line-clamp · truncate cuts to one line · interleave cards on mobile · side-by-side pairs · paired cards equal height · card content overflows fixed height · usePairedPlanCardHeights · window.innerWidth hydration mismatch · desktop and mobile copies of a control · split button · two buttons look like one · splitLeft · tabs wrap or scroll · сетка карточек · карточки · подвал карточки внизу · кнопки разной ширины · обрезать несколько строк · пары карточек одной высоты · составная кнопка · раскладка на телефоне · колонки

# Lay out cards and rows

Cards, rows and pairs follow a few fixed recipes: flex columns for card footers, CSS grid for rows and pairs, and one DOM instance per control. Phone overflow and hover jitter are in `.howto/fix-clipped-or-misaligned-layout.md`.

## How

- Footer at the bottom of every card in a grid: the card is `flex flex-col h-full`, the main content `flex-1` / `flex-grow`, the footer `mt-auto` (`frontend/app/components/dashboard/SermonCard.tsx`, `frontend/app/components/groups/GroupCard.tsx`).
- Equal-width buttons with labels of different lengths: `ACTION_BUTTON_SLOT_CLASS` (`flex-1 basis-0 min-w-[64px]`) on each slot, from `frontend/app/components/common/ActionButton.tsx`.
- Rows of metadata plus text: a CSS grid with fixed tracks for the metadata and one `1fr` for the flexible text — the dashboard rows use `grid-cols-[70px_1fr_auto_18px]` and similar (`frontend/app/(pages)/(private)/dashboard/page.tsx`).
- Truncate to several lines: `line-clamp-2` / `line-clamp-3` + `break-words`, and `min-w-0` / `flex-1` on the flex child so it may shrink. `truncate` is single-line only.
- Pairs side by side on desktop and interleaved on a phone (card A, editor A, card B, editor B): one grid `grid-cols-1 lg:grid-cols-2`, each pair as adjacent children in a `React.Fragment`, never two column `div`s. The grid interleaves on its own, `h-full` wrappers stretch each row's pair, and no `window.innerWidth` check is needed (that check caused hydration mismatches). See `frontend/app/(pages)/(private)/sermons/[id]/plan/PlanMainLayout.tsx`.
- Equal card heights inside those pairs when content renders late (generated markdown): `usePairedPlanCardHeights` (`frontend/app/(pages)/(private)/sermons/[id]/plan/usePairedPlanCardHeights.ts`). One hook owns ref registration, the 200 ms resize debounce, and pair and whole-section sync. It sets `min-height` and leaves `height: auto`, so content that arrives later grows the card instead of spilling out; its desktop guard `(min-width: 1024px)` runs in both sync paths and keeps phones at `height: auto`. Re-sync a pair when its content or edit mode changes.
- A control needed on desktop and phone: one responsive instance, not a hidden desktop copy plus a hidden mobile copy. `ModeToggle` is mounted once in `DashboardNav` and switches between a segmented bar and a compact `Listbox` by measured width. Duplicates make tests ambiguous and let focus and accessibility drift apart.
- Split button (two actions that read as one control): the component that owns the state renders both parts in one DOM tree and takes the extra part as a slot prop — `SplitRecordButton` with `splitLeft` / `splitRight` in `frontend/app/components/audio-recorder/AudioRecorderControls.tsx`. Never fake unity by wrapping two independent components in a parent with `overflow-hidden` and a shared border radius.

## Why

- 2026-02-24: a split button faked by a CSS wrapper — the true fix was one component rendering both parts through `splitLeft`.
- 2026-02-27: equal-height logic was spread over components; moving it into one hook with guards in both sync paths kept phones at natural height.
- 2026-03-15: JS width checks for mobile interleaving caused hydration bugs; the flat grid removed them.
- 2026-04-26: fixed inline pair heights went stale after generated markdown rendered, and long right-hand content overflowed its card.
- 2026-07-04: separate hidden desktop and mobile copies of the sermon mode toggle.

See also: `.howto/fix-clipped-or-misaligned-layout.md`
