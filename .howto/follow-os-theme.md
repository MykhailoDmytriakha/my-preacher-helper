when: theme does not follow OS after wake · prefers-color-scheme late · dark mode does not switch with the system · theme stuck until reload · theme wrong after laptop sleep · tab refocus theme · matchMedia change listener · ThemeWatcher · useThemePreference · ThemeModeToggle · theme-preference localStorage · flash of wrong theme · dark class on html · WAKE_RETRY_DELAYS · visibilitychange · тёмная тема · светлая тема · тема не следует за системой · тема не переключается после сна · системная тема · мигание не той темы · ночной режим

# Follow the OS theme

The inline `themeInitScript` in `frontend/app/layout.tsx` applies the preference before hydration. After that, `frontend/app/utils/themePreference.ts` uses the shared `deviceChoice` as the current document’s choice and applies it to the root. `ThemeWatcher` owns the live OS listener, and every toggle uses the same choice.

## How

- The switch is the `dark` class on `<html>` (Tailwind `darkMode: "class"`, `frontend/tailwind.config.ts`). The dated preference lives under `theme-preference-v2`. The first-paint script can still read a prior `theme-preference` string (`light`, `dark`, or `system`) when no dated value exists. A confirmed save also mirrors the string for a tab still on the old bundle.
- `themeInitScript` runs synchronously in `<head>` before React, so the first paint has the right theme (no flash). It runs once per full page load only.
- `ThemeWatcher` is rendered at the app root in `frontend/app/layout.tsx`. It re-applies on mount, on `matchMedia('(prefers-color-scheme: dark)')` `change` (with the legacy `addListener` fallback), and on device wake — `visibilitychange` to visible or window `focus`.
- On wake or OS changes, the watcher uses the choice already held in memory and samples the OS colour scheme again. A newer dated storage event updates the choice in other tabs. At hydration the first-paint record is compared with the record then stored so that a late script neither misses a new choice nor replaces a newer first paint with an old read.
- On wake, one delayed check is not enough: after sleep or refocus, macOS/Chrome can take 50–500ms+ to pass the OS theme change to `matchMedia`. Schedule progressive retries `WAKE_RETRY_DELAYS = [50, 300, 1000]`; each retry simply re-applies (`classList.toggle` is idempotent), so a late arrival is caught by the next one.
- `useThemePreference` displays the current document preference. An explicit click updates the root and saves through the shared device choice. Opening the menu does not write a preference. An old bundle’s undated write cannot replace a dated choice in the new bundle. A browser-wide storage clear takes effect on the next document, since it carries no order relative to choices already made in this one.
- Tests: `frontend/__tests__/components/ThemeWatcher.test.tsx` covers live change, wake retries, focus, the legacy API and cleanup.

## Why

- 2026-03-19: a single `setTimeout(50)` after wake missed the OS→browser propagation window; progressive retries at 50/300/1000ms catch it.
- 2026-06-26: the `change` listener lived in `useThemePreference`, mounted only while the profile dropdown or mobile menu was open, so in normal use the app did not follow the OS until a reload. It moved to the always-mounted `ThemeWatcher`.

See also: `.howto/detect-viewport-safely.md`
