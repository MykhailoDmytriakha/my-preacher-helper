when: chip · tag · pill · badge label · small label · status word · filter chip · Scripture reference chip · removable tag with ✕ · Chip component · buildChipClasses · CHIP_TONES · getTagStyle · tone="custom" · series badge colour · hand-picked tag colour · font-bold ignored on chip · rounded-full pill · чип · тег · метка · бейдж · таблетка · ссылка на Писание чипом · удаляемый тег с крестиком · цвет тега · статус словом

# Draw a chip

A small label — a tag, a Scripture reference, a status word, a filter — is `<Chip>` from `frontend/app/components/ui/Chip.tsx`. Its colour comes from `CHIP_TONES` in `frontend/app/utils/themeColors.ts`, its shape from `buildChipClasses` in `frontend/app/utils/chipClasses.ts`. Never hand-write a `rounded-full px-2 …` pill.

## How

- `tone`: `emerald`, `blue`, `violet`, `amber`, `rose`, `cyan`, `indigo`, `neutral` (default) or `custom` — use the section's colour.
- `size`: `md` is the app's chip (default); `sm` for dense rows inside a card (tags on a thought card); `xs` for micro labels (a calendar row's PREACHED / PLANNED, the Beta flag beside a nav item).
- `weight="bold"` and `selected` are props. Don't pass `font-bold` in `className`: Tailwind writes `.font-medium` after `.font-bold` in its stylesheet, so the caller's class loses without a warning.
- `onClick` makes the chip keyboard-operable (`role="button"`, Enter and Space, `aria-pressed`) and hands over the event, so a chip inside a link or a clickable row can call `stopPropagation()`. `onRemove` adds a trailing ✕ as its own button that never fires `onClick`; give it `removeLabel` ("Remove …", translated). `ariaLabel` names a chip whose visible text is an abbreviation; `icon` is a leading glyph.
- Hand-picked colours (tags the preacher coloured, series badges): `tone="custom"` + `style={{ backgroundColor, color: getContrastColor(backgroundColor) }}`. `custom` adds no plate of its own, only hover / selected / remove states; any other tone paints over the inline style.
- `buildChipClasses({ tone, size, weight, selected, interactive })` is only for code that cannot render a component — a pure helper returning classes, like `getTagStyle` in `frontend/app/utils/tagUtils.ts`. The string carries no ✕, no keyboard contract and no accessible name; use `<Chip>` everywhere else.

## Why

- 2026-09-07: about 130 hand-written pills in eight sizes; the Scripture reference and the tag right under it in the same column read as two unrelated controls. One component now owns the shape and `CHIP_TONES` the colour, so a change reaches every chip.
- Eight calendar and navigation labels rendered at weight 500 while their source said `font-bold` — why weight became a prop.

See also: `.howto/pick-a-colour.md` · `.howto/fix-a-click-that-misfires.md`
