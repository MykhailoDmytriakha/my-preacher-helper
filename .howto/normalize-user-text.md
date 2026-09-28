when: capitalize title · first letter uppercase after quote · capitalize first letter · title starts with a quote stays lowercase · uppercase first character · outline point title case · capitalizeFirstLetter · normalizeCapitalizedTitle · textNormalization · \p{L} · Unicode letter · Cyrillic title capitalization · charAt(0).toUpperCase · заглавная буква · первая буква заглавной · заголовок начинается с кавычки · регистр заголовка · нормализация текста · кириллица с большой буквы

# Capitalize a user-entered title

Use the helpers in `frontend/app/utils/textNormalization.ts`: `capitalizeFirstLetter` while the person types, `normalizeCapitalizedTitle` when the title is saved. They uppercase the first Unicode letter, not the first character, so a title that opens with a quote, dash or number still gets its capital.

## How

- Target the first letter: skip leading quotes, dashes, digits, emoji and punctuation, then uppercase the first match of `/\p{L}/u`. `"ahead` becomes `"Ahead`, `— stay awake` becomes `— Stay awake`, `123 problem` becomes `123 Problem`. The `u` flag is required for `\p{L}`; `toLocaleUpperCase()` does the change.
- Blank text, text without letters, and text already capitalized come back unchanged.
- In `onChange`, call `capitalizeFirstLetter(e.target.value)` — it does not trim, so leading spaces the person typed stay put.
- On save, call `normalizeCapitalizedTitle(text)` — capitalize, then `trim()`. Outline points and sub-points use this pair everywhere: `frontend/app/components/column/useColumnOutlineState.ts`, `frontend/app/components/column/OutlinePointCard.tsx`, `frontend/app/components/column/SubPointList.tsx`, `frontend/app/components/plan-editor/OutlineBoard.tsx`, `frontend/app/components/sermon/SermonOutline.tsx`, `frontend/app/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus.ts`.
- Do not write `text.charAt(0).toUpperCase() + text.slice(1)` for user text: it capitalizes the quote and leaves the word lowercase. That form is fine only for fixed values whose first character is known to be a letter (voice ids, feedback type names, `formatMonthTitle` in `frontend/app/utils/appLocale.ts`).
- Tests: `frontend/app/utils/__tests__/textNormalization.test.ts` — quotes, guillemets, a dash, digits, blank values, trim.

## Why

- 2026-05-30: when auto-capitalization was added to outline points, uppercasing the first non-whitespace character would have hit the opening quote of titles like a Cyrillic word after `"` and left the word lowercase; the helper targets the first `\p{L}` instead.
