when: Rendered more hooks than during the previous render · Rendered fewer hooks than expected. This may be caused by an accidental early return statement · React has detected a change in the order of Hooks · early return before hooks · conditional hook · hook inside if · loading skeleton return · react-hooks/rules-of-hooks · rules of hooks · helper that calls a hook · порядок хуков · ранний return до хуков · хук внутри условия · правила хуков · больше хуков чем в прошлом рендере · скелетон загрузки

# Fix hook order errors

React matches hooks by call order, so every render of a component must call the same hooks in the same order. Declare all hooks first, then put every early return — loading skeleton, error, not found — after the last hook.

## How

- Rules of Hooks are absolute: no hook inside `if`, a loop, a callback, or after a `return`.
- All early returns go after ALL hook definitions. The sermon page is the pattern: its hooks run to the end, then `if (loading || awaitingFirstAnswer)` returns the skeleton and the not-found branch follows (`frontend/app/(pages)/(private)/sermons/[id]/page.tsx`).
- Need a hook only in one branch? Move the branch into its own component and render that component conditionally; the child owns its hooks.
- A function that calls a hook is a hook: give it the `use` prefix. A helper without the `use` prefix hides the hook call from the linter, and that is how conditional hook order gets introduced later (`useSettingRecovery` in `frontend/app/hooks/useUserSettings.ts`).
- `react-hooks/rules-of-hooks` is an error through `next/core-web-vitals` in `frontend/eslint.config.mjs` — run eslint; it catches most of these before the browser does.

## When it goes wrong

- "Rendered more hooks than during the previous render" → the first render returned early (still loading) and the next one reached hooks below that return. Move the return below the hooks.
- "Rendered fewer hooks than expected" → the opposite: a later render returned early and skipped hooks the first render called.
- "React has detected a change in the order of Hooks" (dev warning) → a hook call is conditional; the table in the message shows the first slot that differs.

## Why

- 2026-01-31: the sermon page's conditional returns (skeleton before "Not Found") violated the Rules of Hooks; the fix was to place the skeleton return after all hooks (`.sessions/SESSION_2026-01-31-dashboard-persistence-and-loading-fix.md`).

See also: `.howto/fix-effect-dependencies.md`
