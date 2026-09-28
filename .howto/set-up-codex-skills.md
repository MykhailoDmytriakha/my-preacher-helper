when: Codex skill not available · Codex skill not callable · skill in curated catalog but not usable · install a Codex skill · skill-installer · ~/.codex/skills · ~/.codex/config.toml · playwright-interactive · js_repl · codex features list · browser QA in Codex · playwright in package.json · скилл Codex · установить скилл · скилл недоступен · настройка Codex · проверка в браузере через Codex

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
