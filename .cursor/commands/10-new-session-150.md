---
name: 10-new-session-150
description: "[10] NEW. Start a NEW session for this project. Use when beginning a fresh task to load AGENTS.md, MEMORY.md, and core project context (README), then create a NEW session log and confirm readiness."
---

# New-Session 150 Protocol

## Primary workflow

1. Read `AGENTS.md` in the repo root.

2. Read `MEMORY.md` in the repo root.
   - Load Long-Term Memory protocols first.
   - Check Lessons (Inbox) and Short-Term for active items.
   - Session State is deprecated; do not use or update it.

3. Read core project context files (if present):
   - `README.md` for project overview and commands.

4. Define the **new** `session_name`.
   - Use user-provided name; if not provided, propose a short descriptive name + date.
   - If a log with the same name exists, ask whether to continue it (switch to `11-continue-session-150`) or create a new unique name.

5. Create a NEW session log at `.sessions/SESSION_[session_name].md` **when the task is defined** and you are about to start research/work.
   - Insert minimal structure: `## Meta`, `## Progress Log`, `## Investigations`, `## Decisions`, `## Next Steps`.

6. Summarize in 5-8 bullets:
   - Most relevant protocols that will affect the upcoming work.
   - Any active lessons or warnings.
   - Key project constraints (tests, tools, conventions).

7. Ask for confirmation before making changes:
   - Confirm the planned next steps.
   - Confirm the session log name and creation.

## Notes

- If any file is missing, state it briefly and proceed with what is available.
- Keep the summary concise; focus on constraints that change behavior.
