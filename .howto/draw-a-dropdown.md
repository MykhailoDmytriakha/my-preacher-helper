when: dropdown · select · <Select> · native select · select arrow misaligned · select arrow far from its label · two filters different widths · appearance-none · chevron on select · select looks like a text input · filter dropdown · sort order dropdown · status field · buildSelectClasses · bg-gray-50 ignored on select · select width · выпадающий список · селект · фильтр · сортировка · стрелка не на месте · стрелка далеко от текста · фильтры разной ширины · выбор статуса

# Draw a dropdown

A dropdown — a filter, a sort order, a status field — is `<Select>` from `frontend/app/components/ui/Select.tsx`, with `<option>` children; every native `<select>` prop passes through.

## How

- It hides the browser's arrow (`appearance-none`) and draws one `ChevronIcon` at a fixed inset, with `pointer-events-none` so the click still lands on the select. The right padding (`pr-9` / `pr-11`) is the arrow's seat: change a size in `SELECT_SIZE_CLASSES` and change the matching inset in `SELECT_CHEVRON_CLASSES` (`frontend/app/utils/selectClasses.ts`), or the longest option runs under the arrow.
- `size`: `sm` (36 px, filter rows) or `md` (44 px, form fields; default).
- `tone`: `field` (default) or `muted` for a control on a panel that already has its own plate (the sermons and prayers filter popovers).
- `accent` is the focus ring in the section's colour: `emerald` studies, `blue` sermons and series, `rose` prayers; `amber` and `neutral` also exist.
- Size, tone and accent are props, never `className`. Tailwind settles two same-specificity rules by the order it wrote them into the stylesheet, not by their order in the attribute, so a caller's `bg-gray-50` loses to the module's `bg-white` silently.
- Width goes on `wrapperClassName` (`sm:w-52`, `flex-1`), never on the control. The browser sizes a native select to its longest option, so two filters side by side end up different widths with one arrow stranded far from its label.
- `buildSelectClasses(size, tone, accent)` is the same look as a string, for a place that must render its own `<select>`.
- Raw selects stay on purpose only in the admin page (`frontend/app/(pages)/(private)/admin/page.tsx`) and the data-engine dev panel (`frontend/app/data-engine/DataSyncStatus.tsx`).

## Why

- 2026-04-25: a native select next to other icon controls never lined up, because every browser draws its own arrow at its own offset; hiding it and drawing a controlled chevron fixed that — now built into `Select`.
- 2026-09-27: 26 `<select>`s in 16 files — 21 with the browser's arrow, 3 with `appearance-none` and no arrow at all (they read as text inputs), 2 hand-drawn. Two studies filters side by side had different widths.

See also: `.howto/pick-a-colour.md`
