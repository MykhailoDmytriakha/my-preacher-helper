when: scrollbar · style a scrollbar · scrollbar light in dark mode · thick grey scrollbar · scrollbar-thin does nothing · scrollbar-thumb class · tailwind-scrollbar plugin · color-scheme · native select popup colours · date picker light in dark mode · form controls light in dark theme · hide scrollbar · scrollbar-hide · ::-webkit-scrollbar · search input clear button twice · полоса прокрутки · скроллбар · скроллбар светлый в тёмной теме · толстый серый скроллбар · скрыть прокрутку · выбор даты светлый в тёмной теме · два крестика в поиске

# Style a scrollbar or a native control

Don't style it per element. `frontend/app/globals.css` declares `color-scheme` on `:root` (light) and on `:root.dark` plus the system-dark branch (dark) — that is what makes the browser draw scrollbars, form controls and select popups in the theme — and one inherited `scrollbar-color` plus `scrollbar-width: thin` that cover every scroll container in the app.

## How

- The thumb colour is the variable `--scrollbar-thumb` (and `--scrollbar-thumb-hover`), set per theme next to `--background`. Change the look there, once.
- `scrollbar-color` is inherited, so it is declared on `html`; `scrollbar-width` is not, so it is declared on `*`.
- WebKit older than Safari 18.2 gets `::-webkit-scrollbar` rules inside `@supports not (scrollbar-width: thin)`; modern engines skip that branch.
- There is no `tailwind-scrollbar` plugin (`plugins: [typography]` in `frontend/tailwind.config.ts`): `scrollbar-thin` and `scrollbar-thumb-*` classes generate nothing. Don't add them.
- No bar at all: the class `.scrollbar-hide` (`frontend/app/time-picker.css`), or arbitrary properties `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` as the primary nav does (`DashboardNav.tsx`).
- The browser's own clear button in `input[type="search"]` is hidden globally in `globals.css`, so it never doubles a custom clear control.
- A new theme mode must set `color-scheme` as well, or every native widget falls back to light.

## Why

- 2026-09-05: a thick light-grey scrollbar sat across the dark study side panel. Three calendar components carried `scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700`, which looked like a fix but were never generated, and `color-scheme` was declared nowhere, so the browser drew every native widget light. One global rule covered all 67 scroll containers without touching any of them — measured live, a 16 px light bar became a 12 px themed one. When the browser draws the widget, the fix is a declaration about the page; a class from an uninstalled plugin looks exactly like a working one until you read the plugin list.

See also: `.howto/pick-a-colour.md`
