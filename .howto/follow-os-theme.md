when: theme does not follow OS after wake · prefers-color-scheme late · dark mode does not switch with the system · theme stuck until reload · theme wrong after laptop sleep · tab refocus theme · matchMedia change listener · ThemeWatcher · useThemePreference · ThemeModeToggle · theme-preference localStorage · flash of wrong theme · dark class on html · WAKE_RETRY_DELAYS · visibilitychange · тёмная тема · светлая тема · тема не следует за системой · тема не переключается после сна · системная тема · мигание не той темы · ночной режим

# Follow the OS theme

The theme is applied in three places with one rule — `dark` when the stored preference is `dark`, or `system` and the OS prefers dark: the inline `themeInitScript` in `frontend/app/layout.tsx` (before hydration), the always-mounted `ThemeWatcher` in `frontend/app/components/ThemeWatcher.tsx` (live), and `useThemePreference` in `frontend/app/hooks/useThemePreference.ts` (when the person changes the toggle). OS-following logic belongs in `ThemeWatcher`, nowhere else.

## How

- The switch is the `dark` class on `<html>` (Tailwind `darkMode: "class"`, `frontend/tailwind.config.ts`). The preference lives in `localStorage` under `theme-preference`: `light` · `dark` · `system` (default).
- `themeInitScript` runs synchronously in `<head>` before React, so the first paint has the right theme (no flash). It runs once per full page load only.
- `ThemeWatcher` is rendered at the app root in `frontend/app/layout.tsx`. It re-applies on mount, on `matchMedia('(prefers-color-scheme: dark)')` `change` (with the legacy `addListener` fallback), and on device wake — `visibilitychange` to visible or window `focus`.
- It reads the preference fresh from `localStorage` on every apply, never from cached React state, so it always honours the latest toggle choice and never fights it.
- On wake, one delayed check is not enough: after sleep or refocus, macOS/Chrome can take 50–500ms+ to pass the OS theme change to `matchMedia`. Schedule progressive retries `WAKE_RETRY_DELAYS = [50, 300, 1000]`; each retry simply re-applies (`classList.toggle` is idempotent), so a late arrival is caught by the next one.
- `useThemePreference` owns only the preference for the toggle UI: read, persist, apply on change. It is mounted only inside `ThemeModeToggle`; do not put the live OS listener there.
- Tests: `frontend/__tests__/components/ThemeWatcher.test.tsx` covers live change, wake retries, focus, the legacy API and cleanup.

## Why

- 2026-03-19: a single `setTimeout(50)` after wake missed the OS→browser propagation window; progressive retries at 50/300/1000ms catch it.
- 2026-06-26: the `change` listener lived in `useThemePreference`, mounted only while the profile dropdown or mobile menu was open, so in normal use the app did not follow the OS until a reload. It moved to the always-mounted `ThemeWatcher`.

See also: `.howto/detect-viewport-safely.md`
