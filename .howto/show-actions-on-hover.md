when: edit and delete on every row · show buttons on hover · reveal on hover · hover-only actions · actions clutter the list · pencil and trash on each card · group header buttons · hidden button still clickable · buttons hidden on iPad · hover on touch screen · opacity-0 group-hover · HoverActions.module.css · PlanRowActions · кнопки при наведении · показывать только при наведении · изменить и удалить у каждой строки · карандаш и корзина засоряют · кнопки не видны на iPad · спрятанная кнопка нажимается

# Show an item's actions on hover

The owner's rule (2026-11-26): the edit and delete that belong to one item of a list — a row, a card, a group's header — are invisible with a mouse until the pointer is over that item or keyboard focus enters them. On touch they stay in sight: there is nothing to hover with. The open page's own actions (its «Изменить», «Удалить» in the header) are one per screen, not a repeat, and stay.

## How

- `import hoverActions from '@/components/ui/HoverActions.module.css'`. Put `hoverActions.row` on the item whose hover reveals and `hoverActions.actions` on the wrapper of its buttons. The module hides only under `(hover: hover) and (pointer: fine)`, and a hidden action takes no press (`pointer-events: none`).
- The host is the item the actions belong to. For a section of a page — a theme's bases, each group — it is the whole section, heading and all below it: the owner chose it (2026-11-26, «эти кнопки появляются при наведении на секцию») over the header line alone. There the section's other actions wait too («+», «Переставить», «+ Основание»), while a mode's way out («Готово») stays in sight (`care/questions/[themeId]/page.tsx`).
- Hide with opacity only; the buttons keep their place, so the row does not shift or flicker when they appear (`.howto/fix-clipped-or-misaligned-layout.md`).
- The rule is `:where(...)`, zero specificity: a screen keeps a narrow width's controls in sight with an ordinary utility (`max-lg:opacity-100 max-lg:pointer-events-auto`, `OutlineBoard.tsx`).
- An explicit mode («Переставить», an edit form) shows its controls plainly: don't wrap those in `actions`.
- Don't write `opacity-0 group-hover:opacity-100` by hand: without the media guard it hides the buttons on an iPad too, and a width breakpoint (`sm:opacity-0`) does the same — the owner's iPad is 1200 wide with touch (`project_owner_ipad_wider_than_lg` in memory).

## Check

In a browser, not jsdom (CSS modules are an identity proxy in Jest): with a mouse — at rest the product of opacities up the tree is 0 and `pointer-events` is `none`; over the item 1; `.focus()` on a button 1; over a neighbouring item still 0. With Playwright `isMobile + hasTouch` at 1200×1568 — 1 and pressable. Example: `.cases/2026-11-25-slozhnye-voprosy-koncepciya/stand/walk7.cjs`.

## Why

- 2026-11-26: the pencil and trash on every group header of «Сложные вопросы» crowded the page. A sweep found the same pair always in sight in about fifteen places, six places hiding it on touch as well, and seven ways of writing the reveal (`BUG-20261126-item-edit-delete-always-visible` in `BUGS.md`). The plan editor's `PlanRowActions.module.css` was the complete one, so it moved to `components/ui/HoverActions.module.css` for everyone.

See also: `.howto/fix-clipped-or-misaligned-layout.md` · `.howto/lay-out-cards-and-rows.md`
