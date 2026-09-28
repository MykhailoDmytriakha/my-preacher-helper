when: colour · color · which colour · themeColors · hardcoded colour · category colour · section colour · getNavItemTheme · dynamic Tailwind class not applied · bg-${…} · dark:${…} · class built at runtime missing · Tailwind purge · safelist · dark: with inline style · tint by entity colour · series colour · Series.color · useSeries · rgba tint in dark mode · text unreadable on coloured panel · contrast on blue background · getContrastColor · цвет · выбрать цвет · цвет категории · цвет раздела · цвет серии · динамический класс не применяется · цвет в тёмной теме · текст не читается на цветном фоне · контраст

# Pick a colour

Colours come from `frontend/app/utils/themeColors.ts` — never a hard-coded one-off. Find the group of the feature you are in (`getNavItemTheme` for the section/category, `SERMON_SECTION_COLORS`, `CHIP_TONES`, `FORM_COLORS`, `UI_COLORS`, `CARE_CARD_TONES`, …); a new feature adds its own group there.

## How

- Write every class as a whole literal string, in a map keyed by the variant: `SECTION_TONE_CLASSES` in `frontend/app/(pages)/(private)/sermons/[id]/plan/constants.ts`, `CHIP_TONES`, the dashboard's `toneClasses`. Tailwind generates CSS only for class names it finds written out in the source, so `bg-${color}-50` or `dark:${token}` compiles to nothing.
- A class composed at runtime that you cannot avoid (older helpers such as `getSectionStyling` build `dark:${colors.darkBg}`) must be listed in `safelist` in `frontend/tailwind.config.ts`, as the header of `themeColors.ts` says. When you touch such a spot, prefer turning it into a literal map and assert those exact classes in a test.
- An entity that owns a colour (`Series.color`) carries it everywhere it is summarised — dashboard, cards, badges — and tests check it. The dashboard reads series through `useSeries` and paints the badge with the series colour plus `getContrastColor` from `frontend/app/utils/color.ts` (test id `series-color-…`).
- Tint by an arbitrary, user-picked colour: in light mode an inline `rgba(r, g, b, 0.07)` on the element; in dark mode an overlay `div` with `opacity-0 dark:opacity-100` carrying its own inline `rgba`, because `dark:` cannot reach an inline style. See `frontend/app/components/series/SeriesCard.tsx`.
- Text on a saturated coloured panel (the blue focus-mode sections) needs its own light palette — light-tinted text, visible bullets and drag handles, a subtle translucent backing. Neutral gray dark tokens read fine on slate cards and fail on vivid blue. See `getSubPointStyles` in `frontend/app/components/column/SubPointList.tsx`.
- Chips: `.howto/draw-a-chip.md`. Dropdown focus rings: `.howto/draw-a-dropdown.md`.

## Why

- 2026-02-24: `dark:` on a dynamic inline tint did nothing; the overlay div is the working form.
- 2026-02-27: section styles assembled from `dark:${token}` fragments lost their dark variants to Tailwind's purge.
- 2026-04-28: the dashboard hid series colours that the list and detail pages show, so a signal people rely on vanished from the overview.
- 2026-05-01: sub-points on the blue focus panel were unreadable in gray dark tokens.

See also: `.howto/draw-a-chip.md` · `.howto/draw-a-dropdown.md` · `.howto/style-scrollbar-and-native-controls.md`
