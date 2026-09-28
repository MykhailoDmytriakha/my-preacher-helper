when: Can't resolve 'fs' · Module not found: Can't resolve 'path' · Node builtin in browser bundle · instrumentation.ts · register() in instrumentation · fs imported by a module the browser reaches · server-only helper breaks client build · eval('require') · loadNodeBuiltins · серверный код в браузере · бандл браузера · модуль fs в клиенте · сборка клиента падает · только для сервера · ленивый импорт

# Keep server-only code out of the browser bundle

A module the browser build can reach must not import Node builtins (`fs`, `path`, ...) at its top level. Load them lazily inside the server-only branch, the way `frontend/app/utils/serverOutputLogger.ts` does for `frontend/instrumentation.ts`.

## How

- `frontend/instrumentation.ts` imports the logger statically, and `register()` returns early when `typeof window !== 'undefined'`. That runtime guard does not keep imports out of a bundle: in the 2026-04-25 failure `instrumentation.ts` was pulled into the Next dev browser overlay, so treat its whole import graph as browser code.
- In the logger, `fs` and `path` appear at top level only as types (`typeof import('fs')`, erased at compile time). The real modules come from `loadNodeBuiltins()` (`eval('require')`), called inside `installServerOutputLogger` only when file logging is on; tests inject `fileSystem` and `pathModule` instead.
- For any other helper a browser file can reach: move the `fs` / `path` use into the function that runs on the server, or into a module that only route handlers import.

## Why

- 2026-04-25: a server-only helper that imported `fs` / `path` at top level, reached through `instrumentation.ts`, failed the browser build with `Can't resolve 'fs'`.

See also: `.howto/fix-stuck-dev-server.md`
