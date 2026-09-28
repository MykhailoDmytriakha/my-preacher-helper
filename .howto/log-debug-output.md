when: console.log · debug output · add logging · debugLog · debugMode · isDebugModeEnabled · setDebugModeEnabled · Debug Mode toggle in settings · debugModeEnabled in localStorage · __DEBUG_MODE__ · extra console logging for troubleshooting · logging on the server · logs in an API route · отладка · отладочный вывод · логи · логирование · режим отладки · вывод в консоль · лог на сервере

# Log debug output

In browser code log with `debugLog(...)` from `@/utils/debugMode` (`frontend/app/utils/debugMode.ts`), never `console.log`. It prints `[debug] ...` only while the person has Debug Mode switched on in settings. Server code does not use `debugLog`: on the server it can never be on.

## How

- `debugLog` checks `isDebugModeEnabled()`: `window.__DEBUG_MODE__ === true` or `localStorage` key `debugModeEnabled` equal to `"true"`. With no `window` it returns false, so a `debugLog` in a route or in `app/utils/server/` prints nothing.
- The switch is `DebugModeToggle` (`frontend/app/components/settings/DebugModeToggle.tsx`) on the user settings page; it calls `setDebugModeEnabled`, which sets both the key and the window flag.
- Replace any client `console.log` you come across with `debugLog`. Nothing enforces it (the ESLint config has no `no-console` rule), and about 14 client files still call `console.log` directly, e.g. `frontend/app/components/FocusRecorderButton.tsx`.
- Server routes write with `console.log` / `console.error` and a bracketed prefix (`[TTS] ...` in the audio generate route). Locally that output also lands in `frontend/.local-logs/sessions/`.

## Why

- 2026-01-17: debug output was put behind a per-person toggle, so a normal console stays quiet and troubleshooting needs no new build.

See also: `.howto/fix-stuck-dev-server.md`
