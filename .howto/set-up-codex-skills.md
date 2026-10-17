when: playwright-cli attach ENOENT · npx ENOTCACHED · lost browser session · cached CLI · Codex skill not available · Codex skill not callable · skill in curated catalog but not usable · install a Codex skill · skill-installer · ~/.codex/skills · ~/.codex/config.toml · playwright-interactive · js_repl · codex features list · browser QA in Codex · playwright in package.json · скилл Codex · установить скилл · скилл недоступен · настройка Codex · проверка в браузере через Codex

# Set up a Codex skill

A Codex skill is usable only after it is installed into `~/.codex/skills` and a new Codex session has started; being listed in the curated catalog is not enough. Install it with the built-in `skill-installer` skill (`~/.codex/skills/.system/skill-installer`). This is machine setup: nothing goes into the repository.

## How

- List or install from the curated catalog (openai/skills, `.curated`) through `skill-installer`, then start a fresh Codex session so its tool list is rebuilt.
- Keep global Codex readiness apart from repository changes. Skills live in `~/.codex/skills`, feature flags in `[features]` of `~/.codex/config.toml`. Do not add `playwright` to `frontend/package.json` unless the next session really needs the interactive skill's local import path; neither package.json has it today.
- Browser QA from Codex: the `playwright` skill drives `playwright-cli` through its own wrapper script via `npx`, so the app needs no dependency.
- `playwright-interactive` runs inside a persistent `js_repl` session. It needs `js_repl = true` under `[features]` (or `--enable js_repl`), a fresh session, and `npm install playwright` in the workspace it debugs. Check before trying: `codex features list`.

## Traps

- On codex-cli 0.156.1, `codex features list` reports `js_repl` as `removed`, and its effective state stays `false` even with `-c features.js_repl=true` or `--enable js_repl`. With that CLI `playwright-interactive` cannot become callable; use the `playwright` skill.

## Why

- 2026-03-05: a skill present in the curated catalog was not callable in the session: it was not installed, and `playwright-interactive` additionally needed `js_repl` plus a new session.

## Recover a lost CLI browser during acceptance

- First distinguish a lost test harness from a product failure. A missing named session or `attach` returning `ENOENT` proves no browser result; retain that output and leave the app verdict pending. Do not close unrelated browsers or delete their profiles.
- If the wrapper stalls resolving npm metadata, `NPM_CONFIG_OFFLINE=true` can diagnose cache availability; `ENOTCACHED` is a package-resolution failure, not an app failure. Locate an already installed CLI with `rg --files "$HOME/.npm/_npx" | rg '/@playwright/cli/playwright-cli\.js$'`, then read its `--version` and `--help` before running it directly with Node. No app dependency is needed.
- Open a newly named headed session through that cached entrypoint (`node <cached-entrypoint> -s=<new-session> open <local-url> --headed`). Keep its owning PTY alive and record both the CLI session name and exec session ID; they are different identifiers. In the October17 acceptance, cached CLI0.1.22 was used from a persistent PTY after the older daemon was absent. This does not establish why the older daemon disappeared.
- Inspect the actual sign-in screen and use only the already authorized existing test-user control (CLAUDE.md). Never substitute guest creation or print credentials. Authentication copied between disposable contexts stays in memory without a storage-state export; ordinary root-browser sign-in can still persist through the app's browserLocalPersistence.
- Replay the original frozen scripts with assertions/data/timing/build unchanged; only fresh capture prefixes and the runner's CLI entrypoint/session change. Preserve the old failures, collect new results and native captures, verify cleanup, and visually inspect them before accepting. Do not count old screenshots as fresh reruns.
- Keep one browser owner at a time. Return the lease explicitly; close only the task-owned browser and its owning PTY when all dependent checks finish.
