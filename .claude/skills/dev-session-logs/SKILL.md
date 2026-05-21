---
name: dev-session-logs
description: >
  Use this skill in the my-preacher-helper repo when the user reports a bug or unexpected behavior in the frontend/backend and you need empirical evidence (not guesses) of what happened. Each `npm run dev` start creates a fresh `.logs/logs_<timestamp>/` folder with `frontend.log` and `backend.log` (JSONL). This skill is the discipline for: (1) finding the active session, (2) reproducing the bug while logs are running, (3) grepping for the smoking gun, (4) fixing, (5) re-reproducing and verifying the bug is gone in the new logs. Invoke proactively when the user says "странно", "не работает", "должно делать X", "почему", or otherwise asks you to debug behavior of code under `frontend/app/`. Do NOT invoke for pure code review, design discussions, or tasks where the user is not running the app.
---

# Dev session logs — debug→fix→verify loop

This repo writes per-`npm run dev` session logs to `.logs/logs_<timestamp>/`. The folder is recreated on every dev start by `frontend/scripts/init-dev-log-session.js` (predev hook). A pointer file `.logs/.current-session` always holds the absolute path of the active session, and `.logs/latest` is a symlink to it.

Both `frontend.log` and `backend.log` are **JSONL** — one JSON object per line — with this shape:

```json
{"ts":"2026-05-21T14:01:23.456Z","side":"frontend","scope":"studies/page","level":"log","message":"saveChanges: triggered","args":[{...}],"url":"/studies/abc123"}
```

Scopes you'll see in this codebase:
- `studies/page` — autosave entry/exit, dirty signature, save attempts/results
- `studies/node/tree` — `setRoot` from prop, lift-check decisions, `onChange` emissions
- `studies/node/reducer` — every reducer action with `childCountBefore/After` delta

Production is a no-op: client-side logger short-circuits when `NODE_ENV === 'production'`, server endpoint returns 404, server-side helper writes nothing. Nothing ships to prod.

## When NOT to invoke

- Pure code-review questions ("does this look right?")
- Design / planning discussions that don't yet have running code
- Backend-only changes where the user is not running `npm run dev`
- Performance tuning or refactors — different discipline

## The loop

Follow these steps in order. Skipping = guessing.

### 1. Locate the active session

```bash
SESSION=$(cat .logs/.current-session 2>/dev/null) && echo "$SESSION"
# fallback if pointer missing
ls -1dt .logs/logs_* | head -1
```

If `.logs/` doesn't exist or is empty, the user hasn't started `npm run dev` since the logging system was added. Ask them to start it and stop here — don't fabricate logs.

### 2. Confirm logs are flowing

```bash
wc -l "$SESSION/frontend.log" "$SESSION/backend.log"
tail -n 5 "$SESSION/frontend.log" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || tail -n 5 "$SESSION/frontend.log"
```

If `frontend.log` is empty after the user has been clicking around, something is wrong with the bridge — check that `/api/dev/log` returns 200 from the Network tab or by curling it. Don't proceed until you can see live log lines.

### 3. Reproduce the bug

Ask the user for the exact steps to reproduce (or do it yourself via the Claude-in-Chrome MCP browser tools). Note the wallclock time `before` and `after` so you can scope the grep to just the repro:

```bash
TS_START="2026-05-21T14:01:00Z"  # 5s before repro
TS_END="2026-05-21T14:02:00Z"    # 5s after repro
```

### 4. Grep for the smoking gun

Match by scope first to narrow down, then read what the reducer actually did:

```bash
# All actions during the repro window
grep -E "\"ts\":\"2026-05-21T14:01" "$SESSION/frontend.log" \
  | grep '"scope":"studies/node/reducer"' \
  | python3 -c 'import sys,json; [print(json.loads(l)["message"], json.loads(l)["args"]) for l in sys.stdin]'

# Just lift decisions (often the culprit)
grep '"scope":"studies/node/tree"' "$SESSION/frontend.log" | grep -i lift

# What did the autosave see?
grep '"scope":"studies/page"' "$SESSION/frontend.log" | grep saveChanges

# Backend errors
grep '"level":"error"' "$SESSION/backend.log"
```

JSONL parses cleanly with `jq`, `python3 -c 'json.loads'`, or `node -e`. Don't try to `awk` on it — the field order is stable but the values can contain commas and quotes.

### 5. State the hypothesis from the logs

Before touching code, write down in 1–2 sentences what the logs prove. Example:

> The `liftRootContent` action fired twice in the same session (lines 12 and 47), each time creating a new lifted child. Between them, `saveChanges: triggered` shows the dirty signature included an extra child. Root cause = lift not idempotent across remounts.

If you can't write that sentence from log evidence, you don't yet have a root cause — go back to step 4 with a different scope or wider window.

### 6. Fix

Apply the smallest change that makes the log entry that proved the bug *not* appear, or appear with the correct payload. Don't refactor surrounding code unless the user asked.

### 7. Re-reproduce and verify

Critical step — do not skip. The same repro must produce **different** log evidence after the fix:

```bash
# Wait for new lines after the fix and repro
tail -f "$SESSION/frontend.log" &
# Repro happens here
```

The buggy log line should be gone (e.g. no more `lift fired twice`, only one `lifting root content into new child`). Quote the new lines back to the user as proof.

### 8. Cleanup logs you added for the debug

Two flavors of cleanup, both required:

- **Temporary scaffolding logs** — if you added extra `debug.log(...)` calls to chase this specific bug, remove them. Keep only the broad-stroke logs that survive as permanent telemetry (action types, lift decisions, save attempts).
- **The session folder itself** — `npm run logs:clean` wipes everything in `.logs/`. Do this only when the user is done debugging (the folder is gitignored, so it won't pollute commits, but it does grow indefinitely).

## Anti-patterns

- **Asking "what do you see in the console?"** — the logs already capture both console mirror and full args. Read them.
- **Adding `console.log` directly** — use `createDebug('scope')` from `@/utils/debug` (client) or `createServerDebug('scope')` from `@/utils/serverDebug` (server). Direct `console.log` won't end up in the session file.
- **Reading the whole log file top-to-bottom** — JSONL is grep-friendly, use the scope/level/ts dimensions to narrow first.
- **Marking a bug fixed without step 7** — the only proof is *the same repro producing different log evidence*. A green test suite isn't enough; the test might not exercise the bug path.
- **Leaving debug logs in for "the next debug session"** — every permanent log line costs runtime allocation and console noise. If you don't want the line in mainline, delete it.

## Where things live

- `frontend/scripts/init-dev-log-session.js` — predev hook that creates `.logs/logs_<ts>/`
- `frontend/app/utils/debug.ts` — client logger (`createDebug(scope)`)
- `frontend/app/utils/serverDebug.ts` — server logger (`createServerDebug(scope)`)
- `frontend/app/api/dev/log/route.ts` — bridge endpoint, 404 in production
- `.logs/latest` — symlink to current session (use this in grep)
- `.logs/.current-session` — text file with absolute session path
- `frontend/package.json:logs:clean` — `npm run logs:clean` to wipe
