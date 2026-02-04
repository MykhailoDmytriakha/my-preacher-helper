---
name: 10-session-new-150
description: "[10] NEW. Start a NEW session for this project. Use when beginning a fresh task to load AGENTS.md, MEMORY.md, core project context (README), then create a NEW session log and confirm readiness."
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

4. **Auto-Detect & Create Session** (CRITICAL — NON-NEGOTIABLE):
   
   ### Automatic Session Creation Rules:
   
   **ALWAYS CREATE SESSION if ANY of these conditions are true:**
   - User starts conversation with NEW problem/task/feature/bug
   - User provides URL, error message, or bug description
   - User says "investigate", "fix", "implement", "analyze", "research"
   - Task is clearly distinct from previous conversation context
   - `.sessions/` directory exists but NO active session file found
   - **Confidence Level: ≥70%** that this is a NEW task
   
   **Automatically generate:**
   - Descriptive `session_name` using format: `fix-[problem]` | `implement-[feature]` | `investigate-[topic]`
   - Session filename: `.sessions/SESSION_[YYYY-MM-DD]-[session-name].md`
   - **EXECUTE IMMEDIATELY** — DO NOT ASK for permission
   
   **ONLY ASK "New or Continue?" if BOTH conditions are true:**
   - **Confidence Level: <70%** about whether task is new or continuation
   - User's message implies continuity (e.g., "continue", "next step", "also", "and then")
   - Recent session file exists with related context
   
   **Default Rule:** **When in doubt, CREATE NEW SESSION.** Session files are cheap. Lost context is expensive.

5. Initialize the Session Log:
   - Insert structure: `## Meta`, `## Progress Log`, `## Investigations`, `## Decisions`, `## Lessons Learned`, `## Current State`, `## Next Steps`.
   - Log the initial User Request in `## Meta` section.
   - Include session creation timestamp.

6. Summarize in 5-8 bullets:
   - Most relevant protocols that will affect the upcoming work.
   - Any active lessons or warnings.
   - Key project constraints (tests, tools, conventions).

7. Present the Plan & Session:
   - State "Created session: `.sessions/[session_filename]`".
   - Propose the plan for the task.
   - Ask for confirmation on the **Plan**, not the session creation.

## Notes

- If any file is missing, state it briefly and proceed with what is available.
- Keep the summary concise; focus on constraints that change behavior.
- **Session files are MANDATORY for all non-trivial tasks** (anything requiring >2 tool calls).
- If you forget to create a session, the user will lose progress tracking and lesson capture.

## Failure Recovery

**If you realize mid-task that session file was not created:**
1. **STOP immediately**
2. **CREATE session file NOW** with backfilled progress log
3. **Document the miss** as a lesson in `## Lessons Learned`
4. **Continue task** with proper session tracking

## Session Confidence Scoring

Use this internal scoring to decide:

| Confidence | Scenario | Action |
|------------|----------|--------|
| **90-100%** | Explicit new task ("fix bug X", "implement Y") | ✅ CREATE immediately |
| **70-89%** | Implied new task (URL, error, investigation query) | ✅ CREATE immediately |
| **50-69%** | Ambiguous ("also do this", "what about...") | ❓ ASK "New or Continue?" |
| **<50%** | Clear continuation ("continue", "next step") | ♻️ CONTINUE existing session |

**Critical:** Err on the side of creating new sessions. Merging sessions is easy. Reconstructing lost context is hard.

