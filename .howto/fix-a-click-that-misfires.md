when: click fires twice · click does nothing · click opens the wrong thing · click on a child triggers the parent · button inside label · button inside link · button inside button · nested interactive elements · event propagation · stopPropagation · chip inside a clickable card · Enter on inner button selects the row · removable chip ✕ opens editor · click on an icon over a control does nothing · клик срабатывает дважды · клик не работает · клик открывает не то · клик по дочернему срабатывает на родителе · кнопка внутри ссылки · вложенные кнопки · всплытие события · крестик на чипе открывает редактор

# Fix a click that misfires

Almost always an interactive element nested inside another one — a button or link inside a `<label>`, inside another button, or inside a clickable card or row. Un-nest it; where a clickable container really must hold its own controls, the inner control stops its event from reaching the container.

## How

- Never put a button or link inside a `<label>` — it breaks event propagation. Make them siblings and tie the label to its field with `htmlFor` / `id`.
- Never put a button inside a button or a link: browsers do not render that nesting. When the outer thing must be activatable and hold a real button (a removable chip with its ✕), the outer element is a `<span role="button" tabIndex={0}>` with its own Enter/Space handling, and only the inner control is a `<button>` (`frontend/app/components/ui/Chip.tsx`).
- A clickable row or card with its own buttons (drag handle, status dot, menu): each inner handler calls `event.stopPropagation()`, and also `event.preventDefault()` when it sits inside a link (`frontend/app/components/groups/FlowItemRow.tsx`: the row is `role="button"`, its handle, status dot and menu stop their clicks). Better still, keep the extra controls outside the link, as `GroupCard.tsx` places its menu beside the card's `Link`. `Chip`'s `onClick` receives the event for exactly this.
- Keys too: a key pressed on an inner control belongs to it. The outer key handler returns when `event.target !== event.currentTarget` (as in `Chip`); otherwise it calls `preventDefault()` on Enter, and Enter on the inner button runs the outer action instead.
- A panel that lives inside its trigger's element (tooltip, popover) receives bubbled clicks as clicks on the trigger: check `panelRef.current.contains(event.target)` first (`frontend/app/components/ui/Tooltip.tsx`).
- A click on a decorative icon laid over a control "does nothing": the icon must be `pointer-events-none` so the click falls through (the chevron in `Select`, the thumb in `Switch`).

## Why

- 2026-02-16: a button nested in a `<label>` broke event propagation.
- A removable chip carries a real `<button>`, so the chip itself cannot be one; without the target check, Enter on the ✕ opened the editor instead of removing (comments in `Chip.tsx`).
- Reaching for a link inside an unpinned tooltip bubbled up and pinned it over the page the link had just opened (comment in `Tooltip.tsx`).

See also: `.howto/show-a-tooltip.md` · `.howto/draw-a-chip.md` · `.howto/ask-are-you-sure.md`
