when: dev server burns CPU · next dev at 100% CPU · EPIPE · write EPIPE · old next dev process · two dev servers · where are the dev server logs · .local-logs · server.log · serverOutputLogger · installServerOutputLogger · LOCAL_SERVER_FILE_LOGS · Cannot find module './5611.js' · Cannot find module after next build · dev server broken after build · дев-сервер грузит процессор · локальный сервер завис · где логи сервера · два дев-сервера · сервер сломался после сборки · старый процесс

# Fix a stuck local dev server

A dev server that burns a CPU core, or answers `Cannot find module './5611.js'`, is usually an old process or a production build written into its `.next`. Find the process's own log under `frontend/.local-logs/sessions/`, stop stale `next dev` processes, and never run a production build into the folder a running `next dev` uses.

## How

- Every `next dev` start writes its own file: `frontend/.local-logs/sessions/server-<UTC stamp>-pid-<pid>-port-<port>.log`. It opens with `[session]` lines (started, `pid`, `configured port`, `cwd`) and adds `detected local URL: ... (port N)` when Next prints `Local: ...`. Match a process to its log by pid.
- The writer is `installServerOutputLogger` in `frontend/app/utils/serverOutputLogger.ts`, installed by `frontend/instrumentation.ts`. It mirrors in development only (never production or edge); `LOCAL_SERVER_FILE_LOGS=false` turns it off, `LOCAL_SERVER_LOG_DIR` / `LOCAL_SERVER_LOG_FILE` redirect it.
- Find stale servers with `ps aux | grep "next dev"`. Stop only the ones you started: a parallel session may own a server on the same repository.
- A logger that patches `process.stdout.write` / `stderr.write` must swallow broken-pipe failures on BOTH writes, the file append and the call to the original stream. A closed terminal or pipe throws `EPIPE`, and an uncaught-exception loop leaves the old Next server burning a full core. Today `createPatchedWrite` guards only the file append; `originalWrite.call(...)` is unguarded.
- `npm run build`, `npm run preview:pwa` and a bare `next build` all write `frontend/.next`, the folder `next dev` serves from. Stop dev first, or run the production build gate in an isolated copy of the tracked files (`git ls-files`) with `node_modules` symlinked. In such a copy, import through aliases (`@locales/...`): a path like `@/../../frontend/locales/...` resolves only inside a folder named `frontend`.

## Why

- 2026-04-25: one shared `server.log` made repeated local starts impossible to tell apart, hence one file per start with pid and port.
- 2026-05-01: an `EPIPE` loop in a stdout mirror left an old Next server at 100% of a core.
- 2026-09-16: a production `next build` into the running dev server's `.next` left it answering `Cannot find module './5611.js'`.

See also: `.howto/set-up-the-service-worker.md` · `.howto/keep-server-code-out-of-browser-bundle.md`
