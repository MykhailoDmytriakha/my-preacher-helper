when: Maximum update depth exceeded · effect runs every render · exhaustive-deps warning · react-hooks/exhaustive-deps · infinite render loop · setState loop · useEffect dependency array · object or array in deps · data?.items ?? [] · new array every render · functional update · setState(prev => ...) · dependency signature string · page dies after an error or offline · бесконечный цикл рендера · эффект срабатывает на каждом рендере · зависимости эффекта · ререндер · зацикливание setState · предупреждение линтера о зависимостях · страница падает после ошибки

# Fix effect dependencies that loop or warn

An effect re-runs whenever a dependency changes identity, so a dependency that is a fresh object or array on every render re-runs it every render, and a `setState` inside turns that into "Maximum update depth exceeded". Make every dependency stable — a primitive value, a module-level constant, or a memoised value whose own inputs are stable — and read current state through a functional update instead of listing it.

## How

- Never put a computed object or array in the dependency list. Turn it into a value: a string key such as `.join(',')` (`navSignature` in `frontend/app/components/navigation/DashboardNav.tsx` joins the labels with `'|'`), or `useMemo` over stable inputs. `useMemo` only helps when its inputs are stable; if an input changes every render, the "memoised" array does too — key on the string instead.
- Empty fallbacks are the usual hidden source: `data?.x ?? []` mints a new array on every render while the query has no data (loading, error, offline). Use a module-level constant (`EMPTY_ITEMS`, `EMPTY_SERMONS` in `frontend/app/hooks/useSeriesDetail.ts`).
- To read state inside an effect or callback without adding it to the list (the fix `react-hooks/exhaustive-deps` asks for), use a functional update: `setState(prev => ...)`.
- Inside that update, return `prev` itself when nothing changed: React skips the re-render on an identical reference, so a churning input stops being a loop (`setOptimisticItems` in `frontend/app/(pages)/(private)/series/[id]/page.tsx` compares ids in order and returns `prev`).
- `react-hooks/exhaustive-deps` comes from `next/core-web-vitals` in `frontend/eslint.config.mjs` as a warning; fix the dependency, do not silence the warning.

## When it goes wrong

- "Maximum update depth exceeded" on the first paint → an effect keyed on an array rebuilt each render resets state, re-renders, runs again. Key it on the values (`navSignature`).
- A page works online and turns into a dead loop after a permission error or offline → a `?? []` fallback feeds an effect that sets state. Give the fallback a stable constant.

## Why

- 2026-01-11: `exhaustive-deps` wanted the state the effect read; the functional update removed the dependency instead of adding it.
- 2026-07-02: on the series page a transient permission error, or offline where the query is disabled, turned a recoverable error into a dead page through `?? []` feeding `setOptimisticItems`.
- 2026-09-10: the header's reset effect was keyed on the `navItems` array and looped on the first paint; keyed on `navSignature` it runs only when a label really changes.

See also: `.howto/sync-state-from-late-props.md` · `.howto/fix-hook-order-errors.md`
